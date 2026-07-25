ALTER TABLE workspaces
ADD COLUMN generation INTEGER NOT NULL DEFAULT 1 CHECK (generation > 0);
