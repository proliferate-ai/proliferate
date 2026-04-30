CREATE TABLE terminal_command_runs (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    terminal_id TEXT,
    purpose TEXT NOT NULL,
    command TEXT NOT NULL,
    status TEXT NOT NULL,
    exit_code INTEGER,
    output_mode TEXT NOT NULL,
    stdout TEXT,
    stderr TEXT,
    combined_output TEXT,
    output_truncated INTEGER NOT NULL DEFAULT 0,
    started_at TEXT,
    completed_at TEXT,
    duration_ms INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_terminal_command_runs_workspace_created
    ON terminal_command_runs(workspace_id, created_at DESC);

CREATE INDEX idx_terminal_command_runs_terminal_created
    ON terminal_command_runs(terminal_id, created_at DESC);

CREATE INDEX idx_terminal_command_runs_status
    ON terminal_command_runs(status);

CREATE TABLE workspace_setup_state (
    workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    latest_command_run_id TEXT NOT NULL REFERENCES terminal_command_runs(id) ON DELETE CASCADE,
    updated_at TEXT NOT NULL
);
