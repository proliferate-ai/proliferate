CREATE TABLE IF NOT EXISTS runtime_config_current (
  scope_key TEXT PRIMARY KEY,
  scope_provider TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  target_id TEXT,
  revision_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  artifact_payloads_json TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS runtime_config_artifacts (
  hash TEXT PRIMARY KEY,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  source_ref TEXT,
  content TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
