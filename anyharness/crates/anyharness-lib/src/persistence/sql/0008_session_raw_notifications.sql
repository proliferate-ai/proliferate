CREATE TABLE session_raw_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    seq INTEGER NOT NULL,
    timestamp TEXT NOT NULL,
    notification_kind TEXT NOT NULL,
    payload_json TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_session_raw_notifications_session_seq
    ON session_raw_notifications(session_id, seq);
