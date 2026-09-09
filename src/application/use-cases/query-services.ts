import type { Customer360View, CustomerListItem, DashboardView } from '../contracts';
import type { Clock, InstalledBaseQueryRepository } from '../ports';

export class InstalledBaseQueryService {
  constructor(
    private readonly repository: InstalledBaseQueryRepository,
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
}
