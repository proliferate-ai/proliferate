ALTER TABLE session_link_completion_deliveries
    ADD COLUMN retired_prompt_seq INTEGER;

ALTER TABLE session_link_completion_deliveries
    ADD COLUMN retired_prompt_id TEXT;

ALTER TABLE session_link_completion_deliveries
    ADD COLUMN removal_event_persisted_at TEXT;

CREATE INDEX idx_completion_deliveries_pending_removal
    ON session_link_completion_deliveries(removal_event_persisted_at, updated_at)
    WHERE retired_prompt_seq IS NOT NULL
      AND removal_event_persisted_at IS NULL;
