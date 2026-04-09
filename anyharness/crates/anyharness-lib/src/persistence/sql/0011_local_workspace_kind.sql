-- For every "repo" workspace that has sessions (user was working in it
-- directly), create a companion "local" workspace and reassign sessions.

INSERT INTO workspaces (
    id, kind, path, source_repo_root_path, source_workspace_id,
    git_provider, git_owner, git_repo_name,
    original_branch, current_branch, created_at, updated_at
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
    w.created_at,
    w.updated_at
FROM workspaces w
WHERE w.kind = 'repo'
  AND EXISTS (SELECT 1 FROM sessions s WHERE s.workspace_id = w.id);

-- Reassign sessions from the old "repo" workspace to the new "local" workspace.
UPDATE sessions
SET workspace_id = (
    SELECT l.id
    FROM workspaces l
    WHERE l.kind = 'local'
      AND l.source_workspace_id = sessions.workspace_id
)
WHERE workspace_id IN (
    SELECT w.id
    FROM workspaces w
    WHERE w.kind = 'repo'
      AND EXISTS (
          SELECT 1 FROM workspaces l
          WHERE l.kind = 'local'
            AND l.source_workspace_id = w.id
      )
);
