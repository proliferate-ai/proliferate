CREATE TABLE cowork_roots (
    id TEXT PRIMARY KEY CHECK (id = 'cowork-root'),
    repo_root_id TEXT NOT NULL UNIQUE REFERENCES repo_roots(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE cowork_threads (
    id TEXT PRIMARY KEY,
    repo_root_id TEXT NOT NULL REFERENCES repo_roots(id),
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    session_id TEXT NOT NULL REFERENCES sessions(id),
    agent_kind TEXT NOT NULL,
    requested_model_id TEXT,
    branch_name TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX idx_cowork_threads_repo_root_id ON cowork_threads(repo_root_id);
CREATE INDEX idx_cowork_threads_workspace_id ON cowork_threads(workspace_id);
CREATE INDEX idx_cowork_threads_session_id ON cowork_threads(session_id);
