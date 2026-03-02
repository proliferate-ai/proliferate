-- V1 Legacy Purge: Drop unused tables with zero service-layer consumers.
-- trigger_event_actions and session_tool_invocations are superseded by V1 event models.
-- workspace_cache_snapshots was never wired up (optimization placeholder, zero usage).

DROP TABLE IF EXISTS "trigger_event_actions" CASCADE;
DROP TABLE IF EXISTS "session_tool_invocations" CASCADE;
DROP TABLE IF EXISTS "workspace_cache_snapshots" CASCADE;
