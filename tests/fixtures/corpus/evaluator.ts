import type { ApproximateAge } from '@/domain/model/age';
import type { FollowUpField } from '@/domain/model/capture';
import { MODALITIES } from '@/domain/model/enums';
import type { ExtractedEquipment, ObservationExtraction } from '@/application/contracts';
import {
  CORPUS_CASE_SOURCES,
  CORPUS_FOLLOW_UP_FIELDS,
  CORPUS_FOLLOW_UP_PRIORITIES,
  CORPUS_LANGUAGES,
  type CorpusCase,
  type ExpectedEquipmentGroup,
  type ExpectedField,
} from './types';

/**
 * What a case's expected follow-ups are compared against. Optional and separate from
 * `extraction`, because a bare `ObservationExtraction` (what the mock and QVAC both return from
 * one call) carries no follow-up information at all — follow-ups are a property of the capture
 * workflow, not of extraction. A caller that has only run extraction can omit `followUps`
 * entirely and still get full field-level evaluation; P4-S3 can supply it by also driving
 * `FollowUpQuestionService` against the merged draft.
 */
export interface ActualFollowUp {
  readonly field: FollowUpField;
  readonly priority?: string;
}

export interface ActualExtractionResult {
  readonly extraction: ObservationExtraction;
  readonly followUps?: readonly ActualFollowUp[];
}

export type FieldFailureReason =
  | 'wrong-value'
  | 'missing-expected-value'
  | 'fabricated-value'
  | 'wrong-normalization'
  | 'wrong-follow-up';

export interface FieldEvaluation {
  readonly scope: string;
  readonly passed: boolean;
  readonly reason?: FieldFailureReason;
  readonly expected?: unknown;
  readonly actual?: unknown;
  readonly detail: string;
}

export interface CaseEvaluation {
  readonly caseId: string;
  readonly passed: boolean;
  readonly fields: readonly FieldEvaluation[];
}

const deepEquals = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Compares one field's expectation against one actual value, distinguishing a fabricated value
 * from a missing one and from a plain wrong one. Returns `null` when the case makes no
 * assertion about this field at all, which must never be scored as a pass or a fail.
 */
function evaluateField<T>(
  scope: string,
  expected: ExpectedField<T> | undefined,
  actual: T | null | undefined,
  matches: (
    expectedValue: T,
    actualValue: T,
  ) => { readonly ok: boolean; readonly reason?: 'wrong-value' | 'wrong-normalization' } = (
    expectedValue,
    actualValue,
  ) => ({ ok: deepEquals(expectedValue, actualValue) }),
): FieldEvaluation | null {
  if (!expected) return null;
  const present = actual !== null && actual !== undefined;

  if (expected.kind === 'Known') {
    if (!present) {
      return {
        scope,
        passed: false,
        reason: 'missing-expected-value',
        expected: expected.value,
        actual,
        detail: `${scope}: expected a known value but none was produced`,
      };
    }
    const { ok, reason } = matches(expected.value, actual);
    if (!ok) {
      return {
        scope,
        passed: false,
        reason: reason ?? 'wrong-value',
        expected: expected.value,
        actual,
        detail: `${scope}: did not match the expected value`,
      };
    }
    return { scope, passed: true, detail: `${scope}: matched` };
  }

  // DeclaredUnknown and MustNotInfer both require the same absence; only the reason a value
  // would be wrong differs, and neither one is ever satisfied by a fabricated value.
  if (present) {
    return {
      scope,
      passed: false,
      reason: 'fabricated-value',
      expected: expected.kind,
      actual,
      detail: `${scope}: must remain absent (${expected.kind}) but a value was produced`,
    };
  }
  return { scope, passed: true, detail: `${scope}: correctly absent (${expected.kind})` };
}

