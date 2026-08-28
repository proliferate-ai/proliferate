-- Which discovered native integrations the user re-admitted into sessions,
-- per agent kind. Discovery results are never stored: a row only names an
-- integration id, and the absence of rows is the absence of passthrough.
-- Spec: specs/systems/harnesses/native-integrations.md, "Owned state".
CREATE TABLE native_integration_selections (
    id             TEXT PRIMARY KEY,
    agent_kind     TEXT NOT NULL,          -- 'codex' | 'claude' | ...
    integration_id TEXT NOT NULL,          -- 'bundle:computer-use' | 'mcp:<server-name>'
    enabled_at     TEXT NOT NULL,
    UNIQUE (agent_kind, integration_id)
);
