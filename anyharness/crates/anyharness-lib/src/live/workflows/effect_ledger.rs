//! Executor-side effect ledger persistence + crash recovery (WS5b, feature
//! spec §6.5 / plan §7.3 / §7.4). The domain owns the ledger SQL and the pure
//! recovery matrix ([`crate::domains::workflows::effects`]); this file is the
//! thin live glue: persist an effect's intent BEFORE its external action, mark
//! its terminal result after, and consult the ledger on crash re-entry.
//!
//! The executor WRAPS each single-body effect step as one seq-0 effect: the row
//! is `started` for the whole body, so a crash mid-body (mid-turn, mid-shell,
//! mid-gate-loop) leaves `started` ⇒ the recovery matrix stops
//! `outcome_uncertain`; a crash AFTER the body completed but before the step
//! decision persisted leaves `completed` ⇒ reconcile the stored result without
//! re-running. `agent.emit` records each corrective turn itself (for durable
//! audit of the loop) and recovers as uncertain — a partial emit loop is never
//! auto-re-prompted or reconciled from an intermediate turn.

use serde_json::json;

use crate::domains::workflows::action::{
    run_action_handshake, ActionSubmit, ActionWaitPolicy, LegacyInlineActionSubmitter,
};
use crate::domains::workflows::effects::{
    self, EffectKind, EffectRecovery, EffectResult,
};
use crate::domains::workflows::engine::{StepExecContext, StepOutcome};
use crate::domains::workflows::plan::PlanStep;
use crate::domains::workflows::store::WorkflowStore;

use super::executor::WorkflowStepExecutorImpl;

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

impl WorkflowStepExecutorImpl {
    fn effect_store(&self) -> &WorkflowStore {
        self.deps.workflow_service.store()
    }

    /// Persist an effect's INTENT before its external action begins (spec §6.5).
    /// Best-effort: a ledger write must never itself fail the step (the durable
    /// step-run row is the run's backbone; the effect row is the recovery aid).
    pub(super) fn begin_effect(
        &self,
        step_key: &str,
        attempt: i64,
        seq: i64,
        kind: EffectKind,
        identity: Option<&str>,
        replay_key: Option<&str>,
    ) {
        let _ = self.effect_store().with_tx_anyhow(|tx| {
            effects::insert_started_tx(
                tx, &self.run_id, step_key, attempt, seq, kind, identity, replay_key, &now(),
            )?;
            Ok(())
        });
    }

    /// Record an effect's terminal result (the exact [`StepOutcome`] it produced,
    /// so a reconcile reproduces it — never a second external effect).
    pub(super) fn finish_effect(
        &self,
        step_key: &str,
        attempt: i64,
        seq: i64,
        kind: EffectKind,
        outcome: &StepOutcome,
    ) {
        if let Some(result) = EffectResult::from_outcome(outcome) {
            let _ = self.effect_store().with_tx_anyhow(|tx| {
                effects::mark_terminal_tx(
                    tx, &self.run_id, step_key, attempt, seq, kind, &result, &now(),
                )?;
                Ok(())
            });
        }
    }

