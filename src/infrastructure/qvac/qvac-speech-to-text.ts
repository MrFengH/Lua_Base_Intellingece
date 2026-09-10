import {
  getLoadedModelInfo,
  heartbeat,
  loadModel,
  transcribe,
  unloadModel,
  WHISPER_TINY_Q8_0,
} from '@qvac/sdk';

/**
 * Re-exported so callers outside `src/infrastructure/qvac/**` can reference the selected registry
 * descriptor (e.g. for logging or tests) without importing `@qvac/sdk` directly, which
 * `AGENTS.md` reserves for this directory.
 */
export { WHISPER_TINY_Q8_0 };
import { InferenceRuntimeInfoSchema, type InferenceRuntimeInfo } from '@/application/contracts';
import type { SpeechToTextPort } from '@/application/ports';

export type QvacSpeechToTextLifecycleEvent =
  'runtime-initialized' | 'model-loaded' | 'transcription-completed';

export interface QvacSpeechToTextConfig {
  /** A locally provisioned Whisper GGML/GGUF file, taking priority over the registry descriptor. */
  modelPath?: string;
  modelName?: string;
  onLifecycleEvent?: (event: QvacSpeechToTextLifecycleEvent) => void;
}

/**
 * Local speech-to-text via `@qvac/sdk`'s `whispercpp-transcription` engine. See
 * docs/MODEL_STRATEGY.md's "Speech to text" capability for why `WHISPER_TINY_Q8_0` was selected,
 * and docs/QVAC_ARCHITECTURE.md for why this model is loaded lazily on first use and unloaded on
 * disposal rather than kept resident for the whole app session like the completion model: its
 * memory cost alongside the completion model has not been measured.
 */
export class QvacSpeechToTextService implements SpeechToTextPort {
  readonly kind = 'qvac' as const;
  private modelId: string | null = null;
  private runtime: InferenceRuntimeInfo;

  constructor(private readonly config: QvacSpeechToTextConfig = {}) {
    this.runtime = {
      engine: 'QVAC',
      execution: 'On-device',
      model: config.modelName ?? config.modelPath ?? WHISPER_TINY_Q8_0.name,
      networkRequiredForInference: false,
      status: 'model-not-loaded',
      detail:
        'La inicialización del modelo de voz es explícita; la primera descarga puede requerir acceso a la red.',
      progressPercent: null,
    };
  }

  async initialize(): Promise<InferenceRuntimeInfo> {
    if (this.modelId) return this.getRuntimeInfo();
    try {
      this.setRuntime({
        status: 'loading',
        detail: 'Inicializando el proceso local de QVAC para voz.',
      });
      await heartbeat();
      this.config.onLifecycleEvent?.('runtime-initialized');

      const onProgress = (progress: { percentage: number }): void => {
        this.setRuntime({
          status: progress.percentage < 100 ? 'downloading' : 'loading',
          detail:
            progress.percentage < 100
              ? 'Descargando el modelo de voz a la caché local.'
              : 'Cargando el modelo de voz en este dispositivo.',
          progressPercent: Math.max(0, Math.min(100, progress.percentage)),
        });
      };
      const modelConfig = {
        // Auto-detect between the observer's two working languages (Spanish, English) rather than
        // assuming one. Never translate: a translated transcript would silently change the exact
        // words the extraction pipeline and evidence record are built from.
        language: 'auto',
        translate: false,
      };
      if (this.config.modelPath) {
        this.modelId = await loadModel({
          modelSrc: this.config.modelPath,
          modelType: 'whispercpp-transcription',
          modelConfig,
          onProgress,
        });
      } else {
        this.modelId = await loadModel({ modelSrc: WHISPER_TINY_Q8_0, modelConfig, onProgress });
      }
      const info = await getLoadedModelInfo({ modelId: this.modelId });
      if (!info.handlers.some((handler) => handler.toLocaleLowerCase('en').includes('transcri'))) {
        throw new Error('El modelo de voz cargado no expone un controlador de transcripción.');
      }
      this.config.onLifecycleEvent?.('model-loaded');
      this.setRuntime({
        status: 'ready',
        detail: `Cargado localmente como ${this.modelId}.`,
        progressPercent: 100,
      });
      return this.getRuntimeInfo();
    } catch (error) {
      this.modelId = null;
      this.setRuntime({
        status: 'error',
        detail:
          error instanceof Error ? error.message : 'Error desconocido al inicializar la voz QVAC.',
      });
      throw error;
    }
  }

  getRuntimeInfo(): InferenceRuntimeInfo {
    return InferenceRuntimeInfoSchema.parse({ ...this.runtime });
  }

  /**
   * Loads the model on first use ("entering voice capture") rather than requiring a separate
   * explicit init call from the renderer — push-to-talk has one user action, not two. Subsequent
   * calls in the same session reuse the already-loaded model.
   */
  async transcribe(localAudioPath: string): Promise<{ text: string }> {
    if (!this.modelId) await this.initialize();
    const modelId = this.modelId;
    if (!modelId) {
      throw new Error('QVAC no está inicializado. Cargue el modelo de voz antes de transcribir.');
    }
    this.setRuntime({ status: 'processing', detail: 'QVAC está transcribiendo localmente.' });
    try {
      const text = await transcribe({ modelId, audioChunk: localAudioPath });
      this.setRuntime({
        status: 'ready',
        detail: 'Última transcripción completada en el dispositivo.',
      });
      this.config.onLifecycleEvent?.('transcription-completed');
      return { text: text.trim() };
    } catch (error) {
      this.setRuntime({
        status: 'error',
        detail: error instanceof Error ? error.message : 'Error desconocido de transcripción QVAC.',
      });
      throw error;
    }
  }

  async dispose(): Promise<void> {
    if (!this.modelId) return;
    const modelId = this.modelId;
    this.modelId = null;
    await unloadModel({ modelId });
    this.setRuntime({
      status: 'model-not-loaded',
      detail: 'El modelo de voz QVAC fue descargado de memoria.',
      progressPercent: null,
    });
  }

  private setRuntime(update: Partial<InferenceRuntimeInfo>): void {
    this.runtime = { ...this.runtime, ...update };
  }
}
