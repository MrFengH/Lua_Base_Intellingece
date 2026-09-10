import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  DuplicateCandidate,
  EquipmentObservation,
  ResolvedDuplicateResolution,
  SavedObservationAggregate,
} from '@/domain';
import { DuplicateDetectionService } from '@/domain';
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

describe('Customer 360 exposes stored provenance and confidence (P3-S4)', () => {
  const equipmentBase = (): EquipmentObservation => createDevelopmentSeed()[0]!.equipment[0]!;

  const withEquipment = (equipment: EquipmentObservation): SavedObservationAggregate => {
    const base = createDevelopmentSeed()[0]!;
    return { ...base, equipment: [equipment] };
  };

  it('round-trips every field certainty value, including null, without recomputing it', () => {
    const database = new LocalSqliteDatabase(':memory:');
    try {
      const repository = new SqliteInstalledBaseRepository(database);
      const equipment: EquipmentObservation = {
        ...equipmentBase(),
        id: 'test-equipment-provenance-1',
        rawModality: 'resonador magnetico',
        confidence: {
          level: 'Medium',
          score: 0.5,
          reasons: [
            { code: 'EXPLICIT_FACTS', detail: '1 explicit fact(s).' },
            { code: 'UNCERTAINTY_LANGUAGE', detail: '1 uncertain fact(s).' },
          ],
          evidenceIds: ['evidence-1'],
          strategyVersion: 'confidence-v1',
        },
        fieldProvenance: {
          modality: {
            knowledgeState: 'Known',
            origin: 'Reported',
            certainty: 'Explicit',
            evidenceIds: ['evidence-1'],
          },
          quantity: {
            knowledgeState: 'Known',
            origin: 'Reported',
            certainty: 'Uncertain',
            evidenceIds: ['evidence-1'],
          },
          manufacturer: {
            // The extractor supplied no certainty at all; this must stay `null`, never `Explicit`.
            knowledgeState: 'Known',
            origin: 'Reported',
            certainty: null,
            evidenceIds: ['evidence-1'],
          },
          model: {
            knowledgeState: 'DeclaredUnknown',
            origin: 'Unknown',
            certainty: null,
            evidenceIds: ['evidence-1'],
          },
          notes: {
            knowledgeState: 'Missing',
            origin: 'Unknown',
            certainty: null,
            evidenceIds: [],
          },
        },
      };
      repository.saveAggregate(withEquipment(equipment), []);
      const view = repository.getCustomer360('seed-customer-democare', '2026-09-09T00:00:00Z');
      const item = view?.installedBase.find((entry) =>
        entry.contributingObservationIds.includes(equipment.id),
      );
      expect(item?.rawModality).toBe('resonador magnetico');
      expect(item?.confidence).toEqual(equipment.confidence);
      expect(item?.fieldProvenance.modality).toEqual({
        knowledgeState: 'Known',
        origin: 'Reported',
        certainty: 'Explicit',
        evidenceIds: ['evidence-1'],
      });
      expect(item?.fieldProvenance.quantity?.certainty).toBe('Uncertain');
      expect(item?.fieldProvenance.manufacturer?.certainty).toBeNull();
      expect(item?.fieldProvenance.manufacturer?.knowledgeState).toBe('Known');
      expect(item?.fieldProvenance.model?.knowledgeState).toBe('DeclaredUnknown');
      expect(item?.fieldProvenance.notes?.knowledgeState).toBe('Missing');
    } finally {
      database.close();
    }
  });

  it('keeps status and field certainty as independent axes for a Confirmed observation with an uncertain age', () => {
    const database = new LocalSqliteDatabase(':memory:');
    try {
      const repository = new SqliteInstalledBaseRepository(database);
      const equipment: EquipmentObservation = {
        ...equipmentBase(),
        id: 'test-equipment-confirmed-uncertain-age',
        status: 'Confirmed',
        fieldProvenance: {
          ...equipmentBase().fieldProvenance,
          approximateAge: {
            knowledgeState: 'Known',
            origin: 'Observed',
            certainty: 'Uncertain',
            evidenceIds: ['evidence-1'],
          },
        },
      };
      repository.saveAggregate(withEquipment(equipment), []);
      const view = repository.getCustomer360('seed-customer-democare', '2026-09-09T00:00:00Z');
      const item = view?.installedBase.find((entry) =>
        entry.contributingObservationIds.includes(equipment.id),
      );
      expect(item?.status).toBe('Confirmed');
      expect(item?.fieldProvenance.approximateAge?.certainty).toBe('Uncertain');
    } finally {
      database.close();
    }
  });

  it('keeps status and field certainty as independent axes for a Reported observation with an explicit field', () => {
    const database = new LocalSqliteDatabase(':memory:');
    try {
      const repository = new SqliteInstalledBaseRepository(database);
      const equipment: EquipmentObservation = {
        ...equipmentBase(),
        id: 'test-equipment-reported-explicit',
        status: 'Reported',
        fieldProvenance: {
          ...equipmentBase().fieldProvenance,
          manufacturer: {
            knowledgeState: 'Known',
            origin: 'Reported',
            certainty: 'Explicit',
            evidenceIds: ['evidence-1'],
          },
        },
      };
      repository.saveAggregate(withEquipment(equipment), []);
      const view = repository.getCustomer360('seed-customer-democare', '2026-09-09T00:00:00Z');
      const item = view?.installedBase.find((entry) =>
        entry.contributingObservationIds.includes(equipment.id),
      );
      expect(item?.status).toBe('Reported');
      expect(item?.fieldProvenance.manufacturer?.certainty).toBe('Explicit');
    } finally {
      database.close();
    }
  });

  it('marks a corrected field through its persisted evidence id, without a new versioning mechanism', () => {
    const database = new LocalSqliteDatabase(':memory:');
    try {
      const repository = new SqliteInstalledBaseRepository(database);
      const equipment: EquipmentObservation = {
        ...equipmentBase(),
        id: 'test-equipment-corrected',
        fieldProvenance: {
          ...equipmentBase().fieldProvenance,
          manufacturer: {
            knowledgeState: 'Known',
            origin: 'Reported',
            certainty: 'Explicit',
            evidenceIds: ['correction:test-1'],
          },
        },
      };
      repository.saveAggregate(withEquipment(equipment), []);
      const view = repository.getCustomer360('seed-customer-democare', '2026-09-09T00:00:00Z');
      const item = view?.installedBase.find((entry) =>
        entry.contributingObservationIds.includes(equipment.id),
      );
      expect(item?.fieldProvenance.manufacturer?.evidenceIds).toContain('correction:test-1');
    } finally {
      database.close();
    }
  });

  it('does not break Customer 360 when a historical record carries no per-field provenance', () => {
    const database = new LocalSqliteDatabase(':memory:');
    try {
      const repository = new SqliteInstalledBaseRepository(database);
      const equipment: EquipmentObservation = {
        ...equipmentBase(),
        id: 'test-equipment-partial-history',
        fieldProvenance: {},
      };
      repository.saveAggregate(withEquipment(equipment), []);
      const view = repository.getCustomer360('seed-customer-democare', '2026-09-09T00:00:00Z');
      const item = view?.installedBase.find((entry) =>
        entry.contributingObservationIds.includes(equipment.id),
      );
      expect(item?.fieldProvenance).toEqual({});
      expect(item?.modality).toBe(equipment.modality);
    } finally {
      database.close();
    }
  });
});