function approximateAgeMatch(
  expected: ApproximateAge,
  actual: ApproximateAge,
): { readonly ok: boolean; readonly reason?: 'wrong-value' | 'wrong-normalization' } {
  if (expected.type !== actual.type) {
    return { ok: false, reason: 'wrong-normalization' };
  }
  if (expected.type === 'exact' && actual.type === 'exact') {
    return { ok: expected.years === actual.years };
  }
  if (
    (expected.type === 'estimate' && actual.type === 'estimate') ||
    (expected.type === 'range' && actual.type === 'range')
  ) {
    return { ok: expected.minYears === actual.minYears && expected.maxYears === actual.maxYears };
  }
  // Qualitative labels are free text describing the same fact in the speaker's words; the type
  // match already proves the model did not fabricate a number, so the label itself is
  // documentary and is not compared. `unknown` carries no further data to compare.
  return { ok: true };
}

const modalityMatch = (
  expected: ExtractedEquipment['modality'],
  actual: ExtractedEquipment['modality'],
): { readonly ok: boolean; readonly reason?: 'wrong-normalization' } => ({
  ok: expected === actual,
  reason: 'wrong-normalization',
});

const FIELD_TO_FOLLOW_UP: Record<
  'name' | 'location' | 'modality' | 'quantity' | 'manufacturer' | 'model' | 'approximateAge',
  FollowUpField
> = {
  name: 'CustomerName',
  location: 'Location',
  modality: 'Modality',
  quantity: 'Quantity',
  manufacturer: 'Manufacturer',
  model: 'Model',
  approximateAge: 'ApproximateAge',
};

/**
 * A field declared unknown must never be asked again — see DATA_SCHEMA.md's `KnowledgeState`
 * section. This derives the follow-up fields that would violate that rule directly from the
 * case's own expectations, so a fixture author never has to restate it separately.
 */
function forbiddenFollowUps(corpusCase: CorpusCase): readonly FollowUpField[] {
  const forbidden: FollowUpField[] = [];
  const customer = corpusCase.expectedCustomer;
  if (customer?.name?.kind === 'DeclaredUnknown') forbidden.push(FIELD_TO_FOLLOW_UP.name);
  if (customer?.city?.kind === 'DeclaredUnknown' || customer?.country?.kind === 'DeclaredUnknown') {
    forbidden.push(FIELD_TO_FOLLOW_UP.location);
  }
  for (const group of corpusCase.expectedEquipment ?? []) {
    if (group.modality?.kind === 'DeclaredUnknown') forbidden.push(FIELD_TO_FOLLOW_UP.modality);
    if (group.quantity?.kind === 'DeclaredUnknown') forbidden.push(FIELD_TO_FOLLOW_UP.quantity);
    if (group.manufacturer?.kind === 'DeclaredUnknown') {
      forbidden.push(FIELD_TO_FOLLOW_UP.manufacturer);
    }
    if (group.model?.kind === 'DeclaredUnknown') forbidden.push(FIELD_TO_FOLLOW_UP.model);
    if (group.approximateAge?.kind === 'DeclaredUnknown') {
      forbidden.push(FIELD_TO_FOLLOW_UP.approximateAge);
    }
  }
  return forbidden;
}

function evaluateFollowUps(
  corpusCase: CorpusCase,
  actual: ActualExtractionResult,
): readonly FieldEvaluation[] {
  if (!actual.followUps) return [];
  const results: FieldEvaluation[] = [];

  for (const expected of corpusCase.expectedFollowUps ?? []) {
    const found = actual.followUps.find((followUp) => followUp.field === expected.field);
    if (!found) {
      results.push({
        scope: `follow-up:${expected.field}`,
        passed: false,
        reason: 'wrong-follow-up',
        expected: expected.field,
        detail: `expected a follow-up on ${expected.field} but none was raised`,
      });
      continue;
    }
    if (expected.priority && found.priority && expected.priority !== found.priority) {
      results.push({
        scope: `follow-up:${expected.field}`,
        passed: false,
        reason: 'wrong-follow-up',
        expected: expected.priority,
        actual: found.priority,
        detail: `follow-up on ${expected.field} had priority ${found.priority}, expected ${expected.priority}`,
      });
      continue;
    }
    results.push({
      scope: `follow-up:${expected.field}`,
      passed: true,
      detail: `follow-up on ${expected.field} matched`,
    });
  }

  for (const field of forbiddenFollowUps(corpusCase)) {
    if (actual.followUps.some((followUp) => followUp.field === field)) {
      results.push({
        scope: `follow-up:${field}`,
        passed: false,
        reason: 'wrong-follow-up',
        actual: field,
        detail: `${field} is declared unknown and must never be asked again`,
      });
    }
  }

  return results;
}

