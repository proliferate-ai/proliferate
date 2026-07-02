-- Agent-auth-config teardown (agent-auth PR 1): drop the encrypted
-- cloud-pushed selection-config table (0046) and the per-session agent-auth
-- scope columns (0047). The sessions.agent_auth_contexts column (0049) is a
-- different feature (catalog v2 classification provenance) and stays.
-- The bundled SQLite (rusqlite "bundled", >= 3.35) supports DROP COLUMN
-- directly; no index/trigger/view references these columns.
DROP TABLE IF EXISTS agent_auth_config;
ALTER TABLE sessions DROP COLUMN agent_auth_scope_provider;
ALTER TABLE sessions DROP COLUMN agent_auth_scope_id;
ALTER TABLE sessions DROP COLUMN agent_auth_scope_target_id;
ALTER TABLE sessions DROP COLUMN required_agent_auth_revision;
