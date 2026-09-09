import type { ConfidenceLevel, FactCertainty, FieldOrigin, KnowledgeState } from './enums';

export interface ConfidenceFact {
  field: string;
  knowledgeState: KnowledgeState;
  origin: FieldOrigin;
  certainty: FactCertainty | null;
  evidenceIds?: readonly string[];
}

export type ConfidenceReasonCode =
  | 'NO_KNOWN_FACTS'
  | 'EXPLICIT_FACTS'
  | 'UNCERTAINTY_LANGUAGE'
  | 'DERIVED_FACTS'
  | 'INCOMPLETE_FIELDS';

export interface ConfidenceReason {
  code: ConfidenceReasonCode;
  detail: string;
}

export interface ConfidenceAssessment {
  level: ConfidenceLevel;
  score: number | null;
  reasons: readonly ConfidenceReason[];
  evidenceIds: readonly string[];
  strategyVersion: 'confidence-v1';
}
