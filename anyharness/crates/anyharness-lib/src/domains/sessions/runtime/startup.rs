use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use crate::domains::agents::readiness::service::resolve_agent_with_env;
use crate::domains::agents::registry;
use crate::domains::agents::route_auth::resolve_launch_route_auth;
use crate::domains::sessions::extensions::{SessionStartedContext, SessionTurnFinishedContext};
use crate::domains::sessions::links::model::SessionLinkRelation;
use crate::domains::sessions::mcp_bindings::assembly::{
    assemble_session_mcp_launch, SessionMcpLaunchAssemblyError,
};
use crate::domains::sessions::mcp_bindings::crypto::{encrypt_bindings, SessionMcpBindingsError};
use crate::domains::sessions::mcp_bindings::summaries::{
    serialize_binding_summaries, SessionMcpSummaryError,
};
use crate::domains::sessions::model::{SessionMcpBindingPolicy, SessionRecord};
use crate::domains::sessions::store::SessionStore;
use crate::live::sessions::handle::LiveSessionHandle;
use crate::live::sessions::model::SessionHooks;
use crate::live::sessions::SessionStartupStrategy;

use super::launch_policy::{
    assemble_session_launch, choose_startup_strategy, session_is_closed, SessionLaunchContext,
    SessionStartupFacts,
};
use super::{
    launch_env::build_session_launch_env, CreateAndStartSessionError, EnsureLiveSessionError,
    SessionLifecycleError, SessionMcpRefresh, SessionRuntime, StartSessionError,
};

/// Resolve steps only — gather the durable facts, then let the pure policy in
/// `launch_policy` pick the strategy. The parent lookup is gated to fork
/// children that have not yet run their own turn (`last_prompt_at` unset): the
/// policy may need the parent native id to re-fork — either because the child
/// never had a native id, or because its eagerly-recorded one is process-local
/// and may be dead after a cold restart-before-first-prompt. This intentionally
/// over-fetches for durable-fork (non-Claude) zero-turn children, where the
/// policy ignores the parent id; that is a single harmless row read kept here so
/// the resolve gate doesn't have to duplicate the adapter distinction. A fork
/// child that has already run keeps its durable native id and skips the lookup.
pub(super) fn choose_session_startup_strategy(
    record: &SessionRecord,
    session_store: &SessionStore,
) -> anyhow::Result<SessionStartupStrategy> {
    let is_fork_child =
        session_store.has_inbound_link_relation(&record.id, SessionLinkRelation::Fork)?;
    let fork_parent_native_session_id = if is_fork_child && record.last_prompt_at.is_none() {
        session_store
            .find_parent_by_inbound_link_relation(&record.id, SessionLinkRelation::Fork)?
            .map(|parent| parent.native_session_id)
    } else {
        None
    };
    choose_startup_strategy(&SessionStartupFacts {
        is_fork_child,
        native_session_id: record.native_session_id.clone(),
        fork_parent_native_session_id,
        agent_kind: record.agent_kind.clone(),
        has_last_prompt_at: record.last_prompt_at.is_some(),
        has_turn_started_event: session_store.has_turn_started_event(&record.id)?,
    })
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
            .map_err(|error| match error {
                StartSessionError::WorkspaceNotFound => EnsureLiveSessionError::Internal(
                    anyhow::anyhow!("workspace not found for session"),
                ),
                StartSessionError::AgentDescriptorNotFound(agent_kind) => {
                    EnsureLiveSessionError::Internal(anyhow::anyhow!(
                        "agent descriptor not found: {agent_kind}"
                    ))
                }
                StartSessionError::Closed => EnsureLiveSessionError::SessionClosed,
                StartSessionError::MissingDataKey => EnsureLiveSessionError::MissingDataKey,
                StartSessionError::RestartRequired(detail) => {
                    EnsureLiveSessionError::RestartRequired(detail)
                }
                StartSessionError::RouteAuth(error) => EnsureLiveSessionError::RouteAuth(error),
                StartSessionError::Internal(error) | StartSessionError::AcpStart(error) => {
                    EnsureLiveSessionError::Internal(error)
                }
            })?;

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
        if let Some(handle) = self.acp_manager.get_handle(&record.id).await {
            tracing::info!(
                session_id = %record.id,
                workspace_id = %record.workspace_id,
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

        let session_store = self.session_service.store().clone();

        // Repair any turns that were left open (turn_started without
        // turn_ended) before starting the actor. LiveSessionManager reads last_seq
        // inside its start/inject critical section after this repair.
        match session_store.repair_unclosed_turns(&record.id) {
            Ok(0) => {}
            Ok(n) => {
                tracing::info!(
                    session_id = %record.id,
                    repaired_turns = n,
                    "repaired unclosed turns before resume"
                );
            }
            Err(e) => {
                tracing::warn!(
                    session_id = %record.id,
                    error = %e,
                    "failed to repair unclosed turns before resume"
                );
            }
        }

        let startup_strategy = choose_session_startup_strategy(&record, &session_store)
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

    pub(super) async fn start_live_session(
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

        let workspace_lookup_started = Instant::now();
        let workspace = self
            .workspace_runtime
            .get_workspace(&record.workspace_id)
            .map_err(StartSessionError::Internal)?
            .ok_or(StartSessionError::WorkspaceNotFound)?;
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
        let readiness_env = workspace_env.clone();
        let agent_resolution_started = Instant::now();
        let resolved_agent =
            resolve_agent_with_env(&descriptor, &self.runtime_home, &readiness_env);
        tracing::info!(
            session_id = %record.id,
            agent_kind = %record.agent_kind,
            elapsed_ms = agent_resolution_started.elapsed().as_millis(),
            "[workspace-latency] session.runtime.start_live_session.agent_resolved"
        );
        let session_launch_env = build_session_launch_env(
            &resolved_agent,
            &self.runtime_home,
            record.requested_model_id.as_deref(),
        )
        .map_err(StartSessionError::Internal)?;
        // Agent-auth render plane: read the declarative state file fresh and
        // render the route layer for this harness. Absent file = empty layer
        // (legacy/native); a scoped file with no selection fails the launch
        // closed with a typed error (spec §3).
        let route_auth = resolve_launch_route_auth(&self.runtime_home, &record.agent_kind)
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
        let mcp_launch = assemble_session_mcp_launch(
            self.session_data_cipher.as_ref(),
            &self.session_extensions,
            &self.product_mcp_launch_catalog,
            &workspace,
            record,
            system_prompt_append,
        )
        .map_err(map_mcp_launch_assembly_error_to_start)?;
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
                            outcome: result.outcome,
                            stop_reason: result.stop_reason.clone(),
                            last_event_seq: result.last_event_seq,
                            error_details: result.error_details.clone(),
                        });
                    }
                }
            })),
            on_exit: None,
        };
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

