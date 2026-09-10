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
  return {
    FAKE_QWEN3_600M_INST_Q4,
    FAKE_QWEN3_1_7B_INST_Q4,
    heartbeat: vi.fn(async () => undefined),
    loadModel: vi.fn(async () => 'loaded-model-1'),
    getLoadedModelInfo: vi.fn(async () => ({ handlers: ['llamacpp-completion'] })),
    completion: vi.fn(),
    unloadModel: vi.fn(async () => undefined),
  };
});

vi.mock('@qvac/sdk', () => ({
  heartbeat: sdk.heartbeat,
  loadModel: sdk.loadModel,
  getLoadedModelInfo: sdk.getLoadedModelInfo,
  completion: sdk.completion,
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

const completionResult = (contentText: string) => ({
  events: (async function* () {})(),
  final: Promise.resolve({ contentText }),
});

beforeEach(() => {
  vi.clearAllMocks();
  sdk.heartbeat.mockResolvedValue(undefined);
  sdk.loadModel.mockResolvedValue('loaded-model-1');
  sdk.getLoadedModelInfo.mockResolvedValue({ handlers: ['llamacpp-completion'] });
  sdk.unloadModel.mockResolvedValue(undefined);
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

  it('never returns a fallback result on truncated model output; it rejects', async () => {
    sdk.completion.mockReturnValueOnce(
      completionResult('{"customer":{"name":null,"city":null,"country":null},"equipment":['),
    );
    const service = new QvacObservationExtractionService();
    await service.initialize();
    await expect(service.extract('test input', emptyContext)).rejects.toThrow();
    expect(service.getRuntimeInfo().status).toBe('error');
  });

  it('rejects structured output that parses as JSON but fails schema validation', async () => {
    sdk.completion.mockReturnValueOnce(
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
