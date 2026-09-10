import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { CaptureWorkflowService, InstalledBaseQueryService } from '@/application';
import type { ObservationExtractionPort, SpeechToTextPort } from '@/application';
import {
  applyDevelopmentSeed,
  DevelopmentMockObservationExtractionService,
  DevelopmentMockSpeechToTextService,
  LocalSqliteDatabase,
  QvacObservationExtractionService,
  QvacSpeechToTextService,
  QWEN3_4B_INST_Q4_K_M,
  RandomIdGenerator,
  SqliteInstalledBaseRepository,
  SystemClock,
} from '@/infrastructure';

/**
 * Resolves `CIB_QVAC_MODEL` to a `modelDescriptor` for the production adapter. `600m` (or unset)
 * keeps the default `QWEN3_600M_INST_Q4` — resolving to `undefined` here rather than the constant
 * itself, matching the adapter's own default so nothing changes for existing dev/test workflows.
 * `4b` selects `QWEN3_4B_INST_Q4_K_M`, the model approved for the demo per the 2026-09-10 addendum
 * in `docs/MODEL_STRATEGY.md`. Any other value fails loudly, the same way `CIB_INFERENCE_MODE` does
 * in `src/main/index.ts`, instead of silently falling back to the default.
 */
const resolveQvacModelDescriptor = (): typeof QWEN3_4B_INST_Q4_K_M | undefined => {
  const requested = process.env.CIB_QVAC_MODEL;
  if (!requested || requested === '600m') return undefined;
  if (requested === '4b') return QWEN3_4B_INST_Q4_K_M;
  throw new Error('CIB_QVAC_MODEL must be either 600m or 4b.');
};

export interface CompositionRoot {
  database: LocalSqliteDatabase;
  extraction: ObservationExtractionPort;
  speechToText: SpeechToTextPort;
  capture: CaptureWorkflowService;
  queries: InstalledBaseQueryService;
  dispose(): Promise<void>;
}

export interface CompositionOptions {
  databasePath: string;
  development: boolean;
  inferenceMode?: 'qvac' | 'mock';
}

export const createCompositionRoot = (options: CompositionOptions): CompositionRoot => {
  mkdirSync(dirname(options.databasePath), { recursive: true });
  const database = new LocalSqliteDatabase(options.databasePath);
  const repository = new SqliteInstalledBaseRepository(database);
  applyDevelopmentSeed(repository);
  const mode = options.inferenceMode ?? (options.development ? 'mock' : 'qvac');
  const extraction: ObservationExtractionPort =
    mode === 'qvac'
      ? new QvacObservationExtractionService({
          modelPath: process.env.CIB_QVAC_MODEL_PATH,
          modelName: process.env.CIB_QVAC_MODEL_NAME,
          // An explicit CIB_QVAC_MODEL_PATH keeps taking priority over CIB_QVAC_MODEL, matching
          // the precedence already documented in README.md.
          modelDescriptor: process.env.CIB_QVAC_MODEL_PATH
            ? undefined
            : resolveQvacModelDescriptor(),
        })
      : new DevelopmentMockObservationExtractionService();
  const speechToText: SpeechToTextPort =
    mode === 'qvac'
      ? new QvacSpeechToTextService({ modelPath: process.env.CIB_QVAC_VOICE_MODEL_PATH })
      : new DevelopmentMockSpeechToTextService();
  const clock = new SystemClock();
  const ids = new RandomIdGenerator();
  return {
    database,
    extraction,
    speechToText,
    capture: new CaptureWorkflowService(extraction, repository, clock, ids),
    queries: new InstalledBaseQueryService(repository, clock),
    async dispose(): Promise<void> {
      await extraction.dispose();
      await speechToText.dispose();
      database.close();
    },
  };
};
