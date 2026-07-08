//! The live [`WorkflowStepExecutor`] implementation: it drives real sessions,
//! goals, shells, PRs, and notifications. Sessions are slot-keyed (B7): each
//! agent slot owns exactly one session for the run's lifetime (harness is fixed
//! per slot — there is no harness-switch machinery), and turn/goal completion is
//! awaited off the live session's broadcast stream.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyharness_contract::v1::{
    ContentPart, Goal, GoalArmState, GoalSourceKind, GoalStatus, PromptInputBlock, SessionEvent,
    SessionEventEnvelope, SetSessionGoalRequest,
};
use serde_json::{json, Value};
use tokio::sync::broadcast;

use super::commands;
use super::exec_policy::{bypass_mode_for_kind, WorkflowOwnedSessions};
use super::gateway::{fire_run_ping, workflow_gateway_server, RunPingSink, WorkflowGatewaySessions};
use crate::domains::goals::runtime::{GoalOpError, GoalRuntime};
use crate::domains::sessions::live_config::ACP_MODEL_COMPAT_CONFIG_ID;
use crate::domains::sessions::model::SessionMcpBindingPolicy;
use crate::domains::sessions::runtime::{SendPromptOutcome, SessionRuntime};
use crate::domains::sessions::service::SessionService;
use crate::domains::workflows::engine::{StepExecContext, StepOutcome, WorkflowStepExecutor};
use crate::domains::workflows::model::WorkflowRunRecord;
use crate::domains::workflows::plan::{
    AgentConfigStep, AgentEmitStep, AgentPromptStep, BranchStep, BranchTarget, GoalSpec, OnBlocked,
    PlanGateway, PlanStep, RequiredInvocation, ScmOpenPrStep, SessionSpec, ShellRunStep, StepKind,
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
/// Bytes of the emit file retained in the failure output for debugging.
const EMIT_RAW_TAIL: usize = 2 * 1024;
/// The `required_invocation` gate (C14, arch §7.6) re-prompts this many times
/// when the required provider+tool was not invoked within the turn before
/// failing `invocation_missing`.
const MAX_GATE_ATTEMPTS: u32 = 3;

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
    /// Per-run gateway MCP servers, keyed by session id. The executor registers
    /// its workflow-owned session's server here before launch; the launch
    /// extension reads it (§6.4/OPEN-3(a)).
    pub workflow_gateway_sessions: Arc<WorkflowGatewaySessions>,
    /// Fire-and-forget sink for the per-run completion ping (§3.7/L16).
    pub run_ping_sink: Arc<dyn RunPingSink>,
}

#[derive(Clone)]
struct CurrentSession {
    session_id: String,
    #[allow(dead_code)]
    harness: String,
}

/// One executor per run. Sessions are slot-keyed (B7): `current` maps each
/// agent slot to the one live session it owns; `models` tracks the effective
/// model per slot (seeded from the plan's `sessions[slot].model`, mutated by
/// `agent.config` steps — which are model-only, A3). All maps are hydrated from
/// the run record on resume.
pub struct WorkflowStepExecutorImpl {
    deps: Arc<WorkflowExecDeps>,
    run_id: String,
    workspace_id: String,
    /// Per-slot session provisioning, straight from the resolved plan.
    sessions: BTreeMap<String, SessionSpec>,
    /// slot -> the live session opened for it.
    current: Mutex<HashMap<String, CurrentSession>>,
    /// slot -> effective model (base `sessions[slot].model`, folded by
    /// `agent.config`).
    models: Mutex<HashMap<String, Option<String>>>,
    /// The plan's per-run gateway block (§6.4/§3.7). Drives both the
    /// session-launch MCP injection and the completion ping. Cloned from the
    /// plan at construction; recomputed identically on crash-resume (the plan
    /// is re-parsed to build the executor).
    gateway: Option<PlanGateway>,
}

impl WorkflowStepExecutorImpl {
    pub fn new(
        deps: Arc<WorkflowExecDeps>,
        run_id: String,
        workspace_id: String,
        sessions: BTreeMap<String, SessionSpec>,
        gateway: Option<PlanGateway>,
    ) -> Self {
        let models = sessions
            .iter()
            .map(|(slot, spec)| (slot.clone(), spec.model.clone()))
            .collect();
        Self {
            deps,
            run_id,
            workspace_id,
            sessions,
            current: Mutex::new(HashMap::new()),
            models: Mutex::new(models),
            gateway,
        }
    }

    /// Restore the per-slot session map AND per-slot models from a run record
    /// (crash-resume): each slot's bound session (from the persisted slot map)
    /// and the model folded from that slot's `agent.config` steps in the plan
    /// prefix up to the cursor. Derives everything from the persisted plan +
    /// cursor, so no extra state is stored on resume.
    pub fn hydrate_from_run(&self, run: &WorkflowRunRecord) {
        self.recompute_models(run);
        let mut current = self.current.lock().unwrap();
        for (slot, session_id) in run.sessions() {
            if let Ok(Some(session)) = self.deps.session_service.get_session(session_id) {
                // Re-arm the always-bypass safety net for the resumed session
                // (the registry is in-memory, so a restart would otherwise drop
                // it).
                self.deps.workflow_owned_sessions.mark(session_id);
                // Re-register the per-run gateway server too, so a relaunch of
                // the resumed session (crash-resume) re-injects it (same
                // in-memory registry, dropped on restart).
                if let Some(server) = workflow_gateway_server(self.gateway.as_ref()) {
                    self.deps.workflow_gateway_sessions.set(session_id, server);
                }
                current.insert(
                    slot.clone(),
                    CurrentSession {
                        session_id: session_id.clone(),
                        harness: session.agent_kind,
                    },
                );
            }
        }
    }