const saveDuplicateReviewScenario = (
  repository: SqliteInstalledBaseRepository,
  suffix: string,
  manufacturer: string,
): {
  source: EquipmentObservation;
  comparable: EquipmentObservation;
  candidate: DuplicateCandidate;
} => {
  const aggregate = createDevelopmentSeed()[0]!;
  const comparable = aggregate.equipment.find((equipment) => equipment.modality === 'MR')!;
  const evidenceId = `duplicate-review-evidence-${suffix}`;
  const sessionId = `duplicate-review-session-${suffix}`;
  const observedAt = `2026-09-${suffix === 'corroboration' ? '08' : '09'}T10:00:00.000Z`;
  const source: EquipmentObservation = {
    ...comparable,
    id: `duplicate-review-source-${suffix}`,
    sessionId,
    manufacturer,
    model: null,
    evidenceIds: [evidenceId],
    confidence: { ...comparable.confidence, evidenceIds: [evidenceId] },
    fieldProvenance: Object.fromEntries(
      Object.entries(comparable.fieldProvenance).map(([field, provenance]) => [
        field,
        { ...provenance, evidenceIds: [evidenceId] },
      ]),
    ),
  };
  const sourceAggregate: SavedObservationAggregate = {
    customer: aggregate.customer,
    session: {
      ...aggregate.session,
      id: sessionId,
      observer: { id: `observer-${suffix}`, displayName: `Reviewer source ${suffix}` },
      visitId: `visit-${suffix}`,
      observedAt,
      createdAt: observedAt,
      rawInput: `Two MR systems by ${manufacturer}, approximately seven years old.`,
      evidence: [
        {
          id: evidenceId,
          sessionId,
          source: 'Text',
          capturedAt: observedAt,
          rawText: `Two MR systems by ${manufacturer}, approximately seven years old.`,
        },
      ],
    },
    equipment: [source],
  };
  const result = new DuplicateDetectionService().score(
    {
      id: source.id,
      customerId: aggregate.customer.id,
      modality: source.modality,
      manufacturer: source.manufacturer,
      model: source.model,
      approximateAge: source.approximateAge,
      observerId: sourceAggregate.session.observer.id,
      visitId: sourceAggregate.session.visitId,
    },
    {
      id: comparable.id,
      customerId: aggregate.customer.id,
      modality: comparable.modality,
      manufacturer: comparable.manufacturer,
      model: comparable.model,
      approximateAge: comparable.approximateAge,
      observerId: aggregate.session.observer.id,
      visitId: aggregate.session.visitId,
    },
  );
  const candidate: DuplicateCandidate = {
    id: `duplicate-review-candidate-${suffix}`,
    sourceObservationId: source.id,
    candidateObservationId: comparable.id,
    candidateInstalledBaseId: null,
    score: result.score,
    explanation: result.reasons,
    relationship: result.relationship,
    resolution: 'Unresolved',
    algorithmVersion: result.algorithmVersion,
    createdAt: observedAt,
  };
  repository.saveAggregate(sourceAggregate, [candidate]);
  return { source, comparable, candidate };
};

