CREATE TABLE IF NOT EXISTS worktree_retention_policy (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    max_materialized_worktrees_per_repo INTEGER NOT NULL
        CHECK (max_materialized_worktrees_per_repo BETWEEN 10 AND 100),
    updated_at TEXT NOT NULL
);

INSERT INTO worktree_retention_policy (
    id,
    max_materialized_worktrees_per_repo,
    updated_at
) VALUES (
    1,
    20,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
) ON CONFLICT(id) DO NOTHING;
