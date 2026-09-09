import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SavedObservationAggregate } from '@/domain';
import { deriveInstallationEstimate, normalizeName } from '@/domain';
import { LocalSqliteDatabase, SqliteInstalledBaseRepository } from '@/infrastructure/persistence';
import { applyDevelopmentSeed, DEVELOPMENT_SEED_KEY } from '@/infrastructure/seed';
import { createLegacyDatabaseFile } from '../fixtures/legacy-database';
import {
  createLegacyDevelopmentSeed,
  LEGACY_DEVELOPMENT_SEED_KEY,
} from '../fixtures/legacy-development-seed';

const NOW = '2026-09-09T00:00:00.000Z';
const OBSERVED_AT = '2026-09-01T09:00:00.000Z';

let directory: string;
let databasePath: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'cib-seed-migration-'));
  databasePath = join(directory, 'legacy.sqlite');
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

/**
 * An observation as the capture workflow saves one: no seed key, and no `fixture` in its evidence
 * metadata. It reports a facility the legacy seed also created, which is the case a careless
 * cleanup would destroy.
 */
const userObservation = (): SavedObservationAggregate => {
  const age = { type: 'estimate', minYears: 6, maxYears: 8 } as const;
  const evidenceId = 'user-evidence-1';
  const provenance = {
    knowledgeState: 'Known' as const,
    origin: 'Reported' as const,
    certainty: 'Uncertain' as const,
    evidenceIds: [evidenceId],
  };
  return {
    customer: {
      id: 'seed-customer-democare',
      name: 'Hospital DemoCare Pacific',
      normalizedName: normalizeName('Hospital DemoCare Pacific'),
      city: 'Panama City',
      country: 'Panama',
      createdAt: OBSERVED_AT,
      updatedAt: OBSERVED_AT,
    },
    session: {
      id: 'user-session-1',
      customerId: 'seed-customer-democare',
      observer: { id: 'user-1', displayName: 'Field Colleague' },
      visitId: 'user-visit-1',
      observedAt: OBSERVED_AT,
      createdAt: OBSERVED_AT,
      lastVerifiedAt: null,
      rawInput: 'They also have an Orion Imaging ultrasound, maybe seven years old.',
      reportedFacility: {
        name: 'Hospital DemoCare Pacific',
        normalizedName: normalizeName('Hospital DemoCare Pacific'),
        city: 'Panama City',
        country: 'Panama',
      },
      evidence: [
        {
          id: evidenceId,
          sessionId: 'user-session-1',
          source: 'Text',
          capturedAt: OBSERVED_AT,
          rawText: 'They also have an Orion Imaging ultrasound, maybe seven years old.',
        },
      ],
    },
    equipment: [
      {
        id: 'user-equipment-1',
        sessionId: 'user-session-1',
        groupOrder: 0,
        modality: 'Ultrasound',
        rawModality: 'ultrasound',
        quantity: 1,
        manufacturer: 'Orion Imaging',
        model: null,
        approximateAge: age,
        installationEstimate: deriveInstallationEstimate(age, OBSERVED_AT),
        confidence: {
          level: 'Medium',
          score: 0.6,
          reasons: [{ code: 'UNCERTAINTY_LANGUAGE', detail: '1 uncertain fact(s).' }],
          evidenceIds: [evidenceId],
          strategyVersion: 'confidence-v1',
        },
        status: 'Estimated',
        notes: null,
        evidenceIds: [evidenceId],
        fieldProvenance: { modality: provenance, approximateAge: provenance },
      },
    ],
  };
};

const openDatabase = () => {
  const database = new LocalSqliteDatabase(databasePath);
  return { database, repository: new SqliteInstalledBaseRepository(database) };
};

const count = (database: LocalSqliteDatabase, sql: string): number =>
  (database.connection.prepare(sql).get() as { count: number }).count;

