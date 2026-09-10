import { describe, expect, it } from 'vitest';
import { DevelopmentMockSpeechToTextService } from '@/infrastructure';

describe('Development Mock speech-to-text fixture', () => {
  it('reports model-not-loaded until initialized, then ready', async () => {
    const service = new DevelopmentMockSpeechToTextService();
    expect(service.getRuntimeInfo().status).toBe('model-not-loaded');
    await service.initialize();
    expect(service.getRuntimeInfo().status).toBe('ready');
    expect(service.getRuntimeInfo().engine).toBe('Development Mock');
  });

  it('returns a clearly-labelled fixture transcript, never real speech recognition', async () => {
    const service = new DevelopmentMockSpeechToTextService();
    const result = await service.transcribe('/tmp/whatever.wav');
    expect(result.text).toContain('simulada');
  });

  it('lazily initializes on first transcribe call, same contract as the real adapter', async () => {
    const service = new DevelopmentMockSpeechToTextService();
    expect(service.getRuntimeInfo().status).toBe('model-not-loaded');
    await service.transcribe('/tmp/whatever.wav');
    expect(service.getRuntimeInfo().status).toBe('ready');
  });

  it('returns to model-not-loaded on disposal', async () => {
    const service = new DevelopmentMockSpeechToTextService();
    await service.initialize();
    await service.dispose();
    expect(service.getRuntimeInfo().status).toBe('model-not-loaded');
  });
});
