use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyharness_contract::v1::{WorkflowRunStatus, WorkflowStepStatus};

use super::engine::{
    CancelToken, EngineProgress, StepExecContext, StepOutcome, WorkflowStepExecutor,
};
use super::model::{LaneStatus, WorkflowLaneCursorRecord};
use super::plan::{PlanStep, StepKind};
use super::service::{lane_visible_outputs, ApprovalInput, WorkflowService};
use super::store::WorkflowStore;
use crate::app::test_support;
use crate::live::workflows::actor::drive_run;
use crate::persistence::Db;

// --------------------------------------------------------------------------
// Test harness: an in-memory service + a scripted fake executor (the house
// "fake things at the service layer" pattern — mirrors goals/service_tests).
// --------------------------------------------------------------------------

fn test_service() -> WorkflowService {
    let db = Db::open_in_memory().expect("open db");
    test_support::seed_workspace_with_repo_root(&db, "workspace-1", "local", "/tmp/workspace-1");
    WorkflowService::new(WorkflowStore::new(db))
}

#[derive(Debug, Clone)]
struct CallRecord {
    attempt: i64,
    text: Option<String>,
}

struct FakeExecutor {
    outcomes: Mutex<VecDeque<StepOutcome>>,
    calls: Mutex<Vec<CallRecord>>,
}

impl FakeExecutor {
    fn script(outcomes: Vec<StepOutcome>) -> Self {
        Self {
            outcomes: Mutex::new(outcomes.into_iter().collect()),
            calls: Mutex::new(Vec::new()),
        }
    }

    fn calls(&self) -> Vec<CallRecord> {
        self.calls.lock().unwrap().clone()
    }
}

#[async_trait::async_trait]
impl WorkflowStepExecutor for FakeExecutor {
    async fn execute_step(&self, step: &PlanStep, ctx: &StepExecContext) -> StepOutcome {
        let text = match &step.kind {
            StepKind::AgentPrompt(agent) => Some(agent.prompt.clone()),
            StepKind::ShellRun(shell) => Some(shell.command.clone()),
            StepKind::Notify(notify) => Some(notify.message.clone()),
            _ => None,
        };
        self.calls.lock().unwrap().push(CallRecord {
            attempt: ctx.attempt,
            text,
        });
        self.outcomes
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or(StepOutcome::Completed {
                output: serde_json::json!({}),
            })
    }
}

fn completed(output: serde_json::Value) -> StepOutcome {
    StepOutcome::Completed { output }
}

fn failed(code: &str) -> StepOutcome {
    StepOutcome::Failed {
        code: code.to_string(),
        message: None,
        output: Some(serde_json::json!({ "exit_code": 1 })),
    }
}

fn end_run(output: serde_json::Value) -> StepOutcome {
    StepOutcome::EndRun { output }
}

/// Drive the run to a resting point (terminal or suspended), exactly like the
/// actor loop.
async fn drive(
    service: &WorkflowService,
    run_id: &str,
    executor: &FakeExecutor,
) -> EngineProgress {
    let cancel = CancelToken::new();
    loop {
        let progress = service
            .run_next_step(run_id, executor, &cancel)
            .await
            .expect("run next step");
        match progress {
            EngineProgress::Advanced => continue,
            other => return other,
        }
    }
}

fn plan_json(steps: &str) -> String {
    // v2 shape: a per-slot `sessions` map (replaces `setup`). These engine tests
    // pass keyless steps; the service seeds synthetic flat keys for them.
    format!(
        r#"{{
            "run_id": "run-1",
            "plan_version": 1,
            "sessions": {{ "main": {{ "harness": "claude", "session_binding": "fresh" }} }},
            "steps": {steps}
        }}"#
    )
}

fn create(service: &WorkflowService, steps: &str) -> String {
    let (run, created) = service
        .create_run_idempotent(&plan_json(steps), "workspace-1")
        .expect("create run");
    assert!(created);
    run.run_id
}

// --------------------------------------------------------------------------
// Creation + idempotency
// --------------------------------------------------------------------------

#[test]
fn create_run_is_idempotent_on_run_id() {
    let service = test_service();
    let steps = r#"[{ "kind": "agent.prompt", "prompt": "hi" }]"#;
    let (first, created_first) = service
        .create_run_idempotent(&plan_json(steps), "workspace-1")
        .expect("create");
    assert!(created_first);
    assert_eq!(first.status, WorkflowRunStatus::Running);
    let (again, created_again) = service
        .create_run_idempotent(&plan_json(steps), "workspace-1")
        .expect("re-create");
    assert!(!created_again);
    assert_eq!(again.run_id, first.run_id);

    let (_, steps_rows) = service
        .get_run_with_steps("run-1")
        .expect("load")
        .expect("run exists");
    assert_eq!(steps_rows.len(), 1);
    assert_eq!(steps_rows[0].status, WorkflowStepStatus::Pending);
    assert_eq!(steps_rows[0].kind, "agent.prompt");
}

