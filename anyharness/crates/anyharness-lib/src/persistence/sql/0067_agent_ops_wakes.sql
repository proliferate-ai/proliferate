-- Session-scoped wake schedules. The link-scoped table stays for link wakes;
-- this one is keyed on the session pair, so a wake can be armed on any session
-- without a relationship existing between the two.
--
-- One row = one watcher waiting on one target. The pair primary key makes
-- arming twice a no-op, and the target index serves the only hot read: the
-- turn-finish transaction deleting every schedule for the session that just
-- finished.
--
-- `armed_for_reply` records WHY the row exists, because the two reasons are
-- consumed differently: a `wakeOnReply` schedule is the safety net for an
-- answer, so the answer itself consumes it, while an explicit
-- `schedule_agent_wake` survives incidental messages and only ever comes off at
-- the target's turn finish.
--
-- `dispatch_confirmed_at` is set once a send this schedule rode along with
-- LANDED. Only an unconfirmed reply arm may be compensated away by a failed
-- send, so two concurrent sends sharing one row cannot have the failing one
-- delete the schedule the succeeding one owes its watcher.
CREATE TABLE session_wake_schedules (
    watcher_session_id TEXT NOT NULL REFERENCES sessions(id),
    target_session_id TEXT NOT NULL REFERENCES sessions(id),
    created_at TEXT NOT NULL,
    armed_for_reply INTEGER NOT NULL DEFAULT 0,
    dispatch_confirmed_at TEXT,
    PRIMARY KEY (watcher_session_id, target_session_id),
    CHECK (watcher_session_id != target_session_id),
    CHECK (armed_for_reply IN (0, 1))
);

CREATE INDEX idx_session_wake_schedules_target
    ON session_wake_schedules(target_session_id);
