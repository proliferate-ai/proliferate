-- V1 Legacy Purge: Drop unused V0 telemetry tables
-- Both tables have zero service-layer consumers and are superseded by V1 event models.

DROP TABLE IF EXISTS "trigger_event_actions" CASCADE;
DROP TABLE IF EXISTS "session_tool_invocations" CASCADE;
