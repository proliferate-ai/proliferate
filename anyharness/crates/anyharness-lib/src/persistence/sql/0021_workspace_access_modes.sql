CREATE TABLE IF NOT EXISTS workspace_access_modes (
    workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    mode TEXT NOT NULL,
    handoff_op_id TEXT,
    updated_at TEXT NOT NULL
);
