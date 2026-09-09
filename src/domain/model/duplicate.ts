import type { ApproximateAge, InstallationEstimate } from './age';
import type { DuplicateResolution, EvidenceRelationship, Modality } from './enums';

export interface DuplicateComparableObservation {
  id: string;
  customerId: string;
  modality: Modality;
  manufacturer: string | null;
  model: string | null;
  approximateAge: ApproximateAge;
  installationEstimate?: InstallationEstimate;
  observerId?: string;
  visitId?: string;
}

export type DuplicateReasonCode =
  | 'DIFFERENT_CUSTOMER'
  | 'SAME_CUSTOMER'
  | 'UNKNOWN_MODALITY'
  | 'DIFFERENT_MODALITY'
  | 'SAME_MODALITY'
  | 'SAME_MANUFACTURER'
  | 'DIFFERENT_MANUFACTURER'
  | 'SAME_MODEL'
  | 'DIFFERENT_MODEL'
  | 'COMPATIBLE_AGE'
  | 'INCOMPATIBLE_AGE'
  | 'COMPATIBLE_INSTALLATION_YEAR'
  | 'INDEPENDENT_OBSERVER'
  | 'INDEPENDENT_VISIT';

export interface DuplicateReason {
  code: DuplicateReasonCode;
  detail: string;
  contribution: number;
}

export interface DuplicateScore {
  score: number;
  isCandidate: boolean;
  relationship: EvidenceRelationship;
  reasons: readonly DuplicateReason[];
  algorithmVersion: 'duplicate-v1';
}

export interface DuplicateCandidate {
  id: string;
  sourceObservationId: string;
  candidateObservationId: string;
  candidateInstalledBaseId: string | null;
  score: number;
  explanation: readonly DuplicateReason[];
  relationship: EvidenceRelationship;
  resolution: DuplicateResolution;
  algorithmVersion: 'duplicate-v1';
  createdAt: string;
}
