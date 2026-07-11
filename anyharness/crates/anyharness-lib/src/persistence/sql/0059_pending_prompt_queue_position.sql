ALTER TABLE sessions
    ADD COLUMN pending_prompt_seq_cursor INTEGER NOT NULL DEFAULT 0;

UPDATE sessions
SET pending_prompt_seq_cursor = COALESCE(
    (
        SELECT MAX(seq)
        FROM session_pending_prompts
        WHERE session_pending_prompts.session_id = sessions.id
    ),
    0
);

ALTER TABLE session_pending_prompts ADD COLUMN queue_position INTEGER;

UPDATE session_pending_prompts
SET queue_position = seq
WHERE queue_position IS NULL;

CREATE UNIQUE INDEX idx_session_pending_prompts_session_position
    ON session_pending_prompts (session_id, queue_position);