function evaluateEquipmentGroup(
  index: number,
  expected: ExpectedEquipmentGroup,
  actual: ExtractedEquipment | undefined,
): readonly FieldEvaluation[] {
  const scope = (field: string): string => `equipment[${index}].${field}`;
  if (!actual) {
    return [
      {
        scope: scope('*'),
        passed: false,
        reason: 'missing-expected-value',
        detail: `expected equipment group ${index} was not produced`,
      },
    ];
  }
  const results: (FieldEvaluation | null)[] = [
    evaluateField(scope('modality'), expected.modality, actual.modality, modalityMatch),
    evaluateField(scope('quantity'), expected.quantity, actual.quantity),
    evaluateField(scope('manufacturer'), expected.manufacturer, actual.manufacturer),
    evaluateField(scope('model'), expected.model, actual.model),
    evaluateField(
      scope('approximateAge'),
      expected.approximateAge,
      // `ApproximateAge` is never JS `null`; "nothing was said about age" is the discriminated
      // union's own `{ type: 'unknown' }` member. `evaluateField`'s generic presence check only
      // knows about `null`/`undefined`, so without this translation every `DeclaredUnknown` or
      // `MustNotInfer` expectation on `approximateAge` would be unconditionally scored as a
      // fabricated value, even against a model that correctly said nothing.
      actual.approximateAge.type === 'unknown' ? null : actual.approximateAge,
      approximateAgeMatch,
    ),
    evaluateField(scope('certainty'), expected.certainty, actual.certainty),
  ];
  return results.filter((result): result is FieldEvaluation => result !== null);
}

