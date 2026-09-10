import type {
  Customer,
  DuplicateCandidate,
  DuplicateComparableObservation,
  ResolvedDuplicateResolution,
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
  resolveDuplicateCandidate(candidateId: string, resolution: ResolvedDuplicateResolution): void;
}

export interface InstalledBaseQueryRepository {
  listCustomers(): readonly CustomerListItem[];
  getCustomer360(customerId: string, now: string): Customer360View | null;
  getDashboard(now: string): DashboardView;
}

export interface SeedRepository {
  hasSeed(seedKey: string): boolean;
  /**
   * Applies a seed once, and retires any superseded seed named in `supersededSeedKeys` first.
   * Retiring removes only rows that the superseded seed itself wrote; user-captured observations
   * are never seed-owned and are never touched.
   */
  applySeed(
    seedKey: string,
    aggregates: readonly SavedObservationAggregate[],
    supersededSeedKeys?: readonly string[],
  ): void;
}

export type InstalledBaseRepository = CustomerRepository &
  ObservationSessionRepository &
  EquipmentObservationRepository &
  DuplicateCandidateRepository &
  InstalledBaseQueryRepository &
  SeedRepository;