const duplicateScenario = (suffix: string, manufacturer = 'NovaMed') => {
  const database = new LocalSqliteDatabase(':memory:');
  const repository = new SqliteInstalledBaseRepository(database);
  const aggregate = createDevelopmentSeed()[0]!;
  repository.saveAggregate(aggregate, []);
  const scenario = saveDuplicateReviewScenario(repository, suffix, manufacturer);
  return { database, repository, customerId: aggregate.customer.id, ...scenario };
};

describe('duplicate candidate review and resolution (P3-S5)', () => {
  it('returns real corroboration and conflict scores, reasons, and the correct observations', () => {
    const database = new LocalSqliteDatabase(':memory:');
    try {
      const repository = new SqliteInstalledBaseRepository(database);
      const aggregate = createDevelopmentSeed()[0]!;
      repository.saveAggregate(aggregate, []);
      const corroboration = saveDuplicateReviewScenario(repository, 'corroboration', 'NovaMed');
      const conflict = saveDuplicateReviewScenario(repository, 'conflict', 'Orion Imaging');

      const view = repository.getCustomer360(aggregate.customer.id, '2026-09-10T00:00:00.000Z');
      expect(view?.duplicateCandidates.pending).toHaveLength(2);
      expect(view?.duplicateCandidates.resolved).toHaveLength(0);

      const corroborationReview = view?.duplicateCandidates.pending.find(
        (candidate) => candidate.id === corroboration.candidate.id,
      );
      expect(corroborationReview?.relationship).toBe('PossibleCorroboration');
      expect(corroborationReview?.score).toBe(0.8);
      expect(corroborationReview?.reasons).toEqual(corroboration.candidate.explanation);
      expect(corroborationReview?.algorithmVersion).toBe('duplicate-v1');
      expect(corroborationReview?.sourceObservation.id).toBe(corroboration.source.id);
      expect(corroborationReview?.comparableObservation.id).toBe(corroboration.comparable.id);
      expect(corroborationReview?.sourceObservation.manufacturer).toBe('NovaMed');
      expect(corroborationReview?.comparableObservation.manufacturer).toBe('NovaMed');
      expect(corroborationReview?.sourceObservation.rawEvidence).toContain('NovaMed');

      const conflictReview = view?.duplicateCandidates.pending.find(
        (candidate) => candidate.id === conflict.candidate.id,
      );
      expect(conflictReview?.relationship).toBe('PossibleConflict');
      expect(conflictReview?.score).toBe(0.56);
      expect(conflictReview?.reasons).toEqual(conflict.candidate.explanation);
      expect(conflictReview?.reasons.map((reason) => reason.code)).toContain(
        'DIFFERENT_MANUFACTURER',
      );
      expect(conflictReview?.sourceObservation.id).toBe(conflict.source.id);
      expect(conflictReview?.comparableObservation.id).toBe(conflict.comparable.id);
      expect(conflictReview?.sourceObservation.manufacturer).toBe('Orion Imaging');
      expect(conflictReview?.comparableObservation.manufacturer).toBe('NovaMed');
    } finally {
      database.close();
    }
  });

  it.each<ResolvedDuplicateResolution>(['NotDuplicate', 'SameEquipment', 'CorroboratingEvidence'])(
    'persists %s without changing either observation or its evidence',
    (resolution) => {
      const { database, repository, customerId, source, comparable, candidate } =
        duplicateScenario(resolution);
      try {
        const observationsBefore = database.connection
          .prepare(
            `SELECT id, quantity, status, confidence_json FROM equipment_observations
           WHERE id IN (?, ?) ORDER BY id`,
          )
          .all(source.id, comparable.id);
        const evidenceBefore = database.connection
          .prepare(
            `SELECT ei.* FROM evidence_items ei
           WHERE ei.session_id IN (
             SELECT session_id FROM equipment_observations WHERE id IN (?, ?)
           ) ORDER BY ei.id`,
          )
          .all(source.id, comparable.id);

        repository.resolveDuplicateCandidate(candidate.id, resolution);

        const persisted = repository
          .listForCustomer(customerId)
          .find((item) => item.id === candidate.id);
        expect(persisted?.resolution).toBe(resolution);
        const view = repository.getCustomer360(customerId, '2026-09-10T00:00:00.000Z');
        expect(view?.duplicateCandidates.pending).toHaveLength(0);
        expect(view?.duplicateCandidates.resolved).toHaveLength(1);
        expect(view?.duplicateCandidates.resolved[0]?.resolution).toBe(resolution);

        expect(
          database.connection
            .prepare(
              `SELECT id, quantity, status, confidence_json FROM equipment_observations
             WHERE id IN (?, ?) ORDER BY id`,
            )
            .all(source.id, comparable.id),
        ).toEqual(observationsBefore);
        expect(
          database.connection
            .prepare(
              `SELECT ei.* FROM evidence_items ei
             WHERE ei.session_id IN (
               SELECT session_id FROM equipment_observations WHERE id IN (?, ?)
             ) ORDER BY ei.id`,
            )
            .all(source.id, comparable.id),
        ).toEqual(evidenceBefore);
      } finally {
        database.close();
      }
    },
  );

  it('keeps an unresolved candidate pending', () => {
    const { database, repository, customerId, candidate } = duplicateScenario('unresolved');
    try {
      const view = repository.getCustomer360(customerId, '2026-09-10T00:00:00.000Z');
      expect(view?.duplicateCandidates.pending.map((item) => item.id)).toEqual([candidate.id]);
      expect(view?.duplicateCandidates.resolved).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  it('keeps the human resolution after a database restart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'cib-duplicate-resolution-'));
    const databasePath = join(directory, 'restart.sqlite');
    try {
      const firstDatabase = new LocalSqliteDatabase(databasePath);
      const firstRepository = new SqliteInstalledBaseRepository(firstDatabase);
      const aggregate = createDevelopmentSeed()[0]!;
      firstRepository.saveAggregate(aggregate, []);
      const { candidate } = saveDuplicateReviewScenario(firstRepository, 'restart', 'NovaMed');
      firstRepository.resolveDuplicateCandidate(candidate.id, 'SameEquipment');
      firstDatabase.close();

      const restartedDatabase = new LocalSqliteDatabase(databasePath);
      try {
        const restartedRepository = new SqliteInstalledBaseRepository(restartedDatabase);
        const view = restartedRepository.getCustomer360(
          aggregate.customer.id,
          '2026-09-10T00:00:00.000Z',
        );
        expect(view?.duplicateCandidates.pending).toHaveLength(0);
        expect(view?.duplicateCandidates.resolved[0]?.resolution).toBe('SameEquipment');
        expect(view?.duplicateCandidates.resolved[0]?.sourceObservation.id).toBe(
          'duplicate-review-source-restart',
        );
      } finally {
        restartedDatabase.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('does not offer an already-resolved candidate for another decision', () => {
    const { database, repository, candidate } = duplicateScenario('one-decision');
    try {
      repository.resolveDuplicateCandidate(candidate.id, 'NotDuplicate');
      expect(() =>
        repository.resolveDuplicateCandidate(candidate.id, 'CorroboratingEvidence'),
      ).toThrow(/already been resolved/i);
    } finally {
      database.close();
    }
  });
});
