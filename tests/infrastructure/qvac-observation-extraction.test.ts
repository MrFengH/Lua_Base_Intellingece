import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtractionContext } from '@/application';

/**
 * P4-S4 adapter sanity: exercises `QvacObservationExtractionService` against a mocked
 * `@qvac/sdk` boundary — no real model, no `npm run qvac:smoke` behaviour duplicated here. See
 * docs/ROADMAP.md, P4-S4, and docs/TESTING.md's "Integration tests" section for the adapter
 * guarantees these cover.
 */
const sdk = vi.hoisted(() => {
  const FAKE_QWEN3_600M_INST_Q4 = { name: 'QWEN3_600M_INST_Q4', engine: 'llamacpp-completion' };
  const FAKE_QWEN3_1_7B_INST_Q4 = { name: 'QWEN3_1_7B_INST_Q4', engine: 'llamacpp-completion' };
  class FakeInferenceCancelledError extends Error {
    readonly requestId: string;
    constructor(requestId: string) {
      super(`cancelled: ${requestId}`);
      this.name = 'InferenceCancelledError';
      this.requestId = requestId;
    }
  }
  return {
    FAKE_QWEN3_600M_INST_Q4,
    FAKE_QWEN3_1_7B_INST_Q4,
    FakeInferenceCancelledError,
    heartbeat: vi.fn(async () => undefined),
    loadModel: vi.fn(async () => 'loaded-model-1'),
    getLoadedModelInfo: vi.fn(async () => ({ handlers: ['llamacpp-completion'] })),
    completion: vi.fn(),
    cancel: vi.fn<(params: { requestId: string }) => Promise<undefined>>(),
    unloadModel: vi.fn(async () => undefined),
  };
});

vi.mock('@qvac/sdk', () => ({
  heartbeat: sdk.heartbeat,
  loadModel: sdk.loadModel,
  getLoadedModelInfo: sdk.getLoadedModelInfo,
  completion: sdk.completion,
  cancel: sdk.cancel,
  InferenceCancelledError: sdk.FakeInferenceCancelledError,
  unloadModel: sdk.unloadModel,
  QWEN3_600M_INST_Q4: sdk.FAKE_QWEN3_600M_INST_Q4,
  QWEN3_1_7B_INST_Q4: sdk.FAKE_QWEN3_1_7B_INST_Q4,
}));

const { QvacObservationExtractionService } = await import('@/infrastructure');

const emptyContext: ExtractionContext = {
  captureDraft: null,
  pendingQuestion: null,
  conversation: [],
  knownCustomers: [],
};

const validExtraction = {
  customer: { name: null, city: null, country: null },
  equipment: [
    {
      modality: 'Unknown',
      rawModality: null,
      quantity: null,
      manufacturer: null,
      model: null,
      approximateAge: { type: 'unknown' },
      notes: null,
      certainty: null,
    },
  ],
};

const completionResult = (contentText: string, requestId = 'req-default') => ({
  requestId,
  events: (async function* () {})(),
  final: Promise.resolve({ contentText }),
});

beforeEach(() => {
  vi.clearAllMocks();
  sdk.heartbeat.mockResolvedValue(undefined);
  sdk.loadModel.mockResolvedValue('loaded-model-1');
  sdk.getLoadedModelInfo.mockResolvedValue({ handlers: ['llamacpp-completion'] });
  sdk.unloadModel.mockResolvedValue(undefined);
  sdk.cancel.mockResolvedValue(undefined);
  sdk.completion.mockReturnValue(completionResult(JSON.stringify(validExtraction)));
});

describe('QvacObservationExtractionService: model selection and configuration', () => {
  it('loads the default registry model when no path or descriptor override is given', async () => {
    const service = new QvacObservationExtractionService();
    await service.initialize();
    expect(sdk.loadModel).toHaveBeenCalledWith(
      expect.objectContaining({ modelSrc: sdk.FAKE_QWEN3_600M_INST_Q4 }),
    );
    expect(service.getRuntimeInfo().model).toBe('QWEN3_600M_INST_Q4');
  });

  it('loads the configured registry model instead of the default', async () => {
    const service = new QvacObservationExtractionService({
      modelDescriptor: sdk.FAKE_QWEN3_1_7B_INST_Q4 as never,
    });
    await service.initialize();
    expect(sdk.loadModel).toHaveBeenCalledWith(
      expect.objectContaining({ modelSrc: sdk.FAKE_QWEN3_1_7B_INST_Q4 }),
    );
    expect(service.getRuntimeInfo().model).toBe('QWEN3_1_7B_INST_Q4');
  });

  it('prefers a local modelPath over the registry, as an explicit llamacpp-completion source', async () => {
    const service = new QvacObservationExtractionService({ modelPath: '/local/model.gguf' });
    await service.initialize();
    expect(sdk.loadModel).toHaveBeenCalledWith(
      expect.objectContaining({ modelSrc: '/local/model.gguf', modelType: 'llamacpp-completion' }),
    );
  });

  it('does not reload the model on a second initialize call (idempotent)', async () => {
    const service = new QvacObservationExtractionService();
    await service.initialize();
    await service.initialize();
    expect(sdk.loadModel).toHaveBeenCalledTimes(1);
  });
});

