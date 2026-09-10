import { z } from 'zod';
import {
  completion,
  getLoadedModelInfo,
  heartbeat,
  loadModel,
  QWEN3_1_7B_INST_Q4,
  QWEN3_600M_INST_Q4,
  unloadModel,
} from '@qvac/sdk';

/**
 * Re-exported so callers outside `src/infrastructure/qvac/**` (e.g. `scripts/qvac-corpus-eval.ts`)
 * can select a `modelDescriptor` below without importing `@qvac/sdk` directly, which `AGENTS.md`
 * reserves for this directory.
 */
export { QWEN3_1_7B_INST_Q4, QWEN3_600M_INST_Q4 };
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

/**
 * Case- and punctuation-insensitive placeholder strings a model sometimes writes into a field
 * instead of leaving it absent (e.g. `manufacturer: "Unknown"` rather than `manufacturer: null`).
 * Deterministic and domain-generic — no hospital, brand, or corpus-specific text — because a
 * schema-valid but semantically empty string is exactly as fabricated as an invented one; see
 * `OBSERVATION_EXTRACTOR_SYSTEM_PROMPT`'s matching instruction not to write these in the first
 * place. This is a safety net for when the model writes one anyway.
 */
const ABSENCE_SENTINELS: ReadonlySet<string> = new Set([
  'unknown',
  'none',
  'n/a',
  'na',
  'not specified',
  'not stated',
  'not mentioned',
  'not applicable',
  'desconocido',
  'desconocida',
  'ninguno',
  'ninguna',
  'no especificado',
  'no especificada',
  'n/d',
]);

const normalizeAbsenceSentinel = (value: string | null): string | null => {
  if (value === null) return null;
  const normalized = value
    .trim()
    .toLocaleLowerCase('en')
    .replace(/[.\s]+$/u, '');
  return ABSENCE_SENTINELS.has(normalized) ? null : value;
};

/** Applies `normalizeAbsenceSentinel` to every free-text field the model can fabricate a placeholder into. */
const normalizeExtraction = (extraction: ObservationExtraction): ObservationExtraction => ({
  ...extraction,
  customer: {
    name: normalizeAbsenceSentinel(extraction.customer.name),
    city: normalizeAbsenceSentinel(extraction.customer.city),
    country: normalizeAbsenceSentinel(extraction.customer.country),
  },
  equipment: extraction.equipment.map((item) => ({
    ...item,
    manufacturer: normalizeAbsenceSentinel(item.manufacturer),
    model: normalizeAbsenceSentinel(item.model),
    notes: normalizeAbsenceSentinel(item.notes),
  })),
});

/**
 * A model registry descriptor from `@qvac/sdk`'s catalog, e.g. `QWEN3_600M_INST_Q4` or
 * `QWEN3_1_7B_INST_Q4`. Passed straight through to `loadModel`'s "load from descriptor" overload,
 * which infers `modelType` from it — the same mechanism already used for the default model.
 */
export type QvacModelDescriptor = typeof QWEN3_600M_INST_Q4 | typeof QWEN3_1_7B_INST_Q4;

export interface QvacExtractionConfig {
  modelPath?: string;
  modelName?: string;
  /**
   * Selects a registry model other than the default `QWEN3_600M_INST_Q4`, e.g.
   * `QWEN3_1_7B_INST_Q4` for a model-quality comparison. Ignored when `modelPath` is set, which
   * takes priority as an explicit local/provisioned source.
   */
  modelDescriptor?: QvacModelDescriptor;
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
      model:
        config.modelName ??
        config.modelDescriptor?.name ??
        config.modelPath ??
        QWEN3_600M_INST_Q4.name,
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
      // Each branch passes one of the concrete, individually-imported descriptor constants
      // (never the union-typed `config.modelDescriptor` value itself) so `loadModel`'s generic
      // "load from descriptor" overload can infer a single literal type and narrow `modelConfig`
      // correctly; feeding it a union type directly defeats that overload resolution.
      if (this.config.modelPath) {
        this.modelId = await loadModel({
          modelSrc: this.config.modelPath,
          modelType: 'llamacpp-completion',
          modelConfig,
          onProgress,
        });
      } else if (this.config.modelDescriptor?.name === QWEN3_1_7B_INST_Q4.name) {
        this.modelId = await loadModel({ modelSrc: QWEN3_1_7B_INST_Q4, modelConfig, onProgress });
      } else {
        this.modelId = await loadModel({ modelSrc: QWEN3_600M_INST_Q4, modelConfig, onProgress });
      }
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
        // No generationParams override: @qvac/sdk officially supports `temp` and `seed` for
        // reproducible, low-variance sampling, and `{ temp: 0 }`, `{ temp: 0.1 }`, and
        // `{ seed: 42 }` alone were each tried here. All three measurably destabilized this
        // model's grammar-constrained JSON decoding — a free-text field would occasionally enter
        // a degenerate repetition loop, producing an unterminated string and a 50s+ stall, on
        // cases the model's own default sampling always completed cleanly across a full corpus
        // run. The default (unset) sampling profile is the only configuration verified stable
        // here, so it is kept rather than trading a reproducibility gain for that risk.
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
      return normalizeExtraction(validated);
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
