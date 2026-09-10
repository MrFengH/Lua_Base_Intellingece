/**
 * P4-S3 real-model scoring run: `npm run corpus:eval`.
 *
 * Runs the P4-S1/P4-S2 extraction corpus against the real QVAC adapter
 * (`QvacObservationExtractionService`, the identical class the application uses in QVAC mode) and
 * the real `FollowUpQuestionService`, and reports a pass rate with failure detail.
 *
 * Deliberately NOT part of `npm test`: it needs a real model and compatible hardware, and its
 * output is not deterministic. It never changes the model, the quantization or the prompt — see
 * docs/ROADMAP.md, P4-S3. If the model fails or the pass rate is poor, that is recorded as a
 * finding, not hidden or worked around here.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  ApproximateAge,
  CaptureDraft,
  CaptureEquipmentDraft,
  DraftField,
  FollowUpQuestion,
  Modality,
  ObservationBasis,
} from '@/domain';
import { declaredUnknownField, FollowUpQuestionService, knownField, missingField } from '@/domain';
import type { ObservationExtraction } from '@/application';
import { QvacObservationExtractionService, type QvacLifecycleEvent } from '@/infrastructure';
import {
  EXTRACTION_CORPUS,
  EXTRACTION_CORPUS_VERSION,
  evaluateCase,
  validateCorpus,
  type ActualFollowUp,
  type CaseEvaluation,
  type CorpusCase,
  type CorpusCaseSource,
  type CorpusLanguage,
  type FieldEvaluation,
} from '../tests/fixtures/corpus';

/**
 * The eight official anti-fabrication cases named in docs/ROADMAP.md, P4-S2. Not a corpus
 * `origin.source` (those are official-workbook / challenge-brief / project-authored); this is a
 * cross-cutting tag over that set, kept here rather than in the fixtures because it exists only
 * for this report's "adversarial" breakdown.
 */
const ADVERSARIAL_CASE_IDS: ReadonlySet<string> = new Set([
  'voice-prompt-04',
  'voice-prompt-05',
  'voice-prompt-06',
  'voice-prompt-08',
  'voice-prompt-09',
  'voice-prompt-10',
  'installed-base-row-07',
  'installed-base-row-15',
]);

const stringField = (value: string | null): DraftField<string> =>
  value === null ? missingField<string>() : knownField(value);

/**
 * Reconstructs a first-message `CaptureDraft` directly from one extraction result, purely so the
 * real `FollowUpQuestionService` can be scored against the corpus. This is NOT the production
 * merge path (`CaptureWorkflowService.mergeExtraction` / `mergeEquipment`): there is nothing to
 * merge, since every corpus case is one utterance evaluated against an empty draft. The mapping is
 * direct — a stated value becomes `Known`, an absent one becomes `Missing` — and never produces
 * `DeclaredUnknown`, matching production: extraction alone cannot distinguish an explicit "I don't
 * know" from a field that was simply never mentioned (see tests/fixtures/corpus/types.ts).
 */
function toFreshDraft(extraction: ObservationExtraction): CaptureDraft {
  return {
    id: 'corpus-eval',
    state: 'NEEDS_FOLLOW_UP',
    source: 'Text',
    customer: {
      name: stringField(extraction.customer.name),
      city: stringField(extraction.customer.city),
      country: stringField(extraction.customer.country),
    },
    equipment: extraction.equipment.map((item, index): CaptureEquipmentDraft => ({
      id: `equipment-${index}`,
      order: index,
      modality: knownField(item.modality),
      rawModality: item.rawModality,
      quantity: item.quantity === null ? missingField<number>() : knownField(item.quantity),
      manufacturer: stringField(item.manufacturer),
      model: stringField(item.model),
      approximateAge:
        item.approximateAge.type === 'unknown'
          ? missingField<ApproximateAge>()
          : knownField(item.approximateAge),
      notes: stringField(item.notes),
      contradictions: [],
    })),
    observationBasis: missingField(),
    askedQuestionKeys: [],
  };
}

/**
 * Marks the field a follow-up question is about as `DeclaredUnknown`, purely to let `next()` move
 * on to the following question so every follow-up a full conversation would eventually raise can
 * be enumerated in one pass. This never happens from a single extraction call in production; it
 * exists only to probe the real `FollowUpQuestionService` for scoring. Returns `null` when the
 * question cannot be advanced without fabricating state (an empty equipment collection), which
 * stops enumeration rather than inventing one.
 */
