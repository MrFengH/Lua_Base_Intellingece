import type { ApproximateAge, InstallationEstimate } from './age';
import type { ConfidenceAssessment } from './confidence';
import type {
  FactCertainty,
  FieldOrigin,
  KnowledgeState,
  Modality,
  ObservationSource,
  ObservationStatus,
} from './enums';

export type EntityId = string;
export type IsoDateTime = string;

export interface Customer {
  id: EntityId;
  name: string;
  normalizedName: string;
  city: string | null;
  country: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface Observer {
  id: string;
  displayName: string;
}

export interface ReportedFacilitySnapshot {
  name: string | null;
  normalizedName: string | null;
  city: string | null;
  country: string | null;
}

export interface EvidenceItem {
  id: EntityId;
  sessionId: EntityId;
  source: ObservationSource;
  capturedAt: IsoDateTime;
  rawText: string | null;
  localArtifactUri?: string | null;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface FieldProvenance {
  knowledgeState: KnowledgeState;
  origin: FieldOrigin;
  /** `null` means the extractor supplied no certainty; it must not be promoted to Explicit. */
  certainty: FactCertainty | null;
  evidenceIds: readonly EntityId[];
  derivation?: Readonly<Record<string, unknown>>;
}

export interface ObservationSession {
  id: EntityId;
  customerId: EntityId;
  observer: Observer;
  visitId: string;
  observedAt: IsoDateTime;
  createdAt: IsoDateTime;
  lastVerifiedAt: IsoDateTime | null;
  /** Primary capture retained for convenient audit; all source items remain in evidence. */
  rawInput: string | null;
  reportedFacility: ReportedFacilitySnapshot;
  evidence: readonly EvidenceItem[];
  supersedesSessionId?: EntityId | null;
}

export interface EquipmentObservation {
  id: EntityId;
  sessionId: EntityId;
  groupOrder: number;
  modality: Modality;
  rawModality?: string | null;
  quantity: number | null;
  manufacturer: string | null;
  model: string | null;
  approximateAge: ApproximateAge;
  installationEstimate: InstallationEstimate;
  confidence: ConfidenceAssessment;
  status: ObservationStatus;
  notes: string | null;
  evidenceIds: readonly EntityId[];
  fieldProvenance: Readonly<Record<string, FieldProvenance>>;
}

/**
 * The immutable evidence aggregate written in one persistence transaction.
 * Draft state is deliberately not part of this type.
 */
export interface SavedObservationAggregate {
  customer: Customer;
  session: ObservationSession;
  equipment: readonly EquipmentObservation[];
}
