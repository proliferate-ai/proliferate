//! T1-WF-RUNTIME-01 fault-injection matrix (WS5b, plan §7.3 / §7.4).
//!
//! Every test name matches the `workflow_fault` filter
//! (`cargo test -p anyharness-lib workflow_fault`) so the traceability command
//! `cargo test -p anyharness-lib workflow_fault_local_effect` and the broader
//! filter both hit the suite.
//!
//! These reconstruct the actor at a persisted crash boundary and assert the
//! recovery matrix's mandated outcome: a `started` effect with no terminal
//! status is the crash boundary; the executor consults the effect ledger for
//! the crashed attempt (`attempt - 1`) and reconciles / replays / stops
//! `outcome_uncertain` per kind — never a blind repeat of a non-idempotent
//! effect. "Restart" is modeled by re-driving the run (the actor is stateless;
//! all truth is in SQLite) — the same way the manager respawns an actor at the
//! persisted cursor.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use anyharness_contract::v1::{WorkflowRunStatus, WorkflowStepStatus};

use super::action::{
    recover_action_handshake, run_action_handshake, ActionIdentity, ActionResult, ActionSubmit,
    ActionWaitPolicy, TestActionSubmitter,
};
use super::effects::{
    self, recover_agent_turn, recover_scm, recover_shell, EffectKind, EffectResult, EffectStatus,
};
use super::engine::{CancelToken, StepExecContext, StepOutcome, WorkflowStepExecutor};
use super::plan::PlanStep;
use super::service::WorkflowService;
use super::store::WorkflowStore;
use crate::app::test_support;
use crate::live::workflows::actor::drive_run;
use crate::persistence::Db;

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn service_with_run(steps: &str) -> (WorkflowService, Db, String) {
    let db = Db::open_in_memory().expect("open db");
    test_support::seed_workspace_with_repo_root(&db, "workspace-1", "local", "/tmp/workspace-1");
    let service = WorkflowService::new(WorkflowStore::new(db.clone()));
    let plan_json = format!(
        r#"{{ "run_id": "run-1",
              "sessions": {{ "s": {{ "harness": "claude", "session_binding": "fresh" }} }},
              "steps": {steps} }}"#
    );
    let (run, created) = service
        .create_run_idempotent(&plan_json, "workspace-1")
        .expect("create run");
    assert!(created);
    (service, db, run.run_id)
}

/// Force a step into the state a crash leaves behind: the step row `running` at
/// `attempt`, with a `started` effect at that same attempt (identity + optional
/// replay key set), and NO applied decision. Re-driving then re-enters the step
/// with `crash_resumed = true`.
#[allow(clippy::too_many_arguments)]
fn inject_started_effect_crash(
    store: &WorkflowStore,
    run_id: &str,
    step_index: i64,
    step_key: &str,
    kind: EffectKind,
    identity: Option<&str>,
    replay_key: Option<&str>,
) {
    store
        .with_tx_anyhow(|tx| {
            let mut step = WorkflowStore::find_step_run_tx(tx, run_id, step_index)?
                .expect("step run exists");
            step.status = WorkflowStepStatus::Running;
            step.attempt = 1;
            step.started_at = Some(now());
            step.updated_at = now();
            WorkflowStore::update_step_run(tx, &step)?;
            effects::insert_started_tx(
                tx, run_id, step_key, 1, 0, kind, identity, replay_key, &now(),
            )?;
            Ok(())
        })
        .expect("inject crash state");
}

fn latest_effect(store: &WorkflowStore, run_id: &str, step_key: &str, attempt: i64, kind: EffectKind) -> Option<effects::WorkflowEffectRecord> {
    store
        .with_tx_anyhow(|tx| Ok(effects::latest_effect_for_attempt_tx(tx, run_id, step_key, attempt, kind)?))
        .unwrap()
}

