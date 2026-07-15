-- Loops: recurring in-session prompts on a schedule. Unlike goals, multiple
-- loops per session are allowed (native Claude `CronList` shape) — keyed by
-- (session_id, loop_id) rather than a single mirror row per session.
CREATE TABLE loops (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    loop_id TEXT NOT NULL,
    prompt TEXT NOT NULL,
    schedule_kind TEXT NOT NULL,
    schedule_expr TEXT NOT NULL,
    recurring INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL,
    native INTEGER NOT NULL DEFAULT 1,
    last_fired_at_ms INTEGER,
    fire_count INTEGER NOT NULL DEFAULT 0,
    native_state_json TEXT,
    created_at TEXT NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    PRIMARY KEY (session_id, loop_id)
);

CREATE INDEX idx_loops_session_status
    ON loops(session_id, status);
