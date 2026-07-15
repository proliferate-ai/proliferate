-- Session auth-context provenance: the classified catalog auth-context IDs
-- active at session creation, as a JSON array (e.g. ["anthropic-api"]). NULL
-- means the session has no captured classification provenance. IDs only: no
-- credential facts or values are ever stored.
ALTER TABLE sessions ADD COLUMN agent_auth_contexts TEXT;