#[test]
fn create_rejects_an_invalid_plan() {
    let service = test_service();
    let error = service
        .create_run_idempotent(
            &plan_json(r#"[{ "kind": "tool.call" }]"#),
            "workspace-1",
        )
        .expect_err("unknown kind rejected");
    assert!(matches!(
        error,
        super::service::WorkflowServiceError::InvalidPlan(_)
    ));
}

// --------------------------------------------------------------------------
// Happy path + cursor advance
// --------------------------------------------------------------------------

#[tokio::test]
async fn drives_two_steps_to_completion() {
    let service = test_service();
    let run_id = create(
        &service,
        r#"[{ "kind": "agent.prompt", "prompt": "a" }, { "kind": "shell.run", "command": "b" }]"#,
    );
    let executor = FakeExecutor::script(vec![
        completed(serde_json::json!({ "turnId": "t1" })),
        completed(serde_json::json!({ "exit_code": 0 })),
    ]);
    let progress = drive(&service, &run_id, &executor).await;
    assert_eq!(progress, EngineProgress::Finished(WorkflowRunStatus::Completed));

    let (run, steps) = service.get_run_with_steps(&run_id).unwrap().unwrap();
    assert_eq!(run.status, WorkflowRunStatus::Completed);
    assert_eq!(run.step_cursor, 2);
    assert!(steps.iter().all(|s| s.status == WorkflowStepStatus::Completed));
    assert_eq!(steps[0].attempt, 1);
}

#[tokio::test]
async fn late_binds_a_prior_step_output_into_a_prompt() {
    let service = test_service();
    let run_id = create(
        &service,
        r#"[{ "kind": "shell.run", "command": "make url" },
            { "kind": "agent.prompt", "prompt": "use {{steps[0].output.pr_url}}" }]"#,
    );
    let executor = FakeExecutor::script(vec![
        completed(serde_json::json!({ "pr_url": "https://x/1" })),
        completed(serde_json::json!({})),
    ]);
    drive(&service, &run_id, &executor).await;
    let calls = executor.calls();
    assert_eq!(calls[1].text.as_deref(), Some("use https://x/1"));
}

// --------------------------------------------------------------------------
// on_fail matrix
// --------------------------------------------------------------------------

#[tokio::test]
async fn on_fail_stop_fails_the_run() {
    let service = test_service();
    let run_id = create(
        &service,
        r#"[{ "kind": "shell.run", "command": "x", "on_fail": { "kind": "stop" } },
            { "kind": "shell.run", "command": "y" }]"#,
    );
    let executor = FakeExecutor::script(vec![failed("nonzero_exit")]);
    let progress = drive(&service, &run_id, &executor).await;
    assert_eq!(progress, EngineProgress::Finished(WorkflowRunStatus::Failed));
    let (run, steps) = service.get_run_with_steps(&run_id).unwrap().unwrap();
    assert_eq!(run.error_code.as_deref(), Some("nonzero_exit"));
    assert_eq!(steps[0].status, WorkflowStepStatus::Failed);
    // second step never ran
    assert_eq!(steps[1].status, WorkflowStepStatus::Pending);
    assert_eq!(executor.calls().len(), 1);
}

#[tokio::test]
async fn on_fail_continue_advances_past_failure() {
    let service = test_service();
    let run_id = create(
        &service,
        r#"[{ "kind": "shell.run", "command": "x", "on_fail": { "kind": "continue" } },
            { "kind": "shell.run", "command": "y" }]"#,
    );
    let executor = FakeExecutor::script(vec![failed("nonzero_exit"), completed(serde_json::json!({}))]);
    let progress = drive(&service, &run_id, &executor).await;
    assert_eq!(progress, EngineProgress::Finished(WorkflowRunStatus::Completed));
    let (_, steps) = service.get_run_with_steps(&run_id).unwrap().unwrap();
    assert_eq!(steps[0].status, WorkflowStepStatus::Failed);
    assert_eq!(steps[1].status, WorkflowStepStatus::Completed);
    // failed-but-continued output is still available for late-binding
    assert_eq!(steps[0].output_value().unwrap()["exit_code"], 1);
}

#[tokio::test]
async fn on_fail_retry_retries_then_fails_when_exhausted() {
    let service = test_service();
    let run_id = create(
        &service,
        r#"[{ "kind": "shell.run", "command": "x", "on_fail": { "kind": "retry", "n": 1 } }]"#,
    );
    let executor = FakeExecutor::script(vec![failed("nonzero_exit"), failed("nonzero_exit")]);
    let progress = drive(&service, &run_id, &executor).await;
    assert_eq!(progress, EngineProgress::Finished(WorkflowRunStatus::Failed));
    let calls = executor.calls();
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0].attempt, 1);
    assert_eq!(calls[1].attempt, 2);
}

#[tokio::test]
async fn on_fail_retry_succeeds_on_second_attempt() {
    let service = test_service();
    let run_id = create(
        &service,
        r#"[{ "kind": "shell.run", "command": "x", "on_fail": { "kind": "retry", "n": 2 } }]"#,
    );
    let executor = FakeExecutor::script(vec![failed("nonzero_exit"), completed(serde_json::json!({ "ok": true }))]);
    let progress = drive(&service, &run_id, &executor).await;
    assert_eq!(progress, EngineProgress::Finished(WorkflowRunStatus::Completed));
    let (_, steps) = service.get_run_with_steps(&run_id).unwrap().unwrap();
    assert_eq!(steps[0].status, WorkflowStepStatus::Completed);
    assert_eq!(steps[0].attempt, 2);
}

// --------------------------------------------------------------------------
// Branch continue / end + skipped tail (C11 / E5)
// --------------------------------------------------------------------------

#[tokio::test]
async fn branch_continue_advances_to_the_next_step() {
    let service = test_service();
    let run_id = create(
        &service,
        r#"[{ "kind": "branch", "on": "{{steps[0].output.verdict}}",
             "cases": { "ship": { "to": "continue" }, "wont_fix": { "to": "end" } } },
            { "kind": "shell.run", "command": "deploy" }]"#,
    );
    // Branch continues (Completed), then the tail step runs.
    let executor = FakeExecutor::script(vec![
        completed(serde_json::json!({ "value": "ship", "target": "continue" })),
        completed(serde_json::json!({ "exit_code": 0 })),
    ]);
    let progress = drive(&service, &run_id, &executor).await;
    assert_eq!(progress, EngineProgress::Finished(WorkflowRunStatus::Completed));
    let (run, steps) = service.get_run_with_steps(&run_id).unwrap().unwrap();
    assert_eq!(run.step_cursor, 2);
    assert!(steps.iter().all(|s| s.status == WorkflowStepStatus::Completed));
}

