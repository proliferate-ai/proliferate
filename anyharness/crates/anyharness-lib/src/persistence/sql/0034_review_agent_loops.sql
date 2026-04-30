ALTER TABLE sessions
ADD COLUMN mcp_binding_policy TEXT NOT NULL DEFAULT 'inherit_workspace';

CREATE TABLE review_runs (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    parent_session_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('plan', 'code')),
    status TEXT NOT NULL CHECK (status IN (
        'reviewing',
        'feedback_ready',
        'parent_revising',
        'waiting_for_revision',
        'passed',
        'stopped',
        'system_failed'
    )),
    target_plan_id TEXT,
    target_plan_snapshot_hash TEXT,
    target_code_manifest_json TEXT,
    title TEXT NOT NULL,
    max_rounds INTEGER NOT NULL,
    auto_send_feedback INTEGER NOT NULL DEFAULT 1,
    active_round_id TEXT,
    current_round_number INTEGER NOT NULL DEFAULT 1,
    parent_can_signal_revision_via_mcp INTEGER NOT NULL DEFAULT 0,
    failure_reason TEXT,
    failure_detail TEXT,
    stopped_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY(parent_session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY(target_plan_id) REFERENCES plans(id) ON DELETE SET NULL
);

CREATE INDEX idx_review_runs_parent_status
ON review_runs(parent_session_id, status);

CREATE TABLE review_rounds (
    id TEXT PRIMARY KEY,
    review_run_id TEXT NOT NULL,
    round_number INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN (
        'reviewing',
        'completing',
        'passed',
        'feedback_pending',
        'feedback_sent',
        'completed_with_drift',
        'cancelled',
        'system_failed'
    )),
    target_plan_id TEXT,
    target_plan_snapshot_hash TEXT,
    target_code_manifest_json TEXT,
    feedback_job_id TEXT,
    feedback_prompt_sent_at TEXT,
    completed_at TEXT,
    failure_reason TEXT,
    failure_detail TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(review_run_id) REFERENCES review_runs(id) ON DELETE CASCADE,
    FOREIGN KEY(target_plan_id) REFERENCES plans(id) ON DELETE SET NULL,
    UNIQUE(review_run_id, round_number)
);

CREATE INDEX idx_review_rounds_run_status
ON review_rounds(review_run_id, status);

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

CREATE INDEX idx_review_assignments_round_status
ON review_assignments(review_round_id, status);

CREATE UNIQUE INDEX idx_review_assignments_reviewer_session
ON review_assignments(reviewer_session_id)
WHERE reviewer_session_id IS NOT NULL
  AND status IN ('launching', 'reviewing', 'reminded');

CREATE TABLE review_run_candidate_plans (
    review_run_id TEXT NOT NULL,
    plan_id TEXT NOT NULL,
    source_turn_id TEXT,
    source_tool_call_id TEXT,
    snapshot_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(review_run_id, plan_id),
    FOREIGN KEY(review_run_id) REFERENCES review_runs(id) ON DELETE CASCADE,
    FOREIGN KEY(plan_id) REFERENCES plans(id) ON DELETE CASCADE
);

CREATE TABLE review_feedback_jobs (
    id TEXT PRIMARY KEY,
    review_run_id TEXT NOT NULL,
    review_round_id TEXT NOT NULL,
    parent_session_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('pending', 'sending', 'sent', 'failed')),
    prompt_text TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT,
    sent_prompt_seq INTEGER,
    feedback_turn_id TEXT,
    failure_reason TEXT,
    failure_detail TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(review_run_id) REFERENCES review_runs(id) ON DELETE CASCADE,
    FOREIGN KEY(review_round_id) REFERENCES review_rounds(id) ON DELETE CASCADE,
    FOREIGN KEY(parent_session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_review_feedback_jobs_state
ON review_feedback_jobs(state, next_attempt_at);

CREATE UNIQUE INDEX idx_session_links_review_agent_child_owner
ON session_links(relation, child_session_id)
WHERE relation = 'review_agent';
