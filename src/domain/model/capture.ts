import type { ApproximateAge } from './age';
import type {
  CaptureState,
  FactCertainty,
  FieldOrigin,
  Modality,
  ObservationBasis,
  ObservationSource,
} from './enums';

export type DraftField<T> =
  | { state: 'Missing' }
  | {
      state: 'Known';
      value: T;
      origin: FieldOrigin;
      certainty: FactCertainty | null;
      evidenceIds: readonly string[];
    }
  | {
      state: 'DeclaredUnknown';
      evidenceIds: readonly string[];
    };

export const missingField = <T>(): DraftField<T> => ({ state: 'Missing' });

export const knownField = <T>(
  value: T,
  origin: FieldOrigin = 'Reported',
  evidenceIds: readonly string[] = [],
  certainty: FactCertainty | null = 'Explicit',
): DraftField<T> => ({ state: 'Known', value, origin, certainty, evidenceIds });

export const declaredUnknownField = <T>(evidenceIds: readonly string[] = []): DraftField<T> => ({
  state: 'DeclaredUnknown',
  evidenceIds,
});

export interface CaptureCustomerDraft {
  name: DraftField<string>;
  city: DraftField<string>;
  country: DraftField<string>;
}

/** The fields whose values can be claimed twice in one capture and disagree. */
export const CONTRADICTION_FIELDS = [
  'Modality',
  'Quantity',
  'Manufacturer',
  'Model',
  'ApproximateAge',
] as const;
export type ContradictionField = (typeof CONTRADICTION_FIELDS)[number];

/**
 * Two incompatible claims about the same field inside one capture, both of them things the
 * observer actually said. It records what was claimed and the evidence behind each side; it
 * never decides between them. It lives on the draft only: once resolved, the traceability that
 * survives is the accumulated `evidenceIds` on the field itself, which is what gets persisted.
 */
export interface FieldContradiction {
  field: ContradictionField;
  /** The earlier claim, rendered for a person to read back. */
  previousText: string;
  previousEvidenceIds: readonly string[];
  /** The later claim, which is the active value while the disagreement is unresolved. */
  currentText: string;
  currentEvidenceIds: readonly string[];
}

export interface CaptureEquipmentDraft {
  id: string;
  order: number;
  modality: DraftField<Modality>;
  rawModality: string | null;
  quantity: DraftField<number>;
  manufacturer: DraftField<string>;
  model: DraftField<string>;
  approximateAge: DraftField<ApproximateAge>;
  notes: DraftField<string>;
  /** Unresolved disagreements only. A resolved one is removed; its evidence ids are not. */
  contradictions: readonly FieldContradiction[];
}

export interface CaptureDraft {
  id: string;
  state: CaptureState;
  source: ObservationSource;
  customer: CaptureCustomerDraft;
  equipment: readonly CaptureEquipmentDraft[];
  /**
   * Session-level provenance of the account. It answers "how do you know this", which is
   * independent of any field certainty and of the confidence assessment.
   */
  observationBasis: DraftField<ObservationBasis>;
  askedQuestionKeys: readonly string[];
}

export type FollowUpPriority = 'Required' | 'Preferred' | 'Optional';

export type FollowUpField =
  | 'CustomerName'
  | 'Location'
  | 'Modality'
  | 'Quantity'
  | 'Manufacturer'
  | 'ApproximateAge'
  | 'Model'
  | 'Notes'
  | 'ObservationBasis';

export type FollowUpTarget =
  | { type: 'Customer' }
  | { type: 'Equipment'; equipmentGroupId: string }
  | { type: 'EquipmentCollection' };

export interface FollowUpQuestion {
  key: string;
  field: FollowUpField;
  priority: FollowUpPriority;
  target: FollowUpTarget;
  text: string;
}
