use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use crate::domains::agents::launch_options::environment::find_capability_affecting_env_override;
use crate::domains::agents::launch_options::LaunchSelectionUnsupported;
use crate::domains::agents::model::ResolvedAgentStatus;
use crate::domains::agents::readiness::service::resolve_launch_agent;
use crate::domains::agents::registry;
use crate::domains::agents::route_auth::resolve_launch_route_auth_rotated;
use crate::domains::sessions::extensions::{
    SessionInteractionRequestedContext, SessionInteractionResolvedContext, SessionStartedContext,
    SessionTurnFinishedContext,
};
use crate::domains::sessions::mcp_bindings::assembly::{
    assemble_session_mcp_launch, SessionMcpLaunchAssemblyError,
};
use crate::domains::sessions::mcp_bindings::crypto::encrypt_bindings;
use crate::domains::sessions::mcp_bindings::summaries::serialize_binding_summaries;
use crate::domains::sessions::mcp_bindings::workspace_attachment::WorkspaceMcpAttachmentError;
use crate::domains::sessions::model::{SessionMcpBindingPolicy, SessionRecord};
use crate::live::sessions::handle::LiveSessionHandle;
use crate::live::sessions::model::SessionHooks;
use crate::live::sessions::SessionStartupStrategy;

use super::launch_policy::{assemble_session_launch, session_is_closed, SessionLaunchContext};
use super::startup_errors::{
    map_encrypt_bindings_error_to_start, map_launch_selection_unsupported,
    map_mcp_launch_assembly_error_to_start, map_mcp_summary_error_to_start,
    map_start_session_error_to_create, map_start_session_error_to_ensure,
};
use super::startup_facts::choose_session_startup_strategy;
use super::{
    launch_env::build_session_launch_env, CreateAndStartSessionError, EnsureLiveSessionError,
    SessionLifecycleError, SessionMcpRefresh, SessionRuntime, StartSessionError,
};

fn require_prepared_basis_unchanged(
    prepared_basis_revision: &str,
    current_basis_revision: &str,
) -> Result<(), LaunchSelectionUnsupported> {
    if prepared_basis_revision != current_basis_revision {
        return Err(LaunchSelectionUnsupported::ObservationUnavailable { state: None });
    }
    Ok(())
}

impl SessionRuntime {
    #[tracing::instrument(skip_all, fields(session_id = %record.id))]
    pub async fn start_persisted_session(
        &self,
        record: &SessionRecord,
    ) -> Result<SessionRecord, CreateAndStartSessionError> {
        let live_start_started = Instant::now();
        let (_handle, native_session_id) = match self
            .start_live_session(
                record,
                SessionStartupStrategy::Fresh,
                record.system_prompt_append.clone(),
            )
            .await
        {
            Ok(result) => {
                tracing::info!(
                    workspace_id = %record.workspace_id,
                    session_id = %record.id,
                    native_session_id = %result.1,
                    elapsed_ms = live_start_started.elapsed().as_millis(),
                    "[workspace-latency] session.runtime.live_session_started"
                );
                result
            }
            Err(error) => {
                self.mark_session_errored(&record.id);
                tracing::warn!(
                    workspace_id = %record.workspace_id,
                    session_id = %record.id,
                    elapsed_ms = live_start_started.elapsed().as_millis(),
                    error = ?error,
                    "[workspace-latency] session.runtime.live_session_failed"
                );
                return Err(map_start_session_error_to_create(error));
            }
        };

        let persist_started = Instant::now();
        self.persist_live_session_state(&record.id, &native_session_id);
        let updated = self
            .session_service
            .get_session(&record.id)
            .map_err(CreateAndStartSessionError::Internal)?
            .unwrap_or_else(|| {
                let mut fallback = record.clone();
                fallback.native_session_id = Some(native_session_id.clone());
                fallback.status = "idle".into();
                fallback
            });
        tracing::info!(
            workspace_id = %updated.workspace_id,
            session_id = %updated.id,
            native_session_id = %updated.native_session_id.as_deref().unwrap_or_default(),
            elapsed_ms = persist_started.elapsed().as_millis(),
            "[workspace-latency] session.runtime.live_session_persisted"
        );
        Ok(updated)
    }