pub(super) fn map_start_session_error_to_anyhow(error: StartSessionError) -> anyhow::Error {
    match error {
        StartSessionError::WorkspaceNotFound => anyhow::anyhow!("workspace not found for session"),
        StartSessionError::AgentDescriptorNotFound(agent_kind) => {
            anyhow::anyhow!("agent descriptor not found: {agent_kind}")
        }
        StartSessionError::Closed => anyhow::anyhow!("session is closed"),
        StartSessionError::MissingDataKey => {
            anyhow::anyhow!("{}", SessionMcpBindingsError::missing_data_key_detail())
        }
        StartSessionError::RestartRequired(detail) => anyhow::anyhow!(detail),
        StartSessionError::RouteAuth(error) => anyhow::Error::new(error),
        StartSessionError::Internal(error) | StartSessionError::AcpStart(error) => error,
    }
}

fn map_encrypt_bindings_error_to_start(error: SessionMcpBindingsError) -> StartSessionError {
    match error {
        SessionMcpBindingsError::MissingDataKey => StartSessionError::MissingDataKey,
        SessionMcpBindingsError::Encrypt(error) | SessionMcpBindingsError::Decrypt(error) => {
            StartSessionError::Internal(error)
        }
    }
}

fn map_mcp_summary_error_to_start(error: SessionMcpSummaryError) -> StartSessionError {
    match error {
        SessionMcpSummaryError::Invalid(detail) => {
            StartSessionError::Internal(anyhow::anyhow!(detail))
        }
        SessionMcpSummaryError::Serialize(error) => StartSessionError::Internal(error),
    }
}

fn map_mcp_launch_assembly_error_to_start(
    error: SessionMcpLaunchAssemblyError,
) -> StartSessionError {
    match error {
        SessionMcpLaunchAssemblyError::MissingDataKey => StartSessionError::MissingDataKey,
        SessionMcpLaunchAssemblyError::RestartRequired(detail) => {
            StartSessionError::RestartRequired(detail)
        }
        SessionMcpLaunchAssemblyError::Internal(error) => StartSessionError::Internal(error),
    }
}

fn map_start_session_error_to_create(error: StartSessionError) -> CreateAndStartSessionError {
    match error {
        StartSessionError::WorkspaceNotFound => CreateAndStartSessionError::WorkspaceNotFound,
        StartSessionError::AgentDescriptorNotFound(agent_kind) => {
            CreateAndStartSessionError::Internal(anyhow::anyhow!(
                "agent descriptor not found: {agent_kind}"
            ))
        }
        StartSessionError::Closed => {
            CreateAndStartSessionError::Internal(anyhow::anyhow!("session is closed"))
        }
        StartSessionError::MissingDataKey => CreateAndStartSessionError::MissingDataKey,
        StartSessionError::RestartRequired(detail) => {
            CreateAndStartSessionError::Internal(anyhow::anyhow!(detail))
        }
        StartSessionError::RouteAuth(error) => CreateAndStartSessionError::RouteAuth(error),
        StartSessionError::Internal(error) => CreateAndStartSessionError::Internal(error),
        StartSessionError::AcpStart(error) => CreateAndStartSessionError::StartFailed(error),
    }
}
