-- Isolated Workflow workspace placement (spec workflow-workspace-placement).
-- Durable materialization state for one Workflow run's isolated workspace. This
-- is a standalone table that does not touch workflow_runs / workflow_run_steps,
-- so it is an ordinary numbered SQL migration (not a custom foreign-key
-- rebuild). `workspace_id` is durable non-FK correlation: no foreign key allows
-- later artifact deletion to erase the record's evidence.
CREATE TABLE IF NOT EXISTS workflow_workspace_materializations (
    run_id                  TEXT PRIMARY KEY,
    schema_version          INTEGER NOT NULL CHECK (schema_version = 1),
    request_json            TEXT NOT NULL,
    resolved_placement_json TEXT,
    status                  TEXT NOT NULL
                            CHECK (status IN ('accepted', 'materializing', 'ready', 'failed')),
    workspace_id            TEXT,
    failure_code            TEXT,
    failure_message         TEXT,
    created_at              TEXT NOT NULL,
    updated_at              TEXT NOT NULL,
    finished_at             TEXT
);

CREATE INDEX IF NOT EXISTS idx_workflow_workspace_materializations_workspace_id
    ON workflow_workspace_materializations(workspace_id);
