-- Session-scoped wake schedules. The link-scoped table stays for link wakes;
-- this one is keyed on the session pair, so a wake can be armed on any session
-- without a relationship existing between the two.
--
-- One row = one watcher waiting on one target. The pair primary key makes
-- arming twice a no-op, and the target index serves the only hot read: the
-- turn-finish transaction deleting every schedule for the session that just
-- finished.
CREATE TABLE session_wake_schedules (
    watcher_session_id TEXT NOT NULL REFERENCES sessions(id),
    target_session_id TEXT NOT NULL REFERENCES sessions(id),
    created_at TEXT NOT NULL,
    PRIMARY KEY (watcher_session_id, target_session_id),
    CHECK (watcher_session_id != target_session_id)
);

CREATE INDEX idx_session_wake_schedules_target
    ON session_wake_schedules(target_session_id);
