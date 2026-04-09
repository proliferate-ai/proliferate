ALTER TABLE workspaces ADD COLUMN current_branch TEXT;
UPDATE workspaces
SET current_branch = original_branch
WHERE current_branch IS NULL;
