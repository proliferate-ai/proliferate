CREATE TABLE IF NOT EXISTS agent_auth_config (
    scope_key TEXT PRIMARY KEY NOT NULL,
    scope_provider TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    target_id TEXT,
    revision INTEGER NOT NULL,
    config_ciphertext TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
