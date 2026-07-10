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
    ContentPart, Goal, GoalArmState, GoalSourceKind, GoalStatus, SessionEvent, SessionEventEnvelope,
    SetSessionGoalRequest,
};
use serde_json::{json, Value};
use tokio::sync::broadcast;

use super::commands;
use super::exec_policy::{bypass_mode_for_kind, WorkflowOwnedSessions};
use super::gateway::{fire_run_ping, workflow_gateway_server, RunPingSink, WorkflowGatewaySessions};
use crate::domains::goals::runtime::{GoalOpError, GoalRuntime};
use crate::domains::sessions::live_config::ACP_MODEL_COMPAT_CONFIG_ID;
use crate::domains::sessions::model::SessionMcpBindingPolicy;
use crate::domains::sessions::prompt::provenance::PromptProvenance;
use crate::domains::sessions::runtime::{SendPromptOutcome, SessionRuntime};
use crate::domains::sessions::service::SessionService;
use crate::domains::workflows::engine::{StepExecContext, StepOutcome, WorkflowStepExecutor};
use crate::domains::workflows::model::WorkflowRunRecord;
use crate::domains::workflows::plan::{
    worktree_scope, AgentConfigStep, AgentEmitStep, AgentPromptStep, BranchStep, BranchTarget,
    GoalSpec, Isolation, OnBlocked, PlanGateway, PlanStep, RequiredInvocation, ScmOpenPrStep,
    SessionSpec, ShellRunStep, StepKind, NO_LANE,
};
use crate::domains::workflows::service::WorkflowService;
use crate::domains::workspaces::creator_context::WorkspaceCreatorContext;
use crate::domains::workspaces::model::WorkspaceKind;
use crate::domains::workspaces::runtime::WorkspaceRuntime;
use crate::domains::workspaces::worktree_names::WorktreeNameConflictPolicy;
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

/// The step identity carried into a prompt injection so it can be stamped with
/// `PromptProvenance::Workflow` and recorded in `workflow_session_injections`
/// (C10 / E9).
struct InjectionMeta {
    step_key: String,
    kind: String,
    label: String,
}

impl InjectionMeta {
    fn from_step(step: &PlanStep) -> Self {
        Self {
            step_key: step.key.clone(),
            kind: step.kind_slug().to_string(),
            label: step.label.clone(),
        }
    }
}

