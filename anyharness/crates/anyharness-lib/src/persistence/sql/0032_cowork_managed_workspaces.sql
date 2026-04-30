CREATE TABLE cowork_managed_workspaces (
    id TEXT PRIMARY KEY,
    parent_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    source_workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
    label TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(parent_session_id, workspace_id),
    UNIQUE(workspace_id)
);

CREATE INDEX idx_cowork_managed_workspaces_parent
    ON cowork_managed_workspaces(parent_session_id);

CREATE INDEX idx_cowork_managed_workspaces_source
    ON cowork_managed_workspaces(source_workspace_id);

CREATE UNIQUE INDEX idx_session_links_cowork_coding_child_owner
    ON session_links(child_session_id)
    WHERE relation = 'cowork_coding_session';

ALTER TABLE cowork_threads
ADD COLUMN workspace_delegation_enabled INTEGER NOT NULL DEFAULT 1;
