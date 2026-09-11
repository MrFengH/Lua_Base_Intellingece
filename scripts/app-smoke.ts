import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';

interface CdpMessage {
  id?: number;
  method?: string;
  params?: {
    type?: string;
    entry?: { level?: string };
  };
  result?: {
    result?: { value?: unknown };
    exceptionDetails?: {
      text?: string;
      exception?: { description?: string };
    };
  };
  error?: { message?: string };
}

interface AppProbe {
  apiType: string;
  methodType: string;
  rootChildren: number;
  rendered: boolean;
  statusOk: boolean;
  engine: string | null;
  runtimeStatus: string | null;
}

interface ComposerProbe {
  input: string;
  processing: boolean;
  optimisticTexts: string[];
}

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const reserveLoopbackPort = async (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not reserve a loopback port for the app smoke.'));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });

const waitForPage = async (
  port: number,
  electronProcess: ChildProcess,
  diagnostics: () => string,
): Promise<{ webSocketDebuggerUrl: string }> => {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (electronProcess.exitCode !== null) {
      throw new Error(`Electron exited before opening a page.\n${diagnostics()}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const pages = (await response.json()) as Array<{ webSocketDebuggerUrl?: string }>;
        const page = pages.find((candidate) => candidate.webSocketDebuggerUrl);
        if (page?.webSocketDebuggerUrl) {
          return { webSocketDebuggerUrl: page.webSocketDebuggerUrl };
        }
      }
    } catch {
      // The local debugging endpoint is expected to refuse connections until Chromium starts.
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for Electron to open a page.\n${diagnostics()}`);
};

const connect = async (url: string): Promise<WebSocket> => {
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out connecting to Chromium.')), 5_000);
    socket.addEventListener(
      'open',
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      'error',
      () => {
        clearTimeout(timeout);
        reject(new Error('Could not connect to Chromium.'));
      },
      { once: true },
    );
  });
  return socket;
};

const parseMessage = (event: MessageEvent): CdpMessage =>
  JSON.parse(String(event.data)) as CdpMessage;

const createCdpClient = (socket: WebSocket) => {
  let nextId = 0;
  const errors: CdpMessage[] = [];

  socket.addEventListener('message', (event) => {
    const message = parseMessage(event);
    if (
      message.method === 'Runtime.exceptionThrown' ||
      (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') ||
      (message.method === 'Log.entryAdded' && message.params?.entry?.level === 'error')
    ) {
      errors.push(message);
    }
  });

  const send = async (method: string, params: Record<string, unknown> = {}): Promise<CdpMessage> =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      const timeout = setTimeout(() => {
        socket.removeEventListener('message', receive);
        reject(new Error(`Timed out waiting for Chromium command ${method}.`));
      }, 5_000);
      const receive = (event: MessageEvent): void => {
        const message = parseMessage(event);
        if (message.id !== id) return;
        clearTimeout(timeout);
        socket.removeEventListener('message', receive);
        if (message.error) {
          reject(new Error(message.error.message ?? `Chromium command ${method} failed.`));
          return;
        }
        resolve(message);
      };
      socket.addEventListener('message', receive);
      socket.send(JSON.stringify({ id, method, params }));
    });

  const evaluate = async (expression: string): Promise<unknown> => {
    const message = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    const exception = message.result?.exceptionDetails;
    if (exception) {
      throw new Error(
        exception.exception?.description ?? exception.text ?? 'Renderer evaluation failed.',
      );
    }
    return message.result?.result?.value;
  };

  return { errors, evaluate, send };
};

const readProbe = (value: unknown): AppProbe | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<AppProbe>;
  if (
    typeof candidate.apiType !== 'string' ||
    typeof candidate.methodType !== 'string' ||
    typeof candidate.rootChildren !== 'number' ||
    typeof candidate.rendered !== 'boolean' ||
    typeof candidate.statusOk !== 'boolean'
  ) {
    return null;
  }
  return {
    apiType: candidate.apiType,
    methodType: candidate.methodType,
    rootChildren: candidate.rootChildren,
    rendered: candidate.rendered,
    statusOk: candidate.statusOk,
    engine: typeof candidate.engine === 'string' ? candidate.engine : null,
    runtimeStatus: typeof candidate.runtimeStatus === 'string' ? candidate.runtimeStatus : null,
  };
};

