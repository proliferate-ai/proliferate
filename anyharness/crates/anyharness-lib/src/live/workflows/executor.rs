//! The live [`WorkflowStepExecutor`] implementation: it drives real sessions,
//! goals, shells, PRs, and notifications. It owns run-scoped session continuity
//! (the harness-switch design opens a NEW session when a step's effective
//! harness differs from the current session's) and awaits turn/goal completion
//! off the live session's broadcast stream.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyharness_contract::v1::{
    Goal, GoalArmState, GoalSourceKind, GoalStatus, PromptInputBlock, SessionEvent,
    SessionEventEnvelope, SetSessionGoalRequest,
};
use serde_json::{json, Map, Value};
use tokio::sync::broadcast;

use super::commands;
use super::exec_policy::{bypass_mode_for_kind, WorkflowOwnedSessions};
use crate::domains::goals::runtime::{GoalOpError, GoalRuntime};
use crate::domains::sessions::live_config::ACP_MODEL_COMPAT_CONFIG_ID;
use crate::domains::sessions::runtime::{SendPromptOutcome, SessionRuntime};
use crate::domains::sessions::service::SessionService;
use crate::domains::workflows::engine::{StepExecContext, StepOutcome, WorkflowStepExecutor};
use crate::domains::workflows::model::WorkflowRunRecord;
use crate::domains::workflows::plan::{
    AgentConfigStep, AgentPromptStep, GoalSpec, OnBlocked, PlanSetup, PlanStep, ScmOpenPrStep,
    ShellRunStep, StepKind,
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
    /// The always-bypass safety net (goals-and-workflows-v1 §3.3): sessions
    /// the executor opens are marked here so the inbound permission advisor
    /// auto-approves for a harness that lacks a native bypass mode. Shared with
    /// the live-session wiring's [`WorkflowAutoApproveAdvisor`].
    ///
    /// [`WorkflowAutoApproveAdvisor`]: super::exec_policy::WorkflowAutoApproveAdvisor
    pub workflow_owned_sessions: Arc<WorkflowOwnedSessions>,
}

struct CurrentSession {
    session_id: String,
    harness: String,
}

/// The run's *active agent config*: the harness/model that subsequent agent
/// steps use. Seeded from Setup and mutated only by `agent.config` steps. It is
/// never persisted separately — on crash-resume it is recomputed by replaying
/// the plan prefix (see [`WorkflowStepExecutorImpl::recompute_active_config`]).
#[derive(Clone)]
struct ActiveConfig {
    harness: String,
    model: Option<String>,
}

/// One executor per run. `current` tracks the run's live session for harness
/// continuity; `active` tracks the harness/model agent steps use. Both are
/// hydrated from the run record on resume.
pub struct WorkflowStepExecutorImpl {
    deps: Arc<WorkflowExecDeps>,
    run_id: String,
    workspace_id: String,
    setup: PlanSetup,
    current: Mutex<Option<CurrentSession>>,
    active: Mutex<ActiveConfig>,
}

impl WorkflowStepExecutorImpl {
    pub fn new(
        deps: Arc<WorkflowExecDeps>,
        run_id: String,
        workspace_id: String,
        setup: PlanSetup,
    ) -> Self {
        let active = ActiveConfig {
            harness: setup.harness.clone(),
            model: setup.model.clone(),
        };
        Self {
            deps,
            run_id,
            workspace_id,
            setup,
            current: Mutex::new(None),
            active: Mutex::new(active),
        }
    }

    /// Restore the current-session pointer AND the active agent config from a run
    /// record (crash-resume): the last opened session (harness read back from the
    /// session row) and the config folded from the plan prefix up to the cursor.
    pub fn hydrate_from_run(&self, run: &WorkflowRunRecord) {
        self.recompute_active_config(run);
        let Some(session_id) = run.current_session_id() else {
            return;
        };
        if let Ok(Some(session)) = self.deps.session_service.get_session(session_id) {
            // Re-arm the always-bypass safety net for the resumed session (the
            // registry is in-memory, so a restart would otherwise drop it).
            self.deps.workflow_owned_sessions.mark(session_id);
            *self.current.lock().unwrap() = Some(CurrentSession {
                session_id: session_id.to_string(),
                harness: session.agent_kind,
            });
        }
    }