function probeField(draft: CaptureDraft, question: FollowUpQuestion): CaptureDraft | null {
  if (question.target.type === 'Customer') {
    if (question.field === 'CustomerName') {
      return { ...draft, customer: { ...draft.customer, name: declaredUnknownField<string>() } };
    }
    if (question.field === 'Location') {
      return {
        ...draft,
        customer: {
          ...draft.customer,
          city:
            draft.customer.city.state === 'Missing'
              ? declaredUnknownField<string>()
              : draft.customer.city,
          country:
            draft.customer.country.state === 'Missing'
              ? declaredUnknownField<string>()
              : draft.customer.country,
        },
      };
    }
    return null;
  }
  if (question.target.type === 'EquipmentCollection') {
    if (question.field === 'ObservationBasis') {
      return { ...draft, observationBasis: declaredUnknownField<ObservationBasis>() };
    }
    return null;
  }
  const equipmentGroupId = question.target.equipmentGroupId;
  const equipment = draft.equipment.map((item): CaptureEquipmentDraft => {
    if (item.id !== equipmentGroupId) return item;
    switch (question.field) {
      case 'Modality':
        return { ...item, modality: declaredUnknownField<Modality>() };
      case 'Quantity':
        return { ...item, quantity: declaredUnknownField<number>() };
      case 'Manufacturer':
        return { ...item, manufacturer: declaredUnknownField<string>() };
      case 'ApproximateAge':
        return { ...item, approximateAge: declaredUnknownField<ApproximateAge>() };
      case 'Model':
        return { ...item, model: declaredUnknownField<string>() };
      case 'Notes':
        return { ...item, notes: declaredUnknownField<string>() };
      default:
        return item;
    }
  });
  return { ...draft, equipment };
}

function collectFollowUps(initialDraft: CaptureDraft): ActualFollowUp[] {
  const service = new FollowUpQuestionService();
  const collected: ActualFollowUp[] = [];
  const seenKeys = new Set<string>();
  let draft = initialDraft;
  for (let iteration = 0; iteration < 25; iteration += 1) {
    const question = service.next(draft);
    if (!question || seenKeys.has(question.key)) break;
    seenKeys.add(question.key);
    collected.push({ field: question.field, priority: question.priority });
    const advanced = probeField(draft, question);
    if (!advanced) break;
    draft = advanced;
  }
  return collected;
}

interface CaseRunResult {
  readonly corpusCase: CorpusCase;
  readonly evaluation: CaseEvaluation;
  readonly extraction: ObservationExtraction | null;
  readonly followUps: readonly ActualFollowUp[];
  readonly extractionError: string | null;
}

async function runCase(
  extractor: QvacObservationExtractionService,
  corpusCase: CorpusCase,
): Promise<CaseRunResult> {
  try {
    const extraction = await extractor.extract(corpusCase.inputText, {
      captureDraft: null,
      pendingQuestion: null,
      conversation: [],
      knownCustomers: [],
    });
    const followUps = collectFollowUps(toFreshDraft(extraction));
    const evaluation = evaluateCase(corpusCase, { extraction, followUps });
    return { corpusCase, evaluation, extraction, followUps, extractionError: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      corpusCase,
      evaluation: {
        caseId: corpusCase.id,
        passed: false,
        fields: [
          {
            scope: 'extraction',
            passed: false,
            detail: `extraction call failed: ${message}`,
          },
        ],
      },
      extraction: null,
      followUps: [],
      extractionError: message,
    };
  }
}

interface Metrics {
  readonly totalCases: number;
  readonly passedCases: number;
  readonly failedCases: number;
  readonly extractionErrors: number;
  readonly totalFields: number;
  readonly passedFields: number;
  readonly fieldAccuracy: number | null;
  readonly fabricatedValues: number;
  readonly missingExpectedValues: number;
  readonly wrongValues: number;
  readonly normalizationFailures: number;
  readonly followUpFailures: number;
}

const countReason = (fields: readonly FieldEvaluation[], reason: FieldEvaluation['reason']) =>
  fields.filter((field) => field.reason === reason).length;

function summarize(results: readonly CaseRunResult[]): Metrics {
  const allFields = results.flatMap((result) => result.evaluation.fields);
  const passedFields = allFields.filter((field) => field.passed).length;
  return {
    totalCases: results.length,
    passedCases: results.filter((result) => result.evaluation.passed).length,
    failedCases: results.filter((result) => !result.evaluation.passed).length,
    extractionErrors: results.filter((result) => result.extractionError !== null).length,
    totalFields: allFields.length,
    passedFields,
    fieldAccuracy: allFields.length > 0 ? passedFields / allFields.length : null,
    fabricatedValues: countReason(allFields, 'fabricated-value'),
    missingExpectedValues: countReason(allFields, 'missing-expected-value'),
    wrongValues: countReason(allFields, 'wrong-value'),
    normalizationFailures: countReason(allFields, 'wrong-normalization'),
    followUpFailures: countReason(allFields, 'wrong-follow-up'),
  };
}

const SOURCES: readonly CorpusCaseSource[] = [
  'official-workbook',
  'challenge-brief',
  'project-authored',
];
const LANGUAGES: readonly CorpusLanguage[] = ['en', 'es'];

