CREATE TABLE loops (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    prompt TEXT NOT NULL,
    -- interval | cron
    schedule_kind TEXT NOT NULL,
    schedule_expr TEXT NOT NULL,
    -- 0 = one-shot wakeup, 1 = re-fires on every match
    recurring INTEGER NOT NULL,
    -- active | paused | cleared (spec §2.7)
    status TEXT NOT NULL,
    -- 1 = mirror of a native harness cron (claude), 0 = runtime-emulated (codex)
    native INTEGER NOT NULL,
    -- The sidecar's loop id (claude cron job id); NULL for emulated loops.
    native_loop_id TEXT,
    last_fired_at TEXT,
    next_fire_at TEXT,
    fire_count INTEGER NOT NULL DEFAULT 0,
    max_fires INTEGER,
    max_wall_secs INTEGER,
    -- user | workflow | agent
    source_kind TEXT NOT NULL,
    cleared_reason TEXT,
    -- Raw native payload (LoopWire) for fidelity/debug.
    native_state_json TEXT NOT NULL,
    revision INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_loops_workspace_updated
    ON loops(workspace_id, updated_at DESC);

CREATE INDEX idx_loops_session_status
    ON loops(session_id, status, updated_at DESC);

-- One mirror row per native cron id per session (upsert key for ingest).
CREATE UNIQUE INDEX idx_loops_session_native_loop
    ON loops(session_id, native_loop_id)
    WHERE native_loop_id IS NOT NULL;
