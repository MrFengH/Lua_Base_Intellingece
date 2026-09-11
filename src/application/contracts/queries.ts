import type {
  ApproximateAge,
  ConfidenceAssessment,
  ConfidenceLevel,
  DuplicateReason,
  DuplicateResolution,
  EvidenceRelationship,
  FieldProvenance,
  InstallationEstimate,
  Modality,
  ObservationStatus,
} from '@/domain';

export interface CustomerListItem {
  id: string;
  name: string;
  city: string | null;
  country: string | null;
  lastObservedAt: string | null;
}

export interface InstalledBaseItem {
  projectionKey: string;
  modality: Modality;
  /** The words the observer actually used, kept when normalization is not certain. */
  rawModality: string | null;
  quantity: number | null;
  manufacturer: string | null;
  model: string | null;
  approximateAge: ApproximateAge;
  installationEstimate: InstallationEstimate;
  confidence: ConfidenceAssessment;
  status: ObservationStatus;
  lastObservedAt: string;
  lastVerifiedAt: string | null;
  daysSinceLastObservation: number;
  daysSinceLastVerification: number | null;
  freshnessStatus: 'Unknown';
  contributingObservationIds: readonly string[];
  /** Per-field knowledge state, origin, certainty and evidence ids for the projected group. */
  fieldProvenance: Readonly<Record<string, FieldProvenance>>;
}

/** One raw evidence entry within a session, with the assistant question it answered (if any)
 * kept alongside it purely as display context — never a domain fact in its own right. */
export interface ObservationEvidenceEntryView {
  id: string;
  rawText: string | null;
  followUpQuestion: string | null;
  capturedAt: string;
}

export interface ObservationEvidenceView {
  sessionId: string;
  equipmentObservationId: string;
  observedAt: string;
  observerName: string;
  visitId: string;
  rawInput: string | null;
  source: string;
  /** The session's individual evidence entries, in capture order. Older sessions saved before
   * this field existed still populate it (one entry per stored evidence item), just without
   * `followUpQuestion` context. */
  items: readonly ObservationEvidenceEntryView[];
}

export interface DuplicateReviewObservation {
  id: string;
  facility: {
    name: string;
    city: string | null;
    country: string | null;
  };
  modality: Modality;
  quantity: number | null;
  manufacturer: string | null;
  model: string | null;
  approximateAge: ApproximateAge;
  status: ObservationStatus;
  confidence: ConfidenceAssessment;
  observedAt: string;
  observerName: string;
  source: string;
  rawEvidence: string | null;
}

export interface DuplicateCandidateReview {
  id: string;
  score: number;
  reasons: readonly DuplicateReason[];
  relationship: EvidenceRelationship;
  resolution: DuplicateResolution;
  algorithmVersion: 'duplicate-v1';
  createdAt: string;
  /** The newly saved equipment observation that caused duplicate detection to run. */
  sourceObservation: DuplicateReviewObservation;
  /** The equipment observation that already existed when the source was saved. */
  comparableObservation: DuplicateReviewObservation;
}

export interface DuplicateCandidateCollectionView {
  pending: readonly DuplicateCandidateReview[];
  resolved: readonly DuplicateCandidateReview[];
}

export interface Customer360View {
  customer: CustomerListItem;
  installedBase: readonly InstalledBaseItem[];
  evidence: readonly ObservationEvidenceView[];
  duplicateCandidates: DuplicateCandidateCollectionView;
  projectionStrategy: 'latest-per-signature-v1';
}

/** One country row for the installed-base geography chart. `equipmentCount` is the projected
 * quantity (the same convention `equipmentByModality` uses); `visitCount` is the number of
 * observation sessions recorded for that country and is shown only as secondary context. */
export interface CountryEquipmentCount {
  country: string;
  equipmentCount: number;
  visitCount: number;
}

/** One band of the age distribution — see `classifyAgeBand` in `@/domain/rules/age-bands` for
 * how a projected group's `approximateAge` is placed here. Purely descriptive; carries no
 * freshness/obsolescence meaning. */
export interface AgeBandCount {
  label: string;
  count: number;
}

/** How many projected groups are missing a given field outright versus how many explicitly
 * declared it unknown — the two must never be conflated, per docs/DATA_SCHEMA.md's
 * `Missing`/`DeclaredUnknown` distinction. */
export interface FieldEnrichmentGap {
  field: 'manufacturer' | 'model' | 'approximateAge' | 'quantity';
  missing: number;
  declaredUnknown: number;
}

export interface DashboardView {
  totalCustomers: number;
  totalEquipmentObserved: number;
  equipmentByModality: Readonly<Record<string, number>>;
  equipmentByCountry: readonly CountryEquipmentCount[];
  equipmentByStatus: Readonly<Record<ObservationStatus, number>>;
  equipmentByConfidence: Readonly<Record<ConfidenceLevel, number>>;
  incompleteObservations: number;
  pendingDuplicateCandidates: number;
  /** Projected quantity whose `approximateAge` is anything other than `{ type: 'unknown' }`. */
  ageKnown: number;
  /** Projected quantity whose `approximateAge` is `{ type: 'unknown' }`. */
  ageUnknown: number;
  /** Always carries every band label from `AGE_BAND_LABELS`, zero-filled, in display order. */
  ageBands: readonly AgeBandCount[];
  /** Always carries all four fields, ordered by `missing` descending. */
  fieldEnrichmentGaps: readonly FieldEnrichmentGap[];
}
