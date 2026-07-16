-- Idempotency ledger for local repository / workspace materialization
-- operations (PR 3). One row per caller operation_id records the normalized
-- request hash and the recovery state so retries converge and crash-after-fs
-- recovery can safely adopt a deterministic destination.
CREATE TABLE IF NOT EXISTS local_materialization_operation (
    operation_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('repo_root', 'workspace')),
    request_hash TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('running', 'completed', 'failed')),
    -- Recorded when the clone path is chosen (repo-root acquisition), so a
    -- crash between clone and registration recovers as a `managed` root rather
    -- than being downgraded to `external` adoption. NULL for adoption/workspace.
    intended_kind TEXT CHECK (intended_kind IN ('managed', 'external')),
    repo_root_id TEXT,
    workspace_id TEXT,
    destination_path TEXT,
    observed_head_sha TEXT,
    failure_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
