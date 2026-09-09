import { QvacObservationExtractionService, type QvacLifecycleEvent } from '@/infrastructure';

const messages: Readonly<Record<QvacLifecycleEvent, string>> = {
  'runtime-initialized': 'PASS: QVAC runtime initialized',
  'model-loaded': 'PASS: model loaded',
  'inference-completed': 'PASS: local inference completed',
  'structured-output-validated': 'PASS: structured output validated',
};

const service = new QvacObservationExtractionService({
  modelPath: process.env.CIB_QVAC_MODEL_PATH,
  modelName: process.env.CIB_QVAC_MODEL_NAME,
  onLifecycleEvent: (event) => console.log(messages[event]),
});

try {
  await service.initialize();
  const result = await service.extract(
    'I visited Hospital DemoCare Pacific in Panama. They have two MR systems and one CT.',
    {
      captureDraft: null,
      pendingQuestion: null,
      conversation: [],
      knownCustomers: [],
    },
  );
  if (result.equipment.length < 2) {
    throw new Error(`Expected at least two equipment groups; received ${result.equipment.length}.`);
  }
  console.log('PASS: direct @qvac/sdk path used; no cloud inference provider is configured');
} catch (error) {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await service.dispose();
}
