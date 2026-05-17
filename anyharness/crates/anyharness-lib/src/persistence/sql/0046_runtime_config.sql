CREATE TABLE IF NOT EXISTS runtime_config_current (
    id TEXT PRIMARY KEY CHECK (id = 'current'),
    revision_id TEXT NOT NULL,
    revision_sequence INTEGER,
    content_hash TEXT NOT NULL,
    manifest_json TEXT NOT NULL,
    source TEXT NOT NULL,
    external_target_id TEXT,
    applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runtime_artifact_cache (
    artifact_hash TEXT PRIMARY KEY,
    content_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    cache_path TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL
);
