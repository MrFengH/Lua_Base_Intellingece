import type {
  ApproximateAge,
  ConfidenceAssessment,
  Customer,
  DuplicateCandidate,
  DuplicateComparableObservation,
  EquipmentObservation,
  InstallationEstimate,
  Modality,
  ObservationStatus,
  SavedObservationAggregate,
} from '@/domain';
import { normalizeName } from '@/domain';
import type {
  Customer360View,
  CustomerListItem,
  DashboardView,
  InstalledBaseItem,
  ObservationEvidenceView,
} from '@/application/contracts';
import type { InstalledBaseRepository } from '@/application/ports';
import type { LocalSqliteDatabase } from './database';

type Row = Readonly<Record<string, unknown>>;

const stringValue = (row: Row, key: string): string => String(row[key]);
const nullableString = (row: Row, key: string): string | null =>
  row[key] === null || row[key] === undefined ? null : String(row[key]);
const numericValue = (row: Row, key: string): number => Number(row[key]);
const nullableNumber = (row: Row, key: string): number | null =>
  row[key] === null || row[key] === undefined ? null : Number(row[key]);
const parseJson = <T>(value: unknown): T => JSON.parse(String(value)) as T;

const mapCustomer = (row: Row): Customer => ({
  id: stringValue(row, 'id'),
  name: stringValue(row, 'name'),
  normalizedName: stringValue(row, 'normalized_name'),
  city: nullableString(row, 'city'),
  country: nullableString(row, 'country'),
  createdAt: stringValue(row, 'created_at'),
  updatedAt: stringValue(row, 'updated_at'),
});

interface ProjectionRow {
  equipment: EquipmentObservation;
  observedAt: string;
  lastVerifiedAt: string | null;
}

const daysBetween = (later: string, earlier: string): number => {
  const delta = new Date(later).valueOf() - new Date(earlier).valueOf();
  return Math.max(0, Math.floor(delta / 86_400_000));
};

const projectionSignature = (row: ProjectionRow): string => {
  const installation = row.equipment.installationEstimate;
  const installationKey =
    installation.type === 'year'
      ? String(installation.year)
      : installation.type === 'range'
        ? `${installation.minYear}-${installation.maxYear}`
        : 'unknown';
  return [
    row.equipment.modality,
    normalizeName(row.equipment.manufacturer ?? 'unknown'),
    normalizeName(row.equipment.model ?? 'unknown'),
    installationKey,
  ].join('|');
};

export class SqliteInstalledBaseRepository implements InstalledBaseRepository {
  constructor(private readonly database: LocalSqliteDatabase) {}

  list(): readonly Customer[] {
    return (
      this.database.connection.prepare('SELECT * FROM customers ORDER BY name').all() as Row[]
    ).map(mapCustomer);
  }

  findById(id: string): Customer | null {
    const row = this.database.connection.prepare('SELECT * FROM customers WHERE id = ?').get(id) as
      Row | undefined;
    return row ? mapCustomer(row) : null;
  }

  findByNormalizedIdentity(
    normalizedName: string,
    city: string | null,
    country: string | null,
  ): Customer | null {
    const row = this.database.connection
      .prepare(
        `SELECT * FROM customers
         WHERE normalized_name = ? AND COALESCE(city, '') = COALESCE(?, '')
           AND COALESCE(country, '') = COALESCE(?, '')`,
      )
      .get(normalizedName, city, country) as Row | undefined;
    return row ? mapCustomer(row) : null;
  }

  saveAggregate(
    aggregate: SavedObservationAggregate,
    duplicateCandidates: readonly DuplicateCandidate[],
  ): void {
    this.database.transaction(() => this.insertAggregate(aggregate, duplicateCandidates));
  }

  findDuplicateComparables(customerId: string): readonly DuplicateComparableObservation[] {
    const rows = this.database.connection
      .prepare(
        `SELECT eo.*, os.customer_id, os.observer_id, os.visit_id
         FROM equipment_observations eo
         JOIN observation_sessions os ON os.id = eo.session_id
         WHERE os.customer_id = ?`,
      )
      .all(customerId) as Row[];
    return rows.map((row) => ({
      id: stringValue(row, 'id'),
      customerId: stringValue(row, 'customer_id'),
      modality: stringValue(row, 'modality') as Modality,
      manufacturer: nullableString(row, 'manufacturer'),
      model: nullableString(row, 'model'),
      approximateAge: parseJson<ApproximateAge>(row.approximate_age_json),
      installationEstimate: parseJson<InstallationEstimate>(row.installation_estimate_json),
      observerId: stringValue(row, 'observer_id'),
      visitId: stringValue(row, 'visit_id'),
    }));
  }

