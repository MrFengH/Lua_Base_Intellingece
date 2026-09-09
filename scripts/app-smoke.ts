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
            rendered: document.body.innerText.includes('Turn field notes into traceable evidence.'),
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
    await cdp.send('Page.reload', { ignoreCache: true });
    const probe = await waitForProbe(cdp.evaluate);
    await delay(250);

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

    socket.send(JSON.stringify({ id: 10_000, method: 'Browser.close' }));
    await waitForExit(electronProcess);
  } finally {
    if (socket?.readyState === WebSocket.OPEN) socket.close();
    if (electronProcess && electronProcess.exitCode === null) {
      electronProcess.kill();
      await waitForExit(electronProcess);
    }
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
};

try {
  await run();
} catch (error) {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
