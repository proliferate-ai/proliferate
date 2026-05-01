ALTER TABLE workspaces ADD COLUMN cleanup_error_message TEXT;
ALTER TABLE workspaces ADD COLUMN cleanup_failed_at TEXT;
ALTER TABLE workspaces ADD COLUMN cleanup_attempted_at TEXT;
