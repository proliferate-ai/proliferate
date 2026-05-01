DROP INDEX IF EXISTS idx_review_assignments_reviewer_session;
DROP INDEX IF EXISTS idx_review_assignments_round_status;

ALTER TABLE review_assignments RENAME TO review_assignments_old;

CREATE TABLE review_assignments (
    id TEXT PRIMARY KEY,
    review_run_id TEXT NOT NULL,
    review_round_id TEXT NOT NULL,
    reviewer_session_id TEXT,
    session_link_id TEXT,
    persona_id TEXT NOT NULL,
    persona_label TEXT NOT NULL,
    persona_prompt TEXT NOT NULL,
    agent_kind TEXT NOT NULL,
    model_id TEXT,
    requested_mode_id TEXT,
    actual_mode_id TEXT,
    mode_verification_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (mode_verification_status IN ('pending', 'verified', 'mismatch', 'not_checked')),
    status TEXT NOT NULL CHECK (status IN (
        'queued',
        'launching',
        'reviewing',
        'reminded',
        'retryable_failed',
        'submitted',
        'cancelled',
        'timed_out',
        'system_failed'
    )),
    pass INTEGER,
    summary TEXT,
    critique_markdown TEXT,
    critique_artifact_path TEXT,
    submitted_at TEXT,
    deadline_at TEXT NOT NULL,
    reminder_count INTEGER NOT NULL DEFAULT 0,
    failure_reason TEXT,
    failure_detail TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(review_run_id) REFERENCES review_runs(id) ON DELETE CASCADE,
    FOREIGN KEY(review_round_id) REFERENCES review_rounds(id) ON DELETE CASCADE,
    FOREIGN KEY(reviewer_session_id) REFERENCES sessions(id) ON DELETE SET NULL,
    FOREIGN KEY(session_link_id) REFERENCES session_links(id) ON DELETE SET NULL
);

INSERT INTO review_assignments (
    id, review_run_id, review_round_id, reviewer_session_id, session_link_id,
    persona_id, persona_label, persona_prompt, agent_kind, model_id,
    requested_mode_id, actual_mode_id, mode_verification_status, status,
    pass, summary, critique_markdown, critique_artifact_path, submitted_at, deadline_at,
    reminder_count, failure_reason, failure_detail, created_at, updated_at
)
SELECT
    id, review_run_id, review_round_id, reviewer_session_id, session_link_id,
    persona_id, persona_label, persona_prompt, agent_kind, model_id,
    requested_mode_id, actual_mode_id, mode_verification_status, status,
    pass, summary, critique_markdown, critique_artifact_path, submitted_at, deadline_at,
    reminder_count, failure_reason, failure_detail, created_at, updated_at
FROM review_assignments_old;

DROP TABLE review_assignments_old;

CREATE INDEX idx_review_assignments_round_status
ON review_assignments(review_round_id, status);

CREATE UNIQUE INDEX idx_review_assignments_reviewer_session
ON review_assignments(reviewer_session_id)
WHERE reviewer_session_id IS NOT NULL
  AND status IN ('launching', 'reviewing', 'reminded');
