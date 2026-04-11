ALTER TABLE sessions
ADD COLUMN permission_policy TEXT NOT NULL DEFAULT 'interactive';