#[tokio::test]
async fn branch_end_completes_run_and_skips_the_tail() {
    let service = test_service();
    let run_id = create(
        &service,
        r#"[{ "kind": "shell.run", "command": "lint" },
            { "kind": "branch", "on": "{{steps[0].output.verdict}}",
              "cases": { "ship": { "to": "continue" }, "wont_fix": { "to": "end" } } },
            { "kind": "shell.run", "command": "deploy" },
            { "kind": "notify", "slack_channel_id": "C1", "message": "done" }]"#,
    );
    let executor = FakeExecutor::script(vec![
        completed(serde_json::json!({ "verdict": "wont_fix" })),
        end_run(serde_json::json!({ "value": "wont_fix", "target": "end" })),
    ]);
    let progress = drive(&service, &run_id, &executor).await;
    assert_eq!(progress, EngineProgress::Finished(WorkflowRunStatus::Completed));

    let (run, steps) = service.get_run_with_steps(&run_id).unwrap().unwrap();
    assert_eq!(run.status, WorkflowRunStatus::Completed);
    // The branch step is recorded Completed with its taken-case output...
    assert_eq!(steps[1].status, WorkflowStepStatus::Completed);
    assert_eq!(steps[1].output_value().unwrap()["target"], "end");
    // ...and every step after the end is Skipped, never executed.
    assert_eq!(steps[2].status, WorkflowStepStatus::Skipped);
    assert_eq!(steps[3].status, WorkflowStepStatus::Skipped);
    // Only the two pre-end steps actually ran.
    assert_eq!(executor.calls().len(), 2);
}

// --------------------------------------------------------------------------
// Approval suspend / resolve / timeout
// --------------------------------------------------------------------------

fn suspend(message: &str) -> StepOutcome {
    StepOutcome::AwaitApproval {
        descriptor: serde_json::json!({ "message": message }),
    }
}

// human.approval step tests were removed with the step kind (E1). The remaining
// park/resume path is a goal step blocked with on_blocked=pause_for_approval,
// which still reaches waiting_approval — exercised below.

#[tokio::test]
async fn goal_block_approve_reruns_the_step() {
    let service = test_service();
    let run_id = create(
        &service,
        r#"[{ "kind": "agent.prompt", "prompt": "work",
             "goal": { "objective": "done", "max_turns": 5, "max_wall_secs": 60, "on_blocked": "pause_for_approval" } }]"#,
    );
    // First execution blocks (suspend); after approve, re-run completes.
    let executor = FakeExecutor::script(vec![suspend("blocked"), completed(serde_json::json!({ "met_reason": "done" }))]);
    let progress = drive(&service, &run_id, &executor).await;
    assert_eq!(progress, EngineProgress::SuspendedForApproval);
    let outcome = service
        .resolve_pending_approval(&run_id, ApprovalInput::Approve)
        .expect("resolve");
    assert!(outcome.resume);
    let progress = drive(&service, &run_id, &executor).await;
    assert_eq!(progress, EngineProgress::Finished(WorkflowRunStatus::Completed));
    let calls = executor.calls();
    assert_eq!(calls.len(), 2);
    // re-run bumps the attempt
    assert_eq!(calls[1].attempt, 2);
}

