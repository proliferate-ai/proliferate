CREATE TABLE workspaces (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    path TEXT NOT NULL,
    source_repo_root_path TEXT NOT NULL,
    source_workspace_id TEXT,
    git_provider TEXT,
    git_owner TEXT,
    git_repo_name TEXT,
    original_branch TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_workspaces_path ON workspaces(path);

CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    agent_kind TEXT NOT NULL,
    native_session_id TEXT,
    model_id TEXT,
    mode_id TEXT,
    thinking_level_id TEXT,
    status TEXT NOT NULL DEFAULT 'idle',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_prompt_at TEXT,
    closed_at TEXT
);

CREATE TABLE session_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    seq INTEGER NOT NULL,
    timestamp TEXT NOT NULL,
    event_type TEXT NOT NULL,
    turn_id TEXT,
    payload_json TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_session_events_session_seq
    ON session_events(session_id, seq);
