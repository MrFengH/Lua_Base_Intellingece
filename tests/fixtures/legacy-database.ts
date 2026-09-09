import { DatabaseSync } from 'node:sqlite';
import { INITIAL_MIGRATION_ID, INITIAL_MIGRATION_SQL } from '@/infrastructure/persistence';
import type { SavedObservationAggregate } from '@/domain';
import {
  createLegacyDevelopmentSeed,
  LEGACY_DEVELOPMENT_SEED_KEY,
} from './legacy-development-seed';

/**
 * Builds a database file exactly as a machine running the application before `P2-S2` would have
 * it: schema migration `001_initial` only, so `observation_sessions` has **no `seed_key` column**,
 * and the three invented facilities of `synthetic-development-v1` written through the column list
 * that existed at the time.
 *
 * This matters. Stamping the seed key at insert time, as the current repository does, would skip
 * the part of the migration that a real upgrade depends on: recovering ownership of rows that
 * were written before ownership was recorded at all.
 */
export const createLegacyDatabaseFile = (
  path: string,
  aggregates: readonly SavedObservationAggregate[] = createLegacyDevelopmentSeed(),
): void => {
  const connection = new DatabaseSync(path, { timeout: 5_000 });
  try {
    connection.exec('PRAGMA foreign_keys = ON;');
    connection.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      ) STRICT;
    `);
    connection.exec(INITIAL_MIGRATION_SQL);
    const now = new Date().toISOString();
    connection
      .prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)')
      .run(INITIAL_MIGRATION_ID, now);

    aggregates.forEach((aggregate) => {
      connection
        .prepare(
          `INSERT OR IGNORE INTO customers
           (id, name, normalized_name, city, country, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          aggregate.customer.id,
          aggregate.customer.name,
          aggregate.customer.normalizedName,
          aggregate.customer.city,
          aggregate.customer.country,
          aggregate.customer.createdAt,
          aggregate.customer.updatedAt,
        );
      connection
        .prepare(
          `INSERT INTO observation_sessions
           (id, customer_id, observer_id, observer_display_name, visit_id, observed_at, created_at,
            last_verified_at, raw_input, reported_facility_json, supersedes_session_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
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
      aggregate.session.evidence.forEach((evidence) =>
        connection
          .prepare(
            `INSERT INTO evidence_items
             (id, session_id, source, captured_at, raw_text, local_artifact_uri, metadata_json)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            evidence.id,
            evidence.sessionId,
            evidence.source,
            evidence.capturedAt,
            evidence.rawText,
            evidence.localArtifactUri ?? null,
            evidence.metadata ? JSON.stringify(evidence.metadata) : null,
          ),
      );
      aggregate.equipment.forEach((equipment) => {
        connection
          .prepare(
            `INSERT INTO equipment_observations
             (id, session_id, group_order, modality, raw_modality, quantity, manufacturer, model,
              approximate_age_json, installation_estimate_json, confidence_json, status, notes,
              field_provenance_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
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
        equipment.evidenceIds.forEach((evidenceId) =>
          connection
            .prepare(
              `INSERT INTO equipment_observation_evidence
               (equipment_observation_id, evidence_item_id) VALUES (?, ?)`,
            )
            .run(equipment.id, evidenceId),
        );
      });
    });

    connection
      .prepare('INSERT INTO seed_imports (seed_key, applied_at) VALUES (?, ?)')
      .run(LEGACY_DEVELOPMENT_SEED_KEY, now);
  } finally {
    connection.close();
  }
};
