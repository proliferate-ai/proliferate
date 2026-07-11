-- Workflow injected-turn provenance (contract §5.2, C10 / E9). Every
-- prompt/command the workflow executor injects into a session is stamped here,
-- so the steps checklist and any queryable "which turns did run X inject" view
-- read from stored truth, never inference. The live/wire provenance rides the
-- session event payload (PromptProvenance::Workflow) — this table is the
-- normalized index written alongside `begin_step`, NOT a read-path join.
--
-- Only prompt-bearing steps (agent.prompt / agent.emit / agent goals) write a
-- row: they produce a session turn. Shell steps do not go through send_prompt
-- and write no row (PROPOSED option B, ruled in the PR-F summary) — so turn_id
-- is NOT NULL and the PK can key on it.
CREATE TABLE workflow_session_injections (
    session_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    step_key TEXT NOT NULL,
    kind TEXT NOT NULL,
    label TEXT NOT NULL,
    injected_text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (session_id, turn_id)
);

CREATE INDEX idx_workflow_injections_run
    ON workflow_session_injections(run_id, step_key);