describe('QvacObservationExtractionService: failures are surfaced honestly', () => {
  it('leaves the runtime in error, not ready, when the model fails to load', async () => {
    sdk.loadModel.mockRejectedValueOnce(new Error('registry unreachable'));
    const service = new QvacObservationExtractionService();
    await expect(service.initialize()).rejects.toThrow('registry unreachable');
    expect(service.getRuntimeInfo().status).toBe('error');
  });

  it('never returns a fallback result when both attempts are truncated; it rejects after one retry', async () => {
    sdk.completion.mockReturnValue(
      completionResult('{"customer":{"name":null,"city":null,"country":null},"equipment":['),
    );
    const service = new QvacObservationExtractionService();
    await service.initialize();
    await expect(service.extract('test input', emptyContext)).rejects.toThrow();
    expect(service.getRuntimeInfo().status).toBe('error');
    // Retried exactly once, then gave up honestly — not silently, and not a third time.
    expect(sdk.completion).toHaveBeenCalledTimes(2);
  });

  it('rejects structured output that fails schema validation on both attempts', async () => {
    sdk.completion.mockReturnValue(
      completionResult(
        JSON.stringify({
          customer: { name: null, city: null, country: null },
          equipment: [{ ...validExtraction.equipment[0], modality: 'NotARealModality' }],
        }),
      ),
    );
    const service = new QvacObservationExtractionService();
    await service.initialize();
    await expect(service.extract('test input', emptyContext)).rejects.toThrow();
    expect(service.getRuntimeInfo().status).toBe('error');
    expect(sdk.completion).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-transient error thrown directly by completion()', async () => {
    sdk.completion.mockImplementationOnce(() => {
      throw new Error('model busy');
    });
    const service = new QvacObservationExtractionService();
    await service.initialize();
    await expect(service.extract('test input', emptyContext)).rejects.toThrow('model busy');
    expect(sdk.completion).toHaveBeenCalledTimes(1);
  });
});

