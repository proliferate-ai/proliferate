-- Workflows gen-2 (Workflows ADR): the gen-1 one-prompt execution vertical is
-- superseded whole, and the beta shipped flag-off with no seeded data, so the
-- ruled migration is drop-and-recreate under the same table names. Tables
-- recreate empty on next boot either way.
DROP TABLE IF EXISTS workflow_run_steps;
DROP TABLE IF EXISTS workflow_runs;
DROP TABLE IF EXISTS workflow_workspace_materializations;

CREATE TABLE workflow_runs (
    id                  TEXT PRIMARY KEY,            -- minted by the courier; PUT is idempotent on it
    invocation_id       TEXT NOT NULL,
    definition_json     TEXT NOT NULL,               -- verbatim snapshot, IMMUTABLE after insert
    arguments_json      TEXT NOT NULL,
    workspace_id        TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    status              TEXT NOT NULL CHECK (status IN ('running','awaiting_human','interrupted','completed','failed')),
    current_node_row_id TEXT,
    failure_code        TEXT CHECK (failure_code IS NULL OR failure_code IN ('node_launch_failed','turn_error','refusal','empty_turn','harness_cap','superseded')),
    interruption_code   TEXT CHECK (interruption_code IS NULL OR interruption_code IN ('user_cancel','app_shutdown','runtime_restarted')),
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    completed_at        TEXT,
    CHECK ((status = 'failed') = (failure_code IS NOT NULL))
);

CREATE INDEX idx_workflow_runs_workspace_id ON workflow_runs(workspace_id);

CREATE TABLE workflow_run_nodes (
    id                    TEXT PRIMARY KEY,          -- the node row id, the API-addressable identity
    run_id                TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
    definition_node_id    TEXT,                      -- null for adhoc; replacements inherit it
    kind                  TEXT NOT NULL CHECK (kind IN ('defined','replacement','adhoc')),
    node_type             TEXT NOT NULL CHECK (node_type IN ('agent','human_in_loop')),  -- MUTABLE, type flips land here
    replaces_node_row_id  TEXT,
    anchor_node_row_id    TEXT,                      -- adhoc: where it hangs off the chain
    chain_index           INTEGER,                   -- position on the linear chain; adhoc copies its anchor's
    title                 TEXT NOT NULL,
    prompt                TEXT NOT NULL,
    status                TEXT NOT NULL CHECK (status IN ('pending','running','needs_attention','awaiting_human','completed','failed')),
    session_id            TEXT,
    prompt_id             TEXT,                      -- the envelope prompt's id (provenance; the extension reports every turn end of a linked session)
    rendered_envelope     TEXT,                      -- JSON {instructionBlocks, firstMessage, systemPromptAppend}
    failure_code          TEXT CHECK (failure_code IS NULL OR failure_code IN ('node_launch_failed','turn_error','refusal','empty_turn','harness_cap','superseded')),
    first_turn_finished_at TEXT,                     -- first turn end of the CURRENT execution; bounds UndoAdvance
    created_at            TEXT NOT NULL,
    started_at            TEXT,
    completed_at          TEXT,
    CHECK ((status = 'failed') = (failure_code IS NOT NULL))
);

CREATE INDEX idx_workflow_run_nodes_run_id ON workflow_run_nodes(run_id);

CREATE TABLE workflow_run_docs (
    id                    TEXT PRIMARY KEY,
    run_id                TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
    slug                  TEXT NOT NULL,
    filename              TEXT NOT NULL,             -- NN-slug.md; NN derived from the producing node's chain_index
    producing_node_row_id TEXT,
    seeded_from_template  INTEGER NOT NULL,
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL,
    UNIQUE (run_id, slug),
    -- The filename law is not injective over slugs alone (seeded "00-plan.md"
    -- from slug "plan" collides with a registered slug "00-plan"); two rows
    -- must never claim one file.
    UNIQUE (run_id, filename)
);

CREATE INDEX idx_workflow_run_docs_run_id ON workflow_run_docs(run_id);

-- Sessions carry a loose, nullable link into the graph: the session stack does
-- not know workflows exist beyond these two columns.
ALTER TABLE sessions ADD COLUMN workflow_run_id TEXT;
ALTER TABLE sessions ADD COLUMN workflow_node_row_id TEXT;
CREATE INDEX idx_sessions_workflow_run_id ON sessions(workflow_run_id) WHERE workflow_run_id IS NOT NULL;
