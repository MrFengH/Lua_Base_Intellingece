import type { ApproximateAge } from '@/domain/model/age';
import type { FollowUpField, FollowUpPriority } from '@/domain/model/capture';
import type { FactCertainty, Modality, ObservationStatus } from '@/domain/model/enums';

/**
 * Where a case was transcribed from. A case must never claim `official-workbook` or
 * `challenge-brief` provenance unless its `inputText` is a verbatim transcription of that
 * source; `origin.locator` says exactly where. See docs/ROADMAP.md, P4-S1, for the rule that
 * only these three origins may appear here.
 */
export const CORPUS_CASE_SOURCES = [
  'official-workbook',
  'challenge-brief',
  'project-authored',
] as const;
export type CorpusCaseSource = (typeof CORPUS_CASE_SOURCES)[number];

export const CORPUS_LANGUAGES = ['en', 'es'] as const;
export type CorpusLanguage = (typeof CORPUS_LANGUAGES)[number];

/**
 * Mirrors `FollowUpField` in `src/domain/model/capture.ts` as a runtime-checkable list. That
 * file defines the type as a literal union with no exported array, so this is kept here only
 * for the corpus's own consistency validation; keep it in sync by hand.
 */
export const CORPUS_FOLLOW_UP_FIELDS = [
  'CustomerName',
  'Location',
  'Modality',
  'Quantity',
  'Manufacturer',
  'ApproximateAge',
  'Model',
  'Notes',
  'ObservationBasis',
] as const satisfies readonly FollowUpField[];

export const CORPUS_FOLLOW_UP_PRIORITIES = [
  'Required',
  'Preferred',
  'Optional',
] as const satisfies readonly FollowUpPriority[];

/**
 * Three expectations about one field, deliberately never collapsed into a bare `null`:
 *
 * - `Known` — the input states a value; extraction must return exactly it.
 * - `DeclaredUnknown` — the speaker explicitly said they do not know. The correct output is an
 *   absent value, but for a reason distinct from the next case: the model must recognise an
 *   explicit statement of not knowing, not merely decline to guess.
 * - `MustNotInfer` — the input never mentions the field. The correct output is the same
 *   absence, but nothing in the text justifies the field being discussed at all; a value here
 *   would be pure fabrication rather than a misread statement of ignorance.
 *
 * Collapsing these three into `null` would make it impossible to tell "the model correctly
 * recognised an explicit unknown" from "the model simply never fabricated anything", which is
 * exactly the distinction P4-S3 needs when it scores real extractions against this corpus.
 */
export type ExpectedField<T> =
  | { readonly kind: 'Known'; readonly value: T }
  | { readonly kind: 'DeclaredUnknown' }
  | { readonly kind: 'MustNotInfer' };

export const known = <T>(value: T): ExpectedField<T> => ({ kind: 'Known', value });
export const declaredUnknown = <T = never>(): ExpectedField<T> => ({ kind: 'DeclaredUnknown' });
export const mustNotInfer = <T = never>(): ExpectedField<T> => ({ kind: 'MustNotInfer' });

export interface ExpectedCustomer {
  readonly name?: ExpectedField<string>;
  readonly city?: ExpectedField<string>;
  readonly country?: ExpectedField<string>;
}

export interface ExpectedEquipmentGroup {
  /** Documentary label for a person reading the fixture; never evaluated. */
  readonly label?: string;
  readonly modality?: ExpectedField<Modality>;
  readonly quantity?: ExpectedField<number>;
  readonly manufacturer?: ExpectedField<string>;
  readonly model?: ExpectedField<string>;
  readonly approximateAge?: ExpectedField<ApproximateAge>;
  /** The extraction contract's single per-group certainty; see DATA_SCHEMA.md. */
  readonly certainty?: ExpectedField<FactCertainty>;
  /**
   * Recorded only when the source case states it explicitly (for example the official
   * workbook's `Status` column). `status` is derived by domain rules from `observationBasis`
   * after a review question, not returned by extraction — see DATA_SCHEMA.md, "Observation
   * status" — so the P4-S1 evaluator does not compare it against an extraction result. It is
   * kept here for traceability and for a future harness that drives the full capture workflow.
   */
  readonly status?: ExpectedField<ObservationStatus>;
}

export interface ExpectedFollowUp {
  readonly field: FollowUpField;
  readonly priority?: FollowUpPriority;
}

export interface CorpusCaseOrigin {
  readonly source: CorpusCaseSource;
  /** Where in the source document this case comes from, e.g. "Voice Test Prompts, Test #3". */
  readonly locator: string;
}

export interface CorpusCase {
  readonly id: string;
  readonly origin: CorpusCaseOrigin;
  readonly language: CorpusLanguage;
  /** Verbatim input text. Never "improved" wording; see docs/ROADMAP.md, P4-S1. */
  readonly inputText: string;
  readonly expectedCustomer?: ExpectedCustomer;
  readonly expectedEquipment?: readonly ExpectedEquipmentGroup[];
  readonly expectedFollowUps?: readonly ExpectedFollowUp[];
  /** Ambiguity, known discrepancies, or scoping decisions specific to this case. */
  readonly notes?: string;
}
