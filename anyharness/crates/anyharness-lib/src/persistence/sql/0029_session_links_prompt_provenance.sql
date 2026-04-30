CREATE TABLE session_links (
    id TEXT PRIMARY KEY,
    relation TEXT NOT NULL,
    parent_session_id TEXT NOT NULL REFERENCES sessions(id),
    child_session_id TEXT NOT NULL REFERENCES sessions(id),
    workspace_relation TEXT NOT NULL,
    created_by_turn_id TEXT,
    created_by_tool_call_id TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(relation, parent_session_id, child_session_id),
    CHECK(parent_session_id != child_session_id)
);

CREATE INDEX idx_session_links_parent
    ON session_links(parent_session_id);

CREATE INDEX idx_session_links_child
    ON session_links(child_session_id);

ALTER TABLE session_pending_prompts ADD COLUMN provenance_json TEXT;