    /// Recompute per-slot models by folding each slot's `agent.config` steps in
    /// the plan prefix `[0, step_cursor)` over the plan's per-slot seed.
    fn recompute_models(&self, run: &WorkflowRunRecord) {
        let mut models: HashMap<String, Option<String>> = self
            .sessions
            .iter()
            .map(|(slot, spec)| (slot.clone(), spec.model.clone()))
            .collect();
        if let Ok(plan) = crate::domains::workflows::plan::parse(&run.plan_json) {
            let cursor = run.step_cursor.max(0) as usize;
            for step in plan.steps.iter().take(cursor) {
                if let StepKind::AgentConfig(cfg) = &step.kind {
                    if let Some(model) = &cfg.model {
                        models.insert(step.slot.clone(), Some(model.clone()));
                    }
                }
            }
        }
        *self.models.lock().unwrap() = models;
    }

    /// The harness for a slot, from the resolved plan. A slot with no session
    /// spec is a malformed plan (the server always emits one per referenced
    /// slot).
    fn harness_for_slot(&self, slot: &str) -> Result<String, StepOutcome> {
        self.sessions
            .get(slot)
            .map(|spec| spec.harness.clone())
            .ok_or_else(|| failed_msg("plan_malformed", format!("no session spec for slot {slot}")))
    }

