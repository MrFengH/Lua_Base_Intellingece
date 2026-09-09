import { describe, expect, it } from 'vitest';
import type { SavedObservationAggregate } from '@/domain';
import {
  applyDevelopmentSeed,
  createDevelopmentSeed,
  LocalSqliteDatabase,
  SqliteInstalledBaseRepository,
} from '@/infrastructure';

describe('SQLite persistence', () => {
  it('saves a session with MR and CT atomically', () => {
    const database = new LocalSqliteDatabase(':memory:');
    try {
      const repository = new SqliteInstalledBaseRepository(database);
      const valid = createDevelopmentSeed()[0]!;
      repository.saveAggregate(valid, []);
      const count = database.connection
        .prepare('SELECT COUNT(*) AS count FROM equipment_observations')
        .get() as { count: number };
      expect(count.count).toBe(2);
    } finally {
      database.close();
    }
  });

  it('rolls back customer, session and first equipment if the second equipment fails', () => {
    const database = new LocalSqliteDatabase(':memory:');
    try {
      const repository = new SqliteInstalledBaseRepository(database);
      const valid = createDevelopmentSeed()[0]!;
      const invalid: SavedObservationAggregate = {
        ...valid,
        equipment: [valid.equipment[0]!, { ...valid.equipment[1]!, quantity: -1 }],
      };
      expect(() => repository.saveAggregate(invalid, [])).toThrow();
      const customers = database.connection
        .prepare('SELECT COUNT(*) AS count FROM customers')
        .get() as {
        count: number;
      };
      const sessions = database.connection
        .prepare('SELECT COUNT(*) AS count FROM observation_sessions')
        .get() as { count: number };
      const equipment = database.connection
        .prepare('SELECT COUNT(*) AS count FROM equipment_observations')
        .get() as { count: number };
      expect([customers.count, sessions.count, equipment.count]).toEqual([0, 0, 0]);
    } finally {
      database.close();
    }
  });

  it('applies the official seed idempotently and preserves projection trace ids', () => {
    const database = new LocalSqliteDatabase(':memory:');
    try {
      const repository = new SqliteInstalledBaseRepository(database);
      applyDevelopmentSeed(repository);
      applyDevelopmentSeed(repository);
      expect(repository.list()).toHaveLength(13);
      const sessions = database.connection
        .prepare('SELECT COUNT(*) AS count FROM observation_sessions')
        .get() as { count: number };
      expect(sessions.count).toBe(13);
      const equipment = database.connection
        .prepare('SELECT COUNT(*) AS count FROM equipment_observations')
        .get() as { count: number };
      expect(equipment.count).toBe(20);
      const view = repository.getCustomer360('seed-customer-democare', '2026-09-08T00:00:00Z');
      expect(view?.installedBase).toHaveLength(2);
      expect(
        view?.installedBase.every((item) => item.contributingObservationIds.length === 1),
      ).toBe(true);
    } finally {
      database.close();
    }
  });
});
