-- Workflow run engine (W3): the anyharness-local mirror of the server's run
-- ledger. `workflow_runs` holds one row per delivered run (the resolved plan is
-- stored verbatim in `plan_json`; the actor never re-fetches the definition),
-- and `workflow_step_runs` holds one row per plan step with the observed
-- execution truth (status, attempt count, typed output) the run view surfaces.
CREATE TABLE workflow_runs (
    run_id TEXT PRIMARY KEY,
    workflow_id TEXT,
    workflow_version_id TEXT,
    version_n INTEGER,
    trigger_kind TEXT,
    target_mode TEXT,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    plan_json TEXT NOT NULL,
    status TEXT NOT NULL,
    step_cursor INTEGER NOT NULL DEFAULT 0,
    session_ids_json TEXT,
    error_code TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_workflow_runs_workspace_created
    ON workflow_runs(workspace_id, created_at DESC);

CREATE INDEX idx_workflow_runs_status
    ON workflow_runs(status);

-- `step_key` is the format-v2 structured step key "<node>.<lane>.<step>" (B5,
-- lane "-" for the flat case). The PK stays (run_id, step_index) — the cursor is
-- pure sequencing — but the key is the step's stable *identity* (outputs are
-- reported by key), enforced unique per run.
CREATE TABLE workflow_step_runs (
    run_id TEXT NOT NULL REFERENCES workflow_runs(run_id) ON DELETE CASCADE,
    step_index INTEGER NOT NULL,
    step_key TEXT NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    attempt INTEGER NOT NULL DEFAULT 0,
    output_json TEXT,
    error_code TEXT,
    error_message TEXT,
    started_at TEXT,
    ended_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (run_id, step_index)
);

CREATE UNIQUE INDEX idx_workflow_step_runs_key
    ON workflow_step_runs(run_id, step_key);