    /// Recompute the active config by folding every `agent.config` step in the
    /// plan prefix `[0, step_cursor)` over the Setup seed. Derives state purely
    /// from the persisted plan + cursor, so no extra state is stored on resume.
    fn recompute_active_config(&self, run: &WorkflowRunRecord) {
        let mut config = ActiveConfig {
            harness: self.setup.harness.clone(),
            model: self.setup.model.clone(),
        };
        if let Ok(plan) = crate::domains::workflows::plan::parse(&run.plan_json) {
            let cursor = run.step_cursor.max(0) as usize;
            for step in plan.steps.iter().take(cursor) {
                if let StepKind::AgentConfig(cfg) = &step.kind {
                    apply_config(&mut config, cfg);
                }
            }
        }
        *self.active.lock().unwrap() = config;
    }

    async fn ensure_session(&self) -> Result<String, StepOutcome> {
        let (effective_harness, model) = {
            let active = self.active.lock().unwrap();
            (active.harness.clone(), active.model.clone())
        };
        // Reuse the current session only when its harness matches.
        {
            let current = self.current.lock().unwrap();
            if let Some(current) = current.as_ref() {
                if current.harness == effective_harness {
                    return Ok(current.session_id.clone());
                }
            }
        }
        // Exec policy (goals-and-workflows-v1 §3.3 "always bypass"): open the
        // session in the harness's native bypass-equivalent mode so agent turns
        // and native-goal auto-continuation never stall on a permission prompt.
        // `None` (harness with no native bypass mode) is covered by the
        // auto-approve safety net below.
        let mode = bypass_mode_for_kind(&effective_harness);
        let record = self
            .deps
            .session_runtime
            .create_and_start_session(
                &self.workspace_id,
                &effective_harness,
                model.as_deref(),
                mode,
                None,
                Vec::new(),
                None,
                false,
                OriginContext::system_local_runtime(),
            )
            .await
            .map_err(|error| failed_msg("session_start_failed", format!("{error:?}")))?;
        // Register the session as workflow-owned so the inbound permission
        // advisor auto-approves for it (safety net for a harness without a
        // native bypass mode). Done before the first prompt/turn is sent.
        self.deps.workflow_owned_sessions.mark(&record.id);
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
        let session_id = match self.ensure_session().await {
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

    async fn run_goal(&self, agent: &AgentPromptStep, goal: &GoalSpec, step_index: usize) -> StepOutcome {
        let session_id = match self.ensure_session().await {
            Ok(id) => id,
            Err(outcome) => return outcome,
        };
        let deadline =
            Instant::now() + Duration::from_secs(goal.max_wall_secs) + GOAL_BACKSTOP_GRACE;
        let mut prompt = agent.prompt.clone();
        let mut verify_attempts = 0u32;
        // Live progress: while awaiting the goal's terminal state, mirror each
        // changed GoalUpdated into the RUNNING step's output_json under `goal`
        // so the run timeline can render honest iteration/token counters.
        let mut last_snapshot: Option<GoalSnapshot> = None;
        let mut on_progress = |g: &Goal| {
            let snapshot = GoalSnapshot::from_goal(g);
            if goal_progress_changed(last_snapshot.as_ref(), &snapshot) {
                let _ = self.deps.workflow_service.record_step_goal_progress(
                    &self.run_id,
                    step_index as i64,
                    snapshot.to_output_json(&session_id),
                );
                last_snapshot = Some(snapshot);
            }
        };

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
            match await_goal_terminal(&mut events, deadline, goal.on_blocked, &mut on_progress).await {
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

    /// `agent.config` executes instantly: it folds the harness/model onto the
    /// run's active config for every step below. Switching harness opens a NEW
    /// session at the next agent step (`session_switched: true`). A model-only
    /// change on an existing matching-harness session is applied LIVE via the
    /// session's live-config path; with no live session yet it simply takes
    /// effect at the next session creation.
    async fn run_agent_config(&self, cfg: &AgentConfigStep) -> StepOutcome {
        // The current session's harness, before we mutate the active config.
        let (current_session_id, current_harness) = {
            let current = self.current.lock().unwrap();
            match current.as_ref() {
                Some(session) => (Some(session.session_id.clone()), Some(session.harness.clone())),
                None => (None, None),
            }
        };
        // Fold the config change into the active state.
        let new_active = {
            let mut active = self.active.lock().unwrap();
            apply_config(&mut active, cfg);
            active.clone()
        };

        let harness_changed = current_harness
            .as_deref()
            .map(|h| h != new_active.harness)
            .unwrap_or(false);

        let mut session_switched = false;
        if harness_changed {
            // A new session will open on the next agent step (ensure_session
            // sees the harness mismatch). Nothing to do now.
            session_switched = true;
        } else if cfg.model.is_some() {
            // Harness unchanged and the model changed: apply it live to the
            // current session if one exists, else it applies at next creation.
            if let (Some(session_id), Some(model)) = (current_session_id, new_active.model.as_deref())
            {
                let _ = self
                    .deps
                    .session_runtime
                    .set_live_session_config_option(&session_id, ACP_MODEL_COMPAT_CONFIG_ID, model)
                    .await;
            }
        }

        let mut output = Map::new();
        if let Some(harness) = &cfg.harness {
            output.insert("harness".to_string(), Value::String(harness.clone()));
        }
        if let Some(model) = &cfg.model {
            output.insert("model".to_string(), Value::String(model.clone()));
        }
        output.insert("session_switched".to_string(), Value::Bool(session_switched));
        StepOutcome::Completed {
            output: Value::Object(output),
        }
    }

}

#[async_trait::async_trait]
impl WorkflowStepExecutor for WorkflowStepExecutorImpl {
    async fn execute_step(&self, step: &PlanStep, ctx: &StepExecContext) -> StepOutcome {
        match &step.kind {
            StepKind::AgentConfig(cfg) => self.run_agent_config(cfg).await,
            StepKind::AgentPrompt(agent) => match &agent.goal {
                None => self.run_prompt(agent).await,
                Some(goal) => self.run_goal(agent, goal, ctx.step_index).await,
            },
            StepKind::ShellRun(shell) => self.run_shell(shell).await,
            StepKind::ScmOpenPr(pr) => self.run_scm(pr).await,
            StepKind::Notify(notify) => {
                commands::notify_step(&notify.message, &notify.slack_channel_id)
            }
            // TODO(workflows phase C/F): agent.emit re-ask loop (C12) and branch
            // continue/end arm (C11). The plan carries them now; the engine
            // executes them in a later phase. Fail loudly until then so a v2 plan
            // using these can't silently no-op.
            StepKind::AgentEmit(_) => StepOutcome::Failed {
                code: "not_implemented".to_string(),
                message: Some("agent.emit execution lands in a later phase".to_string()),
                output: None,
            },
            StepKind::Branch(_) => StepOutcome::Failed {
                code: "not_implemented".to_string(),
                message: Some("branch execution lands in a later phase".to_string()),
                output: None,
            },
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

#[derive(Debug)]
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
    on_progress: &mut (dyn FnMut(&Goal) + Send),
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
                SessionEvent::GoalUpdated(payload) => {
                    // Mirror every observed goal update as a live progress
                    // snapshot (the callback throttles unchanged values).
                    on_progress(&payload.goal);
                    match payload.goal.status {
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
                    }
                }
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
                // A turn that errors out (API/model failure, connection loss)
                // is fatal to the goal: the agent can no longer make progress,
                // so fail the step immediately rather than waiting out the
                // wall-clock backstop. Note we deliberately do NOT treat
                // `TurnEnded` as terminal — goal iteration ends turns
                // repeatedly, and only an actual error stops progress.
                SessionEvent::Error(payload) => {
                    return GoalWait::Failed {
                        reason: format!("turn_error: {}", payload.message),
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

/// Fold an `agent.config` step onto the active config: only present fields
/// override; absent fields keep the prior active value.
fn apply_config(active: &mut ActiveConfig, cfg: &AgentConfigStep) {
    if let Some(harness) = &cfg.harness {
        active.harness = harness.clone();
    }
    if let Some(model) = &cfg.model {
        active.model = Some(model.clone());
    }
}

/// A throttleable snapshot of an in-flight goal's progress. Two snapshots are
/// "equal" when status, iterations, and tokens are all unchanged.
#[derive(Clone, PartialEq)]
struct GoalSnapshot {
    objective: String,
    status: GoalStatus,
    iterations: Option<i64>,
    tokens_used: Option<i64>,
}

impl GoalSnapshot {
    fn from_goal(goal: &Goal) -> Self {
        Self {
            objective: goal.objective.clone(),
            status: goal.status,
            iterations: goal.iterations,
            tokens_used: goal.tokens_used,
        }
    }

    /// The RUNNING step's output_json body: `{ goal: {...}, session_id }`.
    fn to_output_json(&self, session_id: &str) -> Value {
        let status = serde_json::to_value(self.status)
            .ok()
            .and_then(|v| v.as_str().map(str::to_string))
            .unwrap_or_else(|| "active".to_string());
        json!({
            "goal": {
                "objective": self.objective,
                "status": status,
                "iterations": self.iterations,
                "tokens_used": self.tokens_used,
            },
            "session_id": session_id,
        })
    }
}

/// Throttle rule: write only when status, iterations, or tokens changed from the
/// last written snapshot (the objective is stable within a step).
fn goal_progress_changed(prev: Option<&GoalSnapshot>, next: &GoalSnapshot) -> bool {
    match prev {
        None => true,
        Some(prev) => {
            prev.status != next.status
                || prev.iterations != next.iterations
                || prev.tokens_used != next.tokens_used
        }
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(harness: Option<&str>, model: Option<&str>) -> AgentConfigStep {
        AgentConfigStep {
            harness: harness.map(str::to_string),
            model: model.map(str::to_string),
        }
    }

    #[test]
    fn apply_config_only_overrides_present_fields() {
        let mut active = ActiveConfig {
            harness: "claude".to_string(),
            model: Some("sonnet".to_string()),
        };
        // Model-only change keeps the harness.
        apply_config(&mut active, &cfg(None, Some("opus")));
        assert_eq!(active.harness, "claude");
        assert_eq!(active.model.as_deref(), Some("opus"));
        // Harness-only change keeps the (now folded) model.
        apply_config(&mut active, &cfg(Some("codex"), None));
        assert_eq!(active.harness, "codex");
        assert_eq!(active.model.as_deref(), Some("opus"));
    }

    fn snapshot(status: GoalStatus, iterations: Option<i64>, tokens: Option<i64>) -> GoalSnapshot {
        GoalSnapshot {
            objective: "make CI green".to_string(),
            status,
            iterations,
            tokens_used: tokens,
        }
    }

    #[test]
    fn goal_progress_first_snapshot_always_writes() {
        assert!(goal_progress_changed(None, &snapshot(GoalStatus::Active, Some(1), Some(100))));
    }

    #[test]
    fn goal_progress_throttles_unchanged_values() {
        let prev = snapshot(GoalStatus::Active, Some(3), Some(64_000));
        // Identical snapshot → skip the write.
        assert!(!goal_progress_changed(Some(&prev), &snapshot(GoalStatus::Active, Some(3), Some(64_000))));
        // Any of status / iterations / tokens changing → write.
        assert!(goal_progress_changed(Some(&prev), &snapshot(GoalStatus::Active, Some(4), Some(64_000))));
        assert!(goal_progress_changed(Some(&prev), &snapshot(GoalStatus::Active, Some(3), Some(70_000))));
        assert!(goal_progress_changed(Some(&prev), &snapshot(GoalStatus::Blocked, Some(3), Some(64_000))));
    }

    #[test]
    fn goal_snapshot_output_uses_snake_case_status_and_token_key() {
        let out = snapshot(GoalStatus::Active, Some(3), Some(64_000)).to_output_json("sess_1");
        assert_eq!(out["goal"]["status"], "active");
        assert_eq!(out["goal"]["iterations"], 3);
        assert_eq!(out["goal"]["tokens_used"], 64_000);
        assert_eq!(out["session_id"], "sess_1");
    }

    fn envelope(event: SessionEvent) -> SessionEventEnvelope {
        SessionEventEnvelope {
            session_id: "sess_1".to_string(),
            seq: 1,
            timestamp: "2026-07-05T00:00:00Z".to_string(),
            turn_id: None,
            item_id: None,
            event,
        }
    }

    // Regression: a turn that errors out (bad model, API failure) must fail the
    // goal step immediately, not hang until the wall-clock backstop. Before the
    // `SessionEvent::Error` arm, this waited out `deadline` and returned Timeout.
    #[tokio::test]
    async fn goal_await_fails_fast_on_turn_error() {
        let (tx, mut rx) = broadcast::channel(16);
        let deadline = std::time::Instant::now() + Duration::from_secs(30);
        tx.send(envelope(SessionEvent::Error(
            anyharness_contract::v1::ErrorEvent {
                message: "API Error (claude-fable-5): 400 invalid model".to_string(),
                code: None,
                details: None,
            },
        )))
        .unwrap();
        let mut noop = |_: &Goal| {};
        let result = await_goal_terminal(&mut rx, deadline, OnBlocked::Fail, &mut noop).await;
        match result {
            GoalWait::Failed { reason } => {
                assert!(reason.starts_with("turn_error:"), "reason was {reason}");
                assert!(reason.contains("invalid model"));
            }
            other => panic!("expected Failed on turn error, got {other:?}"),
        }
    }
}
