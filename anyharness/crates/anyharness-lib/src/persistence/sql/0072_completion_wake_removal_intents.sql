ALTER TABLE session_link_completion_deliveries
    ADD COLUMN retired_prompt_seq INTEGER;

ALTER TABLE session_link_completion_deliveries
    ADD COLUMN retired_prompt_id TEXT;

ALTER TABLE session_link_completion_deliveries
    ADD COLUMN removal_event_persisted_at TEXT;

ALTER TABLE session_events
    ADD COLUMN completion_wake_removal_key TEXT;

CREATE UNIQUE INDEX idx_session_events_completion_wake_removal
    ON session_events(completion_wake_removal_key)
    WHERE completion_wake_removal_key IS NOT NULL;

CREATE INDEX idx_completion_deliveries_pending_removal
    ON session_link_completion_deliveries(
        removal_event_persisted_at,
        next_attempt_at,
        lease_expires_at
    )
    WHERE retired_prompt_seq IS NOT NULL
      AND removal_event_persisted_at IS NULL;
