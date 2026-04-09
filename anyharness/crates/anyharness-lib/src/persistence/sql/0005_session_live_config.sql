CREATE TABLE session_live_config_snapshots (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id),
    source_seq INTEGER NOT NULL,
    raw_config_options_json TEXT NOT NULL,
    normalized_controls_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE session_pending_config_changes (
    session_id TEXT NOT NULL REFERENCES sessions(id),
    config_id TEXT NOT NULL,
    value TEXT NOT NULL,
    queued_at TEXT NOT NULL,
    PRIMARY KEY (session_id, config_id)
);
