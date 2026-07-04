use std::collections::VecDeque;
use std::sync::Mutex;

use anyharness_contract::v1::{WorkflowRunStatus, WorkflowStepStatus};

use super::engine::{
    CancelToken, EngineProgress, StepExecContext, StepOutcome, WorkflowStepExecutor,
};
use super::plan::{PlanStep, StepKind};
use super::service::{ApprovalInput, WorkflowService};
use super::store::WorkflowStore;
use crate::app::test_support;
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
    format!(
        r#"{{
            "run_id": "run-1",
            "setup": {{ "harness": "claude", "session_binding": "fresh" }},
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
// Approval suspend / resolve / timeout
// --------------------------------------------------------------------------

fn suspend(message: &str) -> StepOutcome {
    StepOutcome::AwaitApproval {
        descriptor: serde_json::json!({ "message": message }),
    }
}

#[tokio::test]
async fn human_approval_approve_advances() {
    let service = test_service();
    let run_id = create(
        &service,
        r#"[{ "kind": "human.approval", "message": "ok?" }, { "kind": "shell.run", "command": "y" }]"#,
    );
    let executor = FakeExecutor::script(vec![suspend("ok?"), completed(serde_json::json!({}))]);
    let progress = drive(&service, &run_id, &executor).await;
    assert_eq!(progress, EngineProgress::SuspendedForApproval);
    let run = service.get_run(&run_id).unwrap().unwrap();
    assert_eq!(run.status, WorkflowRunStatus::WaitingApproval);

    let outcome = service
        .resolve_pending_approval(&run_id, ApprovalInput::Approve)
        .expect("resolve");
    assert!(outcome.resume);
    // Actor resumes the loop after an approve that advanced the run.
    let progress = drive(&service, &run_id, &executor).await;
    assert_eq!(progress, EngineProgress::Finished(WorkflowRunStatus::Completed));
}

#[tokio::test]
async fn human_approval_deny_with_stop_fails_run() {
    let service = test_service();
    let run_id = create(
        &service,
        r#"[{ "kind": "human.approval", "message": "ok?", "on_fail": { "kind": "stop" } }]"#,
    );
    let executor = FakeExecutor::script(vec![suspend("ok?")]);
    drive(&service, &run_id, &executor).await;
    let outcome = service
        .resolve_pending_approval(&run_id, ApprovalInput::Deny)
        .expect("resolve");
    assert_eq!(
        outcome.progress,
        EngineProgress::Finished(WorkflowRunStatus::Failed)
    );
    let run = service.get_run(&run_id).unwrap().unwrap();
    assert_eq!(run.error_code.as_deref(), Some("approval_denied"));
}

#[tokio::test]
async fn human_approval_timeout_continue_advances() {
    let service = test_service();
    let run_id = create(
        &service,
        r#"[{ "kind": "human.approval", "message": "ok?", "on_timeout": "continue" }]"#,
    );
    let executor = FakeExecutor::script(vec![suspend("ok?")]);
    drive(&service, &run_id, &executor).await;
    let outcome = service
        .resolve_pending_approval(&run_id, ApprovalInput::Timeout)
        .expect("resolve");
    assert_eq!(
        outcome.progress,
        EngineProgress::Finished(WorkflowRunStatus::Completed)
    );
}

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
fn append_session_id_is_append_once() {
    let service = test_service();
    let run_id = create(&service, r#"[{ "kind": "shell.run", "command": "x" }]"#);
    service.append_session_id(&run_id, "session-1").unwrap();
    service.append_session_id(&run_id, "session-1").unwrap();
    service.append_session_id(&run_id, "session-2").unwrap();
    let run = service.get_run(&run_id).unwrap().unwrap();
    assert_eq!(run.session_ids, vec!["session-1".to_string(), "session-2".to_string()]);
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
