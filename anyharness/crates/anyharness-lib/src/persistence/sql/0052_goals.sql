CREATE TABLE goals (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    objective TEXT NOT NULL,
    status TEXT NOT NULL,
    native_status TEXT,
    token_budget INTEGER,
    tokens_used INTEGER,
    time_used_seconds INTEGER,
    met_reason TEXT,
    iterations INTEGER,
    native INTEGER NOT NULL DEFAULT 1,
    pending_op TEXT,
    revision INTEGER NOT NULL,
    native_state_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_goals_session_created
    ON goals(session_id, created_at DESC);

CREATE UNIQUE INDEX idx_goals_single_open_per_session
    ON goals(session_id)
    WHERE status IN ('active', 'paused', 'blocked');
