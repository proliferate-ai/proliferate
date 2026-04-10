CREATE TABLE session_pending_prompts (
    session_id TEXT NOT NULL REFERENCES sessions(id),
    seq        INTEGER NOT NULL,
    prompt_id  TEXT,
    text       TEXT NOT NULL,
    queued_at  TEXT NOT NULL,
    PRIMARY KEY (session_id, seq)
);

CREATE INDEX idx_session_pending_prompts_session_seq
    ON session_pending_prompts (session_id, seq);
