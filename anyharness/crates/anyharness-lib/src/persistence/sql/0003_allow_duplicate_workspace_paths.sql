DROP INDEX idx_workspaces_path;
CREATE INDEX idx_workspaces_path ON workspaces(path);