#[test]
fn resolve_approval_errors_when_not_waiting() {
    let service = test_service();
    let run_id = create(&service, r#"[{ "kind": "shell.run", "command": "x" }]"#);
    let error = service
        .resolve_pending_approval(&run_id, ApprovalInput::Approve)
        .expect_err("not waiting");
    assert!(matches!(
        error,
        super::service::WorkflowServiceError::NoPendingApproval
    ));
}

// --------------------------------------------------------------------------
// Cancel + resume matrix
// --------------------------------------------------------------------------

#[tokio::test]
async fn cancel_between_steps_marks_run_cancelled() {
    let service = test_service();
    let run_id = create(&service, r#"[{ "kind": "shell.run", "command": "x" }]"#);
    let executor = FakeExecutor::script(vec![]);
    let cancel = CancelToken::new();
    cancel.cancel();
    let progress = service
        .run_next_step(&run_id, &executor, &cancel)
        .await
        .expect("run next");
    assert_eq!(progress, EngineProgress::Finished(WorkflowRunStatus::Cancelled));
    assert_eq!(executor.calls().len(), 0);
}

#[tokio::test]
async fn resume_reenters_a_step_that_was_running() {
    // Simulate a crash mid-step: the step row is left `running`, cursor at 0.
    // On resume the engine re-enters it (attempt++), matching the conservative
    // resume matrix for a step whose completion never landed.
    let service = test_service();
    let run_id = create(&service, r#"[{ "kind": "agent.prompt", "prompt": "go" }]"#);
    // First attempt lands as "running" then we abandon (only one outcome that
    // suspends the loop would stop it — instead we drive once with a script that
    // records the running state via begin_step, then inspect after a fresh call).
    let executor = FakeExecutor::script(vec![completed(serde_json::json!({}))]);
    // Manually mark the step running with attempt 1 to emulate a crashed run.
    service
        .store()
        .with_tx_anyhow(|tx| {
            let mut step = WorkflowStore::find_step_run_tx(tx, &run_id, 0)?.unwrap();
            step.status = WorkflowStepStatus::Running;
            step.attempt = 1;
            WorkflowStore::update_step_run(tx, &step)?;
            Ok(())
        })
        .unwrap();
    let cancel = CancelToken::new();
    let progress = service
        .run_next_step(&run_id, &executor, &cancel)
        .await
        .unwrap();
    assert_eq!(progress, EngineProgress::Finished(WorkflowRunStatus::Completed));
    // Re-entry bumped the attempt from the crashed 1 to 2.
    assert_eq!(executor.calls()[0].attempt, 2);
}

#[test]
fn set_session_for_slot_is_slot_keyed_and_idempotent() {
    let service = test_service();
    let run_id = create(&service, r#"[{ "kind": "shell.run", "command": "x" }]"#);
    service.set_session_for_slot(&run_id, "triage", "session-1").unwrap();
    // Same (slot, session) is a no-op; a second slot adds a key.
    service.set_session_for_slot(&run_id, "triage", "session-1").unwrap();
    service.set_session_for_slot(&run_id, "fix", "session-2").unwrap();
    let run = service.get_run(&run_id).unwrap().unwrap();
    assert_eq!(run.session_ids.len(), 2);
    assert_eq!(run.session_ids["triage"], "session-1");
    assert_eq!(run.session_ids["fix"], "session-2");
}

#[test]
fn list_non_terminal_runs_excludes_completed() {
    let service = test_service();
    let run_id = create(&service, r#"[{ "kind": "shell.run", "command": "x" }]"#);
    assert_eq!(service.list_non_terminal_runs().unwrap().len(), 1);
    service
        .mark_run_terminal(&run_id, WorkflowRunStatus::Completed, None, None)
        .unwrap();
    assert_eq!(service.list_non_terminal_runs().unwrap().len(), 0);
}

// --------------------------------------------------------------------------
// agent.config + live goal progress
// --------------------------------------------------------------------------

#[tokio::test]
async fn agent_config_step_advances_the_cursor_and_records_output() {
    let service = test_service();
    let run_id = create(
        &service,
        r#"[
            { "kind": "agent.config", "harness": "codex", "model": "opus" },
            { "kind": "agent.prompt", "prompt": "go" }
        ]"#,
    );
    let executor = FakeExecutor::script(vec![
        completed(serde_json::json!({ "harness": "codex", "model": "opus", "session_switched": true })),
        completed(serde_json::json!({ "session_id": "sess-1" })),
    ]);
    let progress = drive(&service, &run_id, &executor).await;
    assert_eq!(progress, EngineProgress::Finished(WorkflowRunStatus::Completed));

    let (_, rows) = service.get_run_with_steps(&run_id).unwrap().unwrap();
    assert_eq!(rows[0].kind, "agent.config");
    assert_eq!(rows[0].status, WorkflowStepStatus::Completed);
    assert!(rows[0].output_json.as_ref().unwrap().contains("session_switched"));
}

#[test]
fn record_step_goal_progress_only_writes_while_running() {
    let service = test_service();
    let run_id = create(
        &service,
        r#"[{ "kind": "agent.prompt", "prompt": "hi",
             "goal": { "objective": "green", "max_turns": 5, "max_wall_secs": 60, "on_blocked": "notify" } }]"#,
    );

    // Pending step: the snapshot is a no-op (a terminal write must never be
    // clobbered by a late snapshot, and pending steps have not begun).
    service
        .record_step_goal_progress(&run_id, 0, serde_json::json!({ "goal": { "iterations": 1 } }))
        .unwrap();
    let (_, rows) = service.get_run_with_steps(&run_id).unwrap().unwrap();
    assert!(rows[0].output_json.is_none());

    // Flip the step to Running, then a snapshot is persisted.
    service
        .store()
        .with_tx_anyhow(|tx| {
            let mut step = WorkflowStore::find_step_run_tx(tx, &run_id, 0)?.unwrap();
            step.status = WorkflowStepStatus::Running;
            WorkflowStore::update_step_run(tx, &step)?;
            Ok(())
        })
        .unwrap();
    service
        .record_step_goal_progress(
            &run_id,
            0,
            serde_json::json!({ "goal": { "iterations": 3, "tokens_used": 64000 }, "session_id": "s1" }),
        )
        .unwrap();
    let (_, rows) = service.get_run_with_steps(&run_id).unwrap().unwrap();
    let output = rows[0].output_json.as_ref().unwrap();
    assert!(output.contains("iterations"));
    assert!(output.contains("tokens_used"));
}

// --------------------------------------------------------------------------
// C10 injected-turn provenance index (workflow_session_injections). The
// executor writes a row alongside begin_step; the steps checklist / audit read
// it back. Shell steps write no row (PROPOSED option B).
// --------------------------------------------------------------------------

#[test]
fn record_injection_round_trips_and_is_idempotent() {
    let service = test_service();
    service
        .record_injection("sess-1", "turn-1", "run-1", "0.-.0", "agent.prompt", "Investigate", "do the thing")
        .unwrap();
    // Idempotent on (session_id, turn_id): a crash-resume re-send is a no-op.
    service
        .record_injection("sess-1", "turn-1", "run-1", "0.-.0", "agent.prompt", "Investigate", "changed")
        .unwrap();
    let row = service
        .store()
        .find_injection("sess-1", "turn-1")
        .unwrap()
        .expect("injection row present");
    let (run_id, step_key, kind, label, text) = row;
    assert_eq!(run_id, "run-1");
    assert_eq!(step_key, "0.-.0");
    assert_eq!(kind, "agent.prompt");
    assert_eq!(label, "Investigate");
    // INSERT OR IGNORE: the first write wins.
    assert_eq!(text, "do the thing");
    // An un-injected (human) turn has no row: absence = human, presence = machine.
    assert!(service.store().find_injection("sess-1", "turn-2").unwrap().is_none());
}

// --------------------------------------------------------------------------
// L30 parallel lanes: concurrent driving, lane-aware on-fail, crash-resume.
// Driven through the real actor loop (`drive_run`), which is segment-aware.
// --------------------------------------------------------------------------

/// An executor keyed by step `key` (not FIFO) so scripting is deterministic
/// regardless of the nondeterministic order concurrent lanes are polled in.
struct KeyedExecutor {
    outcomes: Mutex<HashMap<String, VecDeque<StepOutcome>>>,
    calls: Mutex<Vec<String>>,
    /// Optional rendezvous: every `execute_step` waits here first, so N lanes
    /// must all be concurrently in-flight to make progress (concurrency proof).
    barrier: Option<Arc<tokio::sync::Barrier>>,
    /// Records each `merge_lanes_into_run_worktree` call's lane order (M2b).
    merge_calls: Mutex<Vec<Vec<String>>>,
    /// When set, `merge_lanes_into_run_worktree` returns this conflict outcome
    /// instead of succeeding (drives the "conflict → run fails honestly" test).
    merge_conflict: Option<(String, String)>,
}

impl KeyedExecutor {
    fn new(scripts: Vec<(&str, Vec<StepOutcome>)>) -> Self {
        let mut outcomes = HashMap::new();
        for (key, seq) in scripts {
            outcomes.insert(key.to_string(), seq.into_iter().collect());
        }
        Self {
            outcomes: Mutex::new(outcomes),
            calls: Mutex::new(Vec::new()),
            barrier: None,
            merge_calls: Mutex::new(Vec::new()),
            merge_conflict: None,
        }
    }

    fn with_barrier(mut self, barrier: Arc<tokio::sync::Barrier>) -> Self {
        self.barrier = Some(barrier);
        self
    }

    fn with_merge_conflict(mut self, lane: &str) -> Self {
        self.merge_conflict = Some((
            "lane_merge_conflict".to_string(),
            format!("lane '{lane}' could not be merged"),
        ));
        self
    }

    fn calls(&self) -> Vec<String> {
        self.calls.lock().unwrap().clone()
    }

    fn merge_calls(&self) -> Vec<Vec<String>> {
        self.merge_calls.lock().unwrap().clone()
    }
}

#[async_trait::async_trait]
impl WorkflowStepExecutor for KeyedExecutor {
    async fn execute_step(&self, step: &PlanStep, _ctx: &StepExecContext) -> StepOutcome {
        if let Some(barrier) = &self.barrier {
            barrier.wait().await;
        }
        self.calls.lock().unwrap().push(step.key.clone());
        self.outcomes
            .lock()
            .unwrap()
            .get_mut(&step.key)
            .and_then(|seq| seq.pop_front())
            .unwrap_or(StepOutcome::Completed {
                output: serde_json::json!({}),
            })
    }

    async fn merge_lanes_into_run_worktree(&self, lanes: &[String]) -> Result<(), StepOutcome> {
        self.merge_calls.lock().unwrap().push(lanes.to_vec());
        if let Some((code, message)) = &self.merge_conflict {
            return Err(StepOutcome::Failed {
                code: code.clone(),
                message: Some(message.clone()),
                output: None,
            });
        }
        Ok(())
    }
}

fn parallel_plan(run_id: &str, sessions: &[&str], steps_json: &str) -> String {
    let sessions_map = sessions
        .iter()
        .map(|slot| format!(r#""{slot}": {{ "harness": "claude", "session_binding": "fresh" }}"#))
        .collect::<Vec<_>>()
        .join(",");
    format!(
        r#"{{ "run_id": "{run_id}", "plan_version": 1,
              "sessions": {{ {sessions_map} }}, "steps": {steps_json} }}"#
    )
}

fn create_plan(service: &WorkflowService, plan_json: &str) -> String {
    let (run, created) = service
        .create_run_idempotent(plan_json, "workspace-1")
        .expect("create run");
    assert!(created);
    run.run_id
}

fn lane_cursors(service: &WorkflowService, run_id: &str) -> Vec<WorkflowLaneCursorRecord> {
    service
        .store()
        .with_tx_anyhow(|tx| Ok(WorkflowStore::list_lane_cursors_tx(tx, run_id)?))
        .unwrap()
}

fn step_status(service: &WorkflowService, run_id: &str, key: &str) -> WorkflowStepStatus {
    let (_, steps) = service.get_run_with_steps(run_id).unwrap().unwrap();
    steps
        .into_iter()
        .find(|step| step.step_key == key)
        .unwrap_or_else(|| panic!("no step {key}"))
        .status
}

#[tokio::test]
async fn parallel_group_runs_all_lanes_and_joins() {
    let service = test_service();
    let plan = parallel_plan(
        "run-par",
        &["a", "b"],
        r#"[
            { "key": "0.a.0", "slot": "a", "kind": "shell.run", "command": "a0" },
            { "key": "0.a.1", "slot": "a", "kind": "shell.run", "command": "a1" },
            { "key": "0.b.0", "slot": "b", "kind": "shell.run", "command": "b0" }
        ]"#,
    );
    let run_id = create_plan(&service, &plan);
    let executor = KeyedExecutor::new(vec![]);
    let cancel = CancelToken::new();
    let progress = drive_run(&service, &executor, &run_id, &cancel).await;
    assert_eq!(progress, EngineProgress::Finished(WorkflowRunStatus::Completed));

    let (run, steps) = service.get_run_with_steps(&run_id).unwrap().unwrap();
    assert_eq!(run.status, WorkflowRunStatus::Completed);
    assert_eq!(run.step_cursor, 3, "cursor jumps to the group end on join");
    assert!(steps.iter().all(|s| s.status == WorkflowStepStatus::Completed));

    // Each lane reached its own terminal cursor, independently.
    let mut cursors = lane_cursors(&service, &run_id);
    cursors.sort_by(|x, y| x.lane.cmp(&y.lane));
    assert_eq!(cursors.len(), 2);
    assert_eq!(cursors[0].lane, "a");
    assert_eq!(cursors[0].status, LaneStatus::Completed);
    assert_eq!(cursors[0].cursor, 2);
    assert_eq!(cursors[1].lane, "b");
    assert_eq!(cursors[1].status, LaneStatus::Completed);
    assert_eq!(cursors[1].cursor, 1);
}

#[tokio::test]
async fn pre_group_post_run_in_segment_order() {
    let service = test_service();
    let plan = parallel_plan(
        "run-ppp",
        &["pre", "a", "b", "post"],
        r#"[
            { "key": "0.-.0", "slot": "pre",  "kind": "shell.run", "command": "pre" },
            { "key": "1.a.0", "slot": "a",    "kind": "shell.run", "command": "a0" },
            { "key": "1.b.0", "slot": "b",    "kind": "shell.run", "command": "b0" },
            { "key": "2.-.0", "slot": "post", "kind": "shell.run", "command": "post" }
        ]"#,
    );
    let run_id = create_plan(&service, &plan);
    let executor = KeyedExecutor::new(vec![]);
    let cancel = CancelToken::new();
    let progress = drive_run(&service, &executor, &run_id, &cancel).await;
    assert_eq!(progress, EngineProgress::Finished(WorkflowRunStatus::Completed));

    let calls = executor.calls();
    let pos = |key: &str| calls.iter().position(|c| c == key).unwrap();
    // Pre-group runs before the group; the group runs before post-group.
    assert!(pos("0.-.0") < pos("1.a.0") && pos("0.-.0") < pos("1.b.0"));
    assert!(pos("2.-.0") > pos("1.a.0") && pos("2.-.0") > pos("1.b.0"));
    let (_, steps) = service.get_run_with_steps(&run_id).unwrap().unwrap();
    assert!(steps.iter().all(|s| s.status == WorkflowStepStatus::Completed));
}