describe('upgrading a pre-P2-S2 database to the official seed', () => {
  it('reproduces the old-seed state, then converges on the official dataset', () => {
    createLegacyDatabaseFile(databasePath);

    // The legacy file predates the ownership column entirely.
    const before = new LocalSqliteDatabase(databasePath);
    // Opening it already ran the migration, so assert on what the migration recovered.
    expect(
      before.connection
        .prepare('SELECT COUNT(*) AS count FROM observation_sessions WHERE seed_key = ?')
        .get(LEGACY_DEVELOPMENT_SEED_KEY),
    ).toEqual({ count: 3 });
    before.close();

    const { database, repository } = openDatabase();
    try {
      repository.saveAggregate(userObservation(), []);
      expect(() => applyDevelopmentSeed(repository)).not.toThrow();

      expect(count(database, 'SELECT COUNT(*) AS count FROM customers')).toBe(13);
      expect(
        count(
          database,
          `SELECT COUNT(*) AS count FROM observation_sessions WHERE seed_key = '${DEVELOPMENT_SEED_KEY}'`,
        ),
      ).toBe(13);
      expect(
        count(
          database,
          `SELECT COUNT(*) AS count FROM equipment_observations WHERE session_id IN
             (SELECT id FROM observation_sessions WHERE seed_key = '${DEVELOPMENT_SEED_KEY}')`,
        ),
      ).toBe(20);
      expect(repository.hasSeed(DEVELOPMENT_SEED_KEY)).toBe(true);
      expect(repository.hasSeed(LEGACY_DEVELOPMENT_SEED_KEY)).toBe(false);
    } finally {
      database.close();
    }
  });

  it('leaves no legacy facility or equipment behind to contaminate the projections', () => {
    createLegacyDatabaseFile(databasePath);
    const { database, repository } = openDatabase();
    try {
      applyDevelopmentSeed(repository);
      const names = repository.list().map((customer) => customer.name);
      expect(names).not.toContain('Hospital São Aurora');
      expect(names).not.toContain('Hospital Valle Norte');
      expect(
        count(
          database,
          `SELECT COUNT(*) AS count FROM observation_sessions
           WHERE seed_key = '${LEGACY_DEVELOPMENT_SEED_KEY}'`,
        ),
      ).toBe(0);
      // The legacy seed's only X-Ray group must be gone; the official dataset has no X-Ray row.
      const dashboard = repository.getDashboard(NOW);
      expect(Object.keys(dashboard.equipmentByModality).sort()).toEqual(['CT', 'MR', 'Ultrasound']);
      expect(dashboard.totalCustomers).toBe(13);
    } finally {
      database.close();
    }
  });

  it('keeps the user observation, its evidence and its projection row', () => {
    // The user captured this before the upgrade, so it too predates the ownership column and the
    // migration has to recognise it as *not* seed-owned from its evidence alone.
    createLegacyDatabaseFile(databasePath, [...createLegacyDevelopmentSeed(), userObservation()]);
    const { database, repository } = openDatabase();
    try {
      applyDevelopmentSeed(repository);

      expect(
        count(
          database,
          "SELECT COUNT(*) AS count FROM observation_sessions WHERE id = 'user-session-1'",
        ),
      ).toBe(1);
      expect(
        count(
          database,
          "SELECT COUNT(*) AS count FROM evidence_items WHERE id = 'user-evidence-1'",
        ),
      ).toBe(1);
      expect(
        count(
          database,
          "SELECT COUNT(*) AS count FROM equipment_observations WHERE id = 'user-equipment-1'",
        ),
      ).toBe(1);
      // A user-captured session is never seed-owned, which is what puts it out of retirement range.
      expect(
        count(
          database,
          "SELECT COUNT(*) AS count FROM observation_sessions WHERE id = 'user-session-1' AND seed_key IS NULL",
        ),
      ).toBe(1);

      const view = repository.getCustomer360('seed-customer-democare', NOW);
      const ultrasound = view?.installedBase.filter((item) => item.modality === 'Ultrasound') ?? [];
      expect(ultrasound).toHaveLength(1);
      expect(ultrasound[0]?.manufacturer).toBe('Orion Imaging');
      // The facility still carries the official rows alongside the user's own.
      expect(view?.installedBase.filter((item) => item.modality === 'MR')).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it('does not duplicate the seed when the application restarts repeatedly', () => {
    createLegacyDatabaseFile(databasePath);
    for (let restart = 0; restart < 3; restart += 1) {
      const { database, repository } = openDatabase();
      try {
        applyDevelopmentSeed(repository);
      } finally {
        database.close();
      }
    }
    const { database, repository } = openDatabase();
    try {
      expect(repository.list()).toHaveLength(13);
      expect(count(database, 'SELECT COUNT(*) AS count FROM observation_sessions')).toBe(13);
      expect(count(database, 'SELECT COUNT(*) AS count FROM equipment_observations')).toBe(20);
      expect(count(database, 'SELECT COUNT(*) AS count FROM seed_imports')).toBe(1);
    } finally {
      database.close();
    }
  });

  it('still produces the official dataset on a clean database', () => {
    const { database, repository } = openDatabase();
    try {
      applyDevelopmentSeed(repository);
      applyDevelopmentSeed(repository);
      expect(repository.list()).toHaveLength(13);
      expect(count(database, 'SELECT COUNT(*) AS count FROM observation_sessions')).toBe(13);
      expect(count(database, 'SELECT COUNT(*) AS count FROM equipment_observations')).toBe(20);
      expect(repository.getDashboard(NOW).totalEquipmentObserved).toBe(50);
    } finally {
      database.close();
    }
  });

  it('refuses to retire a seed session that a surviving session supersedes', () => {
    createLegacyDatabaseFile(databasePath);
    const { database, repository } = openDatabase();
    try {
      const correction = userObservation();
      repository.saveAggregate(
        {
          ...correction,
          session: { ...correction.session, supersedesSessionId: 'seed-session-democare' },
        },
        [],
      );
      expect(() => applyDevelopmentSeed(repository)).toThrow(/Refusing to retire seed/);
      // The failed attempt changed nothing.
      expect(repository.hasSeed(LEGACY_DEVELOPMENT_SEED_KEY)).toBe(true);
      expect(
        count(
          database,
          "SELECT COUNT(*) AS count FROM observation_sessions WHERE id = 'user-session-1'",
        ),
      ).toBe(1);
    } finally {
      database.close();
    }
  });
});
