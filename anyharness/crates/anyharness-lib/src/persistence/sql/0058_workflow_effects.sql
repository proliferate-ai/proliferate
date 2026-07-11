-- Per-effect durable ledger (WS5b, feature spec §6.5 attempts/effects/crash
-- recovery, plan §7.3 recovery matrix, §7.4 deterministic action handshake).
--
-- "Before an externally meaningful action, the runtime persists a stable
-- attempt and effect identity derived from at least (run_id, step_key,
-- attempt)." This table IS that record: one row per externally meaningful
-- effect a step attempt performs. It is what turns a crash into a *reconcilable*
-- boundary instead of a blind repeat of a non-idempotent effect.
--
-- Keys:
--  * `attempt` is the step attempt the effect ran under (the same attempt the
--    step-run row records). A crash bumps the step attempt on re-entry, so the
--    crashed effect lives at `attempt - 1` — the recovery hook reads it there.
--  * `effect_seq` disambiguates the sequence of effects within ONE step attempt.
--    Single-effect kinds (shell/scm/action/one prompt) use seq 0; a multi-turn
--    step (`agent.emit`'s corrective loop, a required-invocation gate loop)
--    records each turn at an incrementing seq, so every corrective attempt is
--    durable.
--
-- `effect_kind` is the effect's replay class (spec §6.5 "every effect defines
-- one replay policy"):
--   agent_turn | shell | scm | action | gateway
--
-- `external_identity` is the effect's durable external handle, persisted so a
-- crash-recovered runtime reconciles the SAME operation rather than repeating
-- it (spec §6.5 "reconcile by a durable external identifier"):
--   agent_turn -> the harness turn id
--   shell      -> the spawned process-group handle (child pid)
--   scm        -> the branch (+ PR) identity
--   action     -> the server-assigned action id (§7.4)
--   gateway    -> the non-agent-controlled activation id (WS5c/WS3c populate it)
-- It is NULL between the intent write and the moment the external op yields its
-- identity (e.g. a shell row is inserted `started` with NULL identity, then the
-- pgid is stamped once the child is spawned — the intent is durable even if the
-- crash lands in that window).
--
-- `status` is the effect lifecycle, DISTINCT from the step status:
--   started            -> intent persisted; the external op may or may not have run
--   completed          -> the op reached a durable terminal result (result_json set)
--   failed             -> the op reached a durable terminal FAILURE (result_json set)
--   outcome_uncertain  -> a crash left the outcome unprovable; NEVER auto-replayed
-- A `started` row with no terminal status IS the crash boundary the recovery
-- matrix reconciles.
--
-- `result_json` is the effect's terminal essentials (the serialized StepOutcome
-- the effect produced) so a reconcile reproduces exactly what the step would
-- have returned — never a second external effect.
--
-- `replay_key` is the OPTIONAL author-declared idempotent replay key (shell
-- only, spec §7.3 shell row): its presence lets an unprovable shell effect be
-- safely replayed instead of stopping `outcome_uncertain`. NULL = not idempotent.
--
-- No credential ever enters this table (spec §5.3): identities are non-secret
-- handles and results are non-secret terminal summaries.
CREATE TABLE workflow_effects (
    run_id TEXT NOT NULL REFERENCES workflow_runs(run_id) ON DELETE CASCADE,
    step_key TEXT NOT NULL,
    attempt INTEGER NOT NULL,
    effect_seq INTEGER NOT NULL DEFAULT 0,
    effect_kind TEXT NOT NULL,
    external_identity TEXT,
    status TEXT NOT NULL,
    result_json TEXT,
    replay_key TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (run_id, step_key, attempt, effect_seq, effect_kind)
);

-- Recovery's hot query: the effects for a run/step at a given attempt (the
-- crashed attempt), ordered by seq — the highest-seq row is the last effect the
-- crashed attempt reached.
CREATE INDEX idx_workflow_effects_step_attempt
    ON workflow_effects(run_id, step_key, attempt, effect_seq);