/** Compares one extraction result against one case's expectations, field by field. */
export function evaluateCase(
  corpusCase: CorpusCase,
  actual: ActualExtractionResult,
): CaseEvaluation {
  const fields: FieldEvaluation[] = [];
  const customer = corpusCase.expectedCustomer;
  if (customer) {
    const results = [
      evaluateField('customer.name', customer.name, actual.extraction.customer.name),
      evaluateField('customer.city', customer.city, actual.extraction.customer.city),
      evaluateField('customer.country', customer.country, actual.extraction.customer.country),
    ];
    for (const result of results) if (result) fields.push(result);
  }

  const expectedEquipment = corpusCase.expectedEquipment ?? [];
  const actualEquipment = actual.extraction.equipment;
  if (expectedEquipment.length !== actualEquipment.length) {
    fields.push({
      scope: 'equipment.length',
      passed: false,
      reason: 'wrong-value',
      expected: expectedEquipment.length,
      actual: actualEquipment.length,
      detail: `expected ${expectedEquipment.length} equipment group(s) but got ${actualEquipment.length}`,
    });
  }
  expectedEquipment.forEach((group, index) => {
    fields.push(...evaluateEquipmentGroup(index, group, actualEquipment[index]));
  });

  fields.push(...evaluateFollowUps(corpusCase, actual));

  return { caseId: corpusCase.id, passed: fields.every((field) => field.passed), fields };
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

function validateApproximateAge(scope: string, age: ApproximateAge): string[] {
  const problems: string[] = [];
  if ((age.type === 'estimate' || age.type === 'range') && age.minYears > age.maxYears) {
    problems.push(`${scope}: minYears (${age.minYears}) exceeds maxYears (${age.maxYears})`);
  }
  if (age.type === 'exact' && age.years < 0) {
    problems.push(`${scope}: exact age must not be negative`);
  }
  if (age.type === 'qualitative' && !isNonEmptyString(age.label)) {
    problems.push(`${scope}: qualitative age must carry a non-empty label`);
  }
  return problems;
}

function validateEquipmentGroup(scope: string, group: ExpectedEquipmentGroup): string[] {
  const problems: string[] = [];
  if (group.modality?.kind === 'Known' && !MODALITIES.includes(group.modality.value)) {
    problems.push(`${scope}.modality: "${group.modality.value}" is outside MODALITIES`);
  }
  if (
    group.quantity?.kind === 'Known' &&
    !(Number.isInteger(group.quantity.value) && group.quantity.value > 0)
  ) {
    problems.push(`${scope}.quantity: expected value must be a positive integer`);
  }
  if (group.manufacturer?.kind === 'Known' && !isNonEmptyString(group.manufacturer.value)) {
    problems.push(`${scope}.manufacturer: expected value must be a non-empty string`);
  }
  if (group.model?.kind === 'Known' && !isNonEmptyString(group.model.value)) {
    problems.push(`${scope}.model: expected value must be a non-empty string`);
  }
  if (group.approximateAge?.kind === 'Known') {
    problems.push(...validateApproximateAge(`${scope}.approximateAge`, group.approximateAge.value));
  }
  return problems;
}

/**
 * Structural consistency checks the type system cannot express: unique ids, non-empty
 * provenance, well-formed age intervals, positive quantities, and follow-up fields drawn from
 * the recognised vocabulary. Returns an empty array when the corpus is consistent.
 */
export function validateCorpus(cases: readonly CorpusCase[]): string[] {
  const problems: string[] = [];
  const seenIds = new Set<string>();

  for (const corpusCase of cases) {
    const label = corpusCase.id || '(missing id)';

    if (!isNonEmptyString(corpusCase.id)) {
      problems.push(`${label}: id must be a non-empty string`);
    } else if (seenIds.has(corpusCase.id)) {
      problems.push(`${label}: duplicate case id`);
    } else {
      seenIds.add(corpusCase.id);
    }

    if (!CORPUS_CASE_SOURCES.includes(corpusCase.origin.source)) {
      problems.push(`${label}: unrecognised origin.source "${corpusCase.origin.source}"`);
    }
    if (!isNonEmptyString(corpusCase.origin.locator)) {
      problems.push(`${label}: origin.locator must be a non-empty string`);
    }
    if (!CORPUS_LANGUAGES.includes(corpusCase.language)) {
      problems.push(`${label}: unrecognised language "${corpusCase.language}"`);
    }
    if (!isNonEmptyString(corpusCase.inputText)) {
      problems.push(`${label}: inputText must be a non-empty string`);
    }

    const customer = corpusCase.expectedCustomer;
    if (customer?.name?.kind === 'Known' && !isNonEmptyString(customer.name.value)) {
      problems.push(`${label}.expectedCustomer.name: expected value must be a non-empty string`);
    }
    if (customer?.city?.kind === 'Known' && !isNonEmptyString(customer.city.value)) {
      problems.push(`${label}.expectedCustomer.city: expected value must be a non-empty string`);
    }
    if (customer?.country?.kind === 'Known' && !isNonEmptyString(customer.country.value)) {
      problems.push(`${label}.expectedCustomer.country: expected value must be a non-empty string`);
    }

    (corpusCase.expectedEquipment ?? []).forEach((group, index) => {
      problems.push(...validateEquipmentGroup(`${label}.expectedEquipment[${index}]`, group));
    });

    for (const followUp of corpusCase.expectedFollowUps ?? []) {
      if (!CORPUS_FOLLOW_UP_FIELDS.includes(followUp.field)) {
        problems.push(`${label}: unrecognised follow-up field "${followUp.field}"`);
      }
      if (followUp.priority && !CORPUS_FOLLOW_UP_PRIORITIES.includes(followUp.priority)) {
        problems.push(`${label}: unrecognised follow-up priority "${followUp.priority}"`);
      }
    }
  }

  return problems;
}

/** Loads every case in the corpus. Synchronous, pure data — no QVAC and no I/O involved. */
export function loadCorpus(cases: readonly CorpusCase[]): readonly CorpusCase[] {
  return cases;
}
