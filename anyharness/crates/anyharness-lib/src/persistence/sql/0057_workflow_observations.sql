-- Durable observation outbox (WS5a, feature spec §5.4). AnyHarness reports a
-- whole `ObservedRun` snapshot bound to the immutable delivery identity, with a
-- strictly increasing revision. This table IS that outbox: every revision is an
-- immutable row holding the canonical snapshot bytes exactly as they will be
-- reported. The reporter sends only the lowest unacknowledged revision, retries
-- identical canonical bytes until the server acknowledges, then sends the next —
-- it never polls only the latest runtime snapshot.
--
-- `revision` is strictly increasing per run (computed as MAX(revision)+1 inside
-- the same transaction as the state change that produced it, so the outbox can
-- never skip or reorder). `canonical_snapshot_json` is the serialized
-- `ObservedRun` (WS1 shape) stored verbatim so a replay returns identical bytes.
-- `acked` flips to 1 once the server acknowledges that revision. The row is
-- immutable except for `acked`; acknowledged rows are compacted only after the
-- terminal snapshot + audit retention requirements are met (not in v1).
--
-- No credential ever enters this table (spec §5.3): the snapshot carries only
-- non-secret hashes, cursors, step keys, outputs, session ids, and timing.
CREATE TABLE workflow_observations (
    run_id TEXT NOT NULL REFERENCES workflow_runs(run_id) ON DELETE CASCADE,
    revision INTEGER NOT NULL,
    canonical_snapshot_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    acked INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (run_id, revision),
    UNIQUE (run_id, revision)
);

-- The reporter's hot query: the lowest unacknowledged revision for a run.
CREATE INDEX idx_workflow_observations_unacked
    ON workflow_observations(run_id, acked, revision);
