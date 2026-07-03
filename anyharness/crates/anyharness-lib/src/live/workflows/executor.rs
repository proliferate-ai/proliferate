//! The live [`WorkflowStepExecutor`] implementation: it drives real sessions,
//! goals, shells, PRs, and notifications. It owns run-scoped session continuity
//! (the harness-switch design opens a NEW session when a step's effective
//! harness differs from the current session's) and awaits turn/goal completion
//! off the live session's broadcast stream.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyharness_contract::v1::{
    GoalArmState, GoalSourceKind, GoalStatus, PromptInputBlock, SessionEvent,
    SessionEventEnvelope, SetSessionGoalRequest,
};
use serde_json::json;
use tokio::sync::broadcast;

use super::commands;
use crate::domains::goals::runtime::{GoalOpError, GoalRuntime};
use crate::domains::sessions::runtime::{SendPromptOutcome, SessionRuntime};
use crate::domains::sessions::service::SessionService;
use crate::domains::workflows::engine::{StepExecContext, StepOutcome, WorkflowStepExecutor};
use crate::domains::workflows::model::WorkflowRunRecord;
use crate::domains::workflows::plan::{
    AgentPromptStep, GoalSpec, HumanApprovalStep, OnBlocked, OnTimeout, PlanStep, PlanSetup,
    ScmOpenPrStep, ShellRunStep, StepKind,
};
use crate::domains::workflows::service::WorkflowService;
use crate::domains::workspaces::runtime::WorkspaceRuntime;
use crate::live::sessions::LiveSessionManager;
use crate::origin::OriginContext;

/// A turn/goal that hangs must never wait forever: this backstop caps a single
/// non-goal turn wait.
const TURN_BACKSTOP: Duration = Duration::from_secs(30 * 60);
/// Grace added to `max_wall_secs` for the actor-side goal backstop (the goal cap
/// guard fires on turn boundaries; this catches a hung in-flight turn).
const GOAL_BACKSTOP_GRACE: Duration = Duration::from_secs(60);
const VERIFY_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const MAX_VERIFY_ATTEMPTS: u32 = 3;

/// The shared, run-independent dependencies the executor needs.
pub struct WorkflowExecDeps {
    pub session_runtime: Arc<SessionRuntime>,
    pub goal_runtime: Arc<GoalRuntime>,
    pub session_service: Arc<SessionService>,
    pub workspace_runtime: Arc<WorkspaceRuntime>,
    pub workflow_service: Arc<WorkflowService>,
    pub acp_manager: LiveSessionManager,
}

struct CurrentSession {
    session_id: String,
    harness: String,
}

/// One executor per run. `current` tracks the run's live session for harness
/// continuity; it is hydrated from the run record on resume.
pub struct WorkflowStepExecutorImpl {
    deps: Arc<WorkflowExecDeps>,
    run_id: String,
    workspace_id: String,
    setup: PlanSetup,
    current: Mutex<Option<CurrentSession>>,
}

impl WorkflowStepExecutorImpl {
    pub fn new(
        deps: Arc<WorkflowExecDeps>,
        run_id: String,
        workspace_id: String,
        setup: PlanSetup,
    ) -> Self {
        Self {
            deps,
            run_id,
            workspace_id,
            setup,
            current: Mutex::new(None),
        }
    }

    /// Restore the current-session pointer from a run record (crash-resume):
    /// the last opened session, with its harness read back from the session row.
    pub fn hydrate_from_run(&self, run: &WorkflowRunRecord) {
        let Some(session_id) = run.current_session_id() else {
            return;
        };
        if let Ok(Some(session)) = self.deps.session_service.get_session(session_id) {
            *self.current.lock().unwrap() = Some(CurrentSession {
                session_id: session_id.to_string(),
                harness: session.agent_kind,
            });
        }
    }

    async fn ensure_session(
        &self,
        harness_override: Option<&str>,
        model_override: Option<&str>,
    ) -> Result<String, StepOutcome> {
        let effective_harness = harness_override
            .map(str::to_string)
            .unwrap_or_else(|| self.setup.harness.clone());
        // Reuse the current session only when its harness matches.
        {
            let current = self.current.lock().unwrap();
            if let Some(current) = current.as_ref() {
                if current.harness == effective_harness {
                    return Ok(current.session_id.clone());
                }
            }
        }
        let model = model_override
            .map(str::to_string)
            .or_else(|| self.setup.model.clone());
        let record = self
            .deps
            .session_runtime
            .create_and_start_session(
                &self.workspace_id,
                &effective_harness,
                model.as_deref(),
                None,
                None,
                Vec::new(),
                None,
                false,
                OriginContext::system_local_runtime(),
            )
            .await
            .map_err(|error| failed_msg("session_start_failed", format!("{error:?}")))?;
        let _ = self
            .deps
            .workflow_service
            .append_session_id(&self.run_id, &record.id);
        *self.current.lock().unwrap() = Some(CurrentSession {
            session_id: record.id.clone(),
            harness: effective_harness,
        });
        Ok(record.id)
    }