#[tokio::test]
async fn lane_failure_completes_siblings_then_fails_run_and_skips_post_group() {
    // DENY-PATH (d): a lane's stop-on-fail decision fails the lane; the sibling
    // still runs to completion; the join fails the run; post-group steps never
    // execute.
    let service = test_service();
    let plan = parallel_plan(
        "run-fail",
        &["a", "b", "post"],
        r#"[
            { "key": "0.a.0", "slot": "a", "kind": "shell.run", "command": "a0", "on_fail": { "kind": "stop" } },
            { "key": "0.b.0", "slot": "b", "kind": "shell.run", "command": "b0" },
            { "key": "0.b.1", "slot": "b", "kind": "shell.run", "command": "b1" },
            { "key": "1.-.0", "slot": "post", "kind": "shell.run", "command": "post" }
        ]"#,
    );
    let run_id = create_plan(&service, &plan);
    let executor = KeyedExecutor::new(vec![("0.a.0", vec![failed("boom")])]);
    let cancel = CancelToken::new();
    let progress = drive_run(&service, &executor, &run_id, &cancel).await;
    assert_eq!(progress, EngineProgress::Finished(WorkflowRunStatus::Failed));

    let (run, _) = service.get_run_with_steps(&run_id).unwrap().unwrap();
    assert_eq!(run.status, WorkflowRunStatus::Failed);
    assert_eq!(run.error_code.as_deref(), Some("boom"));

    // Lane a failed; lane b ran BOTH its steps to completion (siblings not killed).
    assert_eq!(step_status(&service, &run_id, "0.a.0"), WorkflowStepStatus::Failed);
    assert_eq!(step_status(&service, &run_id, "0.b.0"), WorkflowStepStatus::Completed);
    assert_eq!(step_status(&service, &run_id, "0.b.1"), WorkflowStepStatus::Completed);
    // Post-group step never executed.
    assert_eq!(step_status(&service, &run_id, "1.-.0"), WorkflowStepStatus::Pending);
    assert!(!executor.calls().contains(&"1.-.0".to_string()));

    let mut cursors = lane_cursors(&service, &run_id);
    cursors.sort_by(|x, y| x.lane.cmp(&y.lane));
    assert_eq!(cursors[0].status, LaneStatus::Failed);
    assert_eq!(cursors[0].error_code.as_deref(), Some("boom"));
    assert_eq!(cursors[1].status, LaneStatus::Completed);
}

