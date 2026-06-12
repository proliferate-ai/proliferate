-- Session auth-context provenance (catalog migration PR-7b): the classified
-- catalog v2 auth-context ids active at session create, as a JSON array of
-- ids (e.g. ["anthropic-api"]). NULL for sessions created in the v1-catalog
-- era. Ids only — no credential facts or values are ever stored.
ALTER TABLE sessions ADD COLUMN agent_auth_contexts TEXT;
