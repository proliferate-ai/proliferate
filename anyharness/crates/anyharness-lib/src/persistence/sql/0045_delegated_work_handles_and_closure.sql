ALTER TABLE session_links ADD COLUMN public_id TEXT;
ALTER TABLE session_links ADD COLUMN closed_at TEXT;

UPDATE session_links
SET public_id = CASE relation
    WHEN 'subagent' THEN 'subagent_' || replace(id, '-', '')
    WHEN 'cowork_coding_session' THEN 'cowork_agent_' || replace(id, '-', '')
    WHEN 'review_agent' THEN 'reviewer_' || replace(id, '-', '')
    ELSE 'session_link_' || replace(id, '-', '')
END
WHERE public_id IS NULL;

CREATE UNIQUE INDEX idx_session_links_public_id
    ON session_links(public_id)
    WHERE public_id IS NOT NULL;

CREATE INDEX idx_session_links_open_parent_relation
    ON session_links(parent_session_id, relation, closed_at);

CREATE INDEX idx_session_links_open_child_relation
    ON session_links(child_session_id, relation, closed_at);

ALTER TABLE cowork_managed_workspaces ADD COLUMN public_id TEXT;
ALTER TABLE cowork_managed_workspaces ADD COLUMN closed_at TEXT;

UPDATE cowork_managed_workspaces
SET public_id = 'cowork_workspace_' || replace(id, '-', '')
WHERE public_id IS NULL;

CREATE UNIQUE INDEX idx_cowork_managed_workspaces_public_id
    ON cowork_managed_workspaces(public_id)
    WHERE public_id IS NOT NULL;

CREATE INDEX idx_cowork_managed_workspaces_open_parent
    ON cowork_managed_workspaces(parent_session_id, closed_at);