/// A scripted executor that persists effect ledger rows and applies the WS5b
/// recovery matrix on crash re-entry — the same shape as the live executor's
/// `recover_effect`, exercised deterministically.
struct LedgerExecutor {
    store: WorkflowStore,
    run_id: String,
    kind: EffectKind,
    /// Identity stamped on a FRESH effect row (turn id / pgid / branch).
    fresh_identity: Option<String>,
    /// Replay key stamped on a FRESH shell effect row.
    replay_key: Option<String>,
    /// What a fresh (non-recovered) execution produces.
    fresh_outcome: StepOutcome,
    // --- recovery probes (what the runtime could prove about the crashed op) ---
    agent_durable: Option<EffectResult>,
    shell_pg_alive: bool,
    shell_durable_exit: Option<EffectResult>,
    scm_pr: Option<EffectResult>,
    // --- observability ---
    fresh_runs: Arc<AtomicUsize>,
}

impl LedgerExecutor {
    fn clone_outcome(&self) -> StepOutcome {
        match &self.fresh_outcome {
            StepOutcome::Completed { output } => StepOutcome::Completed { output: output.clone() },
            StepOutcome::Failed { code, message, output } => StepOutcome::Failed {
                code: code.clone(),
                message: message.clone(),
                output: output.clone(),
            },
            other => panic!("unsupported scripted fresh outcome: {other:?}"),
        }
    }
}

#[async_trait::async_trait]
impl WorkflowStepExecutor for LedgerExecutor {
    async fn execute_step(&self, step: &PlanStep, ctx: &StepExecContext) -> StepOutcome {
        let key = step.key.clone();
        if ctx.crash_resumed {
            if let Some(effect) = latest_effect(&self.store, &self.run_id, &key, ctx.attempt - 1, self.kind) {
                let recovery = match self.kind {
                    EffectKind::AgentTurn => recover_agent_turn(&effect, self.agent_durable.clone()),
                    EffectKind::Shell => {
                        recover_shell(&effect, self.shell_pg_alive, self.shell_durable_exit.clone())
                    }
                    EffectKind::Scm => recover_scm(&effect, self.scm_pr.clone()),
                    other => panic!("recovery for {other:?} is tested elsewhere"),
                };
                match recovery {
                    effects::EffectRecovery::Reconcile(result) => return result.into_outcome(),
                    effects::EffectRecovery::Uncertain => {
                        return StepOutcome::OutcomeUncertain {
                            effect: self.kind.as_db().to_string(),
                            detail: None,
                        }
                    }
                    // Replay: fall through to a fresh execution below (safe: idempotent
                    // shell key, or SCM reissue by the identical branch identity).
                    effects::EffectRecovery::Replay => {}
                    effects::EffectRecovery::AwaitProcess => {
                        // Not exercised here (no live process in a deterministic test).
                        return StepOutcome::OutcomeUncertain {
                            effect: self.kind.as_db().to_string(),
                            detail: Some("await_process".to_string()),
                        };
                    }
                }
            }
        }
        // Fresh execution: persist intent BEFORE the (simulated) external action.
        self.fresh_runs.fetch_add(1, Ordering::SeqCst);
        self.store
            .with_tx_anyhow(|tx| {
                effects::insert_started_tx(
                    tx,
                    &self.run_id,
                    &key,
                    ctx.attempt,
                    0,
                    self.kind,
                    self.fresh_identity.as_deref(),
                    self.replay_key.as_deref(),
                    &now(),
                )?;
                Ok(())
            })
            .unwrap();
        let outcome = self.clone_outcome();
        if let Some(result) = EffectResult::from_outcome(&outcome) {
            self.store
                .with_tx_anyhow(|tx| {
                    effects::mark_terminal_tx(
                        tx, &self.run_id, &key, ctx.attempt, 0, self.kind, &result, &now(),
                    )?;
                    Ok(())
                })
                .unwrap();
        }
        outcome
    }
}

