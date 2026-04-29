ALTER TABLE session_pending_prompts ADD COLUMN blocks_json TEXT;

ALTER TABLE session_live_config_snapshots ADD COLUMN prompt_capabilities_json TEXT;

CREATE TABLE session_prompt_attachments (
    attachment_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    state TEXT NOT NULL,
    kind TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    display_name TEXT,
    source_uri TEXT,
    size_bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    content BLOB NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_session_prompt_attachments_session
    ON session_prompt_attachments (session_id);

CREATE INDEX idx_session_prompt_attachments_state_updated
    ON session_prompt_attachments (state, updated_at);
