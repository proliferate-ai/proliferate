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
-- Backfilled intents are deliberately empty: legacy model/mode requests were
-- never target-observed values, and admission exact-validates every intent
-- entry against current observations, so copying them would permanently block
-- resume for any value the target no longer (or never) reports. Migrated
-- sessions restore their live values from the persisted live snapshot.
INSERT INTO session_launch_intents (
    session_id, requested_model_id, requested_controls_json, created_at
)
SELECT id,
       NULL,
       '{}',
       created_at
FROM sessions;

ALTER TABLE session_live_config_snapshots
    ADD COLUMN full_snapshot_json TEXT;

ALTER TABLE review_assignments
    ADD COLUMN control_values_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE review_assignments
    ADD COLUMN launch_verification_status TEXT NOT NULL DEFAULT 'pending';

-- Same emptiness rule as session intents: legacy review mode ids are not
-- observed control values and would fail strict launch validation.
UPDATE review_assignments
SET control_values_json = '{}',
    launch_verification_status = mode_verification_status;
