CREATE TABLE plans (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL,
    title TEXT NOT NULL,
    body_markdown TEXT NOT NULL,
    snapshot_hash TEXT NOT NULL,
    decision_state TEXT NOT NULL,
    native_resolution_state TEXT NOT NULL,
    decision_version INTEGER NOT NULL,
    source_agent_kind TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    source_session_id TEXT NOT NULL,
    source_turn_id TEXT,
    source_item_id TEXT,
    source_tool_call_id TEXT,
    superseded_by_plan_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_plans_workspace_updated
    ON plans(workspace_id, updated_at DESC);

CREATE INDEX idx_plans_session_source
    ON plans(session_id, source_agent_kind, source_kind, updated_at DESC);

CREATE INDEX idx_plans_tool_call
    ON plans(session_id, source_tool_call_id)
    WHERE source_tool_call_id IS NOT NULL;

CREATE UNIQUE INDEX idx_plans_source_idempotency
    ON plans(source_session_id, source_turn_id, source_item_id, source_kind)
    WHERE source_session_id IS NOT NULL
      AND source_turn_id IS NOT NULL
      AND source_item_id IS NOT NULL
      AND source_kind IS NOT NULL;

CREATE TABLE plan_interaction_links (
    plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    tool_call_id TEXT NOT NULL,
    resolution_state TEXT NOT NULL,
    option_mappings_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (plan_id, request_id)
);

CREATE UNIQUE INDEX idx_plan_interaction_links_request
    ON plan_interaction_links(session_id, request_id);

CREATE INDEX idx_plan_interaction_links_tool_call
    ON plan_interaction_links(session_id, tool_call_id);

CREATE TABLE plan_handoffs (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    source_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    target_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    instruction TEXT NOT NULL,
    prompt_status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_plan_handoffs_plan
    ON plan_handoffs(plan_id, created_at DESC);
