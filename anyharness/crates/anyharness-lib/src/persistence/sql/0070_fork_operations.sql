-- Forks ADR rung 2: one durable record per fork operation.
--
-- Carries fork identity/idempotency and fork provenance together (ADR 4.4
-- "one durable operation with provider-aware recovery"). The row is created in
-- the `prepared` phase before any native call, marked `native_call_in_flight`
-- before dispatch, and advanced to `child_persisted`/`completed` atomically with
-- the child session row and its `fork` link. A timeout/disconnect/crash leaves
-- it `native_outcome_unknown`, which blocks blind redispatch.
--
-- Columns: idempotency_key is the caller child_session_id or an Idempotency-Key
-- (same key + same request_digest resumes; different digest = conflict).
-- child_session_id is the reserved product child id, present from `prepared`.
-- anchor_* is the product anchor (NULL for a tip fork). provider_anchor_* is the
-- translated native anchor (kind/value; inclusive is 0/1 or NULL). prefix_* is
-- the exact copied-prefix terminal seq and its digest, verified at exact-prefix
-- recovery. adapter_version/native_version are provenance.
CREATE TABLE fork_operations (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    request_digest TEXT NOT NULL,
    parent_session_id TEXT NOT NULL,
    child_session_id TEXT NOT NULL UNIQUE,
    phase TEXT NOT NULL CHECK (phase IN (
        'prepared',
        'native_call_in_flight',
        'native_result_known',
        'native_outcome_unknown',
        'child_persisted',
        'completed',
        'failed'
    )),
    anchor_turn_id TEXT,
    anchor_item_id TEXT,
    provider_anchor_kind TEXT,
    provider_anchor_value TEXT,
    provider_anchor_inclusive INTEGER,
    prefix_terminal_seq INTEGER,
    prefix_digest TEXT,
    adapter_version TEXT,
    native_version TEXT,
    native_child_session_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_fork_operations_parent ON fork_operations(parent_session_id);
CREATE INDEX idx_fork_operations_child ON fork_operations(child_session_id);
