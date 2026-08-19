CREATE TABLE harness_launch_option_states (
    harness_kind TEXT PRIMARY KEY,
    basis_revision TEXT NOT NULL,
    revision INTEGER NOT NULL,
    options_json TEXT,
    observed_at TEXT,
    probe_state TEXT NOT NULL
      CHECK (probe_state IN ('probing', 'succeeded', 'failed')),
    probe_attempted_at TEXT NOT NULL,
    probe_failure_code TEXT,
    CHECK ((options_json IS NULL) = (observed_at IS NULL)),
    CHECK (probe_state <> 'succeeded' OR options_json IS NOT NULL),
    CHECK ((probe_state = 'failed') = (probe_failure_code IS NOT NULL))
);

CREATE TABLE session_launch_intents (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    requested_model_id TEXT,
    requested_controls_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- Measured N-1 data migration: old rows remain resumable, but all runtime
-- startup reads the one immutable intent table after this migration.
INSERT INTO session_launch_intents (
    session_id, requested_model_id, requested_controls_json, created_at
)
SELECT id,
       requested_model_id,
       CASE
           WHEN requested_mode_id IS NULL THEN '{}'
           ELSE json_object('mode', requested_mode_id)
       END,
       created_at
FROM sessions;

ALTER TABLE session_live_config_snapshots
    ADD COLUMN full_snapshot_json TEXT;

ALTER TABLE review_assignments
    ADD COLUMN control_values_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE review_assignments
    ADD COLUMN launch_verification_status TEXT NOT NULL DEFAULT 'pending';

UPDATE review_assignments
SET control_values_json = CASE
        WHEN requested_mode_id IS NULL THEN '{}'
        ELSE json_object('mode', requested_mode_id)
    END,
    launch_verification_status = mode_verification_status;