fn base_executor(store: WorkflowStore, run_id: &str, kind: EffectKind) -> LedgerExecutor {
    LedgerExecutor {
        store,
        run_id: run_id.to_string(),
        kind,
        fresh_identity: None,
        replay_key: None,
        fresh_outcome: StepOutcome::Completed {
            output: serde_json::json!({ "fresh": true }),
        },
        agent_durable: None,
        shell_pg_alive: false,
        shell_durable_exit: None,
        scm_pr: None,
        fresh_runs: Arc::new(AtomicUsize::new(0)),
    }
}

// --------------------------------------------------------------------------
// Shell effect recovery (plan §7.3 shell row)
// --------------------------------------------------------------------------

#[tokio::test]
async fn workflow_fault_local_effect_shell_started_no_key_is_uncertain() {
    let (service, db, run_id) = service_with_run(
        r#"[{ "key": "0.-.0", "slot": "s", "kind": "shell.run", "command": "deploy.sh" }]"#,
    );
    let store = WorkflowStore::new(db);
    inject_started_effect_crash(&store, &run_id, 0, "0.-.0", EffectKind::Shell, Some("4242"), None);

    let executor = base_executor(store.clone(), &run_id, EffectKind::Shell);
    let fresh_runs = executor.fresh_runs.clone();
    let progress = drive_run(&service, &executor, &run_id, &CancelToken::new()).await;

    assert_eq!(
        progress,
        crate::domains::workflows::engine::EngineProgress::Finished(WorkflowRunStatus::Failed)
    );
    assert_eq!(fresh_runs.load(Ordering::SeqCst), 0, "no idempotent key ⇒ never blindly replayed");
    let run = service.get_run(&run_id).unwrap().unwrap();
    assert_eq!(run.error_code.as_deref(), Some("outcome_uncertain"));
    // The crashed effect row is retained (durable + auditable), not overwritten.
    let effect = latest_effect(&store, &run_id, "0.-.0", 1, EffectKind::Shell).unwrap();
    assert_eq!(effect.status, EffectStatus::Started);
    assert_eq!(effect.external_identity.as_deref(), Some("4242"));
}

#[tokio::test]
async fn workflow_fault_local_effect_shell_with_idempotent_key_replays() {
    let (service, db, run_id) = service_with_run(
        r#"[{ "key": "0.-.0", "slot": "s", "kind": "shell.run",
              "command": "make build", "replay_key": "build-abc" }]"#,
    );
    let store = WorkflowStore::new(db);
    inject_started_effect_crash(
        &store, &run_id, 0, "0.-.0", EffectKind::Shell, Some("4242"), Some("build-abc"),
    );

    let executor = base_executor(store.clone(), &run_id, EffectKind::Shell);
    let fresh_runs = executor.fresh_runs.clone();
    let progress = drive_run(&service, &executor, &run_id, &CancelToken::new()).await;

    assert_eq!(
        progress,
        crate::domains::workflows::engine::EngineProgress::Finished(WorkflowRunStatus::Completed)
    );
    assert_eq!(fresh_runs.load(Ordering::SeqCst), 1, "idempotent key ⇒ safe replay");
    // The replay ran under attempt 2 and completed; the crashed attempt-1 row stays.
    let attempt2 = latest_effect(&store, &run_id, "0.-.0", 2, EffectKind::Shell).unwrap();
    assert_eq!(attempt2.status, EffectStatus::Completed);
    assert!(latest_effect(&store, &run_id, "0.-.0", 1, EffectKind::Shell).is_some());
}

