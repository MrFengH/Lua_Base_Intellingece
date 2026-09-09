import type {
  ApproximateAge,
  ConfidenceAssessment,
  DuplicateCandidate,
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

export interface Customer360View {
  customer: CustomerListItem;
  installedBase: readonly InstalledBaseItem[];
  evidence: readonly ObservationEvidenceView[];
  duplicateCandidates: readonly DuplicateCandidate[];
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
