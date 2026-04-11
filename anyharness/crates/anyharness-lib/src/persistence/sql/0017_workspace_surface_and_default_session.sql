ALTER TABLE workspaces
ADD COLUMN surface_kind TEXT NOT NULL DEFAULT 'code';

ALTER TABLE workspaces
ADD COLUMN is_internal INTEGER NOT NULL DEFAULT 0;

ALTER TABLE workspaces
ADD COLUMN default_session_id TEXT;
