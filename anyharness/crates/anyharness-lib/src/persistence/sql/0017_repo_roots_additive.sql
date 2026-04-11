CREATE TABLE repo_roots (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    display_name TEXT,
    default_branch TEXT,
    remote_provider TEXT,
    remote_owner TEXT,
    remote_repo_name TEXT,
    remote_url TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO repo_roots (
    id,
    kind,
    path,
    display_name,
    default_branch,
    remote_provider,
    remote_owner,
    remote_repo_name,
    remote_url,
    created_at,
    updated_at
)
SELECT
    w.id,
    'external',
    w.source_repo_root_path,
    w.display_name,
    COALESCE(w.current_branch, w.original_branch),
    w.git_provider,
    w.git_owner,
    w.git_repo_name,
    NULL,
    w.created_at,
    w.updated_at
FROM workspaces w
WHERE w.kind = 'repo';