    /// Ensure the (single, lifetime) session for `slot` exists, opening it lazily
    /// on first use. Harness is fixed per slot — there is no harness-switch
    /// machinery. A slot carrying `bind_session_id` (L29 / PR F) loads the
    /// existing session instead of creating one; that field is always absent
    /// until the session-plane PR lands.
    async fn ensure_session(&self, slot: &str) -> Result<String, StepOutcome> {
        // §5.3 builder obligation (L22 fail-fast): a gateway block that grants
        // integration scopes but carries no usable gateway in this lane (empty
        // authorization/URL, e.g. the local lane where nothing mints a per-run
        // token) can never hand the agent its tools. Fail explicitly at the
        // first agent step rather than silently launching with zero tools.
        if gateway_functions_unsupported(self.gateway.as_ref()) {
            return Err(failed_msg(
                "functions_unsupported_local",
                "workflow declares gateway integration grants but this run has no usable gateway \
                 (integrations cannot be honored in this lane)",
            ));
        }
        if let Some(current) = self.current.lock().unwrap().get(slot) {
            return Ok(current.session_id.clone());
        }
        let harness = self.harness_for_slot(slot)?;
        let model = self
            .models
            .lock()
            .unwrap()
            .get(slot)
            .cloned()
            .flatten();
        let bind_session_id = self
            .sessions
            .get(slot)
            .and_then(|spec| spec.bind_session_id.clone());

        let (session_id, session_harness) = if let Some(bind_id) = bind_session_id {
            // Session binding (L29): load the pre-existing session. Owned by PR
            // F; today `bind_session_id` is always absent, so this branch is a
            // compiling path, not a live one.
            let session = self
                .deps
                .session_service
                .get_session(&bind_id)
                .map_err(|error| failed_msg("session_bind_failed", error.to_string()))?
                .ok_or_else(|| failed_msg("session_bind_missing", bind_id.clone()))?;
            // Register the per-run gateway MCP server for the bound session too,
            // so a relaunch injects it (same in-memory registry as fresh).
            if let Some(server) = workflow_gateway_server(self.gateway.as_ref()) {
                self.deps.workflow_gateway_sessions.set(&bind_id, server);
            }
            (bind_id, session.agent_kind)
        } else {
            // Exec policy (goals-and-workflows-v1 §3.3 "always bypass"): open the
            // session in the harness's native bypass-equivalent mode so agent
            // turns and native-goal auto-continuation never stall on a
            // permission prompt. `None` (harness with no native bypass mode) is
            // covered by the auto-approve safety net.
            let mode = bypass_mode_for_kind(&harness);
            // Split create/start (as reviews/subagents do) so the per-run gateway
            // server and workflow ownership can be registered BEFORE launch — the
            // launch extension reads both from their in-memory registries, and MCP
            // servers are only assembled from the extension seam (never from the
            // durable session bindings).
            let record = self
                .deps
                .session_runtime
                .create_durable_session(
                    &self.workspace_id,
                    &harness,
                    model.as_deref(),
                    mode,
                    None,
                    Vec::new(),
                    None,
                    SessionMcpBindingPolicy::InheritWorkspace,
                    false,
                    OriginContext::system_local_runtime(),
                )
                .map_err(|error| failed_msg("session_start_failed", format!("{error:?}")))?;
            // Register the session as workflow-owned so the inbound permission
            // advisor auto-approves for it. Done before launch/first turn.
            self.deps.workflow_owned_sessions.mark(&record.id);
            // Register the per-run gateway MCP server for this session so the
            // launch extension injects it (plan block wins over the worker
            // dotfile via the extension ordering + dedupe on
            // connection_id/server_name).
            if let Some(server) = workflow_gateway_server(self.gateway.as_ref()) {
                self.deps.workflow_gateway_sessions.set(&record.id, server);
            }
            let record = self
                .deps
                .session_runtime
                .start_persisted_session(&record)
                .await
                .map_err(|error| failed_msg("session_start_failed", format!("{error:?}")))?;
            (record.id, harness)
        };
        // Register the session as workflow-owned so the inbound permission
        // advisor auto-approves for it. Done before the first prompt/turn.
        self.deps.workflow_owned_sessions.mark(&session_id);
        let _ = self
            .deps
            .workflow_service
            .set_session_for_slot(&self.run_id, slot, &session_id);
        self.current.lock().unwrap().insert(
            slot.to_string(),
            CurrentSession {
                session_id: session_id.clone(),
                harness: session_harness,
            },
        );
        Ok(session_id)
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

    async fn run_prompt(&self, slot: &str, agent: &AgentPromptStep) -> StepOutcome {
        let session_id = match self.ensure_session(slot).await {
            Ok(id) => id,
            Err(outcome) => return outcome,
        };
        // No gate: a single turn suffices.
        let Some(required) = &agent.required_invocation else {
            let mut events = match self.subscribe(&session_id).await {
                Ok(events) => events,
                Err(outcome) => return outcome,
            };
            let turn_id = match self.send_prompt(&session_id, &agent.prompt).await {
                Ok(turn_id) => turn_id,
                Err(outcome) => return outcome,
            };
            return match await_turn_ended(&mut events, turn_id.as_deref(), TURN_BACKSTOP).await {
                TurnWait::Ended => StepOutcome::Completed {
                    output: json!({ "turn_id": turn_id, "session_id": session_id }),
                },
                TurnWait::SessionClosed => failed("session_closed"),
                TurnWait::Timeout => failed("turn_timeout"),
            };
        };
        // The C14 gate (arch §7.6): re-prompt up to MAX_GATE_ATTEMPTS until the
        // provider+tool was invoked within the turn. The attempt budget +
        // exhaustion decision lives in `run_gate_loop` so it can be driven
        // directly by tests without a live session.
        run_gate_loop(
            MAX_GATE_ATTEMPTS,
            &agent.prompt,
            required,
            &session_id,
            |_attempt, prompt| {
                let session_id = session_id.clone();
                async move {
                let mut events = self.subscribe(&session_id).await?;
                let turn_id = self.send_prompt(&session_id, &prompt).await?;
                match await_turn_ended_collecting(&mut events, turn_id.as_deref(), TURN_BACKSTOP)
                    .await
                {
                    (TurnWait::Ended, invoked_tools) => Ok((turn_id, invoked_tools)),
                    (TurnWait::SessionClosed, _) => Err(failed("session_closed")),
                    (TurnWait::Timeout, _) => Err(failed("turn_timeout")),
                }
                }
            },
        )
        .await
    }

    async fn run_goal(&self, slot: &str, agent: &AgentPromptStep, goal: &GoalSpec, step_index: usize) -> StepOutcome {
        let session_id = match self.ensure_session(slot).await {
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

    /// `agent.config` executes instantly and is model-only (A3): it folds the
    /// model onto the step's slot for every later step in that slot. The change
    /// is applied LIVE to the slot's session if one is already open, else it
    /// takes effect at the slot's next session creation. Harness is fixed per
    /// slot — a different harness is a different slot, so there is no
    /// harness-switch machinery.
    async fn run_agent_config(&self, slot: &str, cfg: &AgentConfigStep) -> StepOutcome {
        if let Some(model) = &cfg.model {
            self.models
                .lock()
                .unwrap()
                .insert(slot.to_string(), Some(model.clone()));
            // Apply live to the slot's session if it is already open.
            let session_id = self
                .current
                .lock()
                .unwrap()
                .get(slot)
                .map(|s| s.session_id.clone());
            if let Some(session_id) = session_id {
                let _ = self
                    .deps
                    .session_runtime
                    .set_live_session_config_option(&session_id, ACP_MODEL_COMPAT_CONFIG_ID, model)
                    .await;
            }
        }
        let mut output = serde_json::Map::new();
        if let Some(model) = &cfg.model {
            output.insert("model".to_string(), Value::String(model.clone()));
        }
        output.insert("slot".to_string(), Value::String(slot.to_string()));
        StepOutcome::Completed {
            output: Value::Object(output),
        }
    }

    /// `agent.emit` (§7.3 + §7.4 file-drop): prompt the agent to write a JSON
    /// object to a run/step-scoped file, await the turn, then read + validate
    /// against the (optional) schema. Invalid or missing → re-prompt with the
    /// concrete errors, up to the plan's `max_attempts` (C12: sourced from the
    /// plan, no longer a hardcoded constant); the validated object becomes the
    /// step's entire output. Exhaustion fails `emit_invalid`.
    async fn run_emit(&self, slot: &str, step: &AgentEmitStep, step_index: usize) -> StepOutcome {
        let session_id = match self.ensure_session(slot).await {
            Ok(id) => id,
            Err(outcome) => return outcome,
        };
        let (workspace_path, _env) = match self.workspace_ctx() {
            Ok(ctx) => ctx,
            Err(outcome) => return outcome,
        };
        let emit_path = emit_file_path(&workspace_path, &self.run_id, step_index);
        // Ensure the drop directory exists and clear any stale file so a prior
        // attempt/run can't be read as this attempt's output.
        if let Some(parent) = emit_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::remove_file(&emit_path);

        let initial_prompt = format!("{}\n\n{}", step.prompt, emit_instruction(&emit_path));
        // C12: `max_attempts` is sourced from the plan (never hardcoded); the
        // attempt-budget + exhaustion decision lives in `run_emit_loop` so it
        // can be driven directly by tests without a live session.
        let max_attempts = step.max_attempts.max(1);

        run_emit_loop(max_attempts, initial_prompt, |_attempt, prompt| {
            let session_id = session_id.clone();
            let emit_path = emit_path.clone();
            async move {
                // Subscribe BEFORE prompting so a fast TurnEnded is never missed.
                let mut events = self.subscribe(&session_id).await?;
                let turn_id = self.send_prompt(&session_id, &prompt).await?;
                match await_turn_ended(&mut events, turn_id.as_deref(), TURN_BACKSTOP).await {
                    TurnWait::Ended => {}
                    TurnWait::SessionClosed => return Err(failed("session_closed")),
                    TurnWait::Timeout => return Err(failed("turn_timeout")),
                }
                match read_and_validate_emit(&emit_path, step.output_schema.as_ref()) {
                    EmitCheck::Valid(value) => {
                        let _ = std::fs::remove_file(&emit_path);
                        Ok(EmitAttempt::Valid(value))
                    }
                    EmitCheck::Invalid { errors, raw_tail } => Ok(EmitAttempt::Invalid {
                        next_prompt: emit_corrective_prompt(&emit_path, &errors),
                        errors,
                        raw_tail,
                    }),
                }
            }
        })
        .await
    }

    /// `branch` (C11/D3): the `on` template was late-bound to a value by the
    /// resolver, so it arrives as a literal here. Match it against the cases and
    /// route: `continue` advances normally (`Completed`), `end` ends the run
    /// (`EndRun`, E5). An unmatched value fails `branch_unmatched` (on_fail
    /// applies).
    fn run_branch(&self, step: &BranchStep) -> StepOutcome {
        evaluate_branch(step)
    }
}

/// `branch` (C11/D3), pure: match `step.on`'s (already late-bound) value
/// against `step.cases` and route. `continue` advances normally
/// (`Completed`); `end` ends the run (`EndRun`, E5). An unmatched value fails
/// `branch_unmatched` (the step's `on_fail` policy applies from there). Free
/// function (rather than a method) so it can be driven directly by tests
/// without constructing a live executor.
fn evaluate_branch(step: &BranchStep) -> StepOutcome {
    let value = step.on.clone();
    match step.cases.get(&value) {
        Some(case) => {
            let target_slug = match case.to {
                BranchTarget::Continue => "continue",
                BranchTarget::End => "end",
            };
            let output = json!({ "value": value, "target": target_slug });
            match case.to {
                BranchTarget::Continue => StepOutcome::Completed { output },
                BranchTarget::End => StepOutcome::EndRun { output },
            }
        }
        None => StepOutcome::Failed {
            code: "branch_unmatched".to_string(),
            message: Some(format!("branch value {value:?} matched no case")),
            output: Some(json!({ "value": value })),
        },
    }
}

#[async_trait::async_trait]
impl WorkflowStepExecutor for WorkflowStepExecutorImpl {
    async fn execute_step(&self, step: &PlanStep, ctx: &StepExecContext) -> StepOutcome {
        let slot = step.slot.as_str();
        match &step.kind {
            StepKind::AgentConfig(cfg) => self.run_agent_config(slot, cfg).await,
            StepKind::AgentPrompt(agent) => match &agent.goal {
                None => self.run_prompt(slot, agent).await,
                Some(goal) => self.run_goal(slot, agent, goal, ctx.step_index).await,
            },
            StepKind::AgentEmit(emit) => self.run_emit(slot, emit, ctx.step_index).await,
            StepKind::ShellRun(shell) => self.run_shell(shell).await,
            StepKind::ScmOpenPr(pr) => self.run_scm(pr).await,
            StepKind::Notify(notify) => {
                commands::notify_step(&notify.message, &notify.slack_channel_id)
            }
            StepKind::Branch(branch) => self.run_branch(branch),
        }
    }

    /// §3.7/L16: fire the per-run completion ping after each applied transition.
    /// No gateway block → no ping. Fire-and-forget via the injected sink.
    fn on_step_transition(&self) {
        fire_run_ping(self.gateway.as_ref(), self.deps.run_ping_sink.as_ref());
    }
}

/// §5.3: a gateway block declaring integration grants that this lane cannot
/// honor — non-empty `integrations` with an empty/absent credential or URL —
/// must fail the run explicitly rather than silently launch the agent with zero
/// tools.
fn gateway_functions_unsupported(gateway: Option<&PlanGateway>) -> bool {
    match gateway {
        Some(gateway) => {
            !gateway.integrations.is_empty()
                && (gateway.authorization.trim().is_empty() || gateway.url.trim().is_empty())
        }
        None => false,
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

/// Like [`await_turn_ended`], but also collects the native tool names invoked
/// during the turn (from `ToolCall` content parts on item events) so the C14
/// gate can check whether the required provider+tool was invoked.
async fn await_turn_ended_collecting(
    events: &mut broadcast::Receiver<SessionEventEnvelope>,
    turn_id: Option<&str>,
    backstop: Duration,
) -> (TurnWait, Vec<String>) {
    let deadline = tokio::time::Instant::now() + backstop;
    let mut tools: Vec<String> = Vec::new();
    loop {
        match tokio::time::timeout_at(deadline, events.recv()).await {
            Ok(Ok(envelope)) => {
                // Only collect tool calls that belong to this turn (or any, when
                // the turn id is unknown).
                if turn_id.is_none() || envelope.turn_id.as_deref() == turn_id {
                    collect_tool_names(&envelope.event, &mut tools);
                }
                match &envelope.event {
                    SessionEvent::TurnEnded(_)
                        if turn_id.is_none() || envelope.turn_id.as_deref() == turn_id =>
                    {
                        return (TurnWait::Ended, tools)
                    }
                    SessionEvent::SessionEnded(_) => return (TurnWait::SessionClosed, tools),
                    _ => {}
                }
            }
            Ok(Err(broadcast::error::RecvError::Lagged(_))) => continue,
            Ok(Err(broadcast::error::RecvError::Closed)) => return (TurnWait::SessionClosed, tools),
            Err(_) => return (TurnWait::Timeout, tools),
        }
    }
}

/// Push every `ToolCall` native tool name carried by an item event into `out`.
fn collect_tool_names(event: &SessionEvent, out: &mut Vec<String>) {
    let parts: &[ContentPart] = match event {
        SessionEvent::ItemStarted(e) => &e.item.content_parts,
        SessionEvent::ItemCompleted(e) => &e.item.content_parts,
        SessionEvent::ItemDelta(e) => {
            for parts in e
                .delta
                .replace_content_parts
                .iter()
                .chain(e.delta.append_content_parts.iter())
            {
                push_tool_names(parts, out);
            }
            return;
        }
        _ => return,
    };
    push_tool_names(parts, out);
}

fn push_tool_names(parts: &[ContentPart], out: &mut Vec<String>) {
    for part in parts {
        if let ContentPart::ToolCall {
            native_tool_name: Some(name),
            ..
        } = part
        {
            out.push(name.clone());
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

// --- C14 required_invocation gate helpers (arch §7.6) ---

/// Was the required provider+tool invoked among the turn's observed tool names?
fn invocation_present(invoked_tools: &[String], required: &RequiredInvocation) -> bool {
    invoked_tools
        .iter()
        .any(|name| invocation_matches(name, &required.provider, &required.tool))
}

/// Does a native tool name identify the given gateway provider+tool? The gateway
/// exposes MCP tools as `mcp__<provider>__<tool>`; we also accept the bare
/// `<provider>__<tool>` and `<provider>.<tool>` spellings different harnesses
/// surface, matched case-insensitively.
fn invocation_matches(native_tool_name: &str, provider: &str, tool: &str) -> bool {
    let name = native_tool_name.to_ascii_lowercase();
    let provider = provider.to_ascii_lowercase();
    let tool = tool.to_ascii_lowercase();
    let candidates = [
        format!("mcp__{provider}__{tool}"),
        format!("{provider}__{tool}"),
        format!("{provider}.{tool}"),
    ];
    candidates.iter().any(|candidate| name == *candidate)
        // Tolerate a provider-prefixed name whose suffix is the tool (e.g. a
        // `mcp__sentry__` prefix followed by the tool with extra qualifiers).
        || (name.contains(&provider) && name.ends_with(&tool))
}

/// The re-ask sent when the required invocation was not observed.
fn gate_corrective_prompt(original: &str, required: &RequiredInvocation) -> String {
    format!(
        "{original}\n\nYou did not call the required tool `{}` from `{}`. You MUST invoke that \
         tool before finishing.",
        required.tool, required.provider
    )
}

/// The C14 gate loop's attempt-budget + exhaustion control flow, decoupled from
/// live I/O: `attempt(i, prompt)` performs one turn (send + await + collect
/// invoked tool names) and returns `Ok((turn_id, invoked_tools))`, or `Err` on a
/// hard failure (session closed / timeout / send failed) that ends the loop
/// immediately. Colocated (rather than folded into `run_prompt`) so the
/// attempt-count + exhaustion decision can be driven directly by tests without
/// a live session.
async fn run_gate_loop<Attempt, Fut>(
    attempts: u32,
    original_prompt: &str,
    required: &RequiredInvocation,
    session_id: &str,
    mut attempt: Attempt,
) -> StepOutcome
where
    Attempt: FnMut(u32, String) -> Fut,
    Fut: std::future::Future<Output = Result<(Option<String>, Vec<String>), StepOutcome>>,
{
    let mut prompt = original_prompt.to_string();
    for i in 0..attempts {
        let (turn_id, invoked_tools) = match attempt(i, prompt.clone()).await {
            Ok(v) => v,
            Err(outcome) => return outcome,
        };
        if invocation_present(&invoked_tools, required) {
            return StepOutcome::Completed {
                output: json!({
                    "turn_id": turn_id,
                    "session_id": session_id,
                    "required_invocation": { "provider": required.provider, "tool": required.tool },
                }),
            };
        }
        // Missing invocation: re-prompt with the concrete requirement, still
        // counting against the gate budget.
        if i + 1 < attempts {
            prompt = gate_corrective_prompt(original_prompt, required);
        }
    }
    gate_exhausted_outcome(attempts, required, session_id)
}

/// The terminal outcome when the C14 gate never observed the required
/// invocation within the attempt budget.
fn gate_exhausted_outcome(
    attempts: u32,
    required: &RequiredInvocation,
    session_id: &str,
) -> StepOutcome {
    StepOutcome::Failed {
        code: "invocation_missing".to_string(),
        message: Some(format!(
            "required invocation {}::{} was not observed after {} attempts",
            required.provider, required.tool, attempts
        )),
        output: Some(json!({ "session_id": session_id })),
    }
}

// --- agent.emit file-drop helpers (§7.3 + §7.4) ---

/// The file an `agent.emit` step's agent must drop its JSON object at:
/// `<workspace>/.proliferate/emit-<run_id>-<step_index>.json`.
fn emit_file_path(workspace_path: &Path, run_id: &str, step_index: usize) -> PathBuf {
    workspace_path
        .join(".proliferate")
        .join(format!("emit-{run_id}-{step_index}.json"))
}

/// The §7.4 file-drop instruction appended to the emit prompt.
fn emit_instruction(path: &Path) -> String {
    format!(
        "When you are done, write ONLY the JSON object (no prose, no code fences) to the file \
         `{}`. Overwrite the file if it already exists.",
        path.display()
    )
}

/// The corrective message re-prompted after an invalid or missing emit, carrying
/// the concrete validation errors so the agent can fix them.
fn emit_corrective_prompt(path: &Path, errors: &[String]) -> String {
    format!(
        "The JSON object you wrote did not satisfy the required schema:\n{}\n\nPlease write ONLY a \
         corrected JSON object (no prose, no code fences) to `{}`, overwriting it.",
        errors.join("\n"),
        path.display()
    )
}

/// The terminal outcome when `agent.emit` never produced a schema-valid object.
fn emit_exhausted_outcome(
    max_attempts: u32,
    errors: Vec<String>,
    raw_tail: Option<String>,
) -> StepOutcome {
    StepOutcome::Failed {
        code: "emit_invalid".to_string(),
        message: Some(format!(
            "agent did not emit a schema-valid object after {max_attempts} attempts"
        )),
        output: Some(json!({ "errors": errors, "raw_tail": raw_tail })),
    }
}

/// Outcome of one `agent.emit` attempt fed to [`run_emit_loop`].
enum EmitAttempt {
    Valid(Value),
    Invalid {
        /// The corrective prompt for the next attempt.
        next_prompt: String,
        errors: Vec<String>,
        raw_tail: Option<String>,
    },
}

/// The `agent.emit` attempt loop's control flow (C12), decoupled from live
/// I/O: `attempt(i, prompt)` performs one turn + reads/validates the emit
/// file, returning `Ok(EmitAttempt)`, or `Err` on a hard failure (session
/// closed / timeout / send failed) that ends the loop immediately.
/// `max_attempts` is always sourced from the plan step, never hardcoded.
/// Colocated so the attempt-budget + exhaustion decision can be driven
/// directly by tests without a live session.
async fn run_emit_loop<Attempt, Fut>(
    max_attempts: u32,
    initial_prompt: String,
    mut attempt: Attempt,
) -> StepOutcome
where
    Attempt: FnMut(u32, String) -> Fut,
    Fut: std::future::Future<Output = Result<EmitAttempt, StepOutcome>>,
{
    let mut prompt = initial_prompt;
    let mut last_errors: Vec<String> = Vec::new();
    let mut last_raw_tail: Option<String> = None;
    for i in 0..max_attempts {
        match attempt(i, prompt).await {
            Ok(EmitAttempt::Valid(value)) => return StepOutcome::Completed { output: value },
            Ok(EmitAttempt::Invalid {
                next_prompt,
                errors,
                raw_tail,
            }) => {
                prompt = next_prompt;
                last_errors = errors;
                last_raw_tail = raw_tail;
            }
            Err(outcome) => return outcome,
        }
    }
    emit_exhausted_outcome(max_attempts, last_errors, last_raw_tail)
}

/// Outcome of reading + schema-validating the emit file.
enum EmitCheck {
    Valid(Value),
    Invalid {
        errors: Vec<String>,
        /// Last ~2KB of the file, present only when the file existed.
        raw_tail: Option<String>,
    },
}

/// Read the emit file and validate it against `schema` (when one is present; a
/// schema-less emit accepts any valid JSON value). A missing file, unparseable
/// JSON, and schema-invalid content all map to `Invalid` with concrete,
/// agent-actionable error strings.
fn read_and_validate_emit(path: &Path, schema: Option<&Value>) -> EmitCheck {
    let contents = match std::fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(_) => {
            return EmitCheck::Invalid {
                errors: vec![format!("file not found at {}", path.display())],
                raw_tail: None,
            }
        }
    };
    let raw_tail = Some(emit_raw_tail(&contents));
    let value: Value = match serde_json::from_str(&contents) {
        Ok(value) => value,
        Err(error) => {
            return EmitCheck::Invalid {
                errors: vec![format!("emit file is not valid JSON: {error}")],
                raw_tail,
            }
        }
    };
    let errors = match schema {
        Some(schema) => validate_against_schema(&value, schema),
        None => Vec::new(),
    };
    if errors.is_empty() {
        EmitCheck::Valid(value)
    } else {
        EmitCheck::Invalid { errors, raw_tail }
    }
}

/// Collect human-readable schema-validation errors (empty = valid). A schema
/// that itself fails to compile surfaces as a single error rather than a panic.
fn validate_against_schema(value: &Value, schema: &Value) -> Vec<String> {
    match jsonschema::validator_for(schema) {
        Ok(validator) => validator
            .iter_errors(value)
            .map(|error| error.to_string())
            .collect(),
        Err(error) => vec![format!("invalid output_schema: {error}")],
    }
}

/// Keep the last `EMIT_RAW_TAIL` bytes of the file, on a char boundary.
fn emit_raw_tail(text: &str) -> String {
    if text.len() <= EMIT_RAW_TAIL {
        return text.to_string();
    }
    let mut start = text.len() - EMIT_RAW_TAIL;
    while start < text.len() && !text.is_char_boundary(start) {
        start += 1;
    }
    text[start..].to_string()
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

    // --- C14 required_invocation gate ---

    fn required(provider: &str, tool: &str) -> RequiredInvocation {
        RequiredInvocation {
            provider: provider.to_string(),
            tool: tool.to_string(),
        }
    }

    fn plan_gateway(integrations: Vec<String>) -> PlanGateway {
        PlanGateway {
            url: "https://cloud.test/mcp".to_string(),
            authorization: "Bearer per-run".to_string(),
            ping_url: "https://cloud.test/ping".to_string(),
            integrations,
        }
    }

    #[test]
    fn functions_unsupported_only_when_grants_lack_a_usable_gateway() {
        // No gateway at all → supported (nothing granted).
        assert!(!gateway_functions_unsupported(None));
        // Gateway with no integration grants → supported (ping-only token).
        assert!(!gateway_functions_unsupported(Some(&plan_gateway(Vec::new()))));
        // Grants + a usable gateway → supported.
        assert!(!gateway_functions_unsupported(Some(&plan_gateway(vec![
            "issues".to_string()
        ]))));
        // Grants but empty authorization → unsupported (local lane).
        let mut gw = plan_gateway(vec!["issues".to_string()]);
        gw.authorization = "  ".to_string();
        assert!(gateway_functions_unsupported(Some(&gw)));
        // Grants but empty URL → unsupported.
        let mut gw = plan_gateway(vec!["issues".to_string()]);
        gw.url = String::new();
        assert!(gateway_functions_unsupported(Some(&gw)));
    }

    #[test]
    fn invocation_matches_mcp_and_bare_spellings() {
        assert!(invocation_matches("mcp__linear__update_status", "linear", "update_status"));
        assert!(invocation_matches("linear__update_status", "linear", "update_status"));
        assert!(invocation_matches("linear.update_status", "linear", "update_status"));
        // Case-insensitive.
        assert!(invocation_matches("MCP__Linear__Update_Status", "linear", "update_status"));
        // Wrong tool / provider does not match.
        assert!(!invocation_matches("mcp__linear__create_issue", "linear", "update_status"));
        assert!(!invocation_matches("mcp__sentry__update_status", "linear", "update_status"));
        assert!(!invocation_matches("read_file", "linear", "update_status"));
    }

    #[test]
    fn invocation_present_scans_all_observed_tools() {
        let tools = vec!["read_file".to_string(), "mcp__linear__update_status".to_string()];
        assert!(invocation_present(&tools, &required("linear", "update_status")));
        assert!(!invocation_present(&tools, &required("slack", "post_message")));
        assert!(!invocation_present(&[], &required("linear", "update_status")));
    }

    // --- agent.emit schema validation ---

    #[test]
    fn emit_missing_file_is_invalid() {
        let dir = std::env::temp_dir().join(format!("emit-test-{}", std::process::id()));
        let path = emit_file_path(&dir, "run-x", 7);
        match read_and_validate_emit(&path, None) {
            EmitCheck::Invalid { errors, raw_tail } => {
                assert!(errors[0].contains("file not found"));
                assert!(raw_tail.is_none());
            }
            EmitCheck::Valid(_) => panic!("missing file must be invalid"),
        }
    }

    #[test]
    fn emit_validates_against_schema() {
        let dir = std::env::temp_dir().join(format!("emit-ok-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("out.json");
        std::fs::write(&path, r#"{"verdict": "ship"}"#).unwrap();
        let schema = json!({
            "type": "object",
            "required": ["verdict"],
            "properties": { "verdict": { "type": "string" } }
        });
        assert!(matches!(
            read_and_validate_emit(&path, Some(&schema)),
            EmitCheck::Valid(_)
        ));
        // A value that violates the schema is Invalid with concrete errors.
        std::fs::write(&path, r#"{"verdict": 42}"#).unwrap();
        match read_and_validate_emit(&path, Some(&schema)) {
            EmitCheck::Invalid { errors, .. } => assert!(!errors.is_empty()),
            EmitCheck::Valid(_) => panic!("schema violation must be invalid"),
        }
        // Schema-less emit accepts any valid JSON object.
        assert!(matches!(
            read_and_validate_emit(&path, None),
            EmitCheck::Valid(_)
        ));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn collect_tool_names_pulls_from_item_events() {
        use anyharness_contract::v1::{ItemCompletedEvent, TranscriptItemKind, TranscriptItemPayload, TranscriptItemStatus};
        let item = TranscriptItemPayload {
            kind: TranscriptItemKind::ToolInvocation,
            status: TranscriptItemStatus::Completed,
            source_agent_kind: "claude".to_string(),
            is_transient: false,
            message_id: None,
            prompt_id: None,
            title: None,
            tool_call_id: None,
            native_tool_name: None,
            parent_tool_call_id: None,
            raw_input: None,
            raw_output: None,
            content_parts: vec![ContentPart::ToolCall {
                tool_call_id: "tc1".to_string(),
                title: "Update status".to_string(),
                tool_kind: None,
                native_tool_name: Some("mcp__linear__update_status".to_string()),
            }],
            prompt_provenance: None,
        };
        let mut out = Vec::new();
        collect_tool_names(&SessionEvent::ItemCompleted(ItemCompletedEvent { item }), &mut out);
        assert_eq!(out, vec!["mcp__linear__update_status".to_string()]);
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

    // --- C11 branch (deny-path floor: run_branch driven directly) ---

    fn branch_step(on: &str) -> BranchStep {
        use crate::domains::workflows::plan::BranchCase;
        let mut cases = BTreeMap::new();
        cases.insert(
            "ship".to_string(),
            BranchCase {
                to: BranchTarget::Continue,
            },
        );
        cases.insert(
            "wont_fix".to_string(),
            BranchCase {
                to: BranchTarget::End,
            },
        );
        BranchStep {
            on: on.to_string(),
            cases,
            reason: None,
        }
    }

    #[test]
    fn branch_continue_case_completes_with_continue_shape() {
        let outcome = evaluate_branch(&branch_step("ship"));
        match outcome {
            StepOutcome::Completed { output } => {
                assert_eq!(output["value"], "ship");
                assert_eq!(output["target"], "continue");
            }
            other => panic!("expected Completed, got {other:?}"),
        }
    }

    #[test]
    fn branch_end_case_ends_the_run() {
        // E5: the taken `end` case must surface as EndRun (terminal `completed`,
        // later steps `skipped`), not a plain Completed.
        let outcome = evaluate_branch(&branch_step("wont_fix"));
        match outcome {
            StepOutcome::EndRun { output } => {
                assert_eq!(output["value"], "wont_fix");
                assert_eq!(output["target"], "end");
            }
            other => panic!("expected EndRun, got {other:?}"),
        }
    }

    #[test]
    fn branch_unmatched_value_fails() {
        let outcome = evaluate_branch(&branch_step("neither_case"));
        match outcome {
            StepOutcome::Failed {
                code,
                message,
                output,
            } => {
                assert_eq!(code, "branch_unmatched");
                assert!(message.unwrap().contains("neither_case"));
                assert_eq!(output.unwrap()["value"], "neither_case");
            }
            other => panic!("expected Failed(branch_unmatched), got {other:?}"),
        }
    }

    // --- C14 gate loop (deny-path floor: run_gate_loop driven directly) ---

    #[tokio::test]
    async fn gate_loop_exhausts_invocation_missing_when_tool_never_called() {
        let required = required("linear", "update_status");
        let attempts_seen = std::sync::atomic::AtomicU32::new(0);
        let outcome = run_gate_loop(
            MAX_GATE_ATTEMPTS,
            "do the thing",
            &required,
            "sess_1",
            |attempt, _prompt| {
                assert_eq!(attempt, attempts_seen.load(std::sync::atomic::Ordering::SeqCst));
                attempts_seen.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                // The tool is never invoked across any attempt.
                async move { Ok((Some(format!("turn-{attempt}")), Vec::<String>::new())) }
            },
        )
        .await;

        assert_eq!(
            attempts_seen.load(std::sync::atomic::Ordering::SeqCst),
            MAX_GATE_ATTEMPTS,
            "the loop must exhaust the full attempt budget before failing"
        );
        match outcome {
            StepOutcome::Failed {
                code,
                message,
                output,
            } => {
                assert_eq!(code, "invocation_missing");
                let message = message.unwrap();
                assert!(message.contains("linear::update_status"));
                assert!(message.contains(&MAX_GATE_ATTEMPTS.to_string()));
                assert_eq!(output.unwrap()["session_id"], "sess_1");
            }
            other => panic!("expected Failed(invocation_missing), got {other:?}"),
        }
    }

    #[tokio::test]
    async fn gate_loop_re_prompts_with_corrective_text_between_attempts() {
        let required = required("linear", "update_status");
        let prompts_seen = std::sync::Mutex::new(Vec::<String>::new());
        let _ = run_gate_loop(
            MAX_GATE_ATTEMPTS,
            "original prompt",
            &required,
            "sess_1",
            |_attempt, prompt| {
                prompts_seen.lock().unwrap().push(prompt);
                async { Ok((None, Vec::<String>::new())) }
            },
        )
        .await;
        let prompts = prompts_seen.into_inner().unwrap();
        assert_eq!(prompts.len() as u32, MAX_GATE_ATTEMPTS);
        // Attempt 0 gets the original prompt verbatim...
        assert_eq!(prompts[0], "original prompt");
        // ...every subsequent attempt gets the corrective re-prompt naming the
        // missing tool, and does NOT regress back to the original text.
        for prompt in &prompts[1..] {
            assert_ne!(prompt, "original prompt");
            assert!(prompt.contains("update_status"));
            assert!(prompt.contains("linear"));
        }
    }

    #[tokio::test]
    async fn gate_loop_completes_when_invocation_observed() {
        let required = required("linear", "update_status");
        let outcome = run_gate_loop(
            MAX_GATE_ATTEMPTS,
            "do the thing",
            &required,
            "sess_1",
            |_attempt, _prompt| async {
                Ok((
                    Some("turn-1".to_string()),
                    vec!["mcp__linear__update_status".to_string()],
                ))
            },
        )
        .await;
        match outcome {
            StepOutcome::Completed { output } => {
                assert_eq!(output["required_invocation"]["provider"], "linear");
                assert_eq!(output["required_invocation"]["tool"], "update_status");
            }
            other => panic!("expected Completed, got {other:?}"),
        }
    }

    // --- C12 emit loop (deny-path floor: run_emit_loop driven directly) ---

    #[tokio::test]
    async fn emit_loop_exhausts_emit_invalid_using_the_plans_max_attempts() {
        // Deliberately NOT the hardcoded-3 default used elsewhere, to prove
        // max_attempts is plan-sourced (C12).
        let plan_max_attempts: u32 = 5;
        let attempts_seen = std::sync::atomic::AtomicU32::new(0);
        let outcome = run_emit_loop(
            plan_max_attempts,
            "emit the verdict".to_string(),
            |attempt, _prompt| {
                assert_eq!(attempt, attempts_seen.load(std::sync::atomic::Ordering::SeqCst));
                attempts_seen.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                async move {
                    // Output never validates, across every attempt.
                    Ok(EmitAttempt::Invalid {
                        next_prompt: format!("fix it (attempt {attempt})"),
                        errors: vec!["missing required field verdict".to_string()],
                        raw_tail: Some("{}".to_string()),
                    })
                }
            },
        )
        .await;

        assert_eq!(
            attempts_seen.load(std::sync::atomic::Ordering::SeqCst),
            plan_max_attempts,
            "the loop must use the plan's max_attempts, not a hardcoded 3"
        );
        match outcome {
            StepOutcome::Failed {
                code,
                message,
                output,
            } => {
                assert_eq!(code, "emit_invalid");
                assert!(message.unwrap().contains(&plan_max_attempts.to_string()));
                let output = output.unwrap();
                assert_eq!(output["errors"][0], "missing required field verdict");
                assert_eq!(output["raw_tail"], "{}");
            }
            other => panic!("expected Failed(emit_invalid), got {other:?}"),
        }
    }

    #[tokio::test]
    async fn emit_loop_uses_the_corrective_prompt_on_retry() {
        let seen_prompts = std::sync::Mutex::new(Vec::<String>::new());
        let _ = run_emit_loop(3, "initial prompt".to_string(), |_attempt, prompt| {
            seen_prompts.lock().unwrap().push(prompt);
            async {
                Ok(EmitAttempt::Invalid {
                    next_prompt: "corrective prompt".to_string(),
                    errors: vec!["bad".to_string()],
                    raw_tail: None,
                })
            }
        })
        .await;
        let prompts = seen_prompts.into_inner().unwrap();
        assert_eq!(prompts, vec!["initial prompt", "corrective prompt", "corrective prompt"]);
    }

    #[tokio::test]
    async fn emit_loop_completes_on_first_valid_attempt() {
        let outcome = run_emit_loop(5, "emit".to_string(), |attempt, _prompt| async move {
            if attempt == 0 {
                Ok(EmitAttempt::Invalid {
                    next_prompt: "retry".to_string(),
                    errors: vec!["bad".to_string()],
                    raw_tail: None,
                })
            } else {
                Ok(EmitAttempt::Valid(json!({ "verdict": "ship" })))
            }
        })
        .await;
        match outcome {
            StepOutcome::Completed { output } => assert_eq!(output["verdict"], "ship"),
            other => panic!("expected Completed, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn emit_loop_propagates_hard_failure_immediately_without_exhausting_attempts() {
        let attempts_seen = std::sync::atomic::AtomicU32::new(0);
        let outcome = run_emit_loop(5, "emit".to_string(), |_attempt, _prompt| {
            attempts_seen.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            async { Err(failed("session_closed")) }
        })
        .await;
        assert_eq!(attempts_seen.load(std::sync::atomic::Ordering::SeqCst), 1);
        match outcome {
            StepOutcome::Failed { code, .. } => assert_eq!(code, "session_closed"),
            other => panic!("expected Failed(session_closed), got {other:?}"),
        }
    }
}
