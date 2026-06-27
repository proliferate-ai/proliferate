CREATE TABLE IF NOT EXISTS local_skills (
    skill_id TEXT PRIMARY KEY,
    source_kind TEXT NOT NULL,
    source TEXT NOT NULL,
    slug TEXT NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT NOT NULL,
    install_url TEXT,
    source_url TEXT,
    hash TEXT,
    install_count INTEGER NOT NULL DEFAULT 0,
    audit_status TEXT NOT NULL DEFAULT 'missing',
    audits_json TEXT NOT NULL DEFAULT '[]',
    files_json TEXT NOT NULL DEFAULT '[]',
    library_path TEXT NOT NULL,
    installed_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workspace_local_skills (
    workspace_id TEXT NOT NULL,
    skill_id TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (workspace_id, skill_id),
    FOREIGN KEY (skill_id) REFERENCES local_skills(skill_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workspace_local_skills_workspace_id
    ON workspace_local_skills(workspace_id);
