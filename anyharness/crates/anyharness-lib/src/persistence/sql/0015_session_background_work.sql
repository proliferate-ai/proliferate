CREATE TABLE session_background_work (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    tool_call_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    tracker_kind TEXT NOT NULL,
    source_agent_kind TEXT NOT NULL,
    agent_id TEXT,
    output_file TEXT NOT NULL,
    state TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    launched_at TEXT NOT NULL,
    last_activity_at TEXT NOT NULL,
    completed_at TEXT,
    PRIMARY KEY (session_id, tool_call_id)
);

CREATE INDEX idx_session_background_work_pending
    ON session_background_work(session_id, state, launched_at);