const waitForProbe = async (
  evaluate: (expression: string) => Promise<unknown>,
): Promise<AppProbe> => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const probe = readProbe(
        await evaluate(`(async () => {
          const api = window.installedBaseApi;
          const status = api ? await api.getInferenceStatus() : null;
          return {
            apiType: typeof api,
            methodType: typeof api?.getInferenceStatus,
            rootChildren: document.querySelector('#root')?.childElementCount ?? 0,
            rendered: document.body.innerText.includes(
              'Convierta notas de campo en evidencia trazable.',
            ),
            statusOk: status?.ok === true,
            engine: status?.ok ? status.data.engine : null,
            runtimeStatus: status?.ok ? status.data.status : null,
          };
        })()`),
      );
      if (probe?.statusOk && probe.rendered && probe.rootChildren > 0) return probe;
    } catch {
      // Reload briefly destroys the execution context; retry against the new one.
    }
    await delay(100);
  }
  throw new Error('The preload API or React interface did not become ready.');
};

const submitThroughComposer = async (
  evaluate: (expression: string) => Promise<unknown>,
  send: (method: string, params?: Record<string, unknown>) => Promise<CdpMessage>,
  text: string,
): Promise<ComposerProbe> => {
  await evaluate(`(() => {
    const textarea = document.querySelector('.composer textarea');
    if (!(textarea instanceof HTMLTextAreaElement)) {
      throw new Error('Capture composer was not available.');
    }
    textarea.focus();
  })()`);
  await send('Input.insertText', { text });
  await delay(25);
  await evaluate(`(() => {
    const textarea = document.querySelector('.composer textarea');
    const button = document.querySelector('.composer .primary-button');
    if (!(textarea instanceof HTMLTextAreaElement) || !(button instanceof HTMLButtonElement)) {
      throw new Error('Capture composer was not available.');
    }
    if (!button.disabled) return;
    const propsKey = Object.keys(textarea).find((key) => key.startsWith('__reactProps'));
    const onChange = propsKey
      ? textarea[propsKey]?.onChange
      : undefined;
    if (typeof onChange !== 'function') {
      throw new Error('Could not drive the controlled capture textarea.');
    }
    onChange({ target: { value: textarea.value } });
  })()`);
  await delay(25);
  const value = await evaluate(`(async () => {
    const textarea = document.querySelector('.composer textarea');
    const button = document.querySelector('.composer .primary-button');
    const transcript = document.querySelector('.transcript-log');
    if (!(textarea instanceof HTMLTextAreaElement) || !(button instanceof HTMLButtonElement)) {
      throw new Error('Capture composer was not available.');
    }
    if (!(transcript instanceof HTMLDivElement)) {
      throw new Error('Capture transcript was not available.');
    }
    const observed = { input: textarea.value, processing: false, optimisticTexts: [] };
    const immediateState = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        observer.disconnect();
        reject(new Error('Optimistic renderer state was not observed.'));
      }, 2_000);
      const inspect = () => {
        if (textarea.value === '') observed.input = '';
        if (button.textContent?.includes('Procesando') === true) observed.processing = true;
        const optimisticTexts = [...document.querySelectorAll('[data-message-state="optimistic"]')]
          .map((node) => node.textContent ?? '');
        if (optimisticTexts.length > 0) observed.optimisticTexts = optimisticTexts;
        if (
          observed.input === '' &&
          observed.processing &&
          observed.optimisticTexts.length > 0
        ) {
          clearTimeout(timeout);
          observer.disconnect();
          resolve(observed);
        }
      };
      const observer = new MutationObserver(inspect);
      observer.observe(document.querySelector('.capture-screen'), {
        attributes: true,
        childList: true,
        characterData: true,
        subtree: true,
      });
      inspect();
    });
    button.click();
    // A second event in the same renderer turn exercises the synchronous in-flight guard before
    // React has any opportunity to commit the disabled state.
    button.click();
    return await immediateState;
  })()`);
  if (!value || typeof value !== 'object') throw new Error('Invalid composer probe result.');
  const candidate = value as Partial<ComposerProbe>;
  if (
    typeof candidate.input !== 'string' ||
    typeof candidate.processing !== 'boolean' ||
    !Array.isArray(candidate.optimisticTexts)
  ) {
    throw new Error(`Invalid composer probe result: ${JSON.stringify(value)}`);
  }
  return candidate as ComposerProbe;
};