  listForCustomer(customerId: string): readonly DuplicateCandidate[] {
    const rows = this.database.connection
      .prepare(
        `SELECT dc.* FROM duplicate_candidates dc
         JOIN equipment_observations eo ON eo.id = dc.source_observation_id
         JOIN observation_sessions os ON os.id = eo.session_id
         WHERE os.customer_id = ? ORDER BY dc.created_at DESC`,
      )
      .all(customerId) as Row[];
    return rows.map((row) => ({
      id: stringValue(row, 'id'),
      sourceObservationId: stringValue(row, 'source_observation_id'),
      candidateObservationId: stringValue(row, 'candidate_observation_id'),
      candidateInstalledBaseId: nullableString(row, 'candidate_installed_base_id'),
      score: numericValue(row, 'score'),
      explanation: parseJson(row.explanation_json),
      relationship: stringValue(row, 'relationship') as DuplicateCandidate['relationship'],
      resolution: stringValue(row, 'resolution') as DuplicateCandidate['resolution'],
      algorithmVersion: 'duplicate-v1',
      createdAt: stringValue(row, 'created_at'),
    }));
  }

  listCustomers(): readonly CustomerListItem[] {
    return this.database.connection
      .prepare(
        `SELECT c.id, c.name, c.city, c.country, MAX(os.observed_at) AS last_observed_at
         FROM customers c LEFT JOIN observation_sessions os ON os.customer_id = c.id
         GROUP BY c.id ORDER BY c.name`,
      )
      .all()
      .map((raw) => {
        const row = raw as Row;
        return {
          id: stringValue(row, 'id'),
          name: stringValue(row, 'name'),
          city: nullableString(row, 'city'),
          country: nullableString(row, 'country'),
          lastObservedAt: nullableString(row, 'last_observed_at'),
        };
      });
  }

  getCustomer360(customerId: string, now: string): Customer360View | null {
    const customer = this.findById(customerId);
    if (!customer) return null;
    const rows = this.projectionRows(customerId);
    const bySignature = new Map<string, ProjectionRow[]>();
    rows.forEach((row) => {
      const signature = projectionSignature(row);
      bySignature.set(signature, [...(bySignature.get(signature) ?? []), row]);
    });
    const installedBase: InstalledBaseItem[] = [...bySignature.entries()].map(
      ([projectionKey, contributors]) => {
        const latest = [...contributors].sort((a, b) =>
          b.observedAt.localeCompare(a.observedAt),
        )[0];
        if (!latest) throw new Error('Projection group is unexpectedly empty.');
        return {
          projectionKey,
          modality: latest.equipment.modality,
          quantity: latest.equipment.quantity,
          manufacturer: latest.equipment.manufacturer,
          model: latest.equipment.model,
          approximateAge: latest.equipment.approximateAge,
          installationEstimate: latest.equipment.installationEstimate,
          confidence: latest.equipment.confidence,
          status: latest.equipment.status,
          lastObservedAt: latest.observedAt,
          lastVerifiedAt: latest.lastVerifiedAt,
          daysSinceLastObservation: daysBetween(now, latest.observedAt),
          daysSinceLastVerification: latest.lastVerifiedAt
            ? daysBetween(now, latest.lastVerifiedAt)
            : null,
          freshnessStatus: 'Unknown',
          contributingObservationIds: contributors.map((item) => item.equipment.id),
        };
      },
    );
    const evidenceRows = this.database.connection
      .prepare(
        `SELECT os.id AS session_id, eo.id AS equipment_observation_id, os.observed_at,
                os.observer_display_name, os.visit_id, os.raw_input,
                COALESCE(GROUP_CONCAT(DISTINCT ei.source), 'Unknown') AS sources
         FROM observation_sessions os
         JOIN equipment_observations eo ON eo.session_id = os.id
         LEFT JOIN evidence_items ei ON ei.session_id = os.id
         WHERE os.customer_id = ?
         GROUP BY os.id, eo.id ORDER BY os.observed_at DESC`,
      )
      .all(customerId) as Row[];
    const evidence: ObservationEvidenceView[] = evidenceRows.map((row) => ({
      sessionId: stringValue(row, 'session_id'),
      equipmentObservationId: stringValue(row, 'equipment_observation_id'),
      observedAt: stringValue(row, 'observed_at'),
      observerName: stringValue(row, 'observer_display_name'),
      visitId: stringValue(row, 'visit_id'),
      rawInput: nullableString(row, 'raw_input'),
      source: stringValue(row, 'sources'),
    }));
    return {
      customer: {
        id: customer.id,
        name: customer.name,
        city: customer.city,
        country: customer.country,
        lastObservedAt: evidence[0]?.observedAt ?? null,
      },
      installedBase,
      evidence,
      duplicateCandidates: this.listForCustomer(customerId),
      projectionStrategy: 'latest-per-signature-v1',
    };
  }

