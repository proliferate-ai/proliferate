CREATE TABLE session_link_completion_deliveries (
    delivery_id TEXT PRIMARY KEY,
    completion_id TEXT NOT NULL UNIQUE,
    session_link_id TEXT NOT NULL,
    parent_session_id TEXT NOT NULL,
    child_session_id TEXT NOT NULL,
    subagent_public_id TEXT,
    label TEXT,
    child_turn_id TEXT NOT NULL,
    child_last_event_seq INTEGER NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('completed', 'failed', 'cancelled')),
    assistant_text TEXT,
    notification_text TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('pending', 'enqueued', 'delivered', 'abandoned', 'failed')),
    parent_prompt_seq INTEGER,
    parent_turn_id TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL,
    lease_token TEXT,
    lease_expires_at TEXT,
    last_error_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    enqueued_at TEXT,
    delivered_at TEXT,
    UNIQUE(child_session_id, child_turn_id)
);

CREATE INDEX idx_completion_deliveries_due
    ON session_link_completion_deliveries(state, next_attempt_at, lease_expires_at);

CREATE INDEX idx_completion_deliveries_parent_state
    ON session_link_completion_deliveries(parent_session_id, state);