    async fn send_prompt(&self, session_id: &str, text: &str) -> Result<Option<String>, StepOutcome> {
        let blocks = vec![PromptInputBlock::Text {
            text: text.to_string(),
        }];
        match self
            .deps
            .session_runtime
            .send_prompt(session_id, blocks, None)
            .await
        {
            Ok(SendPromptOutcome::Running { turn_id, .. }) => Ok(Some(turn_id)),
            Ok(SendPromptOutcome::Queued { .. }) => Ok(None),
            Err(error) => Err(failed_msg("prompt_failed", format!("{error:?}"))),
        }
    }

    async fn subscribe(
        &self,
        session_id: &str,
    ) -> Result<broadcast::Receiver<SessionEventEnvelope>, StepOutcome> {
        let handle = self
            .deps
            .acp_manager
            .get_handle(session_id)
            .await
            .ok_or_else(|| failed("session_not_live"))?;
        Ok(handle.subscribe())
    }

    async fn run_prompt(&self, agent: &AgentPromptStep) -> StepOutcome {
        let session_id = match self
            .ensure_session(agent.harness_override.as_deref(), agent.model_override.as_deref())
            .await
        {
            Ok(id) => id,
            Err(outcome) => return outcome,
        };
        // Subscribe BEFORE prompting so a fast TurnEnded is never missed.
        let mut events = match self.subscribe(&session_id).await {
            Ok(events) => events,
            Err(outcome) => return outcome,
        };
        let turn_id = match self.send_prompt(&session_id, &agent.prompt).await {
            Ok(turn_id) => turn_id,
            Err(outcome) => return outcome,
        };
        match await_turn_ended(&mut events, turn_id.as_deref(), TURN_BACKSTOP).await {
            TurnWait::Ended => StepOutcome::Completed {
                output: json!({ "turn_id": turn_id, "session_id": session_id }),
            },
            TurnWait::SessionClosed => failed("session_closed"),
            TurnWait::Timeout => failed("turn_timeout"),
        }
    }

    async fn run_goal(&self, agent: &AgentPromptStep, goal: &GoalSpec) -> StepOutcome {
        let session_id = match self
            .ensure_session(agent.harness_override.as_deref(), agent.model_override.as_deref())
            .await
        {
            Ok(id) => id,
            Err(outcome) => return outcome,
        };
        let deadline =
            Instant::now() + Duration::from_secs(goal.max_wall_secs) + GOAL_BACKSTOP_GRACE;
        let mut prompt = agent.prompt.clone();
        let mut verify_attempts = 0u32;

        loop {
            if let Err(outcome) = self.arm_goal(&session_id, goal).await {
                return outcome;
            }
            let mut events = match self.subscribe(&session_id).await {
                Ok(events) => events,
                Err(outcome) => return outcome,
            };
            if let Err(outcome) = self.send_prompt(&session_id, &prompt).await {
                return outcome;
            }
            match await_goal_terminal(&mut events, deadline, goal.on_blocked).await {
                GoalWait::Met { met_reason } => match &goal.verify {
                    None => {
                        return StepOutcome::Completed {
                            output: json!({ "session_id": session_id, "met_reason": met_reason }),
                        }
                    }
                    Some(verify) => {
                        let (workspace_path, env) = match self.workspace_ctx() {
                            Ok(ctx) => ctx,
                            Err(outcome) => return outcome,
                        };
                        let (exit, tail) = commands::run_verify_shell(
                            &workspace_path,
                            &env,
                            &verify.shell,
                            VERIFY_TIMEOUT,
                        )
                        .await;
                        if exit == Some(verify.expect_exit) {
                            return StepOutcome::Completed {
                                output: json!({
                                    "session_id": session_id,
                                    "met_reason": met_reason,
                                    "verified": true,
                                    "verify_attempts": verify_attempts,
                                }),
                            };
                        }
                        verify_attempts += 1;
                        if verify_attempts >= MAX_VERIFY_ATTEMPTS {
                            self.clear_goal(&session_id).await;
                            return StepOutcome::Failed {
                                code: "verify_exhausted".to_string(),
                                message: Some(format!("verification failed {verify_attempts} times")),
                                output: Some(json!({
                                    "session_id": session_id,
                                    "verify_attempts": verify_attempts,
                                    "output_tail": tail,
                                })),
                            };
                        }
                        // Re-arm + feedback prompt, still counting against caps.
                        prompt = format!(
                            "goal claimed met but verification failed:\n{}",
                            verify_feedback_tail(&tail)
                        );
                    }
                },
                GoalWait::Failed { reason } => {
                    return StepOutcome::Failed {
                        code: reason,
                        message: None,
                        output: Some(json!({ "session_id": session_id })),
                    }
                }
                GoalWait::Blocked => match goal.on_blocked {
                    OnBlocked::Fail => return failed("goal_blocked"),
                    OnBlocked::PauseForApproval => {
                        return StepOutcome::AwaitApproval {
                            descriptor: json!({
                                "kind": "goal_block",
                                "session_id": session_id,
                                "message": "goal is blocked; approve to continue",
                            }),
                        }
                    }
                    // Notify never surfaces Blocked here (the wait keeps going).
                    OnBlocked::Notify => {}
                },
                GoalWait::Timeout => {
                    self.clear_goal(&session_id).await;
                    return StepOutcome::Failed {
                        code: "goal_timeout".to_string(),
                        message: Some("goal did not reach a terminal state in time".to_string()),
                        output: Some(json!({ "session_id": session_id })),
                    };
                }
            }
        }
    }

