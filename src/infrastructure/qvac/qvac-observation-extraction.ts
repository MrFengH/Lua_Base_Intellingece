import { z } from 'zod';
import {
  completion,
  getLoadedModelInfo,
  heartbeat,
  loadModel,
  QWEN3_600M_INST_Q4,
  unloadModel,
} from '@qvac/sdk';
import {
  InferenceRuntimeInfoSchema,
  ObservationExtractionSchema,
  type InferenceRuntimeInfo,
  type ObservationExtraction,
} from '@/application/contracts';
import type { ExtractionContext, ObservationExtractionPort } from '@/application/ports';
import {
  buildObservationExtractionPrompt,
  OBSERVATION_EXTRACTOR_SYSTEM_PROMPT,
} from '@/application/prompts';

export type QvacLifecycleEvent =
  'runtime-initialized' | 'model-loaded' | 'inference-completed' | 'structured-output-validated';

export interface QvacExtractionConfig {
  modelPath?: string;
  modelName?: string;
  contextSize?: number;
  onLifecycleEvent?: (event: QvacLifecycleEvent) => void;
}

export class QvacObservationExtractionService implements ObservationExtractionPort {
  readonly kind = 'qvac' as const;
  private modelId: string | null = null;
  private runtime: InferenceRuntimeInfo;

  constructor(private readonly config: QvacExtractionConfig = {}) {
    this.runtime = {
      engine: 'QVAC',
      execution: 'On-device',
      model: config.modelName ?? config.modelPath ?? QWEN3_600M_INST_Q4.name,
      networkRequiredForInference: false,
      status: 'model-not-loaded',
      detail: 'Model initialization is explicit; first download may require network access.',
      progressPercent: null,
    };
  }

  async initialize(): Promise<InferenceRuntimeInfo> {
    if (this.modelId) return this.getRuntimeInfo();
    try {
      this.setRuntime({ status: 'loading', detail: 'Initializing the local QVAC worker.' });
      await heartbeat();
      this.config.onLifecycleEvent?.('runtime-initialized');

      const onProgress = (progress: { percentage: number }): void => {
        this.setRuntime({
          status: progress.percentage < 100 ? 'downloading' : 'loading',
          detail:
            progress.percentage < 100
              ? 'Downloading the configured QVAC model to the local cache.'
              : 'Loading the model on this device.',
          progressPercent: Math.max(0, Math.min(100, progress.percentage)),
        });
      };
      const modelConfig = { ctx_size: this.config.contextSize ?? 4096 };
      this.modelId = this.config.modelPath
        ? await loadModel({
            modelSrc: this.config.modelPath,
            modelType: 'llamacpp-completion',
            modelConfig,
            onProgress,
          })
        : await loadModel({
            modelSrc: QWEN3_600M_INST_Q4,
            modelConfig,
            onProgress,
          });
      const info = await getLoadedModelInfo({ modelId: this.modelId });
      if (
        !info.handlers.some((handler) => handler.toLocaleLowerCase('en').includes('completion'))
      ) {
        throw new Error('The loaded QVAC model does not expose a completion handler.');
      }
      this.config.onLifecycleEvent?.('model-loaded');
      this.setRuntime({
        status: 'ready',
        detail: `Loaded locally as ${this.modelId}.`,
        progressPercent: 100,
      });
      return this.getRuntimeInfo();
    } catch (error) {
      this.modelId = null;
      this.setRuntime({
        status: 'error',
        detail: error instanceof Error ? error.message : 'Unknown QVAC initialization error.',
      });
      throw error;
    }
  }

  getRuntimeInfo(): InferenceRuntimeInfo {
    return InferenceRuntimeInfoSchema.parse({ ...this.runtime });
  }

  async extract(text: string, context: ExtractionContext): Promise<ObservationExtraction> {
    if (!this.modelId) {
      throw new Error('QVAC is not initialized. Load the on-device model before capturing.');
    }
    this.setRuntime({ status: 'processing', detail: 'QVAC is processing locally.' });
    try {
      const jsonSchema = z.toJSONSchema(ObservationExtractionSchema);
      const run = completion({
        modelId: this.modelId,
        history: [
          { role: 'system', content: OBSERVATION_EXTRACTOR_SYSTEM_PROMPT },
          { role: 'user', content: buildObservationExtractionPrompt(text, context) },
        ],
        stream: true,
        responseFormat: {
          type: 'json_schema',
          json_schema: {
            name: 'installed_base_observation',
            schema: jsonSchema,
            strict: true,
          },
        },
      });
      for await (const event of run.events) {
        // Draining events is the canonical QVAC completion lifecycle; raw tokens are not logged.
        if (event.type === 'contentDelta') continue;
      }
      const final = await run.final;
      this.config.onLifecycleEvent?.('inference-completed');
      const parsed: unknown = JSON.parse(final.contentText.trim());
      const validated = ObservationExtractionSchema.parse(parsed);
      this.config.onLifecycleEvent?.('structured-output-validated');
      this.setRuntime({ status: 'ready', detail: 'Last extraction completed on-device.' });
      return validated;
    } catch (error) {
      this.setRuntime({
        status: 'error',
        detail: error instanceof Error ? error.message : 'Unknown QVAC inference error.',
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
      detail: 'The QVAC model was unloaded.',
      progressPercent: null,
    });
  }

  private setRuntime(update: Partial<InferenceRuntimeInfo>): void {
    this.runtime = { ...this.runtime, ...update };
  }
}
