-- Fan-in ledger (Follow-up Workflows ADR, ruling F1): one durable row per
-- parallel LEG of a node. The node row's scalar `session_id` stays the
-- representative session; this table is the "which of the N legs finished"
-- record the boot fence and resume story reconstruct from SQLite, never actor
-- memory. `leg_index` is the durable prompt-to-leg linkage a later per-leg redo
-- replaces one row of. Until the definition grammar can express N > 1 legs (a
-- later rung), exactly one row exists per node (leg_index 0), so every real
-- definition behaves identically to the pre-ledger engine.
--
-- Forward-references workflow_run_nodes(id), which the later custom migration
-- 0069 creates: SQLite never checks a foreign key's parent at CREATE TABLE
-- time, only at row DML, so a plain migration may declare the reference before
-- the parent exists. `status` reuses the node failure vocabulary for the failed
-- cases so aggregation can recover the exact code ('superseded' is a whole-row
-- disposition, never a leg outcome, so it is excluded).
CREATE TABLE IF NOT EXISTS workflow_run_node_sessions (
    node_row_id  TEXT NOT NULL REFERENCES workflow_run_nodes(id) ON DELETE CASCADE,
    leg_index    INTEGER NOT NULL,
    session_id   TEXT,
    status       TEXT NOT NULL CHECK (status IN (
                     'running','done','cancelled','forced_unload',
                     'node_launch_failed','turn_error','refusal','empty_turn','harness_cap')),
    completed_at TEXT,
    UNIQUE (node_row_id, leg_index)
);

CREATE INDEX IF NOT EXISTS idx_workflow_run_node_sessions_node_row_id
    ON workflow_run_node_sessions(node_row_id);