#[tokio::test]
async fn workflow_fault_local_effect_shell_durable_exit_reconciles_without_rerun() {
    let (service, db, run_id) = service_with_run(
        r#"[{ "key": "0.-.0", "slot": "s", "kind": "shell.run", "command": "deploy.sh" }]"#,
    );
    let store = WorkflowStore::new(db);
    inject_started_effect_crash(&store, &run_id, 0, "0.-.0", EffectKind::Shell, Some("4242"), None);

    let mut executor = base_executor(store.clone(), &run_id, EffectKind::Shell);
    // The process left a durable exit-0 result behind: reconcile it, don't re-run.
    executor.shell_durable_exit = Some(EffectResult::Completed {
        output: serde_json::json!({ "exit_code": 0 }),
    });
    let fresh_runs = executor.fresh_runs.clone();
    let progress = drive_run(&service, &executor, &run_id, &CancelToken::new()).await;

    assert_eq!(
        progress,
        crate::domains::workflows::engine::EngineProgress::Finished(WorkflowRunStatus::Completed)
    );
    assert_eq!(fresh_runs.load(Ordering::SeqCst), 0, "durable exit ⇒ reconcile, never re-run");
}

// --------------------------------------------------------------------------
// Agent-turn recovery (plan §7.3 agent turn row)
// --------------------------------------------------------------------------

#[tokio::test]
async fn workflow_fault_local_effect_agent_turn_unprovable_is_uncertain_never_reprompt() {
    let (service, db, run_id) = service_with_run(
        r#"[{ "key": "0.-.0", "slot": "s", "kind": "agent.prompt", "prompt": "do it" }]"#,
    );
    let store = WorkflowStore::new(db);
    inject_started_effect_crash(&store, &run_id, 0, "0.-.0", EffectKind::AgentTurn, Some("turn-1"), None);

    // agent_durable = None: the harness cannot prove the turn's terminal state.
    let executor = base_executor(store.clone(), &run_id, EffectKind::AgentTurn);
    let fresh_runs = executor.fresh_runs.clone();
    let progress = drive_run(&service, &executor, &run_id, &CancelToken::new()).await;

    assert_eq!(
        progress,
        crate::domains::workflows::engine::EngineProgress::Finished(WorkflowRunStatus::Failed)
    );
    assert_eq!(fresh_runs.load(Ordering::SeqCst), 0, "never auto re-prompt an unprovable turn");
    let run = service.get_run(&run_id).unwrap().unwrap();
    assert_eq!(run.error_code.as_deref(), Some("outcome_uncertain"));
}

#[tokio::test]
async fn workflow_fault_local_effect_agent_turn_durable_transcript_reconciles() {
    let (service, db, run_id) = service_with_run(
        r#"[{ "key": "0.-.0", "slot": "s", "kind": "agent.prompt", "prompt": "do it" }]"#,
    );
    let store = WorkflowStore::new(db);
    inject_started_effect_crash(&store, &run_id, 0, "0.-.0", EffectKind::AgentTurn, Some("turn-1"), None);

    let mut executor = base_executor(store.clone(), &run_id, EffectKind::AgentTurn);
    executor.agent_durable = Some(EffectResult::Completed {
        output: serde_json::json!({ "turn_id": "turn-1" }),
    });
    let fresh_runs = executor.fresh_runs.clone();
    let progress = drive_run(&service, &executor, &run_id, &CancelToken::new()).await;

    assert_eq!(
        progress,
        crate::domains::workflows::engine::EngineProgress::Finished(WorkflowRunStatus::Completed)
    );
    assert_eq!(fresh_runs.load(Ordering::SeqCst), 0, "durable transcript ⇒ reconcile, no re-prompt");
}

// --------------------------------------------------------------------------
// SCM recovery (plan §7.3 scm row): reissue only with the identical identity
// --------------------------------------------------------------------------

