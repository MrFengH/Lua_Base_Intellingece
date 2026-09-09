import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { CaptureWorkflowService, InstalledBaseQueryService } from '@/application';
import type { ObservationExtractionPort } from '@/application';
import {
  applyDevelopmentSeed,
  DevelopmentMockObservationExtractionService,
  LocalSqliteDatabase,
  QvacObservationExtractionService,
  RandomIdGenerator,
  SqliteInstalledBaseRepository,
  SystemClock,
} from '@/infrastructure';

export interface CompositionRoot {
  database: LocalSqliteDatabase;
  extraction: ObservationExtractionPort;
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
        })
      : new DevelopmentMockObservationExtractionService();
  const clock = new SystemClock();
  const ids = new RandomIdGenerator();
  return {
    database,
    extraction,
    capture: new CaptureWorkflowService(extraction, repository, clock, ids),
    queries: new InstalledBaseQueryService(repository, clock),
    async dispose(): Promise<void> {
      await extraction.dispose();
      database.close();
    },
  };
};
