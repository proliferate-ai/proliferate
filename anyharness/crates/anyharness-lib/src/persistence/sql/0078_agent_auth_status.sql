-- Per-harness agent-auth status documents (agent_auth spec §2, "Runtime
-- persistent state"): the machine's single source of auth truth,
-- event-refreshed, served stale-marked while a re-probe runs, never
-- withdrawn. doc_json is the served document verbatim; the probe_* columns
-- are the last-OBSERVATION store beside it (the serve-stale memory that
-- survives failures and restarts — a failure dims the served document to the
-- prior observation, it never darkens it).
CREATE TABLE agent_auth_status (
    harness_kind TEXT PRIMARY KEY,
    doc_json TEXT NOT NULL,
    probe_verdict TEXT,
    probe_at TEXT,
    updated_at_epoch_s INTEGER NOT NULL
);