#[tokio::test]
async fn workflow_fault_local_effect_scm_started_reissues_with_identical_identity() {
    let (service, db, run_id) = service_with_run(
        r#"[{ "key": "0.-.0", "slot": "s", "kind": "scm.open_pr", "title": "Fix" }]"#,
    );
    let store = WorkflowStore::new(db);
    // Crashed mid-open with the branch identity persisted.
    inject_started_effect_crash(
        &store, &run_id, 0, "0.-.0", EffectKind::Scm, Some("workflow-run/run-1/-"), None,
    );

    let mut executor = base_executor(store.clone(), &run_id, EffectKind::Scm);
    // The reissue re-runs under the SAME branch identity.
    executor.fresh_identity = Some("workflow-run/run-1/-".to_string());
    executor.fresh_outcome = StepOutcome::Completed {
        output: serde_json::json!({ "pr_url": "https://x/pull/1" }),
    };
    let fresh_runs = executor.fresh_runs.clone();
    let progress = drive_run(&service, &executor, &run_id, &CancelToken::new()).await;

    assert_eq!(
        progress,
        crate::domains::workflows::engine::EngineProgress::Finished(WorkflowRunStatus::Completed)
    );
    assert_eq!(fresh_runs.load(Ordering::SeqCst), 1, "no PR found ⇒ reissue");
    let reissued = latest_effect(&store, &run_id, "0.-.0", 2, EffectKind::Scm).unwrap();
    assert_eq!(
        reissued.external_identity.as_deref(),
        Some("workflow-run/run-1/-"),
        "reissue uses the identical branch identity, never a new one"
    );
}

#[tokio::test]
async fn workflow_fault_local_effect_scm_found_pr_reconciles_without_reissue() {
    let (service, db, run_id) = service_with_run(
        r#"[{ "key": "0.-.0", "slot": "s", "kind": "scm.open_pr", "title": "Fix" }]"#,
    );
    let store = WorkflowStore::new(db);
    inject_started_effect_crash(
        &store, &run_id, 0, "0.-.0", EffectKind::Scm, Some("workflow-run/run-1/-"), None,
    );

    let mut executor = base_executor(store.clone(), &run_id, EffectKind::Scm);
    // gh pr view --head <branch> found the PR: reconcile, do not reissue.
    executor.scm_pr = Some(EffectResult::Completed {
        output: serde_json::json!({ "pr_url": "https://x/pull/1" }),
    });
    let fresh_runs = executor.fresh_runs.clone();
    let progress = drive_run(&service, &executor, &run_id, &CancelToken::new()).await;

    assert_eq!(
        progress,
        crate::domains::workflows::engine::EngineProgress::Finished(WorkflowRunStatus::Completed)
    );
    assert_eq!(fresh_runs.load(Ordering::SeqCst), 0, "PR found ⇒ reconcile, no second push");
}

// --------------------------------------------------------------------------
// Action handshake recovery (§7.4)
// --------------------------------------------------------------------------

#[tokio::test]
async fn workflow_fault_local_effect_action_result_lost_recovers_by_identity() {
    // The action was submitted and recorded server-side, but the response was
    // lost before the runtime persisted its receipt. Recovery uses the SAME
    // persisted action identity and must NOT submit a second action.
    let submitter = TestActionSubmitter::new(
        "act-77",
        vec![Some(ActionResult::Delivered {
            receipt: serde_json::json!({ "channel_id": "C1", "ts": "1.2" }),
        })],
    );
    let identity = ActionIdentity {
        action_id: "act-77".to_string(),
    };
    let policy = ActionWaitPolicy {
        max_polls: 5,
        poll_interval: std::time::Duration::ZERO,
    };
    let result = recover_action_handshake(&submitter, &identity, policy)
        .await
        .unwrap();
    assert!(matches!(result, ActionResult::Delivered { .. }));
    assert_eq!(submitter.submits(), 0, "lost-response recovery never re-submits");
}

