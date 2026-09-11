import { describe, expect, it } from 'vitest';
import type {
  ConfidenceAssessment,
  ConfidenceLevel,
  Customer,
  DuplicateCandidate,
  EquipmentObservation,
  FieldProvenance,
  ObservationSession,
  ObservationStatus,
  ResolvedDuplicateResolution,
  SavedObservationAggregate,
} from '@/domain';
import { LocalSqliteDatabase, SqliteInstalledBaseRepository } from '@/infrastructure';

const NOW = '2026-09-10T00:00:00.000Z';

const customer = (id: string, country: string | null, overrides: Partial<Customer> = {}): Customer => ({
  id,
  name: `Dashboard Test ${id}`,
  normalizedName: `dashboard test ${id}`,
  city: 'Testville',
  country,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

const session = (
  id: string,
  customerId: string,
  observedAt: string,
  overrides: Partial<ObservationSession> = {},
): ObservationSession => ({
  id,
  customerId,
  observer: { id: `${id}-observer`, displayName: 'Field User' },
  visitId: `${id}-visit`,
  observedAt,
  createdAt: observedAt,
  lastVerifiedAt: null,
  rawInput: 'Test capture.',
  reportedFacility: { name: null, normalizedName: null, city: null, country: null },
  evidence: [
    {
      id: `${id}-evidence`,
      sessionId: id,
      source: 'Text',
      capturedAt: observedAt,
      rawText: 'Test capture.',
    },
  ],
  ...overrides,
});

const knownField = (): FieldProvenance => ({
  knowledgeState: 'Known',
  origin: 'Reported',
  certainty: 'Explicit',
  evidenceIds: ['evidence-1'],
});
const missingField = (): FieldProvenance => ({
  knowledgeState: 'Missing',
  origin: 'Unknown',
  certainty: null,
  evidenceIds: [],
});
const declaredUnknownField = (): FieldProvenance => ({
  knowledgeState: 'DeclaredUnknown',
  origin: 'Unknown',
  certainty: null,
  evidenceIds: ['evidence-1'],
});

const confidenceOf = (level: ConfidenceLevel): ConfidenceAssessment => ({
  level,
  score: level === 'Unknown' ? null : 0.8,
  reasons: [],
  evidenceIds: ['evidence-1'],
  strategyVersion: 'confidence-v1',
});

let equipmentCounter = 0;

/** A fully-known MR group by default; callers override just the fields their scenario cares
 * about, so every other axis stays a fixed, uninteresting known value. */
const equipmentOf = (
  sessionId: string,
  overrides: Partial<EquipmentObservation> = {},
): EquipmentObservation => {
  equipmentCounter += 1;
  return {
    id: `dash-equipment-${equipmentCounter}`,
    sessionId,
    groupOrder: equipmentCounter,
    modality: 'MR',
    rawModality: 'MR',
    quantity: 1,
    manufacturer: 'NovaMed',
    model: 'NM-100',
    approximateAge: { type: 'exact', years: 3 },
    installationEstimate: { type: 'unknown', origin: 'Unknown' },
    confidence: confidenceOf('High'),
    status: 'Reported',
    notes: null,
    // No evidence items are linked in these fixtures — the dashboard aggregates never read
    // evidence linkage, and an empty list sidesteps the evidence foreign key entirely.
    evidenceIds: [],
    fieldProvenance: {
      modality: knownField(),
      quantity: knownField(),
      manufacturer: knownField(),
      model: knownField(),
      approximateAge: knownField(),
    },
    ...overrides,
  };
};

const aggregateOf = (
  cust: Customer,
  sess: ObservationSession,
  equipment: readonly EquipmentObservation[],
): SavedObservationAggregate => ({ customer: cust, session: sess, equipment });

describe('Dashboard field enrichment gaps distinguish Missing from DeclaredUnknown', () => {
  it('never counts an explicit "I don\'t know" as the same bug as a field the extractor never touched', () => {
    const database = new LocalSqliteDatabase(':memory:');
    try {
      const repository = new SqliteInstalledBaseRepository(database);
      const cust = customer('gaps-customer', 'Panama');
      const sess = session('gaps-session', cust.id, NOW);
      const equipment = [
        equipmentOf(sess.id, {
          modality: 'MR',
          fieldProvenance: {
            modality: knownField(),
            quantity: knownField(),
            manufacturer: missingField(),
            model: knownField(),
            approximateAge: knownField(),
          },
        }),
        equipmentOf(sess.id, {
          modality: 'CT',
          fieldProvenance: {
            modality: knownField(),
            quantity: knownField(),
            manufacturer: knownField(),
            model: declaredUnknownField(),
            approximateAge: knownField(),
          },
        }),
        equipmentOf(sess.id, {
          modality: 'Ultrasound',
          approximateAge: { type: 'unknown' },
          fieldProvenance: {
            modality: knownField(),
            quantity: knownField(),
            manufacturer: knownField(),
            model: knownField(),
            approximateAge: missingField(),
          },
        }),
        equipmentOf(sess.id, {
          modality: 'X-Ray',
          quantity: null,
          fieldProvenance: {
            modality: knownField(),
            quantity: missingField(),
            manufacturer: knownField(),
            model: knownField(),
            approximateAge: knownField(),
          },
        }),
      ];
      repository.saveAggregate(aggregateOf(cust, sess, equipment), []);

      const dashboard = repository.getDashboard(NOW);
      const gaps = Object.fromEntries(dashboard.fieldEnrichmentGaps.map((gap) => [gap.field, gap]));
      expect(gaps.manufacturer).toEqual({ field: 'manufacturer', missing: 1, declaredUnknown: 0 });
      expect(gaps.model).toEqual({ field: 'model', missing: 0, declaredUnknown: 1 });
      expect(gaps.approximateAge).toEqual({ field: 'approximateAge', missing: 1, declaredUnknown: 0 });
      expect(gaps.quantity).toEqual({ field: 'quantity', missing: 1, declaredUnknown: 0 });
      expect(dashboard.fieldEnrichmentGaps).toHaveLength(4);
    } finally {
      database.close();
    }
  });

  it('reports every gap as zero when a fully-known group is the only one on record', () => {
    const database = new LocalSqliteDatabase(':memory:');
    try {
      const repository = new SqliteInstalledBaseRepository(database);
      const cust = customer('gaps-clean-customer', 'Panama');
      const sess = session('gaps-clean-session', cust.id, NOW);
      repository.saveAggregate(aggregateOf(cust, sess, [equipmentOf(sess.id)]), []);

      const dashboard = repository.getDashboard(NOW);
      dashboard.fieldEnrichmentGaps.forEach((gap) => {
        expect(gap.missing).toBe(0);
        expect(gap.declaredUnknown).toBe(0);
      });
    } finally {
      database.close();
    }
  });
});

describe('Dashboard status and confidence distributions sum projected quantity, not group count', () => {
  it('keeps status and confidence as independent axes over the same equipment', () => {
    const database = new LocalSqliteDatabase(':memory:');
    try {
      const repository = new SqliteInstalledBaseRepository(database);
      const cust = customer('axes-customer', 'Panama');
      const sess = session('axes-session', cust.id, NOW);
      const equipment = [
        equipmentOf(sess.id, {
          modality: 'MR',
          quantity: 3,
          status: 'Confirmed' as ObservationStatus,
          confidence: confidenceOf('High'),
        }),
        equipmentOf(sess.id, {
          modality: 'CT',
          quantity: 2,
          status: 'Confirmed' as ObservationStatus,
          confidence: confidenceOf('Medium'),
        }),
        equipmentOf(sess.id, {
          modality: 'Ultrasound',
          quantity: 1,
          status: 'Reported' as ObservationStatus,
          confidence: confidenceOf('Low'),
        }),
      ];
      repository.saveAggregate(aggregateOf(cust, sess, equipment), []);

      const dashboard = repository.getDashboard(NOW);
      expect(dashboard.equipmentByStatus).toEqual({
        Confirmed: 5,
        Reported: 1,
        Estimated: 0,
        Unknown: 0,
      });
      expect(dashboard.equipmentByConfidence).toEqual({ High: 3, Medium: 2, Low: 1, Unknown: 0 });
    } finally {
      database.close();
    }
  });
});

describe('Dashboard equipment-by-country geography', () => {
  it('sums projected quantity per country independently of how many visits produced it, and falls back to Unknown', () => {
    const database = new LocalSqliteDatabase(':memory:');
    try {
      const repository = new SqliteInstalledBaseRepository(database);
      const panama = customer('geo-panama', 'Panama');
      const panamaSessionA = session('geo-panama-a', panama.id, '2026-09-01T00:00:00.000Z');
      const panamaSessionB = session('geo-panama-b', panama.id, '2026-09-05T00:00:00.000Z');
      const noCountry = customer('geo-unknown', null);
      const noCountrySession = session('geo-unknown-a', noCountry.id, NOW);

      repository.saveAggregate(
        aggregateOf(panama, panamaSessionA, [
          equipmentOf(panamaSessionA.id, { modality: 'MR', quantity: 2 }),
        ]),
        [],
      );
      repository.saveAggregate(
        aggregateOf(panama, panamaSessionB, [
          equipmentOf(panamaSessionB.id, { modality: 'CT', quantity: 3 }),
        ]),
        [],
      );
      repository.saveAggregate(
        aggregateOf(noCountry, noCountrySession, [
          equipmentOf(noCountrySession.id, { modality: 'MR', quantity: 1 }),
        ]),
        [],
      );

      const dashboard = repository.getDashboard(NOW);
      const byCountry = Object.fromEntries(dashboard.equipmentByCountry.map((row) => [row.country, row]));
      expect(byCountry.Panama).toEqual({ country: 'Panama', equipmentCount: 5, visitCount: 2 });
      expect(byCountry.Unknown).toEqual({ country: 'Unknown', equipmentCount: 1, visitCount: 1 });
      // Sorted by equipment descending, so the busier country leads the chart.
      expect(dashboard.equipmentByCountry[0]?.country).toBe('Panama');
    } finally {
      database.close();
    }
  });
});

describe('Dashboard pending duplicate candidates', () => {
  it('shows zero correctly when no candidate has ever been raised', () => {
    const database = new LocalSqliteDatabase(':memory:');
    try {
      const repository = new SqliteInstalledBaseRepository(database);
      const cust = customer('dup-none-customer', 'Panama');
      const sess = session('dup-none-session', cust.id, NOW);
      repository.saveAggregate(aggregateOf(cust, sess, [equipmentOf(sess.id)]), []);

      expect(repository.getDashboard(NOW).pendingDuplicateCandidates).toBe(0);
    } finally {
      database.close();
    }
  });

  it('counts only Unresolved candidates, across customers, after one is resolved', () => {
    const database = new LocalSqliteDatabase(':memory:');
    try {
      const repository = new SqliteInstalledBaseRepository(database);
      const cust = customer('dup-customer', 'Panama');
      const sess = session('dup-session', cust.id, NOW);
      const [first, second, third] = [
        equipmentOf(sess.id, { modality: 'MR' }),
        equipmentOf(sess.id, { modality: 'CT' }),
        equipmentOf(sess.id, { modality: 'Ultrasound' }),
      ] as const;
      const candidateA: DuplicateCandidate = {
        id: 'dup-candidate-a',
        sourceObservationId: first.id,
        candidateObservationId: second.id,
        candidateInstalledBaseId: null,
        score: 0.7,
        explanation: [],
        relationship: 'PossibleDuplicate',
        resolution: 'Unresolved',
        algorithmVersion: 'duplicate-v1',
        createdAt: NOW,
      };
      // A distinct source/candidate pair — the table's unique constraint is on that pair.
      const candidateB: DuplicateCandidate = {
        ...candidateA,
        id: 'dup-candidate-b',
        sourceObservationId: second.id,
        candidateObservationId: third.id,
      };
      repository.saveAggregate(
        aggregateOf(cust, sess, [first, second, third]),
        [candidateA, candidateB],
      );

      expect(repository.getDashboard(NOW).pendingDuplicateCandidates).toBe(2);

      const resolution: ResolvedDuplicateResolution = 'NotDuplicate';
      repository.resolveDuplicateCandidate(candidateA.id, resolution);

      expect(repository.getDashboard(NOW).pendingDuplicateCandidates).toBe(1);
    } finally {
      database.close();
    }
  });
});

describe('Dashboard totals stay coherent with Customer 360', () => {
  it('sums to the same equipment total the per-customer projections give', () => {
    const database = new LocalSqliteDatabase(':memory:');
    try {
      const repository = new SqliteInstalledBaseRepository(database);
      const panama = customer('coherence-panama', 'Panama');
      const panamaSession = session('coherence-panama-session', panama.id, NOW);
      const brazil = customer('coherence-brazil', 'Brazil');
      const brazilSession = session('coherence-brazil-session', brazil.id, NOW);

      repository.saveAggregate(
        aggregateOf(panama, panamaSession, [
          equipmentOf(panamaSession.id, { modality: 'MR', quantity: 4 }),
          equipmentOf(panamaSession.id, { modality: 'CT', quantity: 1 }),
        ]),
        [],
      );
      repository.saveAggregate(
        aggregateOf(brazil, brazilSession, [
          equipmentOf(brazilSession.id, { modality: 'Ultrasound', quantity: 2 }),
        ]),
        [],
      );

      const dashboard = repository.getDashboard(NOW);
      const customerViews = repository
        .listCustomers()
        .map((item) => repository.getCustomer360(item.id, NOW));
      const expectedTotal = customerViews.reduce(
        (sum, view) =>
          sum + (view?.installedBase.reduce((total, item) => total + (item.quantity ?? 0), 0) ?? 0),
        0,
      );

      expect(dashboard.totalEquipmentObserved).toBe(expectedTotal);
      expect(dashboard.totalEquipmentObserved).toBe(7);
      expect(dashboard.totalCustomers).toBe(customerViews.length);
      const equipmentByCountryTotal = dashboard.equipmentByCountry.reduce(
        (sum, row) => sum + row.equipmentCount,
        0,
      );
      expect(equipmentByCountryTotal).toBe(dashboard.totalEquipmentObserved);
    } finally {
      database.close();
    }
  });
});