    async fn arm_goal(&self, session_id: &str, goal: &GoalSpec) -> Result<(), StepOutcome> {
        let request = SetSessionGoalRequest {
            objective: Some(goal.objective.clone()),
            status: Some(GoalArmState::Active),
            token_budget: goal.token_budget,
            max_turns: Some(goal.max_turns),
            max_wall_secs: Some(goal.max_wall_secs),
            source_kind: Some(GoalSourceKind::Workflow),
            source_run_id: Some(self.run_id.clone()),
        };
        match self.deps.goal_runtime.set_goal(session_id, request).await {
            Ok(_) => Ok(()),
            Err(GoalOpError::Unsupported) => Err(failed("goals_unsupported")),
            Err(error) => Err(failed_msg("goal_arm_failed", error.to_string())),
        }
    }

    async fn clear_goal(&self, session_id: &str) {
        let _ = self.deps.goal_runtime.clear_goal(session_id).await;
    }

    fn workspace_ctx(&self) -> Result<(PathBuf, Vec<(String, String)>), StepOutcome> {
        let workspace = self
            .deps
            .workspace_runtime
            .get_workspace(&self.workspace_id)
            .map_err(|error| failed_msg("workspace_error", error.to_string()))?
            .ok_or_else(|| failed("workspace_missing"))?;
        let env = self
            .deps
            .workspace_runtime
            .build_workspace_env(&workspace, None)
            .map_err(|error| failed_msg("workspace_env_error", error.to_string()))?;
        Ok((PathBuf::from(&workspace.path), env))
    }

    async fn run_shell(&self, step: &ShellRunStep) -> StepOutcome {
        let (workspace_path, env) = match self.workspace_ctx() {
            Ok(ctx) => ctx,
            Err(outcome) => return outcome,
        };
        commands::run_shell_step(&workspace_path, &env, step).await
    }

    async fn run_scm(&self, step: &ScmOpenPrStep) -> StepOutcome {
        let (workspace_path, env) = match self.workspace_ctx() {
            Ok(ctx) => ctx,
            Err(outcome) => return outcome,
        };
        commands::open_pr_step(&workspace_path, &env, step).await
    }

    fn human_approval(&self, step: &HumanApprovalStep) -> StepOutcome {
        let deadline_at = step.timeout_secs.map(|secs| {
            (chrono::Utc::now() + chrono::Duration::seconds(secs as i64)).to_rfc3339()
        });
        let on_timeout = match step.on_timeout {
            OnTimeout::Fail => "fail",
            OnTimeout::Continue => "continue",
        };
        StepOutcome::AwaitApproval {
            descriptor: json!({
                "kind": "human_approval",
                "message": step.message,
                "on_timeout": on_timeout,
                "timeout_secs": step.timeout_secs,
                "deadline_at": deadline_at,
            }),
        }
    }
}

