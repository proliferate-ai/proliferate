//! The slot/session lifecycle cluster: ensuring a slot's (lifetime-scoped, B7)
//! session exists — creating fresh or binding an existing one (L29/B8) — and
//! `agent.config` (model-only, A3), which folds live onto an already-open
//! session. Prompt injection + turn waiting live in [`super::turn`]; goal
//! waiting lives in [`super::goal`] (both split out of this cluster for line
//! budget). Moved verbatim out of `executor.rs` (WS0B-R).

use std::collections::HashMap;

use serde_json::Value;

use crate::domains::sessions::live_config::ACP_MODEL_COMPAT_CONFIG_ID;
use crate::domains::sessions::model::SessionMcpBindingPolicy;
use crate::domains::sessions::runtime::CreateAndStartSessionError;
use crate::domains::workflows::engine::StepOutcome;
use crate::domains::workflows::model::WorkflowRunRecord;
use crate::domains::workflows::plan::{
    worktree_scope, AgentConfigStep, Isolation, PlanGateway, StepKind, NO_LANE,
};
use crate::origin::OriginContext;

use super::executor::{failed_msg, WorkflowStepExecutorImpl};
use super::gateway::workflow_gateway_server;
use super::parallel::{recover_resume_worktree, worktree_branch_for_scope};

/// The (session_id, harness) a slot currently owns.
#[derive(Clone)]
pub(super) struct CurrentSession {
    pub(super) session_id: String,
    #[allow(dead_code)]
    pub(super) harness: String,
}

impl WorkflowStepExecutorImpl {
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
    pub(super) async fn ensure_session(&self, slot: &str, scope: &str) -> Result<String, StepOutcome> {
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
            let mode = super::exec_policy::bypass_mode_for_kind(&harness);
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
            let record = match self.deps.session_runtime.create_durable_session(
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
            ) {
                Ok(record) => record,
                // A definition's pinned model is authored without knowing the
                // runner's auth contexts (a seed pinning `haiku` cannot run in a
                // bedrock-only env, where that id is gated). An unattended run
                // must not die on an unlock prompt no human will see — fall back
                // to the catalog default for the ACTIVE contexts, loudly.
                Err(CreateAndStartSessionError::ModelGated {
                    model_id,
                    required_contexts,
                    ..
                }) => {
                    tracing::warn!(
                        run_id = %self.run_id,
                        slot,
                        model_id = %model_id,
                        ?required_contexts,
                        "workflow slot model gated under active auth contexts; \
                         falling back to the context default model"
                    );
                    self.deps
                        .session_runtime
                        .create_durable_session(
                            &session_workspace_id,
                            &harness,
                            None,
                            mode,
                            None,
                            Vec::new(),
                            None,
                            SessionMcpBindingPolicy::InheritWorkspace,
                            false,
                            OriginContext::system_local_runtime(),
                        )
                        .map_err(|error| {
                            failed_msg("session_start_failed", format!("{error:?}"))
                        })?
                }
                Err(error) => {
                    return Err(failed_msg("session_start_failed", format!("{error:?}")))
                }
            };
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

    /// `agent.config` executes instantly and is model-only (A3): it folds the
    /// model onto the step's slot for every later step in that slot. The change
    /// is applied LIVE to the slot's session if one is already open, else it
    /// takes effect at the slot's next session creation. Harness is fixed per
    /// slot — a different harness is a different slot, so there is no
    /// harness-switch machinery.
    pub(super) async fn run_agent_config(&self, slot: &str, cfg: &AgentConfigStep) -> StepOutcome {
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
}

/// §5.3: a gateway block declaring integration grants that this lane cannot
/// honor — non-empty `integrations` with an empty/absent credential or URL —
/// must fail the run explicitly rather than silently launch the agent with zero
/// tools.
pub(super) fn gateway_functions_unsupported(gateway: Option<&PlanGateway>) -> bool {
    match gateway {
        Some(gateway) => {
            !gateway.integrations.is_empty()
                && (gateway.authorization.trim().is_empty() || gateway.url.trim().is_empty())
        }
        None => false,
    }
}

/// B8 bind-target validation (pure decision, so it is unit-testable without a
/// live runtime). A bound session must:
/// 1. match the slot's harness — otherwise the plan is malformed (hard error);
/// 2. not already be held by a *different* live run — otherwise binding would
///    silently transfer ownership (`mark` overwrites the owner entry, and the
///    previous owner's `release_run` would then no longer drop it), leaking the
///    lockout. Re-binding a session THIS run already holds is idempotent and OK.
pub(super) fn validate_bind_target(
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