describe('QvacObservationExtractionService: output cap and one-retry policy', () => {
  it('requests a bounded output-token ceiling for every attempt', async () => {
    const service = new QvacObservationExtractionService();
    await service.initialize();
    await service.extract('test input', emptyContext);
    expect(sdk.completion).toHaveBeenCalledWith(
      expect.objectContaining({ generationParams: { predict: 1024 } }),
    );
  });

  it('succeeds on the first attempt without retrying', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const service = new QvacObservationExtractionService();
    await service.initialize();
    const result = await service.extract('test input', emptyContext);
    expect(result).toEqual(validExtraction);
    expect(sdk.completion).toHaveBeenCalledTimes(1);
    expect(sdk.cancel).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('retries once on truncated JSON output and succeeds on the second attempt', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const retried = vi.fn();
    sdk.completion.mockReturnValueOnce(
      completionResult('{"customer":{"name":null,"city":null,"country":null},"equipment":['),
    );
    const service = new QvacObservationExtractionService({ onLifecycleEvent: retried });
    await service.initialize();
    const result = await service.extract('test input', emptyContext);
    expect(result).toEqual(validExtraction);
    expect(sdk.completion).toHaveBeenCalledTimes(2);
    expect(sdk.cancel).not.toHaveBeenCalled();
    expect(retried).toHaveBeenCalledWith('extraction-retried');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('cancels an in-flight attempt that exceeds the timeout, then retries once and succeeds', async () => {
    vi.useFakeTimers();
    try {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      let resolveEventsClosed: () => void;
      let rejectFinal: (error: unknown) => void;
      const hangingEvents = (async function* (): AsyncGenerator<never> {
        await new Promise<void>((resolve) => {
          resolveEventsClosed = resolve;
        });
      })();
      const hangingFinal = new Promise((_resolve, reject) => {
        rejectFinal = reject;
      });
      sdk.cancel.mockImplementationOnce(async ({ requestId }: { requestId: string }) => {
        resolveEventsClosed();
        rejectFinal(new sdk.FakeInferenceCancelledError(requestId));
      });
      sdk.completion.mockReturnValueOnce({
        requestId: 'req-timeout-1',
        events: hangingEvents,
        final: hangingFinal,
      });
      const retried = vi.fn();
      const service = new QvacObservationExtractionService({
        extractionTimeoutMs: 1_000,
        onLifecycleEvent: retried,
      });
      await service.initialize();

      const resultPromise = service.extract('test input', emptyContext);
      await vi.advanceTimersByTimeAsync(1_000);
      const result = await resultPromise;

      expect(result).toEqual(validExtraction);
      expect(sdk.cancel).toHaveBeenCalledWith({ requestId: 'req-timeout-1' });
      expect(sdk.completion).toHaveBeenCalledTimes(2);
      expect(retried).toHaveBeenCalledWith('extraction-retried');
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up honestly, without a second retry, when the timeout recurs on the retry attempt', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const makeHangingRun = (requestId: string) => {
        let resolveEventsClosed: () => void;
        let rejectFinal: (error: unknown) => void;
        const events = (async function* (): AsyncGenerator<never> {
          await new Promise<void>((resolve) => {
            resolveEventsClosed = resolve;
          });
        })();
        const final = new Promise((_resolve, reject) => {
          rejectFinal = reject;
        });
        return {
          run: { requestId, events, final },
          settle: () => {
            resolveEventsClosed();
            rejectFinal(new sdk.FakeInferenceCancelledError(requestId));
          },
        };
      };
      const first = makeHangingRun('req-timeout-1');
      const second = makeHangingRun('req-timeout-2');
      sdk.cancel.mockImplementation(async ({ requestId }: { requestId: string }) => {
        (requestId === first.run.requestId ? first : second).settle();
      });
      sdk.completion.mockReturnValueOnce(first.run).mockReturnValueOnce(second.run);
      const service = new QvacObservationExtractionService({ extractionTimeoutMs: 1_000 });
      await service.initialize();

      const resultPromise = service.extract('test input', emptyContext);
      resultPromise.catch(() => undefined); // observed below; silence the unhandled-rejection race
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(1_000);

      await expect(resultPromise).rejects.toThrow();
      expect(service.getRuntimeInfo().status).toBe('error');
      expect(sdk.completion).toHaveBeenCalledTimes(2);
      expect(sdk.cancel).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('QvacObservationExtractionService: Unknown/null passthrough', () => {
  it('passes through a well-formed extraction with Unknown modality and null fields unchanged', async () => {
    const service = new QvacObservationExtractionService();
    await service.initialize();
    const result = await service.extract('test input', emptyContext);
    expect(result).toEqual(validExtraction);
  });
});

describe('QvacObservationExtractionService: absence-sentinel normalization', () => {
  it('normalizes placeholder strings the model writes instead of leaving a field absent', async () => {
    sdk.completion.mockReturnValueOnce(
      completionResult(
        JSON.stringify({
          customer: { name: 'Unknown', city: 'N/A', country: 'None' },
          equipment: [
            {
              ...validExtraction.equipment[0],
              manufacturer: 'unknown',
              model: 'Desconocido',
              notes: 'Ninguna.',
            },
          ],
        }),
      ),
    );
    const service = new QvacObservationExtractionService();
    await service.initialize();
    const result = await service.extract('test input', emptyContext);
    expect(result.customer).toEqual({ name: null, city: null, country: null });
    expect(result.equipment[0]).toMatchObject({ manufacturer: null, model: null, notes: null });
  });

  it('leaves a real value that merely contains a sentinel-like word unchanged', async () => {
    sdk.completion.mockReturnValueOnce(
      completionResult(
        JSON.stringify({
          customer: { name: null, city: null, country: null },
          equipment: [{ ...validExtraction.equipment[0], manufacturer: 'Unknown Medical Systems' }],
        }),
      ),
    );
    const service = new QvacObservationExtractionService();
    await service.initialize();
    const result = await service.extract('test input', emptyContext);
    expect(result.equipment[0]?.manufacturer).toBe('Unknown Medical Systems');
  });
});

describe('QvacObservationExtractionService: disposal', () => {
  it('unloads the model and returns the runtime to model-not-loaded', async () => {
    const service = new QvacObservationExtractionService();
    await service.initialize();
    await service.dispose();
    expect(sdk.unloadModel).toHaveBeenCalledWith({ modelId: 'loaded-model-1' });
    expect(service.getRuntimeInfo().status).toBe('model-not-loaded');
  });
});
