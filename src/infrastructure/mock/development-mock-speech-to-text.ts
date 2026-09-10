import type { InferenceRuntimeInfo } from '@/application/contracts';
import type { SpeechToTextPort } from '@/application/ports';

/**
 * Deterministic local fixture, not a production ASR engine — mirrors
 * `DevelopmentMockObservationExtractionService`. It never reads or decodes the audio file it is
 * given; it exists so `npm run dev`, `npm test`, and `npm run app:smoke` can exercise the voice
 * IPC path and UI states without real QVAC or a real microphone.
 */
export class DevelopmentMockSpeechToTextService implements SpeechToTextPort {
  readonly kind = 'development-mock' as const;
  private ready = false;
  private readonly runtime: InferenceRuntimeInfo = {
    engine: 'Development Mock',
    execution: 'Development only',
    model: 'Analizador de voz de fixture determinista',
    networkRequiredForInference: false,
    status: 'model-not-loaded',
    detail: 'No válido para la demo final de QVAC.',
    progressPercent: 100,
  };

  async initialize(): Promise<InferenceRuntimeInfo> {
    this.ready = true;
    return this.getRuntimeInfo();
  }

  getRuntimeInfo(): InferenceRuntimeInfo {
    return { ...this.runtime, status: this.ready ? 'ready' : 'model-not-loaded' };
  }

  async transcribe(localAudioPath: string): Promise<{ text: string }> {
    void localAudioPath; // the fixture never reads the file; the port contract still takes a path
    if (!this.ready) await this.initialize();
    return { text: 'Transcripción simulada del simulador de desarrollo.' };
  }

  async dispose(): Promise<void> {
    this.ready = false;
  }
}
