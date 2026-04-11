UPDATE workspaces
SET repo_root_id = (
    SELECT COALESCE(parent.repo_root_id, parent.id)
    FROM workspaces parent
    WHERE parent.id = workspaces.source_workspace_id
      AND parent.kind = 'repo'
    LIMIT 1
)
WHERE kind IN ('local', 'worktree')
  AND repo_root_id IS NULL
  AND source_workspace_id IS NOT NULL;

UPDATE workspaces
SET repo_root_id = (
    SELECT rr.id
    FROM repo_roots rr
    WHERE rr.path = workspaces.source_repo_root_path
    LIMIT 1
)
WHERE kind IN ('local', 'worktree')
  AND repo_root_id IS NULL;

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
    r.path,
    r.source_repo_root_path,
    NULL,
    r.git_provider,
    r.git_owner,
    r.git_repo_name,
    r.original_branch,
    r.current_branch,
    r.display_name,
    r.created_at,
    r.updated_at,
    COALESCE(r.repo_root_id, r.id),
    'standard'
FROM workspaces r
WHERE r.kind = 'repo'
  AND (
      EXISTS (SELECT 1 FROM sessions s WHERE s.workspace_id = r.id)
      OR EXISTS (SELECT 1 FROM workspace_access_modes wam WHERE wam.workspace_id = r.id)
  )
  AND NOT EXISTS (
      SELECT 1
      FROM workspaces l
      WHERE l.kind = 'local'
        AND l.path = r.path
        AND l.repo_root_id = COALESCE(r.repo_root_id, r.id)
  );

UPDATE sessions
SET workspace_id = (
    SELECT l.id
    FROM workspaces r
    JOIN workspaces l
      ON l.kind = 'local'
     AND l.path = r.path
     AND l.repo_root_id = COALESCE(r.repo_root_id, r.id)
    WHERE r.id = sessions.workspace_id
    ORDER BY l.created_at ASC
    LIMIT 1
)
WHERE workspace_id IN (
    SELECT id
    FROM workspaces
    WHERE kind = 'repo'
);

INSERT OR REPLACE INTO workspace_access_modes (
    workspace_id,
    mode,
    handoff_op_id,
    updated_at
)
SELECT
    l.id,
    wam.mode,
    wam.handoff_op_id,
    wam.updated_at
FROM workspace_access_modes wam
JOIN workspaces r
  ON r.id = wam.workspace_id
 AND r.kind = 'repo'
JOIN workspaces l
  ON l.kind = 'local'
 AND l.path = r.path
 AND l.repo_root_id = COALESCE(r.repo_root_id, r.id);

DELETE FROM workspace_access_modes
WHERE workspace_id IN (
    SELECT id
    FROM workspaces
    WHERE kind = 'repo'
);

UPDATE workspaces
SET source_workspace_id = NULL
WHERE kind IN ('local', 'worktree')
  AND source_workspace_id IN (
      SELECT id
      FROM workspaces
      WHERE kind = 'repo'
  );

DELETE FROM workspaces
WHERE kind = 'repo';