  getDashboard(now: string): DashboardView {
    const customerViews = this.listCustomers().map((customer) =>
      this.getCustomer360(customer.id, now),
    );
    const installedBase = customerViews.flatMap((view) => view?.installedBase ?? []);
    const equipmentByModality: Record<string, number> = {};
    installedBase.forEach((item) => {
      equipmentByModality[item.modality] =
        (equipmentByModality[item.modality] ?? 0) + (item.quantity ?? 0);
    });
    const countryRows = this.database.connection
      .prepare(
        `SELECT COALESCE(c.country, 'Unknown') AS country, COUNT(os.id) AS count
         FROM customers c LEFT JOIN observation_sessions os ON os.customer_id = c.id
         GROUP BY COALESCE(c.country, 'Unknown')`,
      )
      .all() as Row[];
    const observationsByCountry = Object.fromEntries(
      countryRows.map((row) => [stringValue(row, 'country'), numericValue(row, 'count')]),
    );
    const incomplete = this.database.connection
      .prepare(
        `SELECT COUNT(*) AS count FROM equipment_observations
         WHERE modality = 'Unknown' OR quantity IS NULL OR manufacturer IS NULL
            OR model IS NULL OR json_extract(approximate_age_json, '$.type') = 'unknown'`,
      )
      .get() as Row;
    return {
      totalCustomers: customerViews.length,
      totalEquipmentObserved: installedBase.reduce((sum, item) => sum + (item.quantity ?? 0), 0),
      equipmentByModality,
      observationsByCountry,
      agingEquipment: null,
      incompleteObservations: numericValue(incomplete, 'count'),
      agingPolicy: 'Not configured',
    };
  }

  hasSeed(seedKey: string): boolean {
    return Boolean(
      this.database.connection
        .prepare('SELECT seed_key FROM seed_imports WHERE seed_key = ?')
        .get(seedKey),
    );
  }

  applySeed(seedKey: string, aggregates: readonly SavedObservationAggregate[]): void {
    if (this.hasSeed(seedKey)) return;
    this.database.transaction(() => {
      aggregates.forEach((aggregate) => this.insertAggregate(aggregate, []));
      this.database.connection
        .prepare('INSERT INTO seed_imports (seed_key, applied_at) VALUES (?, ?)')
        .run(seedKey, new Date().toISOString());
    });
  }

