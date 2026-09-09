import type {
  ApproximateAge,
  ConfidenceAssessment,
  Customer,
  EquipmentObservation,
  EvidenceItem,
  FieldProvenance,
  SavedObservationAggregate,
} from '@/domain';
import { deriveInstallationEstimate, normalizeName } from '@/domain';
import type { SeedRepository } from '@/application/ports';
import type { OfficialInstalledBaseRecord } from './official-installed-base-records';
import { OFFICIAL_INSTALLED_BASE_RECORDS } from './official-installed-base-records';

/**
 * Bumped from `synthetic-development-v1` when the three invented facilities were replaced by the
 * official workbook rows, so the idempotent seed re-applies over a database that already holds
 * the old fixtures.
 */
export const DEVELOPMENT_SEED_KEY = 'official-dummy-v1';

/**
 * Seeds this one replaces. Their rows are removed before the official records are written, so a
 * database built by an earlier seed converges on the official dataset instead of accumulating
 * both. Retirement is scoped by `observation_sessions.seed_key`, so nothing a user captured is
 * ever in range.
 *
 * `synthetic-development-v1` is the pre-`P2-S2` seed of three invented facilities. It shares the
 * ids `seed-customer-democare`, `seed-session-democare` and `seed-visit-democare` with the
 * official seed, which is why leaving its rows in place made the application fail to start.
 */
export const SUPERSEDED_SEED_KEYS: readonly string[] = ['synthetic-development-v1'];

/** The workbook records a calendar date; the domain stores an instant. */
const observedAtOf = (record: OfficialInstalledBaseRecord): string =>
  `${record.visitDate}T00:00:00.000Z`;

const slug = (value: string): string => normalizeName(value).replace(/ /g, '-');

/**
 * `Hospital DemoCare Pacific` keeps the id the pre-official seed gave it, because the demo path
 * and `tests/infrastructure/persistence.test.ts` both address that facility by id.
 */
const customerIdOf = (name: string): string =>
  name === 'Hospital DemoCare Pacific' ? 'seed-customer-democare' : `seed-customer-${slug(name)}`;

const sessionIdOf = (name: string): string =>
  name === 'Hospital DemoCare Pacific' ? 'seed-session-democare' : `seed-session-${slug(name)}`;

const visitIdOf = (name: string): string =>
  name === 'Hospital DemoCare Pacific' ? 'seed-visit-democare' : `seed-visit-${slug(name)}`;

const equipmentIdOf = (observationId: number): string =>
  `seed-equipment-${String(observationId).padStart(2, '0')}`;

const followUpEvidenceIdOf = (sessionId: string, observationId: number): string =>
  `${sessionId}-followup-${String(observationId).padStart(2, '0')}`;

/**
 * Decision 15 (`X-06`), taken by a person: an official integer age `n` is a hedged reported
 * answer, not a measurement, so it becomes `estimate(n, n)` and never `exact`.
 *
 * `deriveInstallationEstimate` collapses `minYears === maxYears` back to a single year, so the
 * derived installation year still equals the official `Estimated Installation Year` column.
 */
const officialAge = (years: number): ApproximateAge => ({
  type: 'estimate',
  minYears: years,
  maxYears: years,
});

/**
 * The workbook supplies a confidence *level*, not a score. Inventing a number to sit beside the
 * level would be exactly the fabrication the schema exists to prevent, so the score stays `null`
 * and the reasons say where the level came from.
 */
const officialConfidence = (
  record: OfficialInstalledBaseRecord,
  evidenceIds: readonly string[],
): ConfidenceAssessment => ({
  level: record.confidence,
  score: null,
  reasons: [
    {
      code: 'EXPLICIT_FACTS',
      detail: 'Modality, quantity, brand and model stated in the official record.',
    },
    {
      code: 'UNCERTAINTY_LANGUAGE',
      detail: 'Approximate age kept as an estimate; the official follow-up answer is hedged.',
    },
    {
      code: 'DERIVED_FACTS',
      detail: 'Installation year derived from the approximate age and the visit date.',
    },
  ],
  evidenceIds,
  strategyVersion: 'confidence-v1',
});

const reported = (
  certainty: FieldProvenance['certainty'],
  evidenceIds: readonly string[],
): FieldProvenance => ({
  knowledgeState: 'Known',
  origin: 'Reported',
  certainty,
  evidenceIds,
});

