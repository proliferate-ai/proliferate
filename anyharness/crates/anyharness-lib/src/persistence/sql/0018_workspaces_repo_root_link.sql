ALTER TABLE workspaces ADD COLUMN repo_root_id TEXT;
ALTER TABLE workspaces ADD COLUMN surface TEXT NOT NULL DEFAULT 'standard';

UPDATE workspaces
SET repo_root_id = CASE
    WHEN kind = 'repo' THEN id
    WHEN source_workspace_id IS NOT NULL THEN source_workspace_id
    ELSE repo_root_id
END
WHERE repo_root_id IS NULL;

INSERT INTO workspaces (
    id,
    kind,
    path,
    source_repo_root_path,
    source_workspace_id,
    git_provider,
    git_owner,
    git_repo_name,
    original_branch,
    current_branch,
    display_name,
    created_at,
    updated_at,
    repo_root_id,
    surface
)
SELECT
    lower(
        hex(randomblob(4)) || '-' ||
        hex(randomblob(2)) || '-4' ||
        substr(hex(randomblob(2)), 2) || '-' ||
        substr('89ab', abs(random()) % 4 + 1, 1) ||
        substr(hex(randomblob(2)), 2) || '-' ||
        hex(randomblob(6))
    ),
    'local',
    w.path,
    w.source_repo_root_path,
    w.id,
    w.git_provider,
    w.git_owner,
    w.git_repo_name,
    w.original_branch,
    w.current_branch,
    w.display_name,
    w.created_at,
    w.updated_at,
    w.id,
    'standard'
FROM workspaces w
WHERE w.kind = 'repo'
  AND EXISTS (SELECT 1 FROM sessions s WHERE s.workspace_id = w.id)
  AND NOT EXISTS (
      SELECT 1
      FROM workspaces l
      WHERE l.kind = 'local'
        AND l.path = w.path
        AND COALESCE(l.repo_root_id, l.source_workspace_id) = w.id
  );

UPDATE sessions
SET workspace_id = (
    SELECT l.id
    FROM workspaces r
    JOIN workspaces l
      ON l.kind = 'local'
     AND l.path = r.path
     AND COALESCE(l.repo_root_id, l.source_workspace_id) = COALESCE(r.repo_root_id, r.id)
    WHERE r.id = sessions.workspace_id
    ORDER BY l.created_at ASC
    LIMIT 1
)
WHERE workspace_id IN (
    SELECT id
    FROM workspaces
    WHERE kind = 'repo'
);

CREATE INDEX idx_workspaces_repo_root_id ON workspaces(repo_root_id);