#[tokio::test]
async fn workflow_fault_local_effect_action_submitted_but_result_pending_then_delivers() {
    // Fresh submit, then the runtime waits (result pending) and finally advances
    // only on the authoritative receipt — one submit total.
    let submitter = TestActionSubmitter::new(
        "act-9",
        vec![None, Some(ActionResult::Delivered {
            receipt: serde_json::json!({ "ts": "3.3" }),
        })],
    );
    let submit = ActionSubmit {
        run_id: "run-1".to_string(),
        step_key: "0.-.0".to_string(),
        attempt: 1,
        payload: serde_json::json!({ "message": "hi" }),
    };
    let policy = ActionWaitPolicy {
        max_polls: 5,
        poll_interval: std::time::Duration::ZERO,
    };
    let (identity, result) = run_action_handshake(&submitter, &submit, policy, |_| {})
        .await
        .unwrap();
    assert_eq!(identity.action_id, "act-9");
    assert!(matches!(result, ActionResult::Delivered { .. }));
    assert_eq!(submitter.submits(), 1);
}

// --------------------------------------------------------------------------
// Ledger durability + idempotency
// --------------------------------------------------------------------------

#[tokio::test]
async fn workflow_fault_local_effect_duplicate_wake_does_not_duplicate_completed_effect() {
    let (_service, db, run_id) = service_with_run(
        r#"[{ "key": "0.-.0", "slot": "s", "kind": "shell.run", "command": "x" }]"#,
    );
    let store = WorkflowStore::new(db);
    let result = EffectResult::Completed { output: serde_json::json!({ "exit_code": 0 }) };
    store
        .with_tx_anyhow(|tx| {
            effects::insert_started_tx(tx, &run_id, "0.-.0", 1, 0, EffectKind::Shell, Some("42"), None, &now())?;
            effects::mark_terminal_tx(tx, &run_id, "0.-.0", 1, 0, EffectKind::Shell, &result, &now())?;
            // A duplicate actor wake re-persists the intent: INSERT OR IGNORE keeps
            // the COMPLETED row, never resurrecting it as `started`.
            effects::insert_started_tx(tx, &run_id, "0.-.0", 1, 0, EffectKind::Shell, Some("42"), None, &now())?;
            Ok(())
        })
        .unwrap();

    let all = store
        .with_tx_anyhow(|tx| Ok(effects::list_effects_tx(tx, &run_id)?))
        .unwrap();
    assert_eq!(all.len(), 1, "duplicate wake produces no second row");
    assert_eq!(all[0].status, EffectStatus::Completed);
}

#[tokio::test]
async fn workflow_fault_local_effect_emit_corrective_attempts_durable_across_restart() {
    // agent.emit's corrective loop sends several turns within ONE step attempt;
    // each is recorded at an incrementing effect_seq. They survive a "restart"
    // (a fresh service over the same durable Db).
    let (_service, db, run_id) = service_with_run(
        r#"[{ "key": "0.-.0", "slot": "s", "kind": "agent.emit", "prompt": "emit", "max_attempts": 3 }]"#,
    );
    let store = WorkflowStore::new(db.clone());
    store
        .with_tx_anyhow(|tx| {
            for seq in 0..3 {
                effects::insert_started_tx(
                    tx, &run_id, "0.-.0", 1, seq, EffectKind::AgentTurn,
                    Some(&format!("turn-{seq}")), None, &now(),
                )?;
                let result = EffectResult::Failed {
                    code: "emit_invalid".to_string(),
                    message: None,
                    output: None,
                };
                if seq < 2 {
                    effects::mark_terminal_tx(tx, &run_id, "0.-.0", 1, seq, EffectKind::AgentTurn, &result, &now())?;
                }
            }
            Ok(())
        })
        .unwrap();

    // "Restart": a brand-new store over the SAME durable database.
    let restarted = WorkflowStore::new(db);
    let all = restarted
        .with_tx_anyhow(|tx| Ok(effects::list_effects_tx(tx, &run_id)?))
        .unwrap();
    assert_eq!(all.len(), 3, "every corrective turn is durable across restart");
    assert_eq!(all[0].effect_seq, 0);
    assert_eq!(all[2].effect_seq, 2);
    assert_eq!(all[2].external_identity.as_deref(), Some("turn-2"));
}
