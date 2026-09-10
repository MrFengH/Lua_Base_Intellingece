import type {
  ApproximateAge,
  ConfidenceAssessment,
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

export interface ObservationEvidenceView {
  sessionId: string;
  equipmentObservationId: string;
  observedAt: string;
  observerName: string;
  visitId: string;
  rawInput: string | null;
  source: string;
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

export interface DashboardView {
  totalCustomers: number;
  totalEquipmentObserved: number;
  equipmentByModality: Readonly<Record<string, number>>;
  observationsByCountry: Readonly<Record<string, number>>;
  agingEquipment: number | null;
  incompleteObservations: number;
  agingPolicy: 'Not configured';
}
