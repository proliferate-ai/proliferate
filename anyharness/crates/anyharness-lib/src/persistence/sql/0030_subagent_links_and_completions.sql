ALTER TABLE session_links ADD COLUMN label TEXT;

CREATE UNIQUE INDEX idx_session_links_subagent_child_owner
    ON session_links(relation, child_session_id)
    WHERE relation = 'subagent';

CREATE TABLE session_link_completions (
    completion_id TEXT PRIMARY KEY,
    session_link_id TEXT NOT NULL REFERENCES session_links(id) ON DELETE CASCADE,
    child_turn_id TEXT NOT NULL,
    child_last_event_seq INTEGER NOT NULL,
    outcome TEXT NOT NULL,
    parent_event_seq INTEGER,
    parent_prompt_seq INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(session_link_id, child_turn_id)
);

CREATE INDEX idx_session_link_completions_link
    ON session_link_completions(session_link_id);

CREATE TABLE session_link_wake_schedules (
    session_link_id TEXT PRIMARY KEY REFERENCES session_links(id) ON DELETE CASCADE
);