#[async_trait::async_trait]
impl WorkflowStepExecutor for WorkflowStepExecutorImpl {
    async fn execute_step(&self, step: &PlanStep, _ctx: &StepExecContext) -> StepOutcome {
        match &step.kind {
            StepKind::AgentPrompt(agent) => match &agent.goal {
                None => self.run_prompt(agent).await,
                Some(goal) => self.run_goal(agent, goal).await,
            },
            StepKind::ShellRun(shell) => self.run_shell(shell).await,
            StepKind::ScmOpenPr(pr) => self.run_scm(pr).await,
            StepKind::Notify(notify) => commands::notify_step(notify.channel, &notify.message),
            StepKind::HumanApproval(approval) => self.human_approval(approval),
        }
    }
}

enum TurnWait {
    Ended,
    SessionClosed,
    Timeout,
}

/// Await the end of a turn on the session stream. When `turn_id` is known, only
/// that turn's `TurnEnded` resolves; otherwise the next `TurnEnded` does.
async fn await_turn_ended(
    events: &mut broadcast::Receiver<SessionEventEnvelope>,
    turn_id: Option<&str>,
    backstop: Duration,
) -> TurnWait {
    let deadline = tokio::time::Instant::now() + backstop;
    loop {
        match tokio::time::timeout_at(deadline, events.recv()).await {
            Ok(Ok(envelope)) => match &envelope.event {
                SessionEvent::TurnEnded(_)
                    if turn_id.is_none() || envelope.turn_id.as_deref() == turn_id =>
                {
                    return TurnWait::Ended
                }
                SessionEvent::SessionEnded(_) => return TurnWait::SessionClosed,
                _ => {}
            },
            Ok(Err(broadcast::error::RecvError::Lagged(_))) => continue,
            Ok(Err(broadcast::error::RecvError::Closed)) => return TurnWait::SessionClosed,
            Err(_) => return TurnWait::Timeout,
        }
    }
}

enum GoalWait {
    Met { met_reason: Option<String> },
    Failed { reason: String },
    Blocked,
    Timeout,
}

/// Await a terminal goal state. A cap breach arrives as `GoalUpdated(failed)`
/// carrying `failedReason`. On `blocked`, `notify` keeps waiting (the goal may
/// unblock); `fail`/`pause_for_approval` return `Blocked` for the caller.
async fn await_goal_terminal(
    events: &mut broadcast::Receiver<SessionEventEnvelope>,
    deadline: Instant,
    on_blocked: OnBlocked,
) -> GoalWait {
    let deadline = tokio::time::Instant::from_std(deadline);
    loop {
        match tokio::time::timeout_at(deadline, events.recv()).await {
            Ok(Ok(envelope)) => match &envelope.event {
                SessionEvent::GoalMet(payload) => {
                    return GoalWait::Met {
                        met_reason: payload.goal.met_reason.clone(),
                    }
                }
                SessionEvent::GoalUpdated(payload) => match payload.goal.status {
                    GoalStatus::Failed => {
                        return GoalWait::Failed {
                            reason: payload
                                .goal
                                .failed_reason
                                .clone()
                                .unwrap_or_else(|| "goal_failed".to_string()),
                        }
                    }
                    GoalStatus::Met => {
                        return GoalWait::Met {
                            met_reason: payload.goal.met_reason.clone(),
                        }
                    }
                    GoalStatus::Blocked => match on_blocked {
                        OnBlocked::Notify => continue,
                        _ => return GoalWait::Blocked,
                    },
                    _ => {}
                },
                SessionEvent::GoalCleared(_) => {
                    return GoalWait::Failed {
                        reason: "goal_cleared".to_string(),
                    }
                }
                SessionEvent::SessionEnded(_) => {
                    return GoalWait::Failed {
                        reason: "session_closed".to_string(),
                    }
                }
                _ => {}
            },
            Ok(Err(broadcast::error::RecvError::Lagged(_))) => continue,
            Ok(Err(broadcast::error::RecvError::Closed)) => {
                return GoalWait::Failed {
                    reason: "session_closed".to_string(),
                }
            }
            Err(_) => return GoalWait::Timeout,
        }
    }
}

fn verify_feedback_tail(tail: &str) -> String {
    const MAX: usize = 2000;
    if tail.len() <= MAX {
        return tail.to_string();
    }
    let mut start = tail.len() - MAX;
    while start < tail.len() && !tail.is_char_boundary(start) {
        start += 1;
    }
    tail[start..].to_string()
}

fn failed(code: &str) -> StepOutcome {
    StepOutcome::Failed {
        code: code.to_string(),
        message: None,
        output: None,
    }
}

fn failed_msg(code: &str, message: impl Into<String>) -> StepOutcome {
    StepOutcome::Failed {
        code: code.to_string(),
        message: Some(message.into()),
        output: None,
    }
}
