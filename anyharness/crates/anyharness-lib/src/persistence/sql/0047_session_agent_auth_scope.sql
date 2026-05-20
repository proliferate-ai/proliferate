ALTER TABLE sessions ADD COLUMN agent_auth_scope_provider TEXT;
ALTER TABLE sessions ADD COLUMN agent_auth_scope_id TEXT;
ALTER TABLE sessions ADD COLUMN agent_auth_scope_target_id TEXT;
ALTER TABLE sessions ADD COLUMN required_agent_auth_revision INTEGER;
