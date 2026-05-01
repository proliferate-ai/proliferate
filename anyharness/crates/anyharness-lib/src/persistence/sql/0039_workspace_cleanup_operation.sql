ALTER TABLE workspaces ADD COLUMN cleanup_operation TEXT;

UPDATE workspaces
   SET cleanup_operation = 'retire'
 WHERE lifecycle_state = 'retired'
   AND cleanup_operation IS NULL;

CREATE INDEX idx_workspaces_retention
    ON workspaces(repo_root_id, kind, lifecycle_state, surface);

CREATE INDEX idx_sessions_activity
    ON sessions(workspace_id, last_prompt_at, updated_at);

CREATE INDEX idx_terminal_command_runs_workspace_activity
    ON terminal_command_runs(workspace_id, completed_at, updated_at);
