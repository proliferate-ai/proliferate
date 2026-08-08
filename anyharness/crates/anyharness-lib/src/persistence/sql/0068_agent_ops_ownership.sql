-- Ownership, promotion and close attribution — all three land on the existing
-- `session_links` row. One row is one ownership fact, and the three states an
-- agent can be in fall out of the columns rather than out of a new table:
--
--   linked subagent      relation = 'subagent'     AND promoted_at IS NULL
--   promoted             relation = 'subagent'     AND promoted_at IS NOT NULL
--   owned via spawn      relation = 'owned_agent'
--
-- `relation` has no CHECK constraint, so `'owned_agent'` is a value the parser
-- gains rather than a schema change; nothing writes it until the spawn_agent
-- step, and historical rows keep parsing.
--
-- Promotion is one idempotent write. The close cascade follows only
-- `relation = 'subagent' AND promoted_at IS NULL`, so a promoted child stops
-- being taken down with its former parent while the parent still owns it and
-- may close it individually.
ALTER TABLE session_links ADD COLUMN promoted_at TEXT;

-- Close attribution, and the durable close REQUEST that makes a soft close
-- possible. `closed_by_session_id` is set by an agent-initiated `close_agent`
-- and stays NULL for a human close, which leaves no trace. While
-- `closed_at IS NULL` a non-NULL `closed_by_session_id` means "end requested":
-- the target was mid-turn, so the close waits for that turn to finish.
ALTER TABLE session_links ADD COLUMN closed_by_session_id TEXT;

-- Optional free text the closing agent supplies, rendered as
-- "Closed by <agent> · <reason>".
ALTER TABLE session_links ADD COLUMN close_reason TEXT;

-- The turn-finish hook asks one question of every session that finishes a turn:
-- "does an open link name me as end-requested?". Without this the hook is a
-- full scan of `session_links` on every completed turn in the runtime.
CREATE INDEX idx_session_links_pending_close_request
    ON session_links(child_session_id)
    WHERE closed_at IS NULL AND closed_by_session_id IS NOT NULL;
