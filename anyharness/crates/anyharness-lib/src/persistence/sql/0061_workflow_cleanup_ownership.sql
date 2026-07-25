-- Durable ownership for workflow cleanup windows.
--
-- A materialization row is inserted before the broker is called. `pending`
-- therefore means that an external artifact may exist even when the call
-- returned an error or the runtime crashed before receiving the response.
-- `cleanup_required` is the restart/failed-reconciliation fence. Only
-- `registered` (owned by a workspace row) and `cleaned` (broker proved every
-- operation artifact absent) permit ordinary terminal publication.
ALTER TABLE workspaces
    ADD COLUMN workflow_materialization_base_commit_oid TEXT
    CHECK (workflow_materialization_base_commit_oid IS NULL OR kind = 'worktree');

CREATE TABLE workflow_materialization_operations (
    -- Cleanup ownership outlives ordinary run-history deletion. SQLite's
    -- default NO ACTION/RESTRICT behavior prevents deleting the run while an
    -- operation receipt still exists; never cascade away an external-artifact
    -- fence.
    run_id TEXT NOT NULL REFERENCES workflow_runs(run_id),
    scope_id TEXT NOT NULL,
    source_root TEXT NOT NULL,
    target_root TEXT NOT NULL,
    branch_name TEXT NOT NULL,
    base_commit_oid TEXT NOT NULL,
    execution_generation INTEGER NOT NULL CHECK (execution_generation > 0),
    broker_generation INTEGER NOT NULL CHECK (broker_generation > 0),
    state TEXT NOT NULL CHECK (state IN (
        'pending', 'cleanup_required', 'registered', 'cleaned'
    )),
    workspace_id TEXT REFERENCES workspaces(id) ON DELETE RESTRICT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (run_id, scope_id, execution_generation, broker_generation),
    CHECK (
        (state = 'registered' AND workspace_id IS NOT NULL AND length(workspace_id) > 0)
        OR (state <> 'registered' AND workspace_id IS NULL)
    ),
    CHECK (
        (state = 'cleanup_required' AND last_error IS NOT NULL AND length(last_error) > 0)
        OR (state <> 'cleanup_required' AND last_error IS NULL)
    )
);

CREATE INDEX idx_workflow_materialization_cleanup
    ON workflow_materialization_operations(state, run_id);

CREATE INDEX idx_workflow_materialization_workspace
    ON workflow_materialization_operations(workspace_id)
    WHERE workspace_id IS NOT NULL;

-- Non-materialization cleanup that must survive process restart. Phase A uses
-- this for broker/run quiescence. The fence is inserted before the external
-- call and removed only after a synchronous quiescence receipt.
CREATE TABLE workflow_cleanup_fences (
    -- A live external cleanup fence must make run deletion fail, not disappear.
    run_id TEXT NOT NULL REFERENCES workflow_runs(run_id),
    fence_kind TEXT NOT NULL,
    fence_key TEXT NOT NULL,
    detail TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (run_id, fence_kind, fence_key)
);

CREATE INDEX idx_workflow_cleanup_fences_run
    ON workflow_cleanup_fences(run_id);

-- Run-history deletion may discard only settled journal history. Unresolved
-- operation/process ownership aborts the parent delete before any cascading
-- workflow rows are touched.
CREATE TRIGGER workflow_runs_cleanup_ownership_before_delete
BEFORE DELETE ON workflow_runs
BEGIN
    SELECT CASE WHEN EXISTS (
        SELECT 1 FROM workflow_materialization_operations
        WHERE run_id = OLD.run_id AND state IN ('pending', 'cleanup_required')
    ) OR EXISTS (
        SELECT 1 FROM workflow_cleanup_fences WHERE run_id = OLD.run_id
    ) THEN RAISE(ABORT, 'workflow run has unresolved cleanup ownership') END;

    DELETE FROM workflow_materialization_operations
    WHERE run_id = OLD.run_id AND state IN ('registered', 'cleaned');
END;
