import type {
  ApproximateAge,
  Customer,
  EquipmentObservation,
  SavedObservationAggregate,
} from '@/domain';
import { deriveInstallationEstimate, normalizeName } from '@/domain';
import type { SeedRepository } from '@/application/ports';

export const DEVELOPMENT_SEED_KEY = 'synthetic-development-v1';

const confidence = (evidenceId: string) => ({
  level: 'High' as const,
  score: 0.83,
  reasons: [{ code: 'EXPLICIT_FACTS' as const, detail: 'Synthetic explicit seed facts.' }],
  evidenceIds: [evidenceId],
  strategyVersion: 'confidence-v1' as const,
});

const customer = (
  id: string,
  name: string,
  city: string,
  country: string,
  createdAt: string,
): Customer => ({
  id,
  name,
  normalizedName: normalizeName(name),
  city,
  country,
  createdAt,
  updatedAt: createdAt,
});

const equipment = (
  id: string,
  sessionId: string,
  order: number,
  modality: EquipmentObservation['modality'],
  quantity: number,
  manufacturer: string,
  model: string,
  age: ApproximateAge,
  observedAt: string,
  evidenceId: string,
): EquipmentObservation => ({
  id,
  sessionId,
  groupOrder: order,
  modality,
  rawModality: modality,
  quantity,
  manufacturer,
  model,
  approximateAge: age,
  installationEstimate: deriveInstallationEstimate(age, observedAt),
  confidence: confidence(evidenceId),
  status: age.type === 'estimate' || age.type === 'range' ? 'Estimated' : 'Reported',
  notes: 'Synthetic development data; not sourced from the unavailable challenge workbook.',
  evidenceIds: [evidenceId],
  fieldProvenance: {
    modality: {
      knowledgeState: 'Known',
      origin: 'Reported',
      certainty: 'Explicit',
      evidenceIds: [evidenceId],
    },
    quantity: {
      knowledgeState: 'Known',
      origin: 'Reported',
      certainty: 'Explicit',
      evidenceIds: [evidenceId],
    },
    manufacturer: {
      knowledgeState: 'Known',
      origin: 'Reported',
      certainty: 'Explicit',
      evidenceIds: [evidenceId],
    },
    model: {
      knowledgeState: 'Known',
      origin: 'Reported',
      certainty: 'Explicit',
      evidenceIds: [evidenceId],
    },
    approximateAge: {
      knowledgeState: 'Known',
      origin: 'Reported',
      certainty: age.type === 'exact' ? 'Explicit' : 'Uncertain',
      evidenceIds: [evidenceId],
    },
  },
});

const aggregate = (
  facility: Customer,
  sessionId: string,
  observerId: string,
  observerName: string,
  visitId: string,
  observedAt: string,
  rawInput: string,
  items: readonly EquipmentObservation[],
): SavedObservationAggregate => {
  const evidenceId = `${sessionId}-evidence`;
  return {
    customer: facility,
    session: {
      id: sessionId,
      customerId: facility.id,
      observer: { id: observerId, displayName: observerName },
      visitId,
      observedAt,
      createdAt: observedAt,
      lastVerifiedAt: null,
      rawInput,
      reportedFacility: {
        name: facility.name,
        normalizedName: facility.normalizedName,
        city: facility.city,
        country: facility.country,
      },
      evidence: [
        {
          id: evidenceId,
          sessionId,
          source: 'Text',
          capturedAt: observedAt,
          rawText: rawInput,
          metadata: { fixture: DEVELOPMENT_SEED_KEY },
        },
      ],
    },
    equipment: items,
  };
};

export const createDevelopmentSeed = (): readonly SavedObservationAggregate[] => {
  const demoObserved = '2026-06-12T14:00:00.000Z';
  const demoSession = 'seed-session-democare';
  const demoEvidence = `${demoSession}-evidence`;
  const demo = customer(
    'seed-customer-democare',
    'Hospital DemoCare Pacific',
    'Panama City',
    'Panama',
    demoObserved,
  );

  const auroraObserved = '2026-05-03T12:00:00.000Z';
  const auroraSession = 'seed-session-aurora';
  const auroraEvidence = `${auroraSession}-evidence`;
  const aurora = customer(
    'seed-customer-aurora',
    'Hospital São Aurora',
    'São Paulo',
    'Brazil',
    auroraObserved,
  );

  const valleObserved = '2026-04-20T16:30:00.000Z';
  const valleSession = 'seed-session-valle';
  const valleEvidence = `${valleSession}-evidence`;
  const valle = customer(
    'seed-customer-valle',
    'Hospital Valle Norte',
    'Medellín',
    'Colombia',
    valleObserved,
  );

  return [
    aggregate(
      demo,
      demoSession,
      'seed-observer-1',
      'Synthetic Observer A',
      'seed-visit-democare',
      demoObserved,
      'Hospital DemoCare Pacific has two NovaMed MR systems and one Aurelia CT.',
      [
        equipment(
          'seed-equipment-democare-mr',
          demoSession,
          0,
          'MR',
          2,
          'NovaMed',
          'X',
          { type: 'estimate', minYears: 8, maxYears: 8 },
          demoObserved,
          demoEvidence,
        ),
        equipment(
          'seed-equipment-democare-ct',
          demoSession,
          1,
          'CT',
          1,
          'Aurelia',
          'CT-4',
          { type: 'estimate', minYears: 5, maxYears: 6 },
          demoObserved,
          demoEvidence,
        ),
      ],
    ),
    aggregate(
      aurora,
      auroraSession,
      'seed-observer-2',
      'Synthetic Observer B',
      'seed-visit-aurora',
      auroraObserved,
      'Hospital São Aurora reports one NovaMed MR model Axis, around nine years old.',
      [
        equipment(
          'seed-equipment-aurora-mr',
          auroraSession,
          0,
          'MR',
          1,
          'NovaMed',
          'Axis',
          { type: 'estimate', minYears: 9, maxYears: 9 },
          auroraObserved,
          auroraEvidence,
        ),
      ],
    ),
    aggregate(
      valle,
      valleSession,
      'seed-observer-3',
      'Synthetic Observer C',
      'seed-visit-valle',
      valleObserved,
      'Hospital Valle Norte has three Aurelia ultrasound units and two NovaMed X-Ray units.',
      [
        equipment(
          'seed-equipment-valle-ultrasound',
          valleSession,
          0,
          'Ultrasound',
          3,
          'Aurelia',
          'Echo',
          { type: 'exact', years: 4 },
          valleObserved,
          valleEvidence,
        ),
        equipment(
          'seed-equipment-valle-xray',
          valleSession,
          1,
          'X-Ray',
          2,
          'NovaMed',
          'Ray-2',
          { type: 'qualitative', label: 'recent' },
          valleObserved,
          valleEvidence,
        ),
      ],
    ),
  ];
};

export const applyDevelopmentSeed = (repository: SeedRepository): void => {
  repository.applySeed(DEVELOPMENT_SEED_KEY, createDevelopmentSeed());
};
