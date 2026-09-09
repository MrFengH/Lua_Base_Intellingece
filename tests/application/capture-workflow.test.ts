import { describe, expect, it } from 'vitest';
import type { Clock, IdGenerator } from '@/application';
import { CaptureWorkflowService } from '@/application';
import {
  applyDevelopmentSeed,
  DevelopmentMockObservationExtractionService,
  LocalSqliteDatabase,
  SqliteInstalledBaseRepository,
} from '@/infrastructure';

class FixedClock implements Clock {
  now(): string {
    return '2026-09-08T12:00:00.000Z';
  }
}

class SequenceIds implements IdGenerator {
  private value = 0;
  next(): string {
    this.value += 1;
    return `generated-${this.value}`;
  }
}

describe('CaptureWorkflowService', () => {
  it('runs extraction, acknowledges unknown and saves append-only evidence for Customer 360', async () => {
    const database = new LocalSqliteDatabase(':memory:');
    try {
      const repository = new SqliteInstalledBaseRepository(database);
      applyDevelopmentSeed(repository);
      const service = new CaptureWorkflowService(
        new DevelopmentMockObservationExtractionService(),
        repository,
        new FixedClock(),
        new SequenceIds(),
      );
      const started = service.start({
        observerId: 'new-observer',
        observedAt: '2026-09-08T12:00:00Z',
      });
      const extracted = await service.submitMessage(
        started.id,
        'I am at Hospital DemoCare Pacific in Panama. They have two MR systems and one CT.',
      );
      expect(extracted.draft.equipment.map((item) => item.modality)).toEqual([
        expect.objectContaining({ state: 'Known', value: 'MR' }),
        expect.objectContaining({ state: 'Known', value: 'CT' }),
      ]);
      expect(extracted.pendingQuestion?.field).toBe('Manufacturer');

      const unknown = await service.submitMessage(started.id, "I don't know the manufacturer.");
      expect(unknown.draft.equipment[0]?.manufacturer.state).toBe('DeclaredUnknown');
      expect(unknown.pendingQuestion?.field).toBe('ApproximateAge');

      const review = service.proceedToReview(started.id);
      expect(review.draft.state).toBe('READY_FOR_REVIEW');
      const saved = service.save(started.id);
      expect(saved.capture.draft.state).toBe('SAVED');

      const rawSessions = database.connection
        .prepare('SELECT COUNT(*) AS count FROM observation_sessions WHERE customer_id = ?')
        .get(saved.customerId) as { count: number };
      expect(rawSessions.count).toBe(2);
      const view = repository.getCustomer360(saved.customerId, '2026-09-08T12:00:00Z');
      expect(view?.evidence.some((item) => item.observerName === 'Demo Collaborator')).toBe(true);
    } finally {
      database.close();
    }
  });
});
