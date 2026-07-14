CREATE TABLE workflow_runs (
    id TEXT PRIMARY KEY,
    schema_version INTEGER NOT NULL CHECK (schema_version = 1),
    invocation_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('accepted','running','completed','failed')),
    workspace_id TEXT NOT NULL,
    session_id TEXT,
    failure_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT
);

CREATE TABLE workflow_run_steps (
    run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
    stage_index INTEGER NOT NULL,
    step_index INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending','running','completed','failed')),
    prompt_id TEXT NOT NULL UNIQUE,
    turn_id TEXT,
    failure_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    PRIMARY KEY (run_id, stage_index, step_index)
);