#[test]
fn lane_visible_outputs_hides_sibling_lane_outputs() {
    // minor m1: with the group starting at flat index 1, lane "a" owns steps
    // {1, 2}; a sibling lane's step 3 must be invisible, while pre-group step 0
    // stays visible.
    let mut outputs: HashMap<usize, serde_json::Value> = HashMap::new();
    for idx in 0..=3 {
        outputs.insert(idx, serde_json::json!({ "i": idx }));
    }
    let filtered = lane_visible_outputs(outputs, 1, &[1, 2]);
    let mut visible: Vec<usize> = filtered.keys().copied().collect();
    visible.sort();
    assert_eq!(visible, vec![0, 1, 2], "pre-group + own steps only; sibling step 3 hidden");
}

#[tokio::test]
async fn clean_join_merges_lanes_back_in_lane_order() {
    // M2(b): at a clean join every lane's branch merges back into the run-level
    // worktree, in deterministic lane order, exactly once, before the cursor
    // advances past the group.
    let service = test_service();
    let plan = parallel_plan(
        "run-merge",
        &["a", "b", "post"],
        r#"[
            { "key": "0.a.0", "slot": "a", "kind": "shell.run", "command": "a0" },
            { "key": "0.b.0", "slot": "b", "kind": "shell.run", "command": "b0" },
            { "key": "1.-.0", "slot": "post", "kind": "shell.run", "command": "post" }
        ]"#,
    );
    let run_id = create_plan(&service, &plan);
    let executor = KeyedExecutor::new(vec![]);
    let cancel = CancelToken::new();
    let progress = drive_run(&service, &executor, &run_id, &cancel).await;
    assert_eq!(progress, EngineProgress::Finished(WorkflowRunStatus::Completed));
    // Merge-back ran once with the lanes in lane order.
    assert_eq!(executor.merge_calls(), vec![vec!["a".to_string(), "b".to_string()]]);
    // Post-group step ran AFTER the merge-back (it sees merged lane work).
    assert_eq!(step_status(&service, &run_id, "1.-.0"), WorkflowStepStatus::Completed);
}

