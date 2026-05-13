CREATE TABLE IF NOT EXISTS agent_model_registry_snapshots (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    workspace_id TEXT,
    workspace_scope TEXT NOT NULL,
    source TEXT NOT NULL,
    status TEXT NOT NULL,
    refreshed_at TEXT NOT NULL,
    expires_at TEXT,
    models_json TEXT NOT NULL,
    warnings_json TEXT NOT NULL DEFAULT '[]',
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(kind, workspace_scope)
);

CREATE INDEX IF NOT EXISTS idx_agent_model_registry_snapshots_kind
    ON agent_model_registry_snapshots(kind);

CREATE INDEX IF NOT EXISTS idx_agent_model_registry_snapshots_workspace
    ON agent_model_registry_snapshots(workspace_scope);