    #[tracing::instrument(skip_all, fields(session_id = %session_id))]
    pub async fn ensure_live_session(
        &self,
        session_id: &str,
        mcp_refresh: Option<SessionMcpRefresh>,
    ) -> Result<SessionRecord, EnsureLiveSessionError> {
        self.access_gate
            .assert_can_start_live_session(session_id)
            .map_err(|error| {
                EnsureLiveSessionError::Internal(anyhow::anyhow!(error.to_string()))
            })?;
        let record = self
            .get_session_or_not_found(session_id)
            .map_err(|error| match error {
                SessionLifecycleError::SessionNotFound(session_id) => {
                    EnsureLiveSessionError::SessionNotFound(session_id)
                }
                SessionLifecycleError::Internal(error) => EnsureLiveSessionError::Internal(error),
            })?;

        self.ensure_live_session_handle(&record, mcp_refresh)
            .await
            .map_err(map_start_session_error_to_ensure)?;

        self.session_service
            .get_session(session_id)
            .map_err(EnsureLiveSessionError::Internal)?
            .map_or(Ok(record), Ok)
    }

    pub(super) async fn ensure_live_session_handle(
        &self,
        record: &SessionRecord,
        mcp_refresh: Option<SessionMcpRefresh>,
    ) -> Result<Arc<LiveSessionHandle>, StartSessionError> {
        self.access_gate
            .assert_can_start_live_session(&record.id)
            .map_err(|error| StartSessionError::Internal(anyhow::anyhow!(error.to_string())))?;
        if session_is_closed(record) {
            return Err(StartSessionError::Closed);
        }
        let started = Instant::now();
        if let Some(handle) = self.acp_manager.get_ready_handle(&record.id).await {
            let native_session_id = handle
                .native_session_id()
                .expect("ready live handle must have a native session id");
            self.persist_live_session_state(&record.id, &native_session_id);
            tracing::info!(
                session_id = %record.id,
                workspace_id = %record.workspace_id,
                native_session_id = %native_session_id,
                elapsed_ms = started.elapsed().as_millis(),
                "[workspace-latency] session.runtime.ensure_live_handle.reused"
            );
            return Ok(handle);
        }

        let mut record = record.clone();
        if let Some(refresh) = mcp_refresh {
            if record.mcp_binding_policy == SessionMcpBindingPolicy::InternalOnly {
                tracing::debug!(
                    session_id = %record.id,
                    "ignoring MCP refresh for internal-only MCP binding policy"
                );
            } else {
                let mcp_bindings_ciphertext =
                    encrypt_bindings(self.session_data_cipher.as_ref(), &refresh.mcp_servers)
                        .map_err(map_encrypt_bindings_error_to_start)?;
                let mcp_binding_summaries_json =
                    serialize_binding_summaries(refresh.mcp_binding_summaries)
                        .map_err(map_mcp_summary_error_to_start)?;
                self.session_service
                    .store()
                    .update_mcp_bindings(
                        &record.id,
                        mcp_bindings_ciphertext.clone(),
                        mcp_binding_summaries_json.clone(),
                    )
                    .map_err(StartSessionError::Internal)?;
                record.mcp_bindings_ciphertext = mcp_bindings_ciphertext;
                record.mcp_binding_summaries_json = mcp_binding_summaries_json;
            }
        }

        let startup_strategy =
            choose_session_startup_strategy(&record, self.session_service.store())
                .map_err(StartSessionError::Internal)?;

        let (handle, native_session_id) = self
            .start_live_session(
                &record,
                startup_strategy,
                record.system_prompt_append.clone(),
            )
            .await?;

        self.persist_live_session_state(&record.id, &native_session_id);
        tracing::info!(
            session_id = %record.id,
            workspace_id = %record.workspace_id,
            native_session_id = %native_session_id,
            elapsed_ms = started.elapsed().as_millis(),
            "[workspace-latency] session.runtime.ensure_live_handle.live_started"
        );
        Ok(handle)
    }