const waitForSubmittedTurn = async (
  evaluate: (expression: string) => Promise<unknown>,
  text: string,
): Promise<{ userMatches: number; assistantMessages: number }> => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const value = await evaluate(`(() => {
      const userTexts = [...document.querySelectorAll('.transcript-entry.role-user .transcript-text')]
        .map((node) => node.textContent ?? '');
      return {
        userMatches: userTexts.filter((content) => content === ${JSON.stringify(text)}).length,
        assistantMessages: document.querySelectorAll('.transcript-entry.role-assistant').length,
        optimisticMessages: document.querySelectorAll('[data-message-state="optimistic"]').length,
        processing: document.querySelector('.composer .primary-button')?.textContent
          ?.includes('Procesando') === true,
      };
    })()`);
    const candidate = value as {
      userMatches?: number;
      assistantMessages?: number;
      optimisticMessages?: number;
      processing?: boolean;
    };
    if (
      candidate.userMatches === 1 &&
      (candidate.assistantMessages ?? 0) > 0 &&
      candidate.optimisticMessages === 0 &&
      candidate.processing === false
    ) {
      return {
        userMatches: candidate.userMatches,
        assistantMessages: candidate.assistantMessages ?? 0,
      };
    }
    await delay(25);
  }
  throw new Error(`Capture turn did not settle exactly once: ${text}`);
};

const waitForCaptureComposer = async (
  evaluate: (expression: string) => Promise<unknown>,
): Promise<void> => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const captureId = await evaluate(
      `document.querySelector('.transcript-log')?.getAttribute('data-capture-id') ?? null`,
    );
    if (typeof captureId === 'string' && captureId.length > 0) return;
    await delay(25);
  }
  throw new Error('Capture session did not become ready.');
};

const waitForExit = async (electronProcess: ChildProcess): Promise<void> => {
  if (electronProcess.exitCode !== null) return;
  await Promise.race([
    new Promise<void>((resolve) => electronProcess.once('exit', () => resolve())),
    delay(5_000),
  ]);
};

