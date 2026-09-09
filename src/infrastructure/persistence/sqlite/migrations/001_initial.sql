CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  city TEXT,
  country TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX customers_identity
ON customers(normalized_name, COALESCE(city, ''), COALESCE(country, ''));

CREATE TABLE observation_sessions (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  observer_id TEXT NOT NULL,
  observer_display_name TEXT NOT NULL,
  visit_id TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_verified_at TEXT,
  raw_input TEXT,
  reported_facility_json TEXT NOT NULL,
  supersedes_session_id TEXT REFERENCES observation_sessions(id)
) STRICT;

CREATE INDEX observation_sessions_customer_observed
ON observation_sessions(customer_id, observed_at DESC);

CREATE TABLE evidence_items (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES observation_sessions(id),
  source TEXT NOT NULL CHECK (source IN ('Text', 'Voice', 'Photo')),
  captured_at TEXT NOT NULL,
  raw_text TEXT,
  local_artifact_uri TEXT,
  metadata_json TEXT
) STRICT;

CREATE TABLE equipment_observations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES observation_sessions(id),
  group_order INTEGER NOT NULL,
  modality TEXT NOT NULL,
  raw_modality TEXT,
  quantity INTEGER CHECK (quantity IS NULL OR quantity > 0),
  manufacturer TEXT,
  model TEXT,
  approximate_age_json TEXT NOT NULL,
  installation_estimate_json TEXT NOT NULL,
  confidence_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Confirmed', 'Reported', 'Estimated', 'Unknown')),
  notes TEXT,
  field_provenance_json TEXT NOT NULL
) STRICT;

CREATE INDEX equipment_observations_session
ON equipment_observations(session_id, group_order);

CREATE TABLE equipment_observation_evidence (
  equipment_observation_id TEXT NOT NULL REFERENCES equipment_observations(id),
  evidence_item_id TEXT NOT NULL REFERENCES evidence_items(id),
  PRIMARY KEY (equipment_observation_id, evidence_item_id)
) STRICT;

CREATE TABLE duplicate_candidates (
  id TEXT PRIMARY KEY,
  source_observation_id TEXT NOT NULL REFERENCES equipment_observations(id),
  candidate_observation_id TEXT NOT NULL REFERENCES equipment_observations(id),
  candidate_installed_base_id TEXT,
  score REAL NOT NULL CHECK (score >= 0 AND score <= 1),
  explanation_json TEXT NOT NULL,
  relationship TEXT NOT NULL,
  resolution TEXT NOT NULL,
  algorithm_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(source_observation_id, candidate_observation_id)
) STRICT;

CREATE TABLE seed_imports (
  seed_key TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
) STRICT;

