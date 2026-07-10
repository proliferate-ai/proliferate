-- Parallel-lane per-lane cursors (L30 / track 3a phase 2). A parallel group
-- (one spine node with 2+ lanes) can no longer be tracked by the single
-- `workflow_runs.step_cursor`: each lane advances its own steps concurrently, so
-- each lane needs its own cursor + terminal status. This partitions the run's
-- step-run bookkeeping by lane (arch §3.1 "lane-keyed cursor (per-lane
-- workflow_step_runs partitioning)").
--
-- One row per (run, node, lane). `cursor` is the 0-based index INTO THE LANE's
-- step list (not a flat step index); `status` is the lane's own terminal state.
-- Flat runs (no parallel groups) never write here — they keep advancing the
-- single `step_cursor` exactly as before, so this table is empty for them.
CREATE TABLE workflow_lane_cursors (
    run_id TEXT NOT NULL REFERENCES workflow_runs(run_id) ON DELETE CASCADE,
    node_index INTEGER NOT NULL,
    lane TEXT NOT NULL,
    cursor INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'running',
    error_code TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (run_id, node_index, lane)
);

CREATE INDEX idx_workflow_lane_cursors_run
    ON workflow_lane_cursors(run_id);