function printMetrics(label: string, metrics: Metrics): void {
  const accuracy =
    metrics.fieldAccuracy === null ? 'n/a' : `${(metrics.fieldAccuracy * 100).toFixed(1)}%`;
  console.log(
    `${label}: ${metrics.passedCases}/${metrics.totalCases} cases passed, ` +
      `field accuracy ${accuracy} (${metrics.passedFields}/${metrics.totalFields}), ` +
      `fabricated=${metrics.fabricatedValues} missing=${metrics.missingExpectedValues} ` +
      `wrong=${metrics.wrongValues} normalization=${metrics.normalizationFailures} ` +
      `follow-up=${metrics.followUpFailures} extraction-errors=${metrics.extractionErrors}`,
  );
}

async function main(): Promise<void> {
  const structuralProblems = validateCorpus(EXTRACTION_CORPUS);
  if (structuralProblems.length > 0) {
    console.error('FAIL: corpus failed structural validation before any model call was made:');
    for (const problem of structuralProblems) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }

  const lifecycleMessages: Readonly<Record<QvacLifecycleEvent, string>> = {
    'runtime-initialized': 'PASS: QVAC runtime initialized',
    'model-loaded': 'PASS: model loaded',
    'inference-completed': 'inference completed',
    'structured-output-validated': 'structured output validated',
  };
  const extractor = new QvacObservationExtractionService({
    modelPath: process.env.CIB_QVAC_MODEL_PATH,
    modelName: process.env.CIB_QVAC_MODEL_NAME,
    onLifecycleEvent: (event) => {
      if (event === 'runtime-initialized' || event === 'model-loaded') {
        console.log(lifecycleMessages[event]);
      }
    },
  });

  await extractor.initialize();
  console.log(`Scoring ${EXTRACTION_CORPUS.length} cases against the real QVAC adapter...`);

  const results: CaseRunResult[] = [];
  try {
    for (const corpusCase of EXTRACTION_CORPUS) {
      const result = await runCase(extractor, corpusCase);
      results.push(result);
      console.log(
        `  ${result.evaluation.passed ? 'PASS' : 'FAIL'} ${corpusCase.id} (${corpusCase.origin.source}, ${corpusCase.language})` +
          (result.extractionError ? ` — extraction error: ${result.extractionError}` : ''),
      );
    }
  } finally {
    await extractor.dispose();
  }

  const overall = summarize(results);
  const bySource = Object.fromEntries(
    SOURCES.map((source) => [
      source,
      summarize(results.filter((result) => result.corpusCase.origin.source === source)),
    ]),
  );
  const byLanguage = Object.fromEntries(
    LANGUAGES.map((language) => [
      language,
      summarize(results.filter((result) => result.corpusCase.language === language)),
    ]),
  );
  const adversarial = summarize(
    results.filter((result) => ADVERSARIAL_CASE_IDS.has(result.corpusCase.id)),
  );

  const uncertaintyObserved = results.some((result) =>
    result.extraction?.equipment.some((item) => item.certainty === 'Uncertain'),
  );

  console.log('');
  printMetrics('Overall', overall);
  for (const source of SOURCES) printMetrics(`  source=${source}`, bySource[source]);
  for (const language of LANGUAGES) printMetrics(`  language=${language}`, byLanguage[language]);
  printMetrics('  adversarial (P4-S2, 8 cases)', adversarial);
  console.log(
    `Certainty 'Uncertain' ever emitted by the real model: ${uncertaintyObserved ? 'yes' : 'NO — see E-11 finding'}`,
  );

  const failures = results
    .filter((result) => !result.evaluation.passed)
    .map((result) => ({
      id: result.corpusCase.id,
      origin: result.corpusCase.origin,
      language: result.corpusCase.language,
      input: result.corpusCase.inputText,
      extractionError: result.extractionError,
      failingFields: result.evaluation.fields
        .filter((field) => !field.passed)
        .map((field) => ({
          scope: field.scope,
          reason: field.reason ?? null,
          expected: field.expected ?? null,
          actual: field.actual ?? null,
          detail: field.detail,
        })),
    }));

  const report = {
    corpusVersion: EXTRACTION_CORPUS_VERSION,
    generatedAt: new Date().toISOString(),
    modelPath: process.env.CIB_QVAC_MODEL_PATH ?? null,
    modelName: process.env.CIB_QVAC_MODEL_NAME ?? null,
    metrics: { overall, bySource, byLanguage, adversarial },
    uncertaintyObserved,
    failures,
  };

  const outPath = join(
    'docs',
    'qvac-eval-runs',
    `${report.generatedAt.replace(/[:.]/g, '-')}.json`,
  );
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\nReport written to ${outPath}`);

  if (overall.extractionErrors > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(`FAIL: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  process.exitCode = 1;
});