const run = async (): Promise<void> => {
  const projectRoot = process.cwd();
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'cib-app-smoke-'));
  const databasePath = join(temporaryDirectory, 'installed-base.sqlite');
  const userDataPath = join(temporaryDirectory, 'electron-user-data');
  const port = await reserveLoopbackPort();
  const require = createRequire(import.meta.url);
  const resolvedElectronPath: unknown = require('electron');
  if (typeof resolvedElectronPath !== 'string') {
    throw new Error('The Electron executable path could not be resolved.');
  }

  const childEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    CIB_DATABASE_PATH: databasePath,
    CIB_INFERENCE_MODE: 'mock',
  };
  delete childEnvironment.ELECTRON_RUN_AS_NODE;

  let standardOutput = '';
  let standardError = '';
  let electronProcess: ChildProcess | null = null;
  let socket: WebSocket | null = null;

  try {
    electronProcess = spawn(
      resolvedElectronPath,
      ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${userDataPath}`],
      {
        cwd: projectRoot,
        env: childEnvironment,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    electronProcess.stdout?.setEncoding('utf8');
    electronProcess.stderr?.setEncoding('utf8');
    electronProcess.stdout?.on('data', (chunk: string) => {
      standardOutput += chunk;
    });
    electronProcess.stderr?.on('data', (chunk: string) => {
      standardError += chunk;
    });
    const diagnostics = (): string => `${standardOutput}\n${standardError}`.trim();

    const page = await waitForPage(port, electronProcess, diagnostics);
    socket = await connect(page.webSocketDebuggerUrl);
    const cdp = createCdpClient(socket);
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Page.enable');
    const probe = await waitForProbe(cdp.evaluate);
    await waitForCaptureComposer(cdp.evaluate);

    const completeObservation =
      'Estoy en Hospital DemoCare Pacific, en Panamá. Vi dos resonadores NovaMed modelo NM-MR 700 de unos 7 años y un tomógrafo Aurelia Health de aproximadamente 5 años.';
    const immediateObservation = await submitThroughComposer(
      cdp.evaluate,
      cdp.send,
      completeObservation,
    );
    if (
      immediateObservation.input !== '' ||
      !immediateObservation.processing ||
      immediateObservation.optimisticTexts.filter((text) => text.includes(completeObservation))
        .length !== 1
    ) {
      throw new Error(
        `Complete observation did not render immediately: ${JSON.stringify(immediateObservation)}`,
      );
    }
    await waitForSubmittedTurn(cdp.evaluate, completeObservation);
    const structuredEquipmentVisible = await cdp.evaluate(
      `document.querySelectorAll('.equipment-ledger tbody tr').length > 0`,
    );
    if (structuredEquipmentVisible !== true) {
      throw new Error(
        'Complete observation did not produce a visible structured equipment record.',
      );
    }

    const followUpAnswer = 'NovaMed';
    const immediateFollowUp = await submitThroughComposer(cdp.evaluate, cdp.send, followUpAnswer);
    if (
      immediateFollowUp.input !== '' ||
      immediateFollowUp.optimisticTexts.filter((text) => text.includes(followUpAnswer)).length !== 1
    ) {
      throw new Error(`Follow-up did not render immediately: ${JSON.stringify(immediateFollowUp)}`);
    }
    await waitForSubmittedTurn(cdp.evaluate, followUpAnswer);

    await cdp.send('Page.reload', { ignoreCache: true });
    await waitForProbe(cdp.evaluate);
    await waitForCaptureComposer(cdp.evaluate);
    const greeting = 'hola';
    const immediateGreeting = await submitThroughComposer(cdp.evaluate, cdp.send, greeting);
    if (
      immediateGreeting.input !== '' ||
      !immediateGreeting.processing ||
      immediateGreeting.optimisticTexts.filter((text) => text.includes(greeting)).length !== 1
    ) {
      throw new Error(
        `Optimistic send did not render immediately: ${JSON.stringify(immediateGreeting)}`,
      );
    }
    await waitForSubmittedTurn(cdp.evaluate, greeting);

    if (cdp.errors.length > 0) {
      throw new Error(`Renderer or preload errors were reported:\n${JSON.stringify(cdp.errors)}`);
    }
    if (
      probe.apiType !== 'object' ||
      probe.methodType !== 'function' ||
      probe.engine !== 'Development Mock' ||
      probe.runtimeStatus !== 'ready'
    ) {
      throw new Error(`Unexpected preload probe result: ${JSON.stringify(probe)}`);
    }
    if (!existsSync(databasePath)) throw new Error('Electron did not create the SQLite database.');

    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const row = database
        .prepare(
          "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'observation_sessions'",
        )
        .get() as { count: number };
      if (row.count !== 1) throw new Error('The application database schema was not initialized.');
    } finally {
      database.close();
    }

    console.log('PASS: Electron opened the built application');
    console.log('PASS: sandboxed CommonJS preload exposed window.installedBaseApi');
    console.log('PASS: getInferenceStatus returned Development Mock ready');
    console.log('PASS: React rendered the capture interface without console errors');
    console.log('PASS: SQLite database and application schema were created');
    console.log(
      'PASS: user messages rendered optimistically, cleared input, and showed processing',
    );
    console.log(
      'PASS: same-turn duplicate submit was rejected and authoritative state rendered once',
    );
    console.log('PASS: a follow-up answer rendered and reconciled exactly once');
    console.log('PASS: a complete observation produced visible structured equipment');

    socket.send(JSON.stringify({ id: 10_000, method: 'Browser.close' }));
    await waitForExit(electronProcess);
  } finally {
    if (socket?.readyState === WebSocket.OPEN) socket.close();
    if (electronProcess && electronProcess.exitCode === null) {
      electronProcess.kill();
      await waitForExit(electronProcess);
    }
    try {
      rmSync(temporaryDirectory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    } catch (error) {
      // Chromium utility processes can retain Windows file handles briefly after the browser has
      // exited. A cleanup race must not turn successful application assertions into a smoke-test
      // failure; the OS temp directory remains the only affected location.
      console.warn(
        `WARN: temporary smoke directory could not be removed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
};

try {
  await run();
} catch (error) {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