/// One executor per run. Sessions are slot-keyed (B7): `current` maps each
/// agent slot to the one live session it owns; `models` tracks the effective
/// model per slot (seeded from the plan's `sessions[slot].model`, mutated by
/// `agent.config` steps — which are model-only, A3). All maps are hydrated from
/// the run record on resume.
pub struct WorkflowStepExecutorImpl {
    deps: Arc<WorkflowExecDeps>,
    run_id: String,
    /// The run's PINNED workspace (data-contract §3 target). Under
    /// [`Isolation::Workspace`] the run executes here directly; under
    /// [`Isolation::Worktree`] this is the checkout the per-run worktree is
    /// minted from.
    workspace_id: String,
    /// Run isolation posture (wave 2b): plan-level, resolved once into the
    /// memoized `effective_workspace` below.
    isolation: Isolation,
    /// The effective workspace every session/shell/emit of this run resolves to.
    /// Memoized: under `Workspace` isolation it is `workspace_id`; under
    /// `Worktree` isolation it is the id of the per-run git worktree, minted
    /// lazily on first use (and once only, so all the run's slots share it — B7
    /// / one worktree per RUN in v1). `None` until first resolution; recovered
    /// on crash-resume from a persisted session's workspace — or, when the run
    /// persisted no session yet (a shell/PR-only prefix), by ADOPTING the run's
    /// own worktree record — in [`Self::hydrate_from_run`].
    ///
    /// A [`tokio::sync::Mutex`] (not `std`): the memo is held across the
    /// `spawn_blocking` mint await, so it must be an async-aware lock (holding a
    /// `std` guard across `.await` would block the runtime worker).
    ///
    /// This is the RUN-LEVEL worktree (scope [`NO_LANE`]) — flat runs and any
    /// out-of-group step. Steps inside a parallel lane resolve to a per-lane
    /// worktree instead (D-031c), memoized in [`Self::lane_workspaces`].
    effective_workspace: tokio::sync::Mutex<Option<String>>,
    /// Per-LANE effective workspaces (D-031c), keyed by lane name (the step's
    /// worktree scope). Under [`Isolation::Worktree`] each parallel lane mints
    /// its own worktree (branch `workflow-run/<run_id>/<lane>`, path
    /// `wf-run-<run_id>-<lane>`) so write-parallel lanes never share a checkout.
    /// Empty for flat runs and under [`Isolation::Workspace`] (everything shares
    /// the pinned checkout). Recovered on resume in [`Self::hydrate_from_run`].
    lane_workspaces: tokio::sync::Mutex<HashMap<String, String>>,
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
        isolation: Isolation,
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
            isolation,
            effective_workspace: tokio::sync::Mutex::new(None),
            lane_workspaces: tokio::sync::Mutex::new(HashMap::new()),
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
    pub async fn hydrate_from_run(&self, run: &WorkflowRunRecord) {
        self.recompute_models(run);
        // Map each slot to its worktree scope (D-031c): a parallel lane's slot →
        // its own lane worktree; every other slot → the run-level worktree
        // ([`NO_LANE`]). Also the set of distinct lane scopes to recover.
        let mut slot_scope: HashMap<String, String> = HashMap::new();
        let mut lane_scopes: Vec<String> = Vec::new();
        if let Ok(plan) = crate::domains::workflows::plan::parse(&run.plan_json) {
            for step in &plan.steps {
                let scope = worktree_scope(&step.key);
                slot_scope.insert(step.slot.clone(), scope.clone());
                if scope != NO_LANE && !lane_scopes.contains(&scope) {
                    lane_scopes.push(scope);
                }
            }
        }

        // The workspace of the recovered session PER SCOPE (worktree isolation): a
        // persisted session already lives in its scope's minted worktree, so its
        // workspace IS that scope's effective workspace.
        let mut recovered_by_scope: HashMap<String, String> = HashMap::new();
        {
            let mut current = self.current.lock().unwrap();
            for (slot, session_id) in run.sessions() {
                if let Ok(Some(session)) = self.deps.session_service.get_session(session_id) {
                    if self.isolation == Isolation::Worktree {
                        let scope = slot_scope
                            .get(slot)
                            .cloned()
                            .unwrap_or_else(|| NO_LANE.to_string());
                        recovered_by_scope
                            .entry(scope)
                            .or_insert_with(|| session.workspace_id.clone());
                    }
                    // Re-arm the always-bypass safety net for the resumed session
                    // (the registry is in-memory, so a restart would otherwise drop
                    // it).
                    self.deps.workflow_owned_sessions.mark(session_id, &self.run_id);
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
            // Drop the std guard before any await below (never hold it across .await).
        }

        if self.isolation != Isolation::Worktree {
            return;
        }

        // Wave 2b crash-recovery (finding 1, belt-and-suspenders), now per scope:
        // recover each scope's effective worktree so post-resume sessions/shells
        // resolve to the SAME worktree instead of re-minting. A persisted session's
        // workspace wins; otherwise — the session-less crash hole, where a shell.run
        // / scm.open_pr prefix minted the worktree but persisted NO session to
        // recover from — ADOPT that scope's own worktree record if one exists (keyed
        // by the scope's deterministic path + branch). Scope-scoped only; never a
        // general adopt.
        //
        // Run-level ([`NO_LANE`]) worktree.
        let expected_branch = worktree_branch_for_scope(&self.run_id, NO_LANE);
        let recovered = recover_resume_worktree(
            recovered_by_scope.get(NO_LANE).cloned(),
            &expected_branch,
            || async { self.lookup_run_worktree_for_resume(NO_LANE) },
        )
        .await;
        if let Ok(Some(ws)) = recovered {
            let mut eff = self.effective_workspace.lock().await;
            if eff.is_none() {
                *eff = Some(ws);
            }
        }

        // Per-lane worktrees (D-031c): recover each lane independently so a run
        // that crashed with lane A done and lane B mid-step resumes each lane in
        // its OWN worktree (deny-path e — distinct + adopted on resume).
        for scope in &lane_scopes {
            let expected_branch = worktree_branch_for_scope(&self.run_id, scope);
            let recovered = recover_resume_worktree(
                recovered_by_scope.get(scope).cloned(),
                &expected_branch,
                || async { self.lookup_run_worktree_for_resume(scope) },
            )
            .await;
            if let Ok(Some(ws)) = recovered {
                let mut lanes = self.lane_workspaces.lock().await;
                lanes.entry(scope.clone()).or_insert(ws);
            }
        }
    }

    /// Blocking lookup of the run's own worktree record for crash-resume
    /// adoption: load the pinned checkout, derive this run's deterministic
    /// worktree path, and return the active worktree workspace record there (id +
    /// its checked-out branch) if one exists. Returns `None` (never an error that
    /// would fail resume) when there's simply nothing to adopt; the run-scoped
    /// branch gate is applied by [`adoptable_run_worktree`] in the caller.
    fn lookup_run_worktree_for_resume(
        &self,
        scope: &str,
    ) -> Result<Option<AdoptedWorktree>, StepOutcome> {
        let pinned = self
            .deps
            .workspace_runtime
            .get_workspace(&self.workspace_id)
            .map_err(|error| failed_msg("worktree_resume_lookup_failed", error.to_string()))?;
        let Some(pinned) = pinned else {
            return Ok(None);
        };
        let Some(target_path) = worktree_target_path_for_scope(&pinned.path, &self.run_id, scope)
        else {
            return Ok(None);
        };
        Ok(lookup_run_worktree_record(&self.deps.workspace_runtime, &target_path)?)
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

    /// The workspace every session / shell / emit of this run resolves to
    /// (wave 2b). Memoized and computed once:
    ///
    /// - [`Isolation::Workspace`]: the pinned `workspace_id`, unchanged.
    /// - [`Isolation::Worktree`]: mint a fresh per-run git worktree inside the
    ///   pinned checkout (once — all the run's slots share it) and return its
    ///   workspace id.
    ///
    /// A mint failure returns a structured `Failed` outcome; because every
    /// session-creating / workspace-using path calls this FIRST, a failed mint
    /// fails the run BEFORE any session is created in the shared checkout
    /// (deny-path: no silent fallback to the pinned workspace, which would
    /// defeat isolation). Holds the memo lock across the (async, `spawn_blocking`)
    /// mint so two slots can never race into two worktrees.
    async fn effective_workspace_id(&self, scope: &str) -> Result<String, StepOutcome> {
        if scope == NO_LANE {
            return self.run_level_workspace_id().await;
        }
        // Per-lane worktree (D-031c). Under Workspace isolation everything still
        // shares the pinned checkout; under Worktree each lane mints its own.
        match self.isolation {
            Isolation::Workspace => Ok(self.workspace_id.clone()),
            Isolation::Worktree => {
                // M2(a): a lane worktree bases off the RUN-LEVEL worktree's HEAD,
                // not the pinned checkout — so any pre-group commit flows into
                // every lane. Ensure the run-level worktree exists first (mint it
                // lazily if no pre-group step already did).
                let run_level_id = self.run_level_workspace_id().await?;
                let base_workspace_id =
                    worktree_base_workspace_id(scope, &self.workspace_id, &run_level_id).to_string();
                let mut guard = self.lane_workspaces.lock().await;
                if let Some(id) = guard.get(scope) {
                    return Ok(id.clone());
                }
                let id = self.mint_worktree_for_scope(scope, base_workspace_id).await?;
                guard.insert(scope.to_string(), id.clone());
                Ok(id)
            }
        }
    }

    /// The run-level worktree ([`NO_LANE`], scope `-`): flat / out-of-group /
    /// post-group steps resolve here, and every lane worktree bases off it (M2).
    /// Byte-identical to wave 2b — same memo, same mint, same branch/path. Under
    /// `Worktree` isolation it bases off the pinned checkout's HEAD.
    async fn run_level_workspace_id(&self) -> Result<String, StepOutcome> {
        let pinned = self.workspace_id.clone();
        resolve_effective_workspace(
            self.isolation,
            &self.workspace_id,
            &self.effective_workspace,
            || self.mint_worktree_for_scope(NO_LANE, pinned),
        )
        .await
    }

    /// Mint (or ADOPT) the worktree for a given scope and return its workspace
    /// id. Scope [`NO_LANE`] is the run-level worktree (wave 2b); a lane name is
    /// a per-lane worktree (D-031c).
    ///
    /// The blocking git (`std::process::Command`) + synchronous DB work runs on a
    /// `spawn_blocking` pool thread, never on the async executor worker (matching
    /// every other `create_worktree` consumer in this crate); the memo lock is an
    /// async [`tokio::sync::Mutex`] held across this await, so no `std` guard is
    /// pinned across `.await`.
    async fn mint_worktree_for_scope(
        &self,
        scope: &str,
        base_workspace_id: String,
    ) -> Result<String, StepOutcome> {
        let workspace_runtime = self.deps.workspace_runtime.clone();
        let pinned_workspace_id = self.workspace_id.clone();
        let run_id = self.run_id.clone();
        let scope = scope.to_string();
        tokio::task::spawn_blocking(move || {
            mint_or_adopt_run_worktree_blocking(
                &workspace_runtime,
                &pinned_workspace_id,
                &base_workspace_id,
                &run_id,
                &scope,
            )
        })
        .await
        .map_err(|error| {
            failed_msg(
                "worktree_mint_failed",
                format!("worktree mint task failed: {error}"),
            )
        })?
    }

    /// Ensure the (single, lifetime) session for `slot` exists, opening it lazily
    /// on first use. Harness is fixed per slot — there is no harness-switch
    /// machinery. A slot carrying `bind_session_id` (L29 / PR F) loads the
    /// existing session instead of creating one; that field is always absent
    /// until the session-plane PR lands.
    async fn ensure_session(&self, slot: &str, scope: &str) -> Result<String, StepOutcome> {
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
            // Session binding (L29 / B8): load the pre-existing (taken-over)
            // session instead of creating one. It must exist and its harness must
            // match the slot — otherwise the plan is malformed (the server
            // validates this at StartRun, but the runtime re-checks: a plan that
            // reached here with a mismatch is a hard error, never a silent
            // wrong-harness launch).
            let session = self
                .deps
                .session_service
                .get_session(&bind_id)
                .map_err(|error| failed_msg("session_bind_failed", error.to_string()))?
                .ok_or_else(|| failed_msg("session_bind_missing", bind_id.clone()))?;
            // B8: harness must match the slot (hard plan error) and the session
            // must not already be held by a DIFFERENT live run (hard bind
            // rejection). Both are pure decisions, extracted to
            // [`validate_bind_target`] so they are unit-testable without a live
            // runtime.
            let held_run = self.deps.workflow_owned_sessions.held_run(&bind_id);
            validate_bind_target(
                &bind_id,
                &self.run_id,
                &session.agent_kind,
                &harness,
                held_run.as_deref(),
            )?;
            // Mark ownership BEFORE the rebind relaunch so the always-bypass net
            // + lockout are armed for the taken-over session immediately (C13).
            self.deps
                .workflow_owned_sessions
                .mark(&bind_id, &self.run_id);
            // Addendum item 2: rebind the bound session's gateway MCP binding.
            // The per-run credential is injected only at LAUNCH; this session was
            // launched with only the worker-token binding, so register the per-run
            // gateway server and relaunch it so its integration calls run under
            // the run's opt-in scope, not the owner's broad personal grant.
            if let Some(server) = workflow_gateway_server(self.gateway.as_ref()) {
                self.deps.workflow_gateway_sessions.set(&bind_id, server);
                self.deps
                    .session_runtime
                    .relaunch_session_for_mcp_rebind(&bind_id)
                    .await;
            }
            (bind_id, session.agent_kind)
        } else {
            // Exec policy (goals-and-workflows-v1 §3.3 "always bypass"): open the
            // session in the harness's native bypass-equivalent mode so agent
            // turns and native-goal auto-continuation never stall on a
            // permission prompt. `None` (harness with no native bypass mode) is
            // covered by the auto-approve safety net.
            let mode = bypass_mode_for_kind(&harness);
            // Wave 2b: resolve the run's effective workspace BEFORE creating the
            // session. Under worktree isolation this mints the per-run worktree
            // (once); a mint failure returns here, so the session is NEVER
            // created in the shared pinned checkout.
            let session_workspace_id = self.effective_workspace_id(scope).await?;
            // Split create/start (as reviews/subagents do) so the per-run gateway
            // server and workflow ownership can be registered BEFORE launch — the
            // launch extension reads both from their in-memory registries, and MCP
            // servers are only assembled from the extension seam (never from the
            // durable session bindings).
            let record = self
                .deps
                .session_runtime
                .create_durable_session(
                    &session_workspace_id,
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
            self.deps.workflow_owned_sessions.mark(&record.id, &self.run_id);
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
        self.deps.workflow_owned_sessions.mark(&session_id, &self.run_id);
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

    /// Inject a prompt into a workflow-owned session via the internal
    /// provenance-carrying path (C10 / E9) — NOT the public `send_prompt` the
    /// lockout guards (C13). The prompt is stamped `PromptProvenance::Workflow`
    /// so the transcript renders the machine bubble from stored truth, and a
    /// normalized `workflow_session_injections` row is written alongside (the
    /// executor owns both step identity and the send).
    async fn send_prompt(
        &self,
        session_id: &str,
        text: &str,
        meta: &InjectionMeta,
    ) -> Result<Option<String>, StepOutcome> {
        let label = if meta.label.trim().is_empty() {
            None
        } else {
            Some(meta.label.clone())
        };
        let provenance = PromptProvenance::Workflow {
            run_id: self.run_id.clone(),
            step_key: meta.step_key.clone(),
            step_kind: meta.kind.clone(),
            label,
        };
        match self
            .deps
            .session_runtime
            .send_text_prompt_with_provenance(session_id, text.to_string(), provenance)
            .await
        {
            Ok(SendPromptOutcome::Running { turn_id, .. }) => {
                // Stamp the injection index (contract §5.2). Best-effort: a failed
                // index write must never fail the step (the wire provenance on the
                // event payload is the source of truth for rendering).
                let _ = self.deps.workflow_service.record_injection(
                    session_id,
                    &turn_id,
                    &self.run_id,
                    &meta.step_key,
                    &meta.kind,
                    &meta.label,
                    text,
                );
                Ok(Some(turn_id))
            }
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

    async fn run_prompt(
        &self,
        slot: &str,
        agent: &AgentPromptStep,
        meta: &InjectionMeta,
        scope: &str,
    ) -> StepOutcome {
        let session_id = match self.ensure_session(slot, scope).await {
            Ok(id) => id,
            Err(outcome) => return outcome,
        };
        // No gate: a single turn suffices.
        let Some(required) = &agent.required_invocation else {
            let mut events = match self.subscribe(&session_id).await {
                Ok(events) => events,
                Err(outcome) => return outcome,
            };
            let turn_id = match self.send_prompt(&session_id, &agent.prompt, meta).await {
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
                let turn_id = self.send_prompt(&session_id, &prompt, meta).await?;
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

    #[allow(clippy::too_many_arguments)]
    async fn run_goal(
        &self,
        slot: &str,
        agent: &AgentPromptStep,
        goal: &GoalSpec,
        step_index: usize,
        meta: &InjectionMeta,
        scope: &str,
    ) -> StepOutcome {
        let session_id = match self.ensure_session(slot, scope).await {
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
            if let Err(outcome) = self.send_prompt(&session_id, &prompt, meta).await {
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
                        let (workspace_path, env) = match self.workspace_ctx(scope).await {
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

    async fn workspace_ctx(
        &self,
        scope: &str,
    ) -> Result<(PathBuf, Vec<(String, String)>), StepOutcome> {
        // Wave 2b: shells / emit-file drops / verify run in the step's effective
        // workspace — the per-run (or, for a grouped step, per-lane) worktree
        // under worktree isolation (minting it if a shell is the scope's first
        // step), else the pinned workspace.
        let workspace_id = self.effective_workspace_id(scope).await?;
        let workspace = self
            .deps
            .workspace_runtime
            .get_workspace(&workspace_id)
            .map_err(|error| failed_msg("workspace_error", error.to_string()))?
            .ok_or_else(|| failed("workspace_missing"))?;
        let env = self
            .deps
            .workspace_runtime
            .build_workspace_env(&workspace, None)
            .map_err(|error| failed_msg("workspace_env_error", error.to_string()))?;
        Ok((PathBuf::from(&workspace.path), env))
    }

    async fn run_shell(&self, step: &ShellRunStep, scope: &str) -> StepOutcome {
        let (workspace_path, env) = match self.workspace_ctx(scope).await {
            Ok(ctx) => ctx,
            Err(outcome) => return outcome,
        };
        commands::run_shell_step(&workspace_path, &env, step).await
    }

    async fn run_scm(&self, step: &ScmOpenPrStep, scope: &str) -> StepOutcome {
        let (workspace_path, env) = match self.workspace_ctx(scope).await {
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
                    .set_live_session_config_option_unlocked(
                        &session_id,
                        ACP_MODEL_COMPAT_CONFIG_ID,
                        model,
                    )
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
    #[allow(clippy::too_many_arguments)]
    async fn run_emit(
        &self,
        slot: &str,
        step: &AgentEmitStep,
        step_index: usize,
        meta: &InjectionMeta,
        scope: &str,
    ) -> StepOutcome {
        let session_id = match self.ensure_session(slot, scope).await {
            Ok(id) => id,
            Err(outcome) => return outcome,
        };
        let (workspace_path, _env) = match self.workspace_ctx(scope).await {
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
                let turn_id = self.send_prompt(&session_id, &prompt, meta).await?;
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
        // The worktree scope this step resolves to (D-031c): its lane for a
        // grouped step, or the run-level worktree ([`NO_LANE`]) otherwise.
        let scope = worktree_scope(&step.key);
        let meta = InjectionMeta::from_step(step);
        match &step.kind {
            StepKind::AgentConfig(cfg) => self.run_agent_config(slot, cfg).await,
            StepKind::AgentPrompt(agent) => match &agent.goal {
                None => self.run_prompt(slot, agent, &meta, &scope).await,
                Some(goal) => self.run_goal(slot, agent, goal, ctx.step_index, &meta, &scope).await,
            },
            StepKind::AgentEmit(emit) => {
                self.run_emit(slot, emit, ctx.step_index, &meta, &scope).await
            }
            StepKind::ShellRun(shell) => self.run_shell(shell, &scope).await,
            StepKind::ScmOpenPr(pr) => self.run_scm(pr, &scope).await,
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

    /// M2(b): at a clean parallel-group join, merge each lane's branch back into
    /// the run-level worktree, in lane order (deterministic). Under `Workspace`
    /// isolation everything already shared the pinned checkout (nothing to merge);
    /// a lane that never minted a worktree (no workspace-using step ran) has
    /// nothing to merge either. A conflict fails the run honestly
    /// (`lane_merge_conflict`); an already-merged lane (crash-resume mid-merge) is
    /// skipped by the blocking helper's merge-base guard.
    async fn merge_lanes_into_run_worktree(&self, lanes: &[String]) -> Result<(), StepOutcome> {
        if self.isolation == Isolation::Workspace {
            return Ok(());
        }
        // Only lanes that actually minted a worktree have anything to merge.
        let lane_targets: Vec<(String, String)> = {
            let guard = self.lane_workspaces.lock().await;
            lanes
                .iter()
                .filter_map(|lane| guard.get(lane).map(|id| (lane.clone(), id.clone())))
                .collect()
        };
        if lane_targets.is_empty() {
            return Ok(());
        }
        // The merge target — the run-level worktree the lanes were based off (so
        // it exists; resolving is a memo hit). Mint defensively if somehow absent.
        let run_level_id = self.run_level_workspace_id().await?;
        let workspace_runtime = self.deps.workspace_runtime.clone();
        let run_id = self.run_id.clone();
        tokio::task::spawn_blocking(move || {
            merge_lanes_into_run_worktree_blocking(
                &workspace_runtime,
                &run_id,
                &run_level_id,
                &lane_targets,
            )
        })
        .await
        .map_err(|error| {
            failed_msg(
                "lane_merge_failed",
                format!("lane merge-back task failed: {error}"),
            )
        })?
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

// --- run worktree isolation helpers (wave 2b) ---

/// A worktree workspace record considered for run-scoped adoption: its id plus
/// the branch it is checked out on.
type AdoptedWorktree = (String, Option<String>);

/// The memoized effective-workspace resolution, decoupled from live deps so the
/// dispatch + memoization + mint-error propagation can be driven directly by
/// tests. Under `Workspace` isolation the pinned `workspace_id` is returned and
/// `mint` is NEVER called; under `Worktree` isolation `mint` is called AT MOST
/// once (the result is memoized), so every slot/shell of the run shares one
/// worktree and a mint failure propagates before any session is created.
///
/// The memo is a [`tokio::sync::Mutex`] held across the (async, `spawn_blocking`)
/// mint await: an async-aware lock is required so we never pin a `std` guard
/// across `.await` (which would block the runtime worker). Only one actor drives
/// a run, so holding the memo across the await is both correct and the simplest
/// way to keep "mint once, no session in the shared checkout" intact.
async fn resolve_effective_workspace<F, Fut>(
    isolation: Isolation,
    workspace_id: &str,
    memo: &tokio::sync::Mutex<Option<String>>,
    mint: F,
) -> Result<String, StepOutcome>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Result<String, StepOutcome>>,
{
    let mut guard = memo.lock().await;
    if let Some(id) = guard.as_ref() {
        return Ok(id.clone());
    }
    let resolved = match isolation {
        Isolation::Workspace => workspace_id.to_string(),
        Isolation::Worktree => mint().await?,
    };
    *guard = Some(resolved.clone());
    Ok(resolved)
}

/// The run-scoped adoption gate (wave 2b crash-recovery hardening, finding 1): a
/// worktree record `found` at the run's DETERMINISTIC path is adopted ONLY when
/// it is the run's OWN worktree — its branch is exactly `expected_branch`
/// (`workflow-run/<run_id>`). A record at that path on any OTHER branch is a
/// foreign squatter and must NOT be adopted (the caller falls through to an
/// honest mint, which then conflicts on the occupied path). This is never a
/// general conflict-tolerant adopt — only the run's own run-scoped identifiers.
fn adoptable_run_worktree(found: Option<AdoptedWorktree>, expected_branch: &str) -> Option<String> {
    match found {
        Some((id, Some(branch))) if branch == expected_branch => Some(id),
        _ => None,
    }
}

/// Mint OR adopt the run's git worktree, returning its workspace id. Runs the
/// blocking git (`std::process::Command`) + synchronous DB work; the caller
/// wraps it in `spawn_blocking`.
///
/// Adoption (finding 1): a prior executor may have already minted this run's
/// worktree AND its workspace record before crashing — e.g. a `shell.run` /
/// `scm.open_pr` prefix that persisted NO session to recover from. Re-minting
/// would hit the deterministic branch/path under the `Fail` conflict policy and
/// strand the completed work, failing the run terminally on every retry. So if a
/// workspace RECORD already exists at this run's OWN deterministic path+branch,
/// adopt it (return its id). Run-scoped only. A git worktree on disk with NO
/// record (half-created) is NOT adopted: we fall through to the mint, which
/// fails honestly on the occupied path — never adopt untracked state.
fn mint_or_adopt_run_worktree_blocking(
    workspace_runtime: &WorkspaceRuntime,
    pinned_workspace_id: &str,
    base_workspace_id: &str,
    run_id: &str,
    scope: &str,
) -> Result<String, StepOutcome> {
    let pinned = workspace_runtime
        .get_workspace(pinned_workspace_id)
        .map_err(|error| {
            failed_msg(
                "worktree_mint_failed",
                format!("could not load pinned workspace: {error}"),
            )
        })?
        .ok_or_else(|| {
            failed_msg(
                "worktree_mint_failed",
                format!("pinned workspace {pinned_workspace_id} not found"),
            )
        })?;
    let target_path =
        worktree_target_path_for_scope(&pinned.path, run_id, scope).ok_or_else(|| {
            failed_msg(
                "worktree_mint_failed",
                format!("could not derive a worktree path from {}", pinned.path),
            )
        })?;
    let branch_name = worktree_branch_for_scope(run_id, scope);

    // Crash-recovery adoption: return the run's own already-minted worktree if a
    // record for it exists (run-scoped by path + branch).
    if let Some(id) = lookup_run_worktree_record(workspace_runtime, &target_path)?
        .and_then(|found| adoptable_run_worktree(Some(found), &branch_name))
    {
        tracing::info!(
            run_id = %run_id,
            worktree_workspace_id = %id,
            branch = %branch_name,
            "workflow run adopted its existing per-run worktree (isolation=worktree, crash-recovery)"
        );
        return Ok(id);
    }

    // Base the worktree on the BASE workspace's CURRENT HEAD (exact commit), so
    // isolation is faithful even when the base is itself a branch/worktree. For
    // the run-level worktree the base IS the pinned checkout (wave 2b, unchanged);
    // for a parallel lane the base is the RUN-LEVEL worktree (M2a), so any
    // pre-group commit flows into every lane. Falls back to the source repo's HEAD
    // when the SHA can't be read (base_branch=None → git's default HEAD).
    let base_path = if base_workspace_id == pinned_workspace_id {
        pinned.path.clone()
    } else {
        workspace_runtime
            .get_workspace(base_workspace_id)
            .map_err(|error| {
                failed_msg(
                    "worktree_mint_failed",
                    format!("could not load base workspace: {error}"),
                )
            })?
            .ok_or_else(|| {
                failed_msg(
                    "worktree_mint_failed",
                    format!("base workspace {base_workspace_id} not found"),
                )
            })?
            .path
    };
    let base_ref = run_worktree_base_ref(&base_path);
    // Finding 3: tag the worktree with the run as its creator (there is no
    // free-form origin/label on `OriginContext`, but `WorkspaceCreatorContext`
    // carries `automationRunId` + `label`), so a future retention reaper can
    // distinguish and prune orphaned workflow-run worktrees. The deterministic
    // `wf-run-*` path / `workflow-run/*` branch prefixes are the other key such a
    // reaper can match on. Automatic pruning is a follow-up (no retention rule
    // invented here).
    let creator_context = WorkspaceCreatorContext::Automation {
        automation_id: None,
        automation_run_id: Some(run_id.to_string()),
        label: Some("workflow-run".to_string()),
    };
    let result = workspace_runtime
        .create_worktree_with_surface(
            &pinned.repo_root_id,
            &target_path,
            &branch_name,
            base_ref.as_deref(),
            None,
            "standard",
            WorktreeNameConflictPolicy::Fail,
            OriginContext::api_local_runtime(),
            Some(creator_context),
        )
        .map_err(|error| {
            failed_msg(
                "worktree_mint_failed",
                format!("git worktree add failed: {error}"),
            )
        })?;
    tracing::info!(
        run_id = %run_id,
        pinned_workspace_id = %pinned_workspace_id,
        worktree_workspace_id = %result.workspace.id,
        worktree_path = %result.workspace.path,
        branch = %branch_name,
        "workflow run minted a per-run worktree (isolation=worktree)"
    );
    Ok(result.workspace.id)
}

/// Look up the active worktree workspace record at the run's deterministic
/// `target_path` (id + its checked-out branch), for run-scoped adoption. The
/// stored record path is the CANONICALIZED worktree path, so we canonicalize our
/// deterministic target the same way when it exists on disk (a fresh run's path
/// won't exist → raw path → no match → the caller mints). The run-scoped branch
/// gate is applied by [`adoptable_run_worktree`] in the caller.
fn lookup_run_worktree_record(
    workspace_runtime: &WorkspaceRuntime,
    target_path: &str,
) -> Result<Option<AdoptedWorktree>, StepOutcome> {
    let lookup_path = std::fs::canonicalize(target_path)
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|_| target_path.to_string());
    let found = workspace_runtime
        .find_active_workspace_by_path_and_kind(&lookup_path, WorkspaceKind::Worktree)
        .map_err(|error| {
            failed_msg(
                "worktree_mint_failed",
                format!("worktree adoption lookup failed: {error}"),
            )
        })?
        .map(|record| (record.id, record.current_branch));
    Ok(found)
}

/// Crash-resume recovery of the run's effective worktree (finding 1, belt-and-
/// suspenders in `hydrate_from_run`), decoupled from live deps so it can be
/// driven directly by tests. A persisted session already living in the worktree
/// wins (`session_recovered`, its workspace IS the effective one); otherwise —
/// the session-less crash hole — ADOPT the run's own worktree record if one
/// exists (run-scoped by `expected_branch`). `None` when there's nothing to adopt
/// yet (the first step will mint).
async fn recover_resume_worktree<L, LFut>(
    session_recovered: Option<String>,
    expected_branch: &str,
    lookup: L,
) -> Result<Option<String>, StepOutcome>
where
    L: FnOnce() -> LFut,
    LFut: std::future::Future<Output = Result<Option<AdoptedWorktree>, StepOutcome>>,
{
    if let Some(workspace_id) = session_recovered {
        return Ok(Some(workspace_id));
    }
    Ok(adoptable_run_worktree(lookup().await?, expected_branch))
}

/// Sanitize a run id into a path/branch-safe token (alphanumerics, `-`, `_`
/// kept; everything else → `-`). Run ids are already uuid/`run-…`-shaped, so
/// this is a belt-and-braces guard, not a real transform.
fn sanitize_run_token(run_id: &str) -> String {
    run_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect()
}

/// The run-scoped branch name for a per-run worktree: `workflow-run/<run_id>`.
/// Run-scoped so two runs on the same pinned workspace get distinct branches
/// (no collision).
fn run_worktree_branch_name(run_id: &str) -> String {
    format!("workflow-run/{}", sanitize_run_token(run_id))
}

/// The run-scoped worktree checkout path: a sibling of the pinned checkout named
/// `wf-run-<run_id>`. Run-scoped so two runs get distinct paths. `None` when the
/// pinned path has no parent (a filesystem root — never a real checkout).
fn run_worktree_target_path(pinned_path: &str, run_id: &str) -> Option<String> {
    Path::new(pinned_path)
        .parent()
        .map(|parent| {
            parent
                .join(format!("wf-run-{}", sanitize_run_token(run_id)))
                .to_string_lossy()
                .to_string()
        })
}

/// The branch name for a worktree SCOPE (D-031c): the run-level worktree
/// ([`NO_LANE`]) is `workflow-run/<run_id>` (byte-identical to wave 2b); a
/// parallel lane is `workflow-run/<run_id>/<lane>`, so sibling lanes never
/// collide on a branch.
fn worktree_branch_for_scope(run_id: &str, scope: &str) -> String {
    if scope == NO_LANE {
        run_worktree_branch_name(run_id)
    } else {
        format!(
            "workflow-run/{}/{}",
            sanitize_run_token(run_id),
            sanitize_run_token(scope)
        )
    }
}

/// The checkout path for a worktree SCOPE (D-031c): the run-level worktree is
/// `wf-run-<run_id>` (unchanged); a parallel lane is `wf-run-<run_id>-<lane>`,
/// so sibling lanes never collide on a path. `None` when the pinned path has no
/// parent.
fn worktree_target_path_for_scope(pinned_path: &str, run_id: &str, scope: &str) -> Option<String> {
    if scope == NO_LANE {
        return run_worktree_target_path(pinned_path, run_id);
    }
    Path::new(pinned_path).parent().map(|parent| {
        parent
            .join(format!(
                "wf-run-{}-{}",
                sanitize_run_token(run_id),
                sanitize_run_token(scope)
            ))
            .to_string_lossy()
            .to_string()
    })
}

/// The pinned checkout's current HEAD commit SHA, used as the exact base for the
/// per-run worktree ("off the checkout's current HEAD"). `None` when it can't be
/// read, in which case the caller lets git default to the source repo's HEAD.
fn run_worktree_base_ref(pinned_path: &str) -> Option<String> {
    crate::adapters::git::operations::worktrees::stdout_result(
        Path::new(pinned_path),
        &["rev-parse", "HEAD"],
    )
    .ok()
    .filter(|sha| !sha.is_empty())
}

/// Which workspace a scope's worktree bases off at mint time (M2a), pure so the
/// "a lane bases off the run-level worktree, not the pinned checkout" contract is
/// unit-testable: the run-level worktree ([`NO_LANE`]) bases off the pinned
/// checkout (wave 2b, unchanged); a parallel lane bases off the RUN-LEVEL
/// worktree, so any pre-group commit flows into every lane.
fn worktree_base_workspace_id<'a>(
    scope: &str,
    pinned_workspace_id: &'a str,
    run_level_workspace_id: &'a str,
) -> &'a str {
    if scope == NO_LANE {
        pinned_workspace_id
    } else {
        run_level_workspace_id
    }
}

/// The per-lane merge-back decision (M2b), pure so the idempotency contract is
/// unit-testable without a live repo: a lane whose branch is already an ancestor
/// of the run-level worktree HEAD is SKIPPED (already merged — crash-resume mid
/// merge-back must never double-merge), otherwise it is MERGED.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LaneMergeAction {
    Skip,
    Merge,
}

fn decide_lane_merge(lane_branch_is_ancestor_of_run_head: bool) -> LaneMergeAction {
    if lane_branch_is_ancestor_of_run_head {
        LaneMergeAction::Skip
    } else {
        LaneMergeAction::Merge
    }
}

/// Merge every finished lane's branch into the run-level worktree, sequentially
/// in the given lane order (M2b). Runs blocking git in `spawn_blocking`. Each
/// merge is idempotent (skipped when already an ancestor of the run HEAD — see
/// [`decide_lane_merge`]) and a conflict aborts + fails the run
/// (`lane_merge_conflict`), never silently dropping conflicting work.
fn merge_lanes_into_run_worktree_blocking(
    workspace_runtime: &WorkspaceRuntime,
    run_id: &str,
    run_level_id: &str,
    lane_targets: &[(String, String)],
) -> Result<(), StepOutcome> {
    let run_level = workspace_runtime
        .get_workspace(run_level_id)
        .map_err(|error| {
            failed_msg(
                "lane_merge_failed",
                format!("could not load run-level worktree: {error}"),
            )
        })?
        .ok_or_else(|| {
            failed_msg(
                "lane_merge_failed",
                format!("run-level worktree {run_level_id} not found"),
            )
        })?;
    let run_level_path = Path::new(&run_level.path);
    for (lane_name, _lane_workspace_id) in lane_targets {
        let lane_branch = worktree_branch_for_scope(run_id, lane_name);
        // Idempotency guard (crash-resume): the lane branch already merged (its
        // tip is an ancestor of the run-level HEAD) → skip, never double-merge.
        let already_merged = std::process::Command::new("git")
            .current_dir(run_level_path)
            .args(["merge-base", "--is-ancestor", &lane_branch, "HEAD"])
            .status()
            .map(|status| status.success())
            .unwrap_or(false);
        if decide_lane_merge(already_merged) == LaneMergeAction::Skip {
            tracing::info!(
                run_id = %run_id,
                lane = %lane_name,
                branch = %lane_branch,
                "lane already merged into run worktree — skipping (idempotent)"
            );
            continue;
        }
        // Default merge (no squash), non-interactive. A conflict returns non-zero;
        // abort to leave the run-level worktree clean for inspection, then fail.
        let output = std::process::Command::new("git")
            .current_dir(run_level_path)
            .args(["merge", "--no-edit", &lane_branch])
            .output()
            .map_err(|error| {
                failed_msg(
                    "lane_merge_failed",
                    format!("git merge for lane '{lane_name}' failed to spawn: {error}"),
                )
            })?;
        if !output.status.success() {
            let _ = std::process::Command::new("git")
                .current_dir(run_level_path)
                .args(["merge", "--abort"])
                .output();
            return Err(failed_msg(
                "lane_merge_conflict",
                format!(
                    "lane '{lane_name}' could not be merged into the run worktree \
                     (conflicting parallel work): {}",
                    String::from_utf8_lossy(&output.stderr).trim()
                ),
            ));
        }
        tracing::info!(
            run_id = %run_id,
            lane = %lane_name,
            branch = %lane_branch,
            "merged lane into run worktree"
        );
    }
    Ok(())
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

/// B8 bind-target validation (pure decision, so it is unit-testable without a
/// live runtime). A bound session must:
/// 1. match the slot's harness — otherwise the plan is malformed (hard error);
/// 2. not already be held by a *different* live run — otherwise binding would
///    silently transfer ownership (`mark` overwrites the owner entry, and the
///    previous owner's `release_run` would then no longer drop it), leaking the
///    lockout. Re-binding a session THIS run already holds is idempotent and OK.
fn validate_bind_target(
    bind_id: &str,
    run_id: &str,
    session_harness: &str,
    slot_harness: &str,
    held_run: Option<&str>,
) -> Result<(), StepOutcome> {
    if session_harness != slot_harness {
        return Err(failed_msg(
            "plan_malformed",
            format!(
                "bound session {bind_id} harness {session_harness} does not match slot harness \
                 {slot_harness}"
            ),
        ));
    }
    if let Some(existing_run) = held_run {
        if existing_run != run_id {
            return Err(failed_msg(
                "session_bind_held",
                format!(
                    "bound session {bind_id} is already held by workflow run {existing_run}; it \
                     cannot be bound to run {run_id}"
                ),
            ));
        }
    }
    Ok(())
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

    // --- B8 bind-target validation ---

    fn outcome_code(outcome: &StepOutcome) -> &str {
        match outcome {
            StepOutcome::Failed { code, .. } => code,
            _ => panic!("expected Failed outcome"),
        }
    }

    #[test]
    fn bind_target_ok_when_harness_matches_and_not_held() {
        assert!(validate_bind_target("sess-1", "run-a", "claude", "claude", None).is_ok());
    }

    #[test]
    fn bind_target_rebinding_own_run_is_idempotent() {
        // A session already held by THIS run may be re-bound (idempotent).
        assert!(
            validate_bind_target("sess-1", "run-a", "claude", "claude", Some("run-a")).is_ok()
        );
    }

    #[test]
    fn bind_target_harness_mismatch_is_hard_plan_error() {
        let err = validate_bind_target("sess-1", "run-a", "codex", "claude", None)
            .expect_err("harness mismatch must be a hard error");
        assert_eq!(outcome_code(&err), "plan_malformed");
    }

    #[test]
    fn bind_target_rejects_session_held_by_a_different_run() {
        // The double-owner hole: without this guard, run-b would silently re-own a
        // session run-a holds, and run-a's release would no longer drop it.
        let err = validate_bind_target("sess-1", "run-b", "claude", "claude", Some("run-a"))
            .expect_err("a session held by another live run cannot be bound");
        assert_eq!(outcome_code(&err), "session_bind_held");
    }

    #[test]
    fn bind_target_harness_mismatch_takes_precedence_over_held() {
        // Even when also held elsewhere, a harness mismatch is the malformed-plan
        // error (checked first).
        let err = validate_bind_target("sess-1", "run-b", "codex", "claude", Some("run-a"))
            .expect_err("mismatch must error");
        assert_eq!(outcome_code(&err), "plan_malformed");
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

    // --- wave 2b: run worktree isolation (deny-path floor) ---

    #[tokio::test]
    async fn workspace_isolation_returns_pinned_and_never_mints() {
        // Under the default (legacy) isolation, the run resolves to its pinned
        // workspace and the worktree mint is never invoked. (Async now: the mint
        // runs on `spawn_blocking` behind an async-aware memo lock.)
        let memo = tokio::sync::Mutex::new(None);
        let minted = std::sync::atomic::AtomicU32::new(0);
        let resolved = resolve_effective_workspace(Isolation::Workspace, "ws-pinned", &memo, || {
            minted.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            async { Ok("ws-worktree".to_string()) }
        })
        .await
        .expect("workspace isolation resolves");
        assert_eq!(resolved, "ws-pinned");
        assert_eq!(minted.load(std::sync::atomic::Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn worktree_isolation_mints_once_and_every_slot_shares_it() {
        // DENY-PATH (d) + one-worktree-per-run: the mint runs exactly once; every
        // subsequent resolution (a second slot, a shell step) returns the SAME
        // worktree workspace id without re-minting.
        let memo = tokio::sync::Mutex::new(None);
        let mints = std::sync::atomic::AtomicU32::new(0);
        let first = resolve_effective_workspace(Isolation::Worktree, "ws-pinned", &memo, || {
            let n = mints.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            async move { Ok(format!("ws-worktree-{n}")) }
        })
        .await
        .expect("mint");
        let second = resolve_effective_workspace(Isolation::Worktree, "ws-pinned", &memo, || {
            mints.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            async { Ok("ws-worktree-SECOND".to_string()) }
        })
        .await
        .expect("memoized");
        assert_eq!(first, "ws-worktree-0");
        assert_eq!(second, first, "all slots must share the one minted worktree");
        assert_eq!(
            mints.load(std::sync::atomic::Ordering::SeqCst),
            1,
            "the worktree must be minted once per run, never per slot"
        );
    }

    #[tokio::test]
    async fn worktree_mint_failure_propagates_and_leaves_no_effective_workspace() {
        // DENY-PATH (b): a failed mint surfaces the structured error and does NOT
        // memoize a fallback — because callers resolve the workspace BEFORE
        // creating a session, this fails the run with no session in the shared
        // checkout. A later resolution retries the mint (memo still empty).
        let memo = tokio::sync::Mutex::new(None);
        let outcome = resolve_effective_workspace(Isolation::Worktree, "ws-pinned", &memo, || async {
            Err(failed_msg("worktree_mint_failed", "git worktree add failed: dirty"))
        })
        .await
        .expect_err("mint failure must propagate");
        assert_eq!(outcome_code(&outcome), "worktree_mint_failed");
        assert!(
            memo.lock().await.is_none(),
            "a failed mint must not silently fall back to the pinned checkout"
        );
    }

    // --- wave 2b hardening: crash-recovery adoption + spawn_blocking (findings 1 & 2) ---

    #[test]
    fn adoptable_run_worktree_adopts_only_the_runs_own_branch() {
        let expected = run_worktree_branch_name("run-x");
        // Adoption: a record at the run's path on the run's OWN branch is adopted.
        assert_eq!(
            adoptable_run_worktree(Some(("ws-wt".to_string(), Some(expected.clone()))), &expected),
            Some("ws-wt".to_string()),
        );
        // Run-scoped only: a record squatting the path on a DIFFERENT branch is
        // NOT adopted (caller falls through to an honest mint conflict).
        assert_eq!(
            adoptable_run_worktree(
                Some(("ws-foreign".to_string(), Some("feature/other".to_string()))),
                &expected,
            ),
            None,
        );
        // A record with no recorded branch is not adoptable (can't prove it's ours).
        assert_eq!(
            adoptable_run_worktree(Some(("ws-detached".to_string(), None)), &expected),
            None,
        );
        // Half-created (git worktree on disk but NO record) → lookup finds nothing
        // → not adoptable → caller mints and fails honestly.
        assert_eq!(adoptable_run_worktree(None, &expected), None);
    }

    #[tokio::test]
    async fn resolve_adopts_existing_worktree_without_a_second_mint() {
        // Finding 1: when the run's own worktree record already exists (a prior
        // executor minted it before crashing), the "mint" closure adopts it and
        // resolve memoizes that id — a subsequent resolution never mints again.
        let expected = run_worktree_branch_name("run-x");
        let memo = tokio::sync::Mutex::new(None);
        let mint_calls = std::sync::atomic::AtomicU32::new(0);
        let adopt_or_mint = || {
            mint_calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let expected = expected.clone();
            async move {
                // Stub lookup: the run's own record already exists.
                let found = Some(("ws-adopted".to_string(), Some(expected.clone())));
                adoptable_run_worktree(found, &expected)
                    .ok_or_else(|| failed_msg("worktree_mint_failed", "would have minted"))
            }
        };
        let first = resolve_effective_workspace(Isolation::Worktree, "ws-pinned", &memo, adopt_or_mint)
            .await
            .expect("adopts the existing worktree");
        assert_eq!(first, "ws-adopted");
        // Second resolution is served from the memo, never re-adopting/minting.
        let second =
            resolve_effective_workspace(Isolation::Worktree, "ws-pinned", &memo, || async {
                panic!("must not mint/adopt again once memoized")
            })
            .await
            .expect("memoized");
        assert_eq!(second, "ws-adopted");
        assert_eq!(mint_calls.load(std::sync::atomic::Ordering::SeqCst), 1);
        assert_eq!(memo.lock().await.as_deref(), Some("ws-adopted"));
    }

    #[tokio::test]
    async fn half_created_worktree_fails_honestly_rather_than_adopting() {
        // Finding 1: a git worktree exists on disk but has NO workspace record
        // (half-created before a crash). The adoption lookup returns None, so we do
        // NOT adopt untracked state; the mint runs and conflicts on the occupied
        // path — a structured failure, not a silent adopt.
        let expected = run_worktree_branch_name("run-x");
        let memo = tokio::sync::Mutex::new(None);
        let outcome = resolve_effective_workspace(Isolation::Worktree, "ws-pinned", &memo, || {
            let expected = expected.clone();
            async move {
                // Stub lookup: no record (half-created).
                match adoptable_run_worktree(None, &expected) {
                    Some(id) => Ok(id),
                    None => Err(failed_msg(
                        "worktree_mint_failed",
                        "worktree target path already exists",
                    )),
                }
            }
        })
        .await
        .expect_err("half-created worktree must fail honestly");
        assert_eq!(outcome_code(&outcome), "worktree_mint_failed");
        assert!(memo.lock().await.is_none());
    }

    #[tokio::test]
    async fn resume_adopts_existing_worktree_when_no_session_persisted_yet() {
        // Finding 1 (belt-and-suspenders): a fresh executor resuming a run that
        // persisted NO session (a shell/PR-only prefix) still recovers the run's
        // worktree by ADOPTING its record — so resume resolves to the worktree
        // without minting even before the first step runs.
        let expected = run_worktree_branch_name("run-x");
        let recovered = recover_resume_worktree(None, &expected, || {
            let expected = expected.clone();
            async move { Ok(Some(("ws-adopted".to_string(), Some(expected.clone())))) }
        })
        .await
        .expect("resume lookup ok");
        assert_eq!(recovered, Some("ws-adopted".to_string()));
    }

    #[tokio::test]
    async fn resume_prefers_a_recovered_session_and_skips_the_lookup() {
        // A persisted session already lives in the worktree: its workspace wins and
        // the (belt-and-suspenders) adoption lookup is never consulted.
        let recovered = recover_resume_worktree(
            Some("ws-from-session".to_string()),
            "workflow-run/run-x",
            || async { panic!("must not look up when a session was recovered") },
        )
        .await
        .expect("session recovery wins");
        assert_eq!(recovered, Some("ws-from-session".to_string()));
    }

    #[tokio::test]
    async fn resume_adopts_nothing_when_no_record_and_no_session() {
        // Nothing to recover yet (no session, no record): the first step will mint.
        let expected = run_worktree_branch_name("run-x");
        let recovered = recover_resume_worktree(None, &expected, || async { Ok(None) })
            .await
            .expect("resume lookup ok");
        assert_eq!(recovered, None);
    }

    #[test]
    fn run_worktree_addressing_is_run_scoped_and_deterministic() {
        // DENY-PATH (c): two runs on the SAME pinned workspace get distinct
        // worktree branches AND paths (no collision); the same run always
        // addresses the same worktree (deterministic → resume/reuse is safe).
        let pinned = "/sandbox/repo";
        let a_branch = run_worktree_branch_name("run-aaa");
        let b_branch = run_worktree_branch_name("run-bbb");
        assert_ne!(a_branch, b_branch);
        assert_eq!(a_branch, run_worktree_branch_name("run-aaa"));

        let a_path = run_worktree_target_path(pinned, "run-aaa").expect("path a");
        let b_path = run_worktree_target_path(pinned, "run-bbb").expect("path b");
        assert_ne!(a_path, b_path);
        assert_eq!(a_path, run_worktree_target_path(pinned, "run-aaa").unwrap());
        // The worktree lands as a sibling of the pinned checkout.
        assert_eq!(a_path, "/sandbox/wf-run-run-aaa");
    }

    // --- M2: lane worktree base-ref + merge-back ---

    #[test]
    fn lane_worktree_bases_off_run_level_not_pinned() {
        // M2(a): the run-level worktree bases off the pinned checkout; a lane
        // worktree bases off the RUN-LEVEL worktree (so pre-group commits flow in).
        assert_eq!(
            worktree_base_workspace_id(NO_LANE, "ws-pinned", "ws-run-level"),
            "ws-pinned"
        );
        assert_eq!(
            worktree_base_workspace_id("fix", "ws-pinned", "ws-run-level"),
            "ws-run-level"
        );
        assert_eq!(
            worktree_base_workspace_id("docs", "ws-pinned", "ws-run-level"),
            "ws-run-level"
        );
    }

    #[test]
    fn decide_lane_merge_skips_when_already_ancestor() {
        // M2(b) idempotency: a lane whose branch is already an ancestor of the
        // run-level HEAD (crash-resume mid merge-back) is skipped, never re-merged;
        // otherwise it is merged.
        assert_eq!(decide_lane_merge(true), LaneMergeAction::Skip);
        assert_eq!(decide_lane_merge(false), LaneMergeAction::Merge);
    }

    #[test]
    fn run_worktree_target_path_needs_a_parent() {
        // A filesystem root has no parent → no derivable worktree path (mint
        // then fails with worktree_mint_failed rather than corrupting `/`).
        assert!(run_worktree_target_path("/", "run-x").is_none());
    }

    // --- L30 worktree-per-lane addressing (D-031c) ---

    #[test]
    fn lane_worktree_addressing_is_distinct_per_lane() {
        // DENY-PATH (e): each lane of a run gets a DISTINCT worktree branch AND
        // path (no collision between sibling lanes, nor with the run-level
        // worktree). The run-level scope stays byte-identical to wave 2b.
        let run = "run-z";
        let pinned = "/sandbox/repo";

        // Run-level scope == the exact wave-2b strings (byte-identical for flat).
        assert_eq!(
            worktree_branch_for_scope(run, NO_LANE),
            run_worktree_branch_name(run)
        );
        assert_eq!(
            worktree_target_path_for_scope(pinned, run, NO_LANE),
            run_worktree_target_path(pinned, run)
        );

        let a_branch = worktree_branch_for_scope(run, "a");
        let b_branch = worktree_branch_for_scope(run, "b");
        let run_branch = worktree_branch_for_scope(run, NO_LANE);
        assert_eq!(a_branch, "workflow-run/run-z/a");
        assert_ne!(a_branch, b_branch);
        assert_ne!(a_branch, run_branch);
        assert_ne!(b_branch, run_branch);

        let a_path = worktree_target_path_for_scope(pinned, run, "a").unwrap();
        let b_path = worktree_target_path_for_scope(pinned, run, "b").unwrap();
        let run_path = worktree_target_path_for_scope(pinned, run, NO_LANE).unwrap();
        assert_eq!(a_path, "/sandbox/wf-run-run-z-a");
        assert_ne!(a_path, b_path);
        assert_ne!(a_path, run_path);
        assert_ne!(b_path, run_path);
        // Deterministic: the same lane always addresses the same worktree
        // (resume/adopt is safe).
        assert_eq!(a_branch, worktree_branch_for_scope(run, "a"));
        assert_eq!(a_path, worktree_target_path_for_scope(pinned, run, "a").unwrap());
    }

    #[test]
    fn lane_worktree_adoption_is_scoped_to_the_lanes_own_branch() {
        // DENY-PATH (e), resume half: a lane adopts ONLY its own branch. A record
        // on lane a's branch is adopted when resuming lane a, but NOT when
        // resuming lane b (whose expected branch differs), so lanes never adopt
        // each other's worktrees on crash-resume.
        let run = "run-z";
        let a_branch = worktree_branch_for_scope(run, "a");
        let b_branch = worktree_branch_for_scope(run, "b");
        let found_on_a = Some(("ws-lane-a".to_string(), Some(a_branch.clone())));
        assert_eq!(
            adoptable_run_worktree(found_on_a.clone(), &a_branch),
            Some("ws-lane-a".to_string())
        );
        // Lane b's resume must not adopt lane a's worktree.
        assert_eq!(adoptable_run_worktree(found_on_a, &b_branch), None);
    }

    #[test]
    fn run_worktree_base_ref_is_none_outside_a_repo() {
        // rev-parse fails outside a git repo → None, letting git default to the
        // source repo's HEAD rather than passing a bogus base.
        let dir = std::env::temp_dir().join(format!("wf-norepo-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(run_worktree_base_ref(&dir.to_string_lossy()).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