  private insertAggregate(
    aggregate: SavedObservationAggregate,
    duplicateCandidates: readonly DuplicateCandidate[],
  ): void {
    const db = this.database.connection;
    db.prepare(
      `INSERT OR IGNORE INTO customers
       (id, name, normalized_name, city, country, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      aggregate.customer.id,
      aggregate.customer.name,
      aggregate.customer.normalizedName,
      aggregate.customer.city,
      aggregate.customer.country,
      aggregate.customer.createdAt,
      aggregate.customer.updatedAt,
    );
    db.prepare(
      `INSERT INTO observation_sessions
       (id, customer_id, observer_id, observer_display_name, visit_id, observed_at, created_at,
        last_verified_at, raw_input, reported_facility_json, supersedes_session_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      aggregate.session.id,
      aggregate.session.customerId,
      aggregate.session.observer.id,
      aggregate.session.observer.displayName,
      aggregate.session.visitId,
      aggregate.session.observedAt,
      aggregate.session.createdAt,
      aggregate.session.lastVerifiedAt,
      aggregate.session.rawInput,
      JSON.stringify(aggregate.session.reportedFacility),
      aggregate.session.supersedesSessionId ?? null,
    );
    const insertEvidence = db.prepare(
      `INSERT INTO evidence_items
       (id, session_id, source, captured_at, raw_text, local_artifact_uri, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    aggregate.session.evidence.forEach((evidence) =>
      insertEvidence.run(
        evidence.id,
        evidence.sessionId,
        evidence.source,
        evidence.capturedAt,
        evidence.rawText,
        evidence.localArtifactUri ?? null,
        evidence.metadata ? JSON.stringify(evidence.metadata) : null,
      ),
    );
    const insertEquipment = db.prepare(
      `INSERT INTO equipment_observations
       (id, session_id, group_order, modality, raw_modality, quantity, manufacturer, model,
        approximate_age_json, installation_estimate_json, confidence_json, status, notes,
        field_provenance_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const linkEvidence = db.prepare(
      `INSERT INTO equipment_observation_evidence
       (equipment_observation_id, evidence_item_id) VALUES (?, ?)`,
    );
    aggregate.equipment.forEach((equipment) => {
      insertEquipment.run(
        equipment.id,
        equipment.sessionId,
        equipment.groupOrder,
        equipment.modality,
        equipment.rawModality ?? null,
        equipment.quantity,
        equipment.manufacturer,
        equipment.model,
        JSON.stringify(equipment.approximateAge),
        JSON.stringify(equipment.installationEstimate),
        JSON.stringify(equipment.confidence),
        equipment.status,
        equipment.notes,
        JSON.stringify(equipment.fieldProvenance),
      );
      equipment.evidenceIds.forEach((evidenceId) => linkEvidence.run(equipment.id, evidenceId));
    });
    const insertDuplicate = db.prepare(
      `INSERT INTO duplicate_candidates
       (id, source_observation_id, candidate_observation_id, candidate_installed_base_id,
        score, explanation_json, relationship, resolution, algorithm_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    duplicateCandidates.forEach((candidate) =>
      insertDuplicate.run(
        candidate.id,
        candidate.sourceObservationId,
        candidate.candidateObservationId,
        candidate.candidateInstalledBaseId,
        candidate.score,
        JSON.stringify(candidate.explanation),
        candidate.relationship,
        candidate.resolution,
        candidate.algorithmVersion,
        candidate.createdAt,
      ),
    );
  }

  private projectionRows(customerId: string): ProjectionRow[] {
    const rows = this.database.connection
      .prepare(
        `SELECT eo.*, os.observed_at, os.last_verified_at
         FROM equipment_observations eo
         JOIN observation_sessions os ON os.id = eo.session_id
         WHERE os.customer_id = ? ORDER BY os.observed_at DESC, eo.group_order`,
      )
      .all(customerId) as Row[];
    return rows.map((row) => ({
      observedAt: stringValue(row, 'observed_at'),
      lastVerifiedAt: nullableString(row, 'last_verified_at'),
      equipment: {
        id: stringValue(row, 'id'),
        sessionId: stringValue(row, 'session_id'),
        groupOrder: numericValue(row, 'group_order'),
        modality: stringValue(row, 'modality') as Modality,
        rawModality: nullableString(row, 'raw_modality'),
        quantity: nullableNumber(row, 'quantity'),
        manufacturer: nullableString(row, 'manufacturer'),
        model: nullableString(row, 'model'),
        approximateAge: parseJson<ApproximateAge>(row.approximate_age_json),
        installationEstimate: parseJson<InstallationEstimate>(row.installation_estimate_json),
        confidence: parseJson<ConfidenceAssessment>(row.confidence_json),
        status: stringValue(row, 'status') as ObservationStatus,
        notes: nullableString(row, 'notes'),
        evidenceIds: this.database.connection
          .prepare(
            `SELECT evidence_item_id FROM equipment_observation_evidence
             WHERE equipment_observation_id = ?`,
          )
          .all(stringValue(row, 'id'))
          .map((value) => stringValue(value as Row, 'evidence_item_id')),
        fieldProvenance: parseJson(row.field_provenance_json),
      },
    }));
  }
}