const equipmentOf = (
  record: OfficialInstalledBaseRecord,
  sessionId: string,
  groupOrder: number,
  evidenceIds: readonly string[],
): EquipmentObservation => {
  const approximateAge = officialAge(record.approximateAgeYears);
  return {
    id: equipmentIdOf(record.observationId),
    sessionId,
    groupOrder,
    modality: record.modality,
    rawModality: record.modality,
    quantity: record.quantity,
    manufacturer: record.brand,
    model: record.model,
    approximateAge,
    installationEstimate: deriveInstallationEstimate(approximateAge, observedAtOf(record)),
    confidence: officialConfidence(record, evidenceIds),
    status: record.status,
    notes: record.notes,
    evidenceIds,
    fieldProvenance: {
      modality: reported('Explicit', evidenceIds),
      quantity: reported('Explicit', evidenceIds),
      manufacturer: reported('Explicit', evidenceIds),
      model: reported('Explicit', evidenceIds),
      approximateAge: reported('Uncertain', evidenceIds),
    },
  };
};

/**
 * Rows sharing a customer, an observer and a visit date are one visit, so they become one session
 * with several equipment groups. Rows 3 and 4 stay two MR groups at different ages and models
 * because that is what the official data says; averaging them would fabricate.
 */
const groupIntoVisits = (
  records: readonly OfficialInstalledBaseRecord[],
): readonly (readonly OfficialInstalledBaseRecord[])[] => {
  const visits = new Map<string, OfficialInstalledBaseRecord[]>();
  records.forEach((record) => {
    const key = `${record.customer}|${record.observer}|${record.visitDate}`;
    visits.set(key, [...(visits.get(key) ?? []), record]);
  });
  return [...visits.values()];
};

const aggregateOf = (
  records: readonly OfficialInstalledBaseRecord[],
): SavedObservationAggregate => {
  const first = records[0];
  if (!first) throw new Error('An official visit group is unexpectedly empty.');
  const observedAt = observedAtOf(first);
  const sessionId = sessionIdOf(first.customer);

  // A visit contributes one voice evidence item per distinct utterance, not one per row.
  const utterances = [...new Set(records.map((record) => record.voiceInput))];
  const voiceEvidenceIdOf = (record: OfficialInstalledBaseRecord): string =>
    `${sessionId}-voice-${utterances.indexOf(record.voiceInput) + 1}`;

  const voiceEvidence: EvidenceItem[] = utterances.map((rawText, index) => ({
    id: `${sessionId}-voice-${index + 1}`,
    sessionId,
    source: first.source,
    capturedAt: observedAt,
    rawText,
    metadata: { fixture: DEVELOPMENT_SEED_KEY, workbookColumn: 'Voice Input Example' },
  }));

  // The follow-up answer is the text that actually supplied the brand and the age, so it is
  // evidence in its own right. The agent's question has no domain field and is kept as metadata.
  const followUpEvidence: EvidenceItem[] = records.map((record) => ({
    id: followUpEvidenceIdOf(sessionId, record.observationId),
    sessionId,
    source: record.source,
    capturedAt: observedAt,
    rawText: record.followUpAnswer,
    metadata: {
      fixture: DEVELOPMENT_SEED_KEY,
      workbookColumn: 'Follow-up Answer',
      followUpQuestion: record.followUpQuestion,
      officialObservationId: record.observationId,
    },
  }));

  const customer: Customer = {
    id: customerIdOf(first.customer),
    name: first.customer,
    normalizedName: normalizeName(first.customer),
    city: first.city,
    country: first.country,
    createdAt: observedAt,
    updatedAt: observedAt,
  };

  return {
    customer,
    session: {
      id: sessionId,
      customerId: customer.id,
      observer: { id: `seed-observer-${slug(first.observer)}`, displayName: first.observer },
      visitId: visitIdOf(first.customer),
      observedAt,
      createdAt: observedAt,
      lastVerifiedAt: null,
      rawInput: utterances.join(' '),
      reportedFacility: {
        name: customer.name,
        normalizedName: customer.normalizedName,
        city: customer.city,
        country: customer.country,
      },
      evidence: [...voiceEvidence, ...followUpEvidence],
    },
    equipment: records.map((record, index) =>
      equipmentOf(record, sessionId, index, [
        voiceEvidenceIdOf(record),
        followUpEvidenceIdOf(sessionId, record.observationId),
      ]),
    ),
  };
};

/**
 * The 20 official workbook records as 13 visits over 13 facilities. Every record is fictional by
 * construction: the workbook states that all of its customers, brands, models and observations
 * are synthetic and exist only for hackathon testing.
 */
export const createDevelopmentSeed = (): readonly SavedObservationAggregate[] =>
  groupIntoVisits(OFFICIAL_INSTALLED_BASE_RECORDS).map(aggregateOf);

export const applyDevelopmentSeed = (repository: SeedRepository): void => {
  repository.applySeed(DEVELOPMENT_SEED_KEY, createDevelopmentSeed(), SUPERSEDED_SEED_KEYS);
};