#[tokio::test]
async fn failed_join_skips_merge_back() {
    // M2(b): a FAILED join never merges lanes back — the partial work is left in
    // the lane worktrees for inspection (the run is failed anyway).
    let service = test_service();
    let plan = parallel_plan(
        "run-nomerge",
        &["a", "b"],
        r#"[
            { "key": "0.a.0", "slot": "a", "kind": "shell.run", "command": "a0", "on_fail": { "kind": "stop" } },
            { "key": "0.b.0", "slot": "b", "kind": "shell.run", "command": "b0" }
        ]"#,
    );
    let run_id = create_plan(&service, &plan);
    let executor = KeyedExecutor::new(vec![("0.a.0", vec![failed("boom")])]);
    let cancel = CancelToken::new();
    let progress = drive_run(&service, &executor, &run_id, &cancel).await;
    assert_eq!(progress, EngineProgress::Finished(WorkflowRunStatus::Failed));
    assert!(executor.merge_calls().is_empty(), "a failed join must not merge back");
}

#[tokio::test]
async fn merge_conflict_at_join_fails_run_and_skips_post_group() {
    // M2(b): a merge CONFLICT at a clean join is an honest run failure
    // (lane_merge_conflict) — never silently dropped; the cursor stays at the
    // group start so post-group steps never run.
    let service = test_service();
    let plan = parallel_plan(
        "run-conflict",
        &["a", "b", "post"],
        r#"[
            { "key": "0.a.0", "slot": "a", "kind": "shell.run", "command": "a0" },
            { "key": "0.b.0", "slot": "b", "kind": "shell.run", "command": "b0" },
            { "key": "1.-.0", "slot": "post", "kind": "shell.run", "command": "post" }
        ]"#,
    );
    let run_id = create_plan(&service, &plan);
    let executor = KeyedExecutor::new(vec![]).with_merge_conflict("a");
    let cancel = CancelToken::new();
    let progress = drive_run(&service, &executor, &run_id, &cancel).await;
    assert_eq!(progress, EngineProgress::Finished(WorkflowRunStatus::Failed));

    let (run, _) = service.get_run_with_steps(&run_id).unwrap().unwrap();
    assert_eq!(run.status, WorkflowRunStatus::Failed);
    assert_eq!(run.error_code.as_deref(), Some("lane_merge_conflict"));
    // Post-group step never executed (cursor never advanced past the group).
    assert_eq!(step_status(&service, &run_id, "1.-.0"), WorkflowStepStatus::Pending);
    assert!(!executor.calls().contains(&"1.-.0".to_string()));
}

#[tokio::test]
async fn sibling_lanes_are_isolated() {
    // DENY-PATH (b): each lane only ever runs its OWN steps, and the per-lane
    // cursor rows are fully partitioned by (node, lane) — one lane never touches
    // another's bookkeeping. (Worktree/session isolation is slot-keyed and
    // covered by the executor helper tests.)
    let service = test_service();
    let plan = parallel_plan(
        "run-iso",
        &["a", "b"],
        r#"[
            { "key": "0.a.0", "slot": "a", "kind": "shell.run", "command": "a0" },
            { "key": "0.a.1", "slot": "a", "kind": "shell.run", "command": "a1" },
            { "key": "0.b.0", "slot": "b", "kind": "shell.run", "command": "b0" },
            { "key": "0.b.1", "slot": "b", "kind": "shell.run", "command": "b1" }
        ]"#,
    );
    let run_id = create_plan(&service, &plan);
    let executor = KeyedExecutor::new(vec![]);
    let cancel = CancelToken::new();
    drive_run(&service, &executor, &run_id, &cancel).await;

    let calls = executor.calls();
    let lane_a: Vec<&String> = calls.iter().filter(|k| k.starts_with("0.a.")).collect();
    let lane_b: Vec<&String> = calls.iter().filter(|k| k.starts_with("0.b.")).collect();
    assert_eq!(lane_a.len(), 2);
    assert_eq!(lane_b.len(), 2);
    // Every recorded call belongs to exactly one lane — no cross-lane execution.
    assert_eq!(lane_a.len() + lane_b.len(), calls.len());

    let cursors = lane_cursors(&service, &run_id);
    assert_eq!(cursors.len(), 2, "one cursor row per lane, never shared");
    assert!(cursors.iter().all(|c| c.node_index == 0));
}

