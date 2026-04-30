ALTER TABLE workspaces ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'active';
ALTER TABLE workspaces ADD COLUMN cleanup_state TEXT NOT NULL DEFAULT 'none';
