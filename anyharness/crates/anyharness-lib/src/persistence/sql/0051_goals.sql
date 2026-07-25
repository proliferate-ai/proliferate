CREATE TABLE goals (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    objective TEXT NOT NULL,
    -- active | paused | blocked | met | failed | cleared (spec §2.1)
    status TEXT NOT NULL,
    -- user | workflow | agent
    source_kind TEXT NOT NULL,
    source_run_id TEXT,
    token_budget INTEGER,
    max_turns INTEGER,
    max_wall_secs INTEGER,
    tokens_used INTEGER,
    time_used_secs INTEGER,
    turns_used INTEGER NOT NULL DEFAULT 0,
    met_reason TEXT,
    -- Raw native payload (GoalWire) for fidelity/debug.
    native_state_json TEXT NOT NULL,
    revision INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    met_at TEXT
);

CREATE INDEX idx_goals_workspace_updated
    ON goals(workspace_id, updated_at DESC);

CREATE INDEX idx_goals_session_updated
    ON goals(session_id, updated_at DESC);

-- Invariant (spec §2.1): at most one non-terminal goal per session.
CREATE UNIQUE INDEX idx_goals_session_non_terminal
    ON goals(session_id)
    WHERE status IN ('active', 'paused', 'blocked');
