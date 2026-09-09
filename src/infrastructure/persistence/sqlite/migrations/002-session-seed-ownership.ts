export const SESSION_SEED_OWNERSHIP_MIGRATION_ID = '002_session_seed_ownership';

/**
 * Records which seed, if any, produced a session, so a superseded seed can be retired without
 * touching anything a user captured.
 *
 * `seed_imports` already recorded *that* a seed key had been applied, but nothing recorded *which
 * rows it wrote*. Replacing the pre-`P2-S2` development seed with the official workbook records
 * therefore had no safe way to remove the old rows, and the two seeds collide on the ids
 * deliberately shared by `Hospital DemoCare Pacific`.
 *
 * The backfill is exact rather than a guess. Until this migration the seed was the only writer of
 * `evidence_items.metadata_json`, and it always wrote a `fixture` key holding its seed key, while
 * the capture workflow never wrote evidence metadata at all. A session with no `fixture` in its
 * evidence was therefore captured by a user, and keeps `seed_key IS NULL`.
 */
export const SESSION_SEED_OWNERSHIP_MIGRATION_SQL = `
ALTER TABLE observation_sessions ADD COLUMN seed_key TEXT;

UPDATE observation_sessions
SET seed_key = (
  SELECT json_extract(evidence_items.metadata_json, '$.fixture')
  FROM evidence_items
  WHERE evidence_items.session_id = observation_sessions.id
    AND json_extract(evidence_items.metadata_json, '$.fixture') IS NOT NULL
  LIMIT 1
);

CREATE INDEX observation_sessions_seed_key ON observation_sessions(seed_key);
`;
