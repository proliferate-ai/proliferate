-- Checkpoints ADR (Lane H): the metadata truth for a captured workspace
-- checkpoint. The bytes truth lives in `refs/proliferate/checkpoints/*`
-- (sole-written by `domains/workspaces/checkpoints/refs.rs`); this row records
-- everything ELSE about a capture — its origin, the session/turn/prompt keys it
-- was taken at, the peeled tree OIDs it points into, and its retention state.
--
-- The refs-before-row order at capture time means a crash between the ref write
-- and this insert leaves orphaned refs with no row; the retention duty's orphan
-- reap converges that by row-absence (the fail-safe direction: bytes are durable
-- before metadata). Deletion runs the other way — the row is marked `expired_at`
-- FIRST, then the three refs are deleted — so an unexpired row never has its
-- refs reaped out from under it.
--
-- Columns: origin is the capture cadence that produced the row. session_id /
-- turn_id / prompt_id are the turn-start boundary keys (turn_id is backfilled
-- once the actor reports Started). fork_operation_id / revert_operation_id link a
-- checkpoint to the fork or revert operation that references it (both later
-- PRs — revert is entirely out of scope here). head_sha is the peeled HEAD
-- commit; work_tree_oid / index_tree_oid are the PEELED tree OIDs; the
-- work_tree_anchored / index_tree_anchored flags record whether the underlying
-- ref points at a parentless LFS anchor commit (so the orphan reap and any later
-- resolve know which peel a ref takes). notices_json is the full snapshot notice
-- set serialized at capture. expired_at NULL means live; non-NULL means retention
-- has retired it and its refs are (or are being) deleted.
CREATE TABLE workspace_checkpoints (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    origin TEXT NOT NULL CHECK (origin IN ('turn_start','fork_boundary','safety')),
    session_id TEXT,
    turn_id TEXT,
    prompt_id TEXT,
    fork_operation_id TEXT,
    revert_operation_id TEXT,
    head_sha TEXT NOT NULL,
    work_tree_oid TEXT NOT NULL,
    index_tree_oid TEXT NOT NULL,
    work_tree_anchored INTEGER NOT NULL,
    index_tree_anchored INTEGER NOT NULL,
    notices_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expired_at TEXT
);
CREATE INDEX idx_workspace_checkpoints_ws_created ON workspace_checkpoints(workspace_id, created_at);
CREATE INDEX idx_workspace_checkpoints_session_turn ON workspace_checkpoints(session_id, turn_id);

-- Fork rows reference the boundary checkpoint they were taken at (Q-H4). NULL
-- when the flag was off, or no unexpired checkpoint existed at the boundary.
ALTER TABLE fork_operations ADD COLUMN checkpoint_id TEXT;
