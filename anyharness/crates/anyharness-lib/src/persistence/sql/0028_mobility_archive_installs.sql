CREATE TABLE mobility_archive_installs (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    operation_id TEXT NOT NULL,
    status TEXT NOT NULL,
    source_workspace_path TEXT NOT NULL,
    base_commit_sha TEXT NOT NULL,
    imported_session_ids_json TEXT NOT NULL,
    applied_file_count INTEGER NOT NULL DEFAULT 0,
    deleted_file_count INTEGER NOT NULL DEFAULT 0,
    imported_agent_artifact_count INTEGER NOT NULL DEFAULT 0,
    completed_at TEXT,
    PRIMARY KEY (workspace_id, operation_id)
);
