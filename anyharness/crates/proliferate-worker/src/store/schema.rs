pub const INIT_SQL: &str = r#"
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS identity (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  target_id TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  install_id TEXT NOT NULL,
  cloud_base_url TEXT NOT NULL,
  credential_kind TEXT NOT NULL,
  credential_value TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS command_leases (
  command_id TEXT PRIMARY KEY,
  lease_id TEXT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  leased_at TEXT,
  lease_expires_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_cursors (
  workspace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  last_uploaded_seq INTEGER NOT NULL DEFAULT 0,
  last_ack_seq INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, session_id)
);

CREATE TABLE IF NOT EXISTS event_outbox (
  batch_id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  seq_start INTEGER NOT NULL,
  seq_end INTEGER NOT NULL,
  payload TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_event_outbox_next_attempt
  ON event_outbox(next_attempt_at, created_at);

CREATE TABLE IF NOT EXISTS sync_mappings (
  local_workspace_id TEXT NOT NULL,
  cloud_workspace_id TEXT,
  local_session_id TEXT,
  cloud_session_id TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (local_workspace_id, local_session_id)
);

CREATE TABLE IF NOT EXISTS inventory_cache (
  cache_key TEXT PRIMARY KEY,
  last_report_hash TEXT NOT NULL,
  last_reported_at TEXT NOT NULL,
  payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS update_state (
  component TEXT PRIMARY KEY,
  installed_version TEXT,
  desired_version TEXT,
  staged_path TEXT,
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
"#;
