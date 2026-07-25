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
    worktree_scope, AgentConfigStep, Isolation, StepKind, NO_LANE,
};
use crate::live::sessions::model::SessionProcessPolicy;
use crate::live::workflows::isolation::{
    bind_workflow_local_gateway, cancel_workflow_run_bounded, WorkflowProcessIdentity,
};
use crate::origin::OriginContext;

use super::exec_policy::WorkflowSessionAcquisition;
use super::executor::{failed_msg, WorkflowStepExecutorImpl};
use super::gateway::workflow_gateway_server;
use super::parallel::{recover_resume_worktree, worktree_branch_for_scope};

mod ownership;
mod security;

use ownership::acquire_workflow_session;
pub(super) use ownership::{
    finalize_prepared_session_rollback, validate_bind_target, PreparedSessionRollbackEvidence,
};

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
    pub async fn hydrate_from_run(&self, run: &WorkflowRunRecord) -> Result<(), StepOutcome> {
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
        for (slot, session_id) in run.sessions() {
            if let Ok(Some(session)) = self.deps.session_service.get_session(session_id) {
                if self.isolation == Isolation::Worktree {
                    let scope = slot_scope
                        .get(slot)
                        .cloned()
                        .unwrap_or_else(|| NO_LANE.to_string());
                    self.inspect_existing_worktree_for_scope(&scope, &session.workspace_id)
                        .await?;
                    recovered_by_scope
                        .entry(scope)
                        .or_insert_with(|| session.workspace_id.clone());
                }
                // Recovery never reuses an existing actor. Re-arm ownership,
                // mint/install a current broker binding, then force the same
                // session through broker-policy relaunch before it enters the
                // executor's current map.
                let transition = self
                    .deps
                    .session_runtime
                    .lock_session_process_transition(session_id)
                    .await;
                acquire_workflow_session(
                    self.deps.workflow_owned_sessions.as_ref(),
                    &transition,
                    session_id,
                    &self.run_id,
                )?;
                let server = self.workflow_gateway_server(slot, session_id)?;
                self.deps.workflow_gateway_sessions.set(session_id, server);
                let process_policy = self.workflow_process_policy(slot, session_id)?;
                if self
                    .deps
                    .session_runtime
                    .relaunch_session_for_workflow_rebind_under_transition(
                        session_id,
                        process_policy,
                        &transition,
                    )
                    .await
                    .is_err()
                {
                    self.deps.workflow_gateway_sessions.remove(session_id);
                    return Err(failed_msg(
                        "workflow_agent_isolation_unavailable",
                        "recovered workflow session could not be broker-relaunched",
                    ));
                }
                self.current.lock().unwrap().insert(
                    slot.clone(),
                    CurrentSession {
                        session_id: session_id.clone(),
                        harness: session.agent_kind,
                    },
                );
            }
        }

        if self.isolation != Isolation::Worktree {
            return Ok(());
        }

        // Wave 2b crash-recovery, now per scope: recover each scope's effective
        // worktree so post-resume sessions/shells resolve to the SAME worktree
        // instead of re-minting. A persisted session's workspace wins;
        // otherwise, the session-less crash hole may adopt only the workspace
        // bound by this scope's exact durable operation-registration receipt.
        // Path/branch/creator metadata is revalidated but is never provenance.
        //
        // Run-level ([`NO_LANE`]) worktree.
        let expected_branch = worktree_branch_for_scope(&self.run_id, NO_LANE);
        let recovered = recover_resume_worktree(
            recovered_by_scope.get(NO_LANE).cloned(),
            &expected_branch,
            || self.lookup_run_worktree_for_resume(NO_LANE),
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
                || self.lookup_run_worktree_for_resume(scope),
            )
            .await;
            if let Ok(Some(ws)) = recovered {
                let mut lanes = self.lane_workspaces.lock().await;
                lanes.entry(scope.clone()).or_insert(ws);
            }
        }
        Ok(())
    }

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
    pub(super) async fn ensure_session(
        &self,
        slot: &str,
        scope: &str,
    ) -> Result<String, StepOutcome> {
        if let Some(current) = self.current.lock().unwrap().get(slot) {
            return Ok(current.session_id.clone());
        }
        let harness = self.harness_for_slot(slot)?;
        let model = self.models.lock().unwrap().get(slot).cloned().flatten();
        let bind_session_id = self
            .sessions
            .get(slot)
            .and_then(|spec| spec.bind_session_id.clone());

        let (session_id, session_harness, newly_created, ownership_acquired, transition) =
            if let Some(bind_id) = bind_session_id {
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
                // B8 harness validation is pure. Ownership is acquired separately
                // under the shared process-transition gate so validation + hold +
                // quiesce/relaunch cannot race public interactive resume.
                validate_bind_target(&bind_id, &session.agent_kind, &harness)?;
                let transition = self
                    .deps
                    .session_runtime
                    .lock_session_process_transition(&bind_id)
                    .await;
                let acquisition = acquire_workflow_session(
                    self.deps.workflow_owned_sessions.as_ref(),
                    &transition,
                    &bind_id,
                    &self.run_id,
                )?;
                if acquisition == WorkflowSessionAcquisition::AlreadyOwned {
                    return Err(failed_msg(
                        "session_bind_held",
                        format!(
                            "bound session {bind_id} is already assigned to workflow run {}",
                            self.run_id
                        ),
                    ));
                }
                let ownership_acquired = true;
                let process_policy = match self.workflow_process_policy(slot, &bind_id) {
                    Ok(policy) => policy,
                    Err(error) => {
                        self.rollback_prepared_session(
                            slot,
                            &bind_id,
                            false,
                            ownership_acquired,
                            transition,
                        )
                        .await?;
                        return Err(error);
                    }
                };
                // Rebind the bound session to an ephemeral, session-bound local
                // broker endpoint. No remote gateway bearer is placed in the plan,
                // durable session bindings, ACP payload, or child environment.
                let server = match self.workflow_gateway_server(slot, &bind_id) {
                    Ok(server) => server,
                    Err(error) => {
                        self.rollback_prepared_session(
                            slot,
                            &bind_id,
                            false,
                            ownership_acquired,
                            transition,
                        )
                        .await?;
                        return Err(error);
                    }
                };
                self.deps.workflow_gateway_sessions.set(&bind_id, server);
                if self
                    .deps
                    .session_runtime
                    .relaunch_session_for_workflow_rebind_under_transition(
                        &bind_id,
                        process_policy,
                        &transition,
                    )
                    .await
                    .is_err()
                {
                    self.rollback_prepared_session(
                        slot,
                        &bind_id,
                        false,
                        ownership_acquired,
                        transition,
                    )
                    .await?;
                    return Err(failed_msg(
                        "workflow_agent_isolation_unavailable",
                        "bound session could not be relaunched through the workflow broker",
                    ));
                }
                (
                    bind_id,
                    session.agent_kind,
                    false,
                    ownership_acquired,
                    transition,
                )
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
                // Split create/start so the ephemeral local-broker server and
                // workflow ownership can be registered BEFORE launch. MCP servers
                // are assembled from the extension seam, never written into the
                // durable session binding row.
                let record = match self.deps.session_runtime.create_durable_session(
                    &session_workspace_id,
                    &harness,
                    model.as_deref(),
                    mode,
                    None,
                    Vec::new(),
                    None,
                    SessionMcpBindingPolicy::InternalOnly,
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
                        return Err(failed_msg(
                            "workflow_model_route_unavailable",
                            format!(
                            "pinned model {model_id} is unavailable for the selected route ({})",
                            required_contexts.join(",")
                        ),
                        ));
                    }
                    Err(error) => {
                        return Err(failed_msg("session_start_failed", format!("{error:?}")))
                    }
                };
                let transition = self
                    .deps
                    .session_runtime
                    .lock_session_process_transition(&record.id)
                    .await;
                let ownership_acquired = match acquire_workflow_session(
                    self.deps.workflow_owned_sessions.as_ref(),
                    &transition,
                    &record.id,
                    &self.run_id,
                ) {
                    Ok(WorkflowSessionAcquisition::Acquired) => true,
                    Ok(WorkflowSessionAcquisition::AlreadyOwned) => {
                        return Err(failed_msg(
                            "workflow_agent_isolation_unavailable",
                            "fresh workflow session unexpectedly had prior ownership",
                        ));
                    }
                    Err(outcome) => {
                        let _ = self.deps.session_service.delete_session(&record.id);
                        return Err(outcome);
                    }
                };
                let process_policy = match self.workflow_process_policy(slot, &record.id) {
                    Ok(policy) => policy,
                    Err(error) => {
                        self.rollback_prepared_session(
                            slot,
                            &record.id,
                            true,
                            ownership_acquired,
                            transition,
                        )
                        .await?;
                        return Err(error);
                    }
                };
                // Register the session-bound local broker MCP server for launch.
                // It replaces the generic integration-gateway connection id only
                // in this in-memory launch assembly.
                let server = match self.workflow_gateway_server(slot, &record.id) {
                    Ok(server) => server,
                    Err(error) => {
                        self.rollback_prepared_session(
                            slot,
                            &record.id,
                            true,
                            ownership_acquired,
                            transition,
                        )
                        .await?;
                        return Err(error);
                    }
                };
                self.deps.workflow_gateway_sessions.set(&record.id, server);
                let record = match self
                    .deps
                    .session_runtime
                    .start_persisted_session_with_process_policy_under_transition(
                        &record,
                        process_policy,
                        &transition,
                    )
                    .await
                {
                    Ok(record) => record,
                    Err(error) => {
                        self.rollback_prepared_session(
                            slot,
                            &record.id,
                            true,
                            ownership_acquired,
                            transition,
                        )
                        .await?;
                        return Err(failed_msg("session_start_failed", format!("{error:?}")));
                    }
                };
                (record.id, harness, true, ownership_acquired, transition)
            };
        if let Err(error) =
            self.deps
                .workflow_service
                .set_session_for_slot(&self.run_id, slot, &session_id)
        {
            self.rollback_prepared_session(
                slot,
                &session_id,
                newly_created,
                ownership_acquired,
                transition,
            )
            .await?;
            return Err(failed_msg("session_persist_failed", error.to_string()));
        }
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
                let process_policy = match self.workflow_process_policy(slot, &session_id) {
                    Ok(policy) => policy,
                    Err(outcome) => return outcome,
                };
                let _ = self
                    .deps
                    .session_runtime
                    .set_live_session_config_option_with_process_policy(
                        &session_id,
                        ACP_MODEL_COMPAT_CONFIG_ID,
                        model,
                        process_policy,
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
