-- QA finding: gen-2 workflow runs have no way to cancel a misbehaving run.
-- The 0069 CHECK vocabularies are too narrow to hold 'cancelled', and SQLite
-- cannot ALTER a CHECK constraint in place, so this is a rename+recreate+copy
-- rebuild of both tables (precedent 0062), NOT a destructive drop-and-recreate
-- (unlike 0069 itself): gen-2 may already have real run data by the time this
-- ships, so every row is preserved verbatim.
PRAGMA legacy_alter_table = ON;

ALTER TABLE workflow_run_nodes RENAME TO workflow_run_nodes_pre_cancel;
ALTER TABLE workflow_runs RENAME TO workflow_runs_pre_cancel;

CREATE TABLE workflow_runs (
    id                  TEXT PRIMARY KEY,
    invocation_id       TEXT NOT NULL,
    definition_json     TEXT NOT NULL,
    arguments_json      TEXT NOT NULL,
    workspace_id        TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    status              TEXT NOT NULL CHECK (status IN ('running','awaiting_human','interrupted','completed','failed','cancelled')),
    current_node_row_id TEXT,
    failure_code        TEXT CHECK (failure_code IS NULL OR failure_code IN ('node_launch_failed','turn_error','refusal','empty_turn','harness_cap','superseded')),
    interruption_code   TEXT CHECK (interruption_code IS NULL OR interruption_code IN ('user_cancel','app_shutdown','runtime_restarted')),
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    completed_at        TEXT,
    CHECK ((status = 'failed') = (failure_code IS NOT NULL))
);

INSERT INTO workflow_runs (
    id, invocation_id, definition_json, arguments_json, workspace_id, status,
    current_node_row_id, failure_code, interruption_code, created_at, updated_at,
    completed_at
)
SELECT
    id, invocation_id, definition_json, arguments_json, workspace_id, status,
    current_node_row_id, failure_code, interruption_code, created_at, updated_at,
    completed_at
FROM workflow_runs_pre_cancel;

CREATE TABLE workflow_run_nodes (
    id                    TEXT PRIMARY KEY,
    run_id                TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
    definition_node_id    TEXT,
    kind                  TEXT NOT NULL CHECK (kind IN ('defined','replacement','adhoc')),
    node_type             TEXT NOT NULL CHECK (node_type IN ('agent','human_in_loop')),
    replaces_node_row_id  TEXT,
    anchor_node_row_id    TEXT,
    chain_index           INTEGER,
    title                 TEXT NOT NULL,
    prompt                TEXT NOT NULL,
    status                TEXT NOT NULL CHECK (status IN ('pending','running','needs_attention','awaiting_human','completed','failed','cancelled')),
    session_id            TEXT,
    prompt_id             TEXT,
    model                 TEXT,
    rendered_envelope     TEXT,
    failure_code          TEXT CHECK (failure_code IS NULL OR failure_code IN ('node_launch_failed','turn_error','refusal','empty_turn','harness_cap','superseded')),
    first_turn_finished_at TEXT,
    created_at            TEXT NOT NULL,
    started_at            TEXT,
    completed_at          TEXT,
    CHECK ((status = 'failed') = (failure_code IS NOT NULL))
);

INSERT INTO workflow_run_nodes (
    id, run_id, definition_node_id, kind, node_type, replaces_node_row_id,
    anchor_node_row_id, chain_index, title, prompt, status, session_id,
    prompt_id, model, rendered_envelope, failure_code, first_turn_finished_at,
    created_at, started_at, completed_at
)
SELECT
    id, run_id, definition_node_id, kind, node_type, replaces_node_row_id,
    anchor_node_row_id, chain_index, title, prompt, status, session_id,
    prompt_id, model, rendered_envelope, failure_code, first_turn_finished_at,
    created_at, started_at, completed_at
FROM workflow_run_nodes_pre_cancel;

DROP TABLE workflow_run_nodes_pre_cancel;
DROP TABLE workflow_runs_pre_cancel;

DROP INDEX IF EXISTS idx_workflow_runs_workspace_id;
DROP INDEX IF EXISTS idx_workflow_run_nodes_run_id;
CREATE INDEX idx_workflow_runs_workspace_id ON workflow_runs(workspace_id);
CREATE INDEX idx_workflow_run_nodes_run_id ON workflow_run_nodes(run_id);

PRAGMA legacy_alter_table = OFF;