#[tokio::test]
async fn crash_resume_mid_group_resumes_only_the_unfinished_lane() {
    // DENY-PATH (c): a run crashed with lane a done and lane b mid-step. On
    // resume, lane a re-runs nothing and lane b resumes at its cursor; the group
    // joins correctly.
    let service = test_service();
    let plan = parallel_plan(
        "run-resume",
        &["a", "b"],
        r#"[
            { "key": "0.a.0", "slot": "a", "kind": "shell.run", "command": "a0" },
            { "key": "0.b.0", "slot": "b", "kind": "shell.run", "command": "b0" },
            { "key": "0.b.1", "slot": "b", "kind": "shell.run", "command": "b1" }
        ]"#,
    );
    let run_id = create_plan(&service, &plan);
    // Hand-craft the crashed state: lane a completed; lane b past its first step.
    service
        .store()
        .with_tx_anyhow(|tx| {
            let now = chrono::Utc::now().to_rfc3339();
            for (key, node, lane, cursor, status) in [
                ("0.a.0", 0i64, "a", 1i64, LaneStatus::Completed),
                ("0.b.0", 0, "b", 1, LaneStatus::Running),
            ] {
                // Cursor row.
                WorkflowStore::upsert_lane_cursor_tx(
                    tx,
                    &WorkflowLaneCursorRecord {
                        run_id: run_id.clone(),
                        node_index: node,
                        lane: lane.to_string(),
                        cursor,
                        status,
                        error_code: None,
                        error_message: None,
                        created_at: now.clone(),
                        updated_at: now.clone(),
                    },
                )?;
                // Mark the already-run step completed.
                let mut step = WorkflowStore::find_step_run_tx(
                    tx,
                    &run_id,
                    if key == "0.a.0" { 0 } else { 1 },
                )?
                .unwrap();
                step.status = WorkflowStepStatus::Completed;
                WorkflowStore::update_step_run(tx, &step)?;
            }
            Ok(())
        })
        .unwrap();

    let executor = KeyedExecutor::new(vec![]);
    let cancel = CancelToken::new();
    let progress = drive_run(&service, &executor, &run_id, &cancel).await;
    assert_eq!(progress, EngineProgress::Finished(WorkflowRunStatus::Completed));

    // ONLY the unfinished lane-b step ran; the completed steps were not re-run.
    assert_eq!(executor.calls(), vec!["0.b.1".to_string()]);
    let (run, _) = service.get_run_with_steps(&run_id).unwrap().unwrap();
    assert_eq!(run.status, WorkflowRunStatus::Completed);
    assert_eq!(run.step_cursor, 3);
}

#[tokio::test]
async fn lanes_run_concurrently() {
    // Concurrency proof: two single-step lanes share a Barrier(2). If the lanes
    // were driven sequentially, the first would block at the barrier forever;
    // completing within the timeout proves both were concurrently in-flight.
    let service = test_service();
    let plan = parallel_plan(
        "run-conc",
        &["a", "b"],
        r#"[
            { "key": "0.a.0", "slot": "a", "kind": "shell.run", "command": "a0" },
            { "key": "0.b.0", "slot": "b", "kind": "shell.run", "command": "b0" }
        ]"#,
    );
    let run_id = create_plan(&service, &plan);
    let barrier = Arc::new(tokio::sync::Barrier::new(2));
    let executor = KeyedExecutor::new(vec![]).with_barrier(barrier);
    let cancel = CancelToken::new();
    let progress = tokio::time::timeout(
        Duration::from_secs(5),
        drive_run(&service, &executor, &run_id, &cancel),
    )
    .await
    .expect("lanes must run concurrently (no sequential deadlock at the barrier)");
    assert_eq!(progress, EngineProgress::Finished(WorkflowRunStatus::Completed));
}

#[tokio::test]
async fn lane_step_retries_through_the_pure_matrix() {
    // The pure on-fail matrix applies per lane: a retry step fails once, retries,
    // then completes — the lane completes at attempt 2.
    let service = test_service();
    let plan = parallel_plan(
        "run-retry",
        &["a", "b"],
        r#"[
            { "key": "0.a.0", "slot": "a", "kind": "shell.run", "command": "a0", "on_fail": { "kind": "retry", "n": 1 } },
            { "key": "0.b.0", "slot": "b", "kind": "shell.run", "command": "b0" }
        ]"#,
    );
    let run_id = create_plan(&service, &plan);
    let executor = KeyedExecutor::new(vec![(
        "0.a.0",
        vec![failed("flaky"), completed(serde_json::json!({ "ok": true }))],
    )]);
    let cancel = CancelToken::new();
    let progress = drive_run(&service, &executor, &run_id, &cancel).await;
    assert_eq!(progress, EngineProgress::Finished(WorkflowRunStatus::Completed));

    let (_, steps) = service.get_run_with_steps(&run_id).unwrap().unwrap();
    let a0 = steps.iter().find(|s| s.step_key == "0.a.0").unwrap();
    assert_eq!(a0.status, WorkflowStepStatus::Completed);
    assert_eq!(a0.attempt, 2);
}

#[tokio::test]
async fn branch_end_inside_a_lane_ends_the_lane_not_the_run() {
    // A branch `end` inside a lane ends THAT lane (its tail is skipped) but the
    // group still joins as completed and post-group steps run.
    let service = test_service();
    let plan = parallel_plan(
        "run-lane-end",
        &["a", "b", "post"],
        r#"[
            { "key": "0.a.0", "slot": "a", "kind": "branch", "on": "{{steps[0].output.v}}",
              "cases": { "ship": { "to": "continue" }, "stop": { "to": "end" } } },
            { "key": "0.a.1", "slot": "a", "kind": "shell.run", "command": "a1" },
            { "key": "0.b.0", "slot": "b", "kind": "shell.run", "command": "b0" },
            { "key": "1.-.0", "slot": "post", "kind": "shell.run", "command": "post" }
        ]"#,
    );
    let run_id = create_plan(&service, &plan);
    let executor = KeyedExecutor::new(vec![(
        "0.a.0",
        vec![end_run(serde_json::json!({ "value": "stop", "target": "end" }))],
    )]);
    let cancel = CancelToken::new();
    let progress = drive_run(&service, &executor, &run_id, &cancel).await;
    assert_eq!(progress, EngineProgress::Finished(WorkflowRunStatus::Completed));

    // The lane's branch step completed; its tail step was skipped; the run did
    // NOT end (post-group step ran).
    assert_eq!(step_status(&service, &run_id, "0.a.0"), WorkflowStepStatus::Completed);
    assert_eq!(step_status(&service, &run_id, "0.a.1"), WorkflowStepStatus::Skipped);
    assert_eq!(step_status(&service, &run_id, "0.b.0"), WorkflowStepStatus::Completed);
    assert_eq!(step_status(&service, &run_id, "1.-.0"), WorkflowStepStatus::Completed);
}
