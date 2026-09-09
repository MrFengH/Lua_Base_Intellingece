import type {
  Customer,
  DuplicateCandidate,
  DuplicateComparableObservation,
  SavedObservationAggregate,
} from '@/domain';
import type { Customer360View, CustomerListItem, DashboardView } from '../contracts';

export interface CustomerRepository {
  list(): readonly Customer[];
  findById(id: string): Customer | null;
  findByNormalizedIdentity(
    normalizedName: string,
    city: string | null,
    country: string | null,
  ): Customer | null;
}

export interface ObservationSessionRepository {
  saveAggregate(
    aggregate: SavedObservationAggregate,
    duplicateCandidates: readonly DuplicateCandidate[],
  ): void;
}

export interface EquipmentObservationRepository {
  findDuplicateComparables(customerId: string): readonly DuplicateComparableObservation[];
}

export interface DuplicateCandidateRepository {
  listForCustomer(customerId: string): readonly DuplicateCandidate[];
}

export interface InstalledBaseQueryRepository {
  listCustomers(): readonly CustomerListItem[];
  getCustomer360(customerId: string, now: string): Customer360View | null;
  getDashboard(now: string): DashboardView;
}

export interface SeedRepository {
  hasSeed(seedKey: string): boolean;
  applySeed(seedKey: string, aggregates: readonly SavedObservationAggregate[]): void;
}

export type InstalledBaseRepository = CustomerRepository &
  ObservationSessionRepository &
  EquipmentObservationRepository &
  DuplicateCandidateRepository &
  InstalledBaseQueryRepository &
  SeedRepository;
