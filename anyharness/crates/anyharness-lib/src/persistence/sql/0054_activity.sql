-- Activity rosters: read-only mirrors of harness-native background
-- processes and subagents (session-activity-architecture). Never externally
-- settable — records transition only through observer-ingested native
-- notifications. `feed_bindings` holds the transport detail
-- (tail_file|acp_child_demux|http_sse) that never leaves the runtime; the
-- contract only ever sees the opaque `feed_id` it mints.
CREATE TABLE activity_processes (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    process_id TEXT NOT NULL,
    command TEXT NOT NULL,
    cwd TEXT,
    status TEXT NOT NULL,
    exit_code INTEGER,
    pid INTEGER,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    feed_id TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (session_id, process_id)
);

CREATE TABLE activity_subagents (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    subagent_id TEXT NOT NULL,
    agent_type TEXT,
    description TEXT,
    model TEXT,
    background INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    summary TEXT,
    tokens_used INTEGER,
    tool_calls INTEGER,
    duration_seconds INTEGER,
    feed_id TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (session_id, subagent_id)
);

CREATE TABLE feed_bindings (
    feed_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    owner_kind TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    transport_kind TEXT NOT NULL,
    transport_path TEXT,
    transport_thread_id TEXT,
    transport_url TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_feed_bindings_owner
    ON feed_bindings(session_id, owner_kind, owner_id);
