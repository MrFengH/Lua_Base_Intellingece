import type { ResolvedDuplicateResolution } from '@/domain';
import type { Customer360View, CustomerListItem, DashboardView } from '../contracts';
import type { Clock, DuplicateCandidateRepository, InstalledBaseQueryRepository } from '../ports';

export class InstalledBaseQueryService {
  constructor(
    private readonly repository: InstalledBaseQueryRepository & DuplicateCandidateRepository,
    private readonly clock: Clock,
  ) {}

  listCustomers(): readonly CustomerListItem[] {
    return this.repository.listCustomers();
  }

  getCustomer360(customerId: string): Customer360View | null {
    return this.repository.getCustomer360(customerId, this.clock.now());
  }

  getDashboard(): DashboardView {
    return this.repository.getDashboard(this.clock.now());
  }

  resolveDuplicateCandidate(
    candidateId: string,
    resolution: ResolvedDuplicateResolution,
  ): { candidateId: string; resolution: ResolvedDuplicateResolution } {
    this.repository.resolveDuplicateCandidate(candidateId, resolution);
    return { candidateId, resolution };
  }
}