    /// The crash-recovery gate at step re-entry (plan §7.3). Returns `Some` to
    /// short-circuit the step (reconcile a durable result / stop
    /// `outcome_uncertain`); `None` to proceed with a fresh execution (a safe
    /// replay, or no prior effect at all). Only consulted when the step was left
    /// `running` by a crash (`ctx.crash_resumed`), reading the crashed attempt's
    /// effect at `attempt - 1`.
    pub(super) fn recover_effect(
        &self,
        step: &PlanStep,
        ctx: &StepExecContext,
    ) -> Option<StepOutcome> {
        if !ctx.crash_resumed {
            return None;
        }
        let kind = EffectKind::for_step_slug(step.kind_slug())?;
        let effect = self
            .effect_store()
            .with_tx_anyhow(|tx| {
                Ok(effects::latest_effect_for_attempt_tx(
                    tx,
                    &self.run_id,
                    &step.key,
                    ctx.attempt - 1,
                    kind,
                )?)
            })
            .ok()
            .flatten()?;
        // A partial `agent.emit` loop is never auto-re-prompted nor reconciled
        // from an intermediate corrective turn — an interrupted emit is
        // uncertain (spec §7.3 agent-turn row: never auto re-prompt).
        if step.kind_slug() == "agent.emit" {
            return Some(StepOutcome::OutcomeUncertain {
                effect: EffectKind::AgentTurn.as_db().to_string(),
                detail: Some("agent.emit was interrupted; the loop cannot be safely resumed".to_string()),
            });
        }
        let recovery = match kind {
            // The current harness API cannot reattach to a persisted turn id, so
            // an in-flight turn is unprovable (honest `None` probe): a durable
            // terminal effect reconciles, a `started` turn is uncertain — never
            // an automatic replacement prompt.
            EffectKind::AgentTurn => effects::recover_agent_turn(&effect, None),
            // No process-group liveness probe exists in this runtime (no runner
            // reattaches today): a durable exit reconciles, an idempotent replay
            // key replays, otherwise `outcome_uncertain`.
            EffectKind::Shell => effects::recover_shell(&effect, false, None),
            // Reissue by the identical branch identity when no durable PR result
            // is stored (a real `gh pr view --head <branch>` reconcile is a
            // later enrichment; the branch identity keeps a reissue single).
            EffectKind::Scm => effects::recover_scm(&effect, None),
            // The v1 legacy action submitter is in-memory (no durable server
            // record to poll on restart): a durable terminal effect reconciles,
            // else uncertain. WS4c's durable submitter recovers by polling the
            // action identity.
            EffectKind::Action | EffectKind::Gateway => {
                effects::recover_gateway(&effect, None)
            }
        };
        match recovery {
            EffectRecovery::Reconcile(result) => Some(result.into_outcome()),
            EffectRecovery::Uncertain => Some(StepOutcome::OutcomeUncertain {
                effect: kind.as_db().to_string(),
                detail: None,
            }),
            // A safe replay (idempotent shell key / SCM reissue) or an
            // unreattachable live process both proceed with a fresh execution.
            EffectRecovery::Replay | EffectRecovery::AwaitProcess => None,
        }
    }

    /// The §7.4 deterministic action handshake for a `notify` step, driven
    /// through the v1 [`LegacyInlineActionSubmitter`] (WS4c swaps in the real
    /// control-API + outbox submitter). The runtime persists the action effect,
    /// submits the stable identity, stamps the returned action id onto the
    /// ledger (so a lost response recovers by identity, never a second action),
    /// and advances only on the authoritative result. The legacy adapter
    /// delivers inline, so the output is byte-identical to the pre-WS5b
    /// `notify_step` (`{channel, message, slack_channel_id}`).
    pub(super) async fn run_notify_action(
        &self,
        step_key: &str,
        attempt: i64,
        message: &str,
        slack_channel_id: &str,
    ) -> StepOutcome {
        self.begin_effect(step_key, attempt, 0, EffectKind::Action, None, None);
        let submitter = LegacyInlineActionSubmitter::new();
        let submit = ActionSubmit {
            run_id: self.run_id.clone(),
            step_key: step_key.to_string(),
            attempt,
            payload: json!({
                "channel": "slack",
                "message": message,
                "slack_channel_id": slack_channel_id,
            }),
        };
        let store = self.effect_store().clone();
        let run_id = self.run_id.clone();
        let stamp_key = step_key.to_string();
        let result = run_action_handshake(
            &submitter,
            &submit,
            ActionWaitPolicy::default(),
            |identity| {
                let _ = store.with_tx_anyhow(|tx| {
                    effects::set_identity_tx(
                        tx,
                        &run_id,
                        &stamp_key,
                        attempt,
                        0,
                        EffectKind::Action,
                        &identity.action_id,
                        &now(),
                    )?;
                    Ok(())
                });
            },
        )
        .await;
        let outcome = match result {
            Ok((_identity, action_result)) => action_result.into_outcome(),
            Err(error) => StepOutcome::Failed {
                code: "action_submit_failed".to_string(),
                message: Some(error.to_string()),
                output: None,
            },
        };
        self.finish_effect(step_key, attempt, 0, EffectKind::Action, &outcome);
        outcome
    }

    /// Record one `agent.emit` corrective turn effect (seq = the loop index) for
    /// durable audit of the bounded correction budget (WS5b). Each turn is its
    /// own agent_turn effect; the emit step's crash recovery is uncertain
    /// (handled in [`Self::recover_effect`]).
    pub(super) fn record_emit_turn(
        &self,
        step_key: &str,
        attempt: i64,
        seq: i64,
        turn_id: Option<&str>,
        outcome: &StepOutcome,
    ) {
        self.begin_effect(step_key, attempt, seq, EffectKind::AgentTurn, turn_id, None);
        self.finish_effect(step_key, attempt, seq, EffectKind::AgentTurn, outcome);
    }
}
