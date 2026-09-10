import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Adapter sanity for `QvacSpeechToTextService`, mirroring
 * `tests/infrastructure/qvac-observation-extraction.test.ts`: exercises the adapter against a
 * mocked `@qvac/sdk` boundary — no real model, no microphone, no `npm run qvac:smoke` behaviour
 * duplicated here.
 */
const sdk = vi.hoisted(() => {
  const FAKE_WHISPER_TINY_Q8_0 = { name: 'WHISPER_TINY_Q8_0', engine: 'whispercpp-transcription' };
  return {
    FAKE_WHISPER_TINY_Q8_0,
    heartbeat: vi.fn(async () => undefined),
    loadModel: vi.fn(async () => 'loaded-voice-model-1'),
    getLoadedModelInfo: vi.fn(async () => ({ handlers: ['whispercpp-transcription'] })),
    transcribe: vi.fn(async () => 'hola, tengo dos resonadores'),
    unloadModel: vi.fn(async () => undefined),
  };
});

vi.mock('@qvac/sdk', () => ({
  heartbeat: sdk.heartbeat,
  loadModel: sdk.loadModel,
  getLoadedModelInfo: sdk.getLoadedModelInfo,
  transcribe: sdk.transcribe,
  unloadModel: sdk.unloadModel,
  WHISPER_TINY_Q8_0: sdk.FAKE_WHISPER_TINY_Q8_0,
}));

const { QvacSpeechToTextService } = await import('@/infrastructure');

beforeEach(() => {
  vi.clearAllMocks();
  sdk.heartbeat.mockResolvedValue(undefined);
  sdk.loadModel.mockResolvedValue('loaded-voice-model-1');
  sdk.getLoadedModelInfo.mockResolvedValue({ handlers: ['whispercpp-transcription'] });
  sdk.transcribe.mockResolvedValue('hola, tengo dos resonadores');
  sdk.unloadModel.mockResolvedValue(undefined);
});

describe('QvacSpeechToTextService: model selection and configuration', () => {
  it('loads the default registry model (WHISPER_TINY_Q8_0) when no local path is given', async () => {
    const service = new QvacSpeechToTextService();
    await service.initialize();
    expect(sdk.loadModel).toHaveBeenCalledWith(
      expect.objectContaining({ modelSrc: sdk.FAKE_WHISPER_TINY_Q8_0 }),
    );
    expect(service.getRuntimeInfo().model).toBe('WHISPER_TINY_Q8_0');
  });

  it('prefers a local modelPath over the registry, as an explicit whispercpp-transcription source', async () => {
    const service = new QvacSpeechToTextService({ modelPath: '/local/whisper.bin' });
    await service.initialize();
    expect(sdk.loadModel).toHaveBeenCalledWith(
      expect.objectContaining({
        modelSrc: '/local/whisper.bin',
        modelType: 'whispercpp-transcription',
      }),
    );
  });

  it('auto-detects language and never translates, so the transcript stays in the words spoken', async () => {
    const service = new QvacSpeechToTextService();
    await service.initialize();
    expect(sdk.loadModel).toHaveBeenCalledWith(
      expect.objectContaining({ modelConfig: { language: 'auto', translate: false } }),
    );
  });

  it('does not reload the model on a second initialize call (idempotent)', async () => {
    const service = new QvacSpeechToTextService();
    await service.initialize();
    await service.initialize();
    expect(sdk.loadModel).toHaveBeenCalledTimes(1);
  });
});

describe('QvacSpeechToTextService: lazy load on first use', () => {
  it('loads the model automatically on the first transcribe call, with no separate initialize needed', async () => {
    const service = new QvacSpeechToTextService();
    expect(service.getRuntimeInfo().status).toBe('model-not-loaded');

    const result = await service.transcribe('/tmp/observation.wav');

    expect(sdk.loadModel).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ text: 'hola, tengo dos resonadores' });
  });

  it('reuses the already-loaded model on a second transcribe call', async () => {
    const service = new QvacSpeechToTextService();
    await service.transcribe('/tmp/one.wav');
    await service.transcribe('/tmp/two.wav');
    expect(sdk.loadModel).toHaveBeenCalledTimes(1);
    expect(sdk.transcribe).toHaveBeenCalledTimes(2);
  });
});

describe('QvacSpeechToTextService: successful transcription', () => {
  it('passes the local audio path straight through and returns the trimmed transcript', async () => {
    sdk.transcribe.mockResolvedValueOnce('  hay dos equipos NovaMed  ');
    const service = new QvacSpeechToTextService();
    await service.initialize();
    const result = await service.transcribe('/tmp/observation.wav');
    expect(sdk.transcribe).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: 'loaded-voice-model-1',
        audioChunk: '/tmp/observation.wav',
      }),
    );
    expect(result).toEqual({ text: 'hay dos equipos NovaMed' });
    expect(service.getRuntimeInfo().status).toBe('ready');
  });
});

describe('QvacSpeechToTextService: failures are surfaced honestly', () => {
  it('leaves the runtime in error, not ready, when the model fails to load', async () => {
    sdk.loadModel.mockRejectedValueOnce(new Error('registry unreachable'));
    const service = new QvacSpeechToTextService();
    await expect(service.initialize()).rejects.toThrow('registry unreachable');
    expect(service.getRuntimeInfo().status).toBe('error');
  });

  it('surfaces a transcription failure as an error status and rethrows, never returning empty text as if it were a real result', async () => {
    sdk.transcribe.mockRejectedValueOnce(new Error('audio decode failed'));
    const service = new QvacSpeechToTextService();
    await service.initialize();
    await expect(service.transcribe('/tmp/bad.wav')).rejects.toThrow('audio decode failed');
    expect(service.getRuntimeInfo().status).toBe('error');
  });

  it('rejects when the loaded model exposes no transcription handler', async () => {
    sdk.getLoadedModelInfo.mockResolvedValueOnce({ handlers: ['llamacpp-completion'] });
    const service = new QvacSpeechToTextService();
    await expect(service.initialize()).rejects.toThrow(/controlador de transcripción/);
    expect(service.getRuntimeInfo().status).toBe('error');
  });
});

describe('QvacSpeechToTextService: disposal', () => {
  it('unloads the model and returns the runtime to model-not-loaded', async () => {
    const service = new QvacSpeechToTextService();
    await service.initialize();
    await service.dispose();
    expect(sdk.unloadModel).toHaveBeenCalledWith({ modelId: 'loaded-voice-model-1' });
    expect(service.getRuntimeInfo().status).toBe('model-not-loaded');
  });

  it('is a no-op when disposed before ever being loaded', async () => {
    const service = new QvacSpeechToTextService();
    await service.dispose();
    expect(sdk.unloadModel).not.toHaveBeenCalled();
  });
});