    pub(super) async fn start_live_session_inner(
        &self,
        record: &SessionRecord,
        startup_strategy: SessionStartupStrategy,
        system_prompt_append: Option<String>,
    ) -> Result<(Arc<LiveSessionHandle>, String), StartSessionError> {
        let started = Instant::now();
        let startup_strategy_label = startup_strategy.as_str();
        tracing::info!(
            session_id = %record.id,
            workspace_id = %record.workspace_id,
            agent_kind = %record.agent_kind,
            startup_strategy = startup_strategy_label,
            has_system_prompt_append = system_prompt_append.is_some(),
            "[workspace-latency] session.runtime.start_live_session.start"
        );

        let validated_state = self
            .session_service
            .validate_persisted_launch_intent(record)
            .map_err(|unsupported| {
                map_launch_selection_unsupported(&record.agent_kind, unsupported)
            })?;
        let prepared_basis_revision = validated_state.basis_revision.clone();
        tracing::info!(
            session_id = %record.id,
            agent_kind = %record.agent_kind,
            harness_basis_revision = %validated_state.basis_revision,
            source_revision = validated_state.revision,
            event = "session.launch_selection.prevalidated",
            "persisted launch intent validated before start preparation"
        );

        let workspace_lookup_started = Instant::now();
        let workspace = self
            .workspace_runtime
            .get_workspace(&record.workspace_id)
            .map_err(StartSessionError::Internal)?
            .ok_or(StartSessionError::WorkspaceNotFound)?;
        // Common admission for every live start (create, resume, prompt, fork,
        // config): refuse a proven-deleted local checkout with a typed error so
        // it maps to a 409 rather than a generic ACP-start 500. This is an
        // early, friendly refusal — the directory can still vanish before the
        // subprocess spawns, where `validate_spawn_cwd` remains the backstop.
        if workspace.checkout_directory_missing() {
            return Err(StartSessionError::WorkspaceDirectoryMissing {
                path: workspace.path,
            });
        }
        tracing::info!(
            session_id = %record.id,
            workspace_id = %record.workspace_id,
            elapsed_ms = workspace_lookup_started.elapsed().as_millis(),
            "[workspace-latency] session.runtime.start_live_session.workspace_loaded"
        );

        let descriptor_lookup_started = Instant::now();
        let descriptor = registry::descriptor(&record.agent_kind)
            .ok_or_else(|| StartSessionError::AgentDescriptorNotFound(record.agent_kind.clone()))?;
        tracing::info!(
            session_id = %record.id,
            agent_kind = %record.agent_kind,
            elapsed_ms = descriptor_lookup_started.elapsed().as_millis(),
            "[workspace-latency] session.runtime.start_live_session.agent_descriptor_found"
        );

        let workspace_path = PathBuf::from(&workspace.path);
        let workspace_env = self
            .workspace_runtime
            .workspace_env(&workspace)
            .map_err(StartSessionError::Internal)?;
        if let Some(env_var_name) =
            find_capability_affecting_env_override(&descriptor, &workspace_env)
        {
            return Err(StartSessionError::AgentEnvOverrideUnsupported {
                agent_kind: record.agent_kind.clone(),
                env_var_name,
            });
        }
        let readiness_env = workspace_env.clone();
        // Fail closed BEFORE the readiness gate, mirroring create_session
        // (service/create.rs): an unsatisfiable selection must be reported as
        // the auth problem it is, not as "agent is not ready" — which reads
        // to a user as "go install something" when the real answer is "your
        // gateway budget is exhausted". agent-auth.md: a selection never
        // silently degrades to the user's personal credentials. The rotated
        // variant folds in the seat-cooling preview so an all-cooling pool
        // 409s here with the same sentence the launch itself would produce.
        let seat_cooling_store = crate::domains::agents::seat_cooling::SeatCoolingStore::new(
            self.session_service.store().db(),
        );
        if let Some(error) =
            crate::domains::agents::route_auth::launch_route_selection_failure_rotated(
                &self.runtime_home,
                &record.agent_kind,
                &seat_cooling_store,
            )
        {
            tracing::warn!(
                session_id = %record.id,
                workspace_id = %record.workspace_id,
                agent_kind = %record.agent_kind,
                code = error.code(),
                error = %error,
                "agent-auth selection is unsatisfiable; refusing live session start"
            );
            return Err(StartSessionError::RouteAuth(error));
        }
        let agent_resolution_started = Instant::now();
        // Route-aware launch readiness keeps the resolved agent's credential
        // state consistent with create/launch-options for gateway routes
        // (issue #1106); the live launch injects the route env below regardless.
        let resolved_agent = resolve_launch_agent(&descriptor, &self.runtime_home, &readiness_env);
        tracing::info!(
            session_id = %record.id,
            agent_kind = %record.agent_kind,
            elapsed_ms = agent_resolution_started.elapsed().as_millis(),
            "[workspace-latency] session.runtime.start_live_session.agent_resolved"
        );
        // A9 Scope C: mirrors create_session's readiness gate (create.rs) at
        // the common live-start seam, so resume/fork/prompt/config-lazy-start
        // converge on the same typed condition create-time already enforces
        // — an agent whose readiness regressed after creation (e.g. revoked
        // credentials) is refused here instead of falling through to a spawn
        // attempt and a generic ACP-start failure. Runs AFTER the selection
        // pre-check above, same order as create_session, so an unsatisfiable
        // selection is never misreported as a readiness gap.
        if resolved_agent.status != ResolvedAgentStatus::Ready {
            tracing::warn!(
                session_id = %record.id,
                agent_kind = %record.agent_kind,
                status = ?resolved_agent.status,
                credential_state = ?resolved_agent.credential_state,
                "Agent readiness check failed for live session start"
            );
            let detail = resolved_agent.agent_process.message.clone().or_else(|| {
                resolved_agent
                    .native
                    .as_ref()
                    .and_then(|artifact| artifact.message.clone())
            });
            return Err(StartSessionError::AgentNotReady {
                agent_kind: record.agent_kind.clone(),
                status: resolved_agent.status,
                detail,
            });
        }
        // Agent-auth render plane: read the declarative state file fresh and
        // render the route layer for this harness. Absent file = empty layer
        // (legacy/native); a scoped file with no selection fails the launch
        // closed with a typed error (spec §3). The pre-check above already
        // ruled out the unsatisfiable-selection case; this still runs to
        // materialize the actual route files for the spawn. Rotated: the
        // seat-rotation seam picks which pool seat serves THIS launch (the
        // same Db handle as the pre-check; render/preview never advance
        // rotation — only the actor's post-spawn confirm_served does).
        let route_auth = resolve_launch_route_auth_rotated(
            &self.runtime_home,
            &record.agent_kind,
            self.gateway_model_resolver.as_ref(),
            &seat_cooling_store,
        )
        .map_err(|error| {
            tracing::warn!(
                session_id = %record.id,
                workspace_id = %record.workspace_id,
                agent_kind = %record.agent_kind,
                code = error.code(),
                error = %error,
                "agent-auth route resolution failed; refusing launch"
            );
            StartSessionError::RouteAuth(error)
        })?;
        // Non-auth launch wiring only. A routed Codex CODEX_HOME + config.toml
        // comes from `route_auth` above; a native profile emits no delta and
        // inherits the user's own Codex home. This layer never authors either.
        let session_launch_env =
            build_session_launch_env(&resolved_agent, record.requested_model_id.as_deref())
                .map_err(StartSessionError::Internal)?;
        // No launch-options probe poke here, deliberately: a session launch is
        // not one of the target-observation service's closed trigger set.
        // The gate-driven launch backstop of the superseded design deleted with
        // the staleness machinery; anything a machine missed while the runtime
        // was down is the unconditional startup pass's job.
        let mcp_launch = match assemble_session_mcp_launch(
            self.session_data_cipher.as_ref(),
            &self.session_extensions,
            &self.product_mcp_launch_catalog,
            &workspace,
            record,
            system_prompt_append,
        ) {
            Ok(launch) => launch,
            Err(SessionMcpLaunchAssemblyError::WorkspaceAttachment(error)) => {
                // Point of detection. Downstream this becomes one generic HTTP
                // incident that has lost both the phase and the error class,
                // and the cleanup branch below can replace the root cause
                // outright — so record both here before either happens.
                let original_phase = error.phase();
                tracing::warn!(
                    target: "anyharness.workspace_mcp.attachment_failed",
                    session_id = %record.id,
                    phase = original_phase.as_str(),
                    source_error_class = error.source_class(),
                    "Workspace MCP attachment failed"
                );
                let error = match self.clear_workspace_mcp_binding_summary(record) {
                    Ok(()) => error,
                    Err(cleanup_error) => {
                        let error = WorkspaceMcpAttachmentError::summary_cleanup(cleanup_error);
                        // Attachment failed AND its cleanup failed: the stale
                        // Applied binding summary survives, which violates the
                        // fail-closed contract.
                        tracing::error!(
                            target: "anyharness.workspace_mcp.cleanup_failed",
                            session_id = %record.id,
                            original_phase = original_phase.as_str(),
                            cleanup_error_class = error.source_class(),
                            "Workspace MCP binding summary cleanup failed after attachment failure"
                        );
                        error
                    }
                };
                return Err(StartSessionError::WorkspaceMcpAttachmentFailed(error));
            }
            Err(error) => return Err(map_mcp_launch_assembly_error_to_start(error)),
        };
        if let Some(summaries_json) = mcp_launch.mcp_binding_summaries_json.clone() {
            self.session_service
                .store()
                .update_mcp_binding_summaries(&record.id, Some(summaries_json))
                .map_err(StartSessionError::Internal)?;
        }
        let acp_start_started = Instant::now();
        let launch = assemble_session_launch(SessionLaunchContext {
            record: record.clone(),
            agent: resolved_agent,
            workspace_path,
            workspace_env,
            session_env: session_launch_env,
            route_auth,
            mcp_servers: mcp_launch.mcp_servers,
            startup: startup_strategy,
            every_prompt_append: mcp_launch.system_prompt_append,
            first_prompt_append: mcp_launch.first_prompt_system_prompt_append,
        });
        let hooks = SessionHooks {
            on_turn_finish: Some(Arc::new({
                let extensions = self.session_extensions.clone();
                let workspace = workspace.clone();
                move |result| {
                    for extension in &extensions {
                        extension.on_turn_finished(SessionTurnFinishedContext {
                            workspace: workspace.clone(),
                            session_id: result.session_id.clone(),
                            turn_id: result.turn_id.clone(),
                            prompt_id: result.prompt_id.clone(),
                            outcome: result.outcome,
                            stop_reason: result.stop_reason.clone(),
                            last_event_seq: result.last_event_seq,
                            error_details: result.error_details.clone(),
                        });
                    }
                }
            })),
            // Both interaction hooks fire while the caller holds the session
            // event-sink lock, and the workflow extension does a synchronous
            // store lookup — so the fan-out is pushed to the blocking pool and
            // the sink lock is never held across a database read.
            on_interaction_requested: Some(Arc::new({
                let extensions = self.session_extensions.clone();
                move |ctx: SessionInteractionRequestedContext| {
                    let extensions = extensions.clone();
                    tokio::task::spawn_blocking(move || {
                        for extension in &extensions {
                            extension.on_interaction_requested(ctx.clone());
                        }
                    });
                }
            })),
            on_interaction_resolved: Some(Arc::new({
                let extensions = self.session_extensions.clone();
                move |ctx: SessionInteractionResolvedContext| {
                    let extensions = extensions.clone();
                    tokio::task::spawn_blocking(move || {
                        for extension in &extensions {
                            extension.on_interaction_resolved(ctx.clone());
                        }
                    });
                }
            })),
            on_exit: None,
        };
        // Re-read the current basis and exact observed membership at the last
        // common point before every ACP process start. The earlier validation
        // avoids doing start preparation for a stale intent; this one closes
        // the preparation window for create/replay/resume/prompt/fork/config.
        let validated_state = self
            .session_service
            .validate_persisted_launch_intent(record)
            .map_err(|unsupported| {
                map_launch_selection_unsupported(&record.agent_kind, unsupported)
            })?;
        require_prepared_basis_unchanged(&prepared_basis_revision, &validated_state.basis_revision)
            .map_err(|unsupported| {
                map_launch_selection_unsupported(&record.agent_kind, unsupported)
            })?;
        tracing::info!(
            session_id = %record.id,
            agent_kind = %record.agent_kind,
            harness_basis_revision = %validated_state.basis_revision,
            source_revision = validated_state.revision,
            event = "session.launch_selection.revalidated",
            "persisted launch intent revalidated immediately before real start"
        );
        let (handle, ready) = self
            .acp_manager
            .start_session(launch, hooks)
            .await
            .map_err(StartSessionError::AcpStart)?;
        tracing::info!(
            session_id = %record.id,
            workspace_id = %record.workspace_id,
            native_session_id = %ready.native_session_id,
            startup_strategy = startup_strategy_label,
            elapsed_ms = acp_start_started.elapsed().as_millis(),
            total_elapsed_ms = started.elapsed().as_millis(),
            "[workspace-latency] session.runtime.start_live_session.acp_started"
        );

        for extension in &self.session_extensions {
            extension.on_session_started(SessionStartedContext {
                session_id: record.id.clone(),
                agent_kind: record.agent_kind.clone(),
            });
        }

        Ok((handle, ready.native_session_id))
    }
}

#[cfg(test)]
mod basis_continuity_tests {
    use super::require_prepared_basis_unchanged;
    use crate::domains::agents::launch_options::LaunchSelectionUnsupported;

    #[test]
    fn prepared_launch_rejects_a_newly_validated_different_basis() {
        let error = require_prepared_basis_unchanged("basis-a", "basis-b")
            .expect_err("prepared launch facts cannot cross a basis transition");
        assert!(matches!(
            error,
            LaunchSelectionUnsupported::ObservationUnavailable { state: None }
        ));
    }
}
