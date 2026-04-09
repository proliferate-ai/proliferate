use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use anyharness_contract::v1::{
    ConfigApplyState, Session, SessionExecutionSummary, SessionLiveConfigSnapshot,
    WorkspaceExecutionSummary,
};

use super::execution_summary::{
    idle_workspace_execution_summary, summarize_session_record, summarize_workspace_sessions,
};
use super::model::SessionRecord;
use super::service::SessionService;
use crate::acp::manager::AcpManager;
use crate::acp::session_actor::{
    LiveSessionHandle, PromptAcceptError, SessionCommand, SetConfigOptionCommandError,
};
use crate::agents::model::{AgentKind, ResolvedAgent};
use crate::agents::registry::built_in_registry;
use crate::agents::resolver::resolve_agent;
use crate::api::http::latency::{latency_trace_fields, LatencyRequestContext};
use crate::workspaces::service::WorkspaceService;

pub struct SessionRuntime {
    session_service: Arc<SessionService>,
    workspace_service: Arc<WorkspaceService>,
    acp_manager: AcpManager,
    runtime_home: PathBuf,
}

#[derive(Debug)]
pub enum CreateAndStartSessionError {
    Invalid(String),
    WorkspaceNotFound,
    StartFailed(anyhow::Error),
    Internal(anyhow::Error),
}

#[derive(Debug)]
pub enum EnsureLiveSessionError {
    SessionNotFound(String),
    Internal(anyhow::Error),
}

#[derive(Debug)]
pub enum SetSessionConfigOptionError {
    SessionNotFound(String),
    Rejected(String),
    Internal(anyhow::Error),
}

#[derive(Debug)]
pub enum SendPromptError {
    SessionNotFound(String),
    EmptyPrompt,
    Busy,
    Internal(anyhow::Error),
}

#[derive(Debug)]
pub enum SessionLifecycleError {
    SessionNotFound(String),
    Internal(anyhow::Error),
}

#[derive(Debug, Clone)]
pub enum PermissionResolution {
    Allow,
    Deny,
    OptionId(String),
}

#[derive(Debug)]
pub enum ResolvePermissionError {
    SessionNotLive(String),
    PermissionNotFound(String),
}

#[derive(Debug)]
enum StartSessionError {
    WorkspaceNotFound,
    AgentDescriptorNotFound(String),
    Internal(anyhow::Error),
    AcpStart(anyhow::Error),
}

impl SessionRuntime {
    pub fn new(
        session_service: Arc<SessionService>,
        workspace_service: Arc<WorkspaceService>,
        acp_manager: AcpManager,
        runtime_home: PathBuf,
    ) -> Self {
        Self {
            session_service,
            workspace_service,
            acp_manager,
            runtime_home,
        }
    }

    pub async fn session_to_contract(&self, record: &SessionRecord) -> anyhow::Result<Session> {
        let live_config = self.session_service.get_live_config_snapshot(&record.id)?;
        self.session_to_contract_with_live_config(record, live_config)
            .await
    }

    pub async fn session_to_contract_with_live_config(
        &self,
        record: &SessionRecord,
        live_config: Option<SessionLiveConfigSnapshot>,
    ) -> anyhow::Result<Session> {
        let execution_summary = self.session_execution_summary(record).await;
        Ok(record.to_contract_with_details(live_config, Some(execution_summary)))
    }

    pub async fn session_execution_summary(
        &self,
        record: &SessionRecord,
    ) -> SessionExecutionSummary {
        let live_snapshot = match self.acp_manager.get_handle(&record.id).await {
            Some(handle) => Some(handle.execution_snapshot().await),
            None => None,
        };

        summarize_session_record(record, live_snapshot.as_ref())
    }

    pub async fn workspace_execution_summary(
        &self,
        workspace_id: &str,
    ) -> anyhow::Result<WorkspaceExecutionSummary> {
        let records = self.session_service.list_sessions(Some(workspace_id), false)?;
        Ok(self
            .summarize_workspace_session_records(records)
            .await
            .unwrap_or_else(idle_workspace_execution_summary))
    }

    pub async fn workspace_execution_summaries(
        &self,
    ) -> anyhow::Result<HashMap<String, WorkspaceExecutionSummary>> {
        let records = self.session_service.list_sessions(None, false)?;
        let mut grouped = HashMap::<String, Vec<SessionRecord>>::new();

        for record in records {
            grouped
                .entry(record.workspace_id.clone())
                .or_default()
                .push(record);
        }

        let mut summaries = HashMap::with_capacity(grouped.len());
        for (workspace_id, records) in grouped {
            let summary = self
                .summarize_workspace_session_records(records)
                .await
                .unwrap_or_else(idle_workspace_execution_summary);
            summaries.insert(workspace_id, summary);
        }

        Ok(summaries)
    }

    pub async fn create_and_start_session(
        &self,
        workspace_id: &str,
        agent_kind: &str,
        model_id: Option<&str>,
        mode_id: Option<&str>,
        system_prompt_append: Option<Vec<String>>,
        latency: Option<&LatencyRequestContext>,
    ) -> Result<SessionRecord, CreateAndStartSessionError> {
        let started = Instant::now();
        let latency_fields = latency_trace_fields(latency);
        let system_prompt_append_count = system_prompt_append
            .as_ref()
            .map(|entries| entries.len())
            .unwrap_or(0);
        tracing::info!(
            workspace_id = %workspace_id,
            agent_kind = %agent_kind,
            model_id = ?model_id,
            mode_id = ?mode_id,
            system_prompt_append_count,
            flow_id = latency_fields.flow_id,
            flow_kind = latency_fields.flow_kind,
            flow_source = latency_fields.flow_source,
            prompt_id = latency_fields.prompt_id,
            "[workspace-latency] session.runtime.create_and_start.start"
        );

        let durable_create_started = Instant::now();
        let mut record = self
            .session_service
            .create_session(workspace_id, agent_kind, model_id, mode_id)
            .map_err(|error| CreateAndStartSessionError::Invalid(error.to_string()))?;
        tracing::info!(
            workspace_id = %workspace_id,
            session_id = %record.id,
            elapsed_ms = durable_create_started.elapsed().as_millis(),
            flow_id = latency_fields.flow_id,
            flow_kind = latency_fields.flow_kind,
            flow_source = latency_fields.flow_source,
            prompt_id = latency_fields.prompt_id,
            "[workspace-latency] session.runtime.durable_session_created"
        );

        let system_prompt_append = join_system_prompt_append(system_prompt_append);
        let live_start_started = Instant::now();
        let start_result = self
            .start_live_session(&record, false, 0, system_prompt_append, latency)
            .await;
        let (_handle, native_session_id) = match start_result {
            Ok(result) => {
                tracing::info!(
                        workspace_id = %workspace_id,
                        session_id = %record.id,
                        native_session_id = %result.1,
                        elapsed_ms = live_start_started.elapsed().as_millis(),
                        flow_id = latency_fields.flow_id,
                flow_kind = latency_fields.flow_kind,
                flow_source = latency_fields.flow_source,
                prompt_id = latency_fields.prompt_id,
                        "[workspace-latency] session.runtime.live_session_started"
                    );
                result
            }
            Err(error) => {
                tracing::warn!(
                        workspace_id = %workspace_id,
                        session_id = %record.id,
                        elapsed_ms = live_start_started.elapsed().as_millis(),
                        error = ?error,
                        flow_id = latency_fields.flow_id,
                flow_kind = latency_fields.flow_kind,
                flow_source = latency_fields.flow_source,
                prompt_id = latency_fields.prompt_id,
                        "[workspace-latency] session.runtime.live_session_failed"
                    );
                return Err(match error {
                    StartSessionError::WorkspaceNotFound => {
                        CreateAndStartSessionError::WorkspaceNotFound
                    }
                    StartSessionError::AgentDescriptorNotFound(agent_kind) => {
                        CreateAndStartSessionError::Internal(anyhow::anyhow!(
                            "agent descriptor not found: {agent_kind}"
                        ))
                    }
                    StartSessionError::Internal(error) => {
                        CreateAndStartSessionError::Internal(error)
                    }
                    StartSessionError::AcpStart(error) => {
                        self.mark_session_errored(&record.id);
                        CreateAndStartSessionError::StartFailed(error)
                    }
                });
            }
        };

        let persist_started = Instant::now();
        self.persist_live_session_state(&record.id, &native_session_id);
        record.native_session_id = Some(native_session_id);
        record.status = "idle".into();
        tracing::info!(
            workspace_id = %workspace_id,
            session_id = %record.id,
            native_session_id = %record.native_session_id.as_deref().unwrap_or_default(),
            elapsed_ms = persist_started.elapsed().as_millis(),
            total_elapsed_ms = started.elapsed().as_millis(),
            flow_id = latency_fields.flow_id,
            flow_kind = latency_fields.flow_kind,
            flow_source = latency_fields.flow_source,
            prompt_id = latency_fields.prompt_id,
            "[workspace-latency] session.runtime.create_and_start.completed"
        );

        Ok(record)
    }

    pub async fn ensure_live_session(
        &self,
        session_id: &str,
        latency: Option<&LatencyRequestContext>,
    ) -> Result<SessionRecord, EnsureLiveSessionError> {
        let record = self
            .get_session_or_not_found(session_id)
            .map_err(|error| match error {
                SessionLifecycleError::SessionNotFound(session_id) => {
                    EnsureLiveSessionError::SessionNotFound(session_id)
                }
                SessionLifecycleError::Internal(error) => EnsureLiveSessionError::Internal(error),
            })?;

        self.ensure_live_session_handle(&record, latency)
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
                StartSessionError::Internal(error) | StartSessionError::AcpStart(error) => {
                    EnsureLiveSessionError::Internal(error)
                }
            })?;

        self.session_service
            .get_session(session_id)
            .map_err(EnsureLiveSessionError::Internal)?
            .map_or(Ok(record), Ok)
    }

    /// Apply or queue a live ACP config option change for an existing session.
    ///
    /// This is a runtime-owned operation because it may need to ensure the ACP
    /// actor is running, forward a command over the actor channel, and wait for
    /// the actor to either apply the change immediately or queue it for later.
    /// After the actor responds, runtime reloads the durable session summary and
    /// current live-config snapshot from the session domain.
    pub async fn set_live_session_config_option(
        &self,
        session_id: &str,
        config_id: &str,
        value: &str,
    ) -> Result<
        (
            SessionRecord,
            Option<SessionLiveConfigSnapshot>,
            ConfigApplyState,
        ),
        SetSessionConfigOptionError,
    > {
        let record = self
            .get_session_or_not_found(session_id)
            .map_err(|error| match error {
                SessionLifecycleError::SessionNotFound(session_id) => {
                    SetSessionConfigOptionError::SessionNotFound(session_id)
                }
                SessionLifecycleError::Internal(error) => {
                    SetSessionConfigOptionError::Internal(error)
                }
            })?;

        // Config mutations go through the live ACP actor. If the actor is not
        // running yet, start or resume it and return its control handle.
        let handle = self
            .ensure_live_session_handle(&record, None)
            .await
            .map_err(|error| match error {
                StartSessionError::WorkspaceNotFound => SetSessionConfigOptionError::Internal(
                    anyhow::anyhow!("workspace not found for session"),
                ),
                StartSessionError::AgentDescriptorNotFound(agent_kind) => {
                    SetSessionConfigOptionError::Internal(anyhow::anyhow!(
                        "agent descriptor not found: {agent_kind}"
                    ))
                }
                StartSessionError::Internal(error) | StartSessionError::AcpStart(error) => {
                    SetSessionConfigOptionError::Internal(error)
                }
            })?;

        // Send the config update command to the actor and attach a oneshot
        // reply channel so this specific request gets a single result back.
        let (tx, rx) = tokio::sync::oneshot::channel();
        if handle
            .command_tx
            .send(SessionCommand::SetConfigOption {
                config_id: config_id.to_string(),
                value: value.to_string(),
                respond_to: tx,
            })
            .await
            .is_err()
        {
            return Err(SetSessionConfigOptionError::Internal(anyhow::anyhow!(
                "session actor channel closed"
            )));
        }

        let apply_state = rx
            .await
            .map_err(|_| {
                SetSessionConfigOptionError::Internal(anyhow::anyhow!(
                    "session actor dropped config update response"
                ))
            })?
            .map_err(|error| match error {
                SetConfigOptionCommandError::Rejected(detail) => {
                    SetSessionConfigOptionError::Rejected(detail)
                }
            })?;

        // The actor persists any applied/queued changes. Reload the durable
        // session summary and latest live-config snapshot before returning.
        let updated = self
            .session_service
            .get_session(session_id)
            .map_err(SetSessionConfigOptionError::Internal)?
            .ok_or_else(|| SetSessionConfigOptionError::SessionNotFound(session_id.to_string()))?;
        let live_config = self
            .session_service
            .get_live_config_snapshot(session_id)
            .map_err(SetSessionConfigOptionError::Internal)?;

        Ok((updated, live_config, apply_state))
    }

    pub async fn send_prompt(
        &self,
        session_id: &str,
        text: String,
        latency: Option<&LatencyRequestContext>,
    ) -> Result<SessionRecord, SendPromptError> {
        if text.is_empty() {
            return Err(SendPromptError::EmptyPrompt);
        }
        let started = Instant::now();
        let latency_fields = latency_trace_fields(latency);
        tracing::info!(
            session_id = %session_id,
            flow_id = latency_fields.flow_id,
            flow_kind = latency_fields.flow_kind,
            flow_source = latency_fields.flow_source,
            prompt_id = latency_fields.prompt_id,
            "[workspace-latency] session.runtime.prompt.request_received"
        );

        let record = self
            .get_session_or_not_found(session_id)
            .map_err(map_lifecycle_error_to_prompt)?;

        let ensure_started = Instant::now();
        let handle = self
            .ensure_live_session_handle(&record, latency)
            .await
            .map_err(map_start_error_to_prompt)?;
        tracing::info!(
            session_id = %session_id,
            elapsed_ms = ensure_started.elapsed().as_millis(),
            total_elapsed_ms = started.elapsed().as_millis(),
            flow_id = latency_fields.flow_id,
            flow_kind = latency_fields.flow_kind,
            flow_source = latency_fields.flow_source,
            prompt_id = latency_fields.prompt_id,
            "[workspace-latency] session.runtime.prompt.live_handle_ready"
        );

        if !handle.try_begin_prompt() {
            return Err(SendPromptError::Busy);
        }

        let (tx, rx) = tokio::sync::oneshot::channel();
        if handle
            .command_tx
            .send(SessionCommand::Prompt {
                text,
                latency: latency.cloned(),
                respond_to: tx,
            })
            .await
            .is_err()
        {
            handle.finish_prompt();
            return Err(SendPromptError::Internal(anyhow::anyhow!(
                "session actor channel closed"
            )));
        }
        tracing::info!(
            session_id = %session_id,
            total_elapsed_ms = started.elapsed().as_millis(),
            flow_id = latency_fields.flow_id,
            flow_kind = latency_fields.flow_kind,
            flow_source = latency_fields.flow_source,
            prompt_id = latency_fields.prompt_id,
            "[workspace-latency] session.runtime.prompt.command_sent"
        );

        rx.await
            .map_err(|_| {
                handle.finish_prompt();
                SendPromptError::Internal(anyhow::anyhow!("session actor dropped response"))
            })?
            .map_err(|error| match error {
                PromptAcceptError::Busy => SendPromptError::Busy,
                PromptAcceptError::ActorDead => {
                    handle.finish_prompt();
                    SendPromptError::Internal(anyhow::anyhow!("session actor is not responding"))
                }
            })?;
        tracing::info!(
            session_id = %session_id,
            total_elapsed_ms = started.elapsed().as_millis(),
            flow_id = latency_fields.flow_id,
            flow_kind = latency_fields.flow_kind,
            flow_source = latency_fields.flow_source,
            prompt_id = latency_fields.prompt_id,
            "[workspace-latency] session.runtime.prompt.actor_accepted"
        );

        Ok(self
            .session_service
            .get_session(session_id)
            .map_err(SendPromptError::Internal)?
            .unwrap_or(record))
    }

    pub async fn cancel_live_session(
        &self,
        session_id: &str,
    ) -> Result<SessionRecord, SessionLifecycleError> {
        let record = self.get_session_or_not_found(session_id)?;

        if let Some(handle) = self.acp_manager.get_handle(session_id).await {
            let _ = handle.command_tx.send(SessionCommand::Cancel).await;
        }

        Ok(self
            .session_service
            .get_session(session_id)
            .map_err(SessionLifecycleError::Internal)?
            .unwrap_or(record))
    }

    pub async fn close_live_session(
        &self,
        session_id: &str,
    ) -> Result<SessionRecord, SessionLifecycleError> {
        let _record = self.get_session_or_not_found(session_id)?;

        if let Some(handle) = self.acp_manager.get_handle(session_id).await {
            let (tx, rx) = tokio::sync::oneshot::channel();
            let _ = handle
                .command_tx
                .send(SessionCommand::Close { respond_to: tx })
                .await;
            let _ = rx.await;
        }
        self.acp_manager.remove_session(session_id).await;

        let now = chrono::Utc::now().to_rfc3339();
        self.session_service
            .store()
            .mark_closed(session_id, &now)
            .map_err(SessionLifecycleError::Internal)?;

        self.session_service
            .get_session(session_id)
            .map_err(SessionLifecycleError::Internal)?
            .ok_or_else(|| SessionLifecycleError::SessionNotFound(session_id.to_string()))
    }

    pub async fn dismiss_live_session(
        &self,
        session_id: &str,
    ) -> Result<SessionRecord, SessionLifecycleError> {
        let record = self.get_session_or_not_found(session_id)?;

        if let Some(handle) = self.acp_manager.get_handle(session_id).await {
            let (tx, rx) = tokio::sync::oneshot::channel();
            let _ = handle
                .command_tx
                .send(SessionCommand::Dismiss { respond_to: tx })
                .await;
            let _ = rx.await;
        }
        self.acp_manager.remove_session(session_id).await;

        if record.dismissed_at.is_none() {
            let now = chrono::Utc::now().to_rfc3339();
            self.session_service
                .store()
                .mark_dismissed(session_id, &now)
                .map_err(SessionLifecycleError::Internal)?;
        }

        self.session_service
            .get_session(session_id)
            .map_err(SessionLifecycleError::Internal)?
            .ok_or_else(|| SessionLifecycleError::SessionNotFound(session_id.to_string()))
    }

    pub async fn restore_dismissed_session(
        &self,
        workspace_id: &str,
        latency: Option<&LatencyRequestContext>,
    ) -> Result<Option<SessionRecord>, SessionLifecycleError> {
        let started = Instant::now();
        let latency_fields = latency_trace_fields(latency);
        tracing::info!(
            workspace_id = %workspace_id,
            flow_id = latency_fields.flow_id,
            flow_kind = latency_fields.flow_kind,
            flow_source = latency_fields.flow_source,
            prompt_id = latency_fields.prompt_id,
            "[workspace-latency] session.runtime.restore.start"
        );
        let now = chrono::Utc::now().to_rfc3339();
        let Some(restored) = self
            .session_service
            .store()
            .pop_last_dismissed_in_workspace(workspace_id, &now)
            .map_err(SessionLifecycleError::Internal)?
        else {
            tracing::info!(
                workspace_id = %workspace_id,
                elapsed_ms = started.elapsed().as_millis(),
                flow_id = latency_fields.flow_id,
                flow_kind = latency_fields.flow_kind,
                flow_source = latency_fields.flow_source,
                prompt_id = latency_fields.prompt_id,
                "[workspace-latency] session.runtime.restore.empty"
            );
            return Ok(None);
        };

        tracing::info!(
            session_id = %restored.id,
            workspace_id = %workspace_id,
            total_elapsed_ms = started.elapsed().as_millis(),
            flow_id = latency_fields.flow_id,
            flow_kind = latency_fields.flow_kind,
            flow_source = latency_fields.flow_source,
            prompt_id = latency_fields.prompt_id,
            "[workspace-latency] session.runtime.restore.dismissed_cleared"
        );
        tracing::info!(
            session_id = %restored.id,
            workspace_id = %workspace_id,
            total_elapsed_ms = started.elapsed().as_millis(),
            flow_id = latency_fields.flow_id,
            flow_kind = latency_fields.flow_kind,
            flow_source = latency_fields.flow_source,
            prompt_id = latency_fields.prompt_id,
            "[workspace-latency] session.runtime.restore.completed"
        );

        Ok(Some(restored))
    }

    pub async fn resolve_permission_request(
        &self,
        session_id: &str,
        request_id: &str,
        resolution: PermissionResolution,
    ) -> Result<(), ResolvePermissionError> {
        use crate::acp::permission_broker::PermissionDecision;

        let _handle = self
            .acp_manager
            .get_handle(session_id)
            .await
            .ok_or_else(|| ResolvePermissionError::SessionNotLive(session_id.to_string()))?;

        let resolved = match resolution {
            PermissionResolution::Allow => {
                self.acp_manager
                    .permission_broker()
                    .resolve_with_decision(request_id, PermissionDecision::Allow)
                    .await
            }
            PermissionResolution::Deny => {
                self.acp_manager
                    .permission_broker()
                    .resolve_with_decision(request_id, PermissionDecision::Deny)
                    .await
            }
            PermissionResolution::OptionId(option_id) => {
                self.acp_manager
                    .permission_broker()
                    .resolve_with_option_id(request_id, &option_id)
                    .await
            }
        };

        if !resolved {
            return Err(ResolvePermissionError::PermissionNotFound(
                request_id.to_string(),
            ));
        }

        Ok(())
    }

    async fn ensure_live_session_handle(
        &self,
        record: &SessionRecord,
        latency: Option<&LatencyRequestContext>,
    ) -> Result<Arc<LiveSessionHandle>, StartSessionError> {
        let started = Instant::now();
        let latency_fields = latency_trace_fields(latency);
        if let Some(handle) = self.acp_manager.get_handle(&record.id).await {
            tracing::info!(
                session_id = %record.id,
                workspace_id = %record.workspace_id,
                elapsed_ms = started.elapsed().as_millis(),
                flow_id = latency_fields.flow_id,
            flow_kind = latency_fields.flow_kind,
            flow_source = latency_fields.flow_source,
            prompt_id = latency_fields.prompt_id,
                "[workspace-latency] session.runtime.ensure_live_handle.reused"
            );
            return Ok(handle);
        }

        let session_store = self.session_service.store().clone();

        // Repair any turns that were left open (turn_started without
        // turn_ended) before reading last_seq, so the resumed event sink
        // starts after the synthetic turn_ended events.
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

        let last_seq = session_store
            .last_event_seq(&record.id)
            .map_err(StartSessionError::Internal)?;

        let (handle, native_session_id) = self
            .start_live_session(
                record,
                record.native_session_id.is_some(),
                last_seq,
                None,
                latency,
            )
            .await?;

        self.persist_live_session_state(&record.id, &native_session_id);
        tracing::info!(
            session_id = %record.id,
            workspace_id = %record.workspace_id,
            native_session_id = %native_session_id,
            elapsed_ms = started.elapsed().as_millis(),
            flow_id = latency_fields.flow_id,
            flow_kind = latency_fields.flow_kind,
            flow_source = latency_fields.flow_source,
            prompt_id = latency_fields.prompt_id,
            "[workspace-latency] session.runtime.ensure_live_handle.live_started"
        );
        Ok(handle)
    }

    async fn start_live_session(
        &self,
        record: &SessionRecord,
        is_resume: bool,
        last_seq: i64,
        system_prompt_append: Option<String>,
        latency: Option<&LatencyRequestContext>,
    ) -> Result<(Arc<LiveSessionHandle>, String), StartSessionError> {
        let started = Instant::now();
        let latency_fields = latency_trace_fields(latency);
        tracing::info!(
            session_id = %record.id,
            workspace_id = %record.workspace_id,
            agent_kind = %record.agent_kind,
            is_resume,
            last_seq,
            has_system_prompt_append = system_prompt_append.is_some(),
            flow_id = latency_fields.flow_id,
            flow_kind = latency_fields.flow_kind,
            flow_source = latency_fields.flow_source,
            prompt_id = latency_fields.prompt_id,
            "[workspace-latency] session.runtime.start_live_session.start"
        );

        let workspace_lookup_started = Instant::now();
        let workspace = self
            .workspace_service
            .get_workspace(&record.workspace_id)
            .map_err(StartSessionError::Internal)?
            .ok_or(StartSessionError::WorkspaceNotFound)?;
        tracing::info!(
            session_id = %record.id,
            workspace_id = %record.workspace_id,
            elapsed_ms = workspace_lookup_started.elapsed().as_millis(),
            flow_id = latency_fields.flow_id,
            flow_kind = latency_fields.flow_kind,
            flow_source = latency_fields.flow_source,
            prompt_id = latency_fields.prompt_id,
            "[workspace-latency] session.runtime.start_live_session.workspace_loaded"
        );

        let descriptor_lookup_started = Instant::now();
        let registry = built_in_registry();
        let descriptor = registry
            .iter()
            .find(|descriptor| descriptor.kind.as_str() == record.agent_kind)
            .ok_or_else(|| StartSessionError::AgentDescriptorNotFound(record.agent_kind.clone()))?;
        tracing::info!(
            session_id = %record.id,
            agent_kind = %record.agent_kind,
            elapsed_ms = descriptor_lookup_started.elapsed().as_millis(),
            flow_id = latency_fields.flow_id,
            flow_kind = latency_fields.flow_kind,
            flow_source = latency_fields.flow_source,
            prompt_id = latency_fields.prompt_id,
            "[workspace-latency] session.runtime.start_live_session.agent_descriptor_found"
        );

        let agent_resolution_started = Instant::now();
        let resolved_agent = resolve_agent(descriptor, &self.runtime_home);
        tracing::info!(
            session_id = %record.id,
            agent_kind = %record.agent_kind,
            elapsed_ms = agent_resolution_started.elapsed().as_millis(),
            flow_id = latency_fields.flow_id,
            flow_kind = latency_fields.flow_kind,
            flow_source = latency_fields.flow_source,
            prompt_id = latency_fields.prompt_id,
            "[workspace-latency] session.runtime.start_live_session.agent_resolved"
        );
        let session_launch_env = build_session_launch_env(&resolved_agent);
        let session_store = self.session_service.store().clone();
        let workspace_path = PathBuf::from(&workspace.path);
        let workspace_env = self.workspace_service.workspace_env(&workspace);
        let acp_start_started = Instant::now();
        let (handle, ready) = self
            .acp_manager
            .start_session(
                record.clone(),
                resolved_agent,
                workspace_path,
                workspace_env,
                session_launch_env,
                session_store,
                is_resume,
                last_seq,
                system_prompt_append,
                latency.cloned(),
            )
            .await
            .map_err(StartSessionError::AcpStart)?;
        tracing::info!(
            session_id = %record.id,
            workspace_id = %record.workspace_id,
            native_session_id = %ready.native_session_id,
            elapsed_ms = acp_start_started.elapsed().as_millis(),
            total_elapsed_ms = started.elapsed().as_millis(),
            flow_id = latency_fields.flow_id,
            flow_kind = latency_fields.flow_kind,
            flow_source = latency_fields.flow_source,
            prompt_id = latency_fields.prompt_id,
            "[workspace-latency] session.runtime.start_live_session.acp_started"
        );

        Ok((handle, ready.native_session_id))
    }

    fn get_session_or_not_found(
        &self,
        session_id: &str,
    ) -> Result<SessionRecord, SessionLifecycleError> {
        self.session_service
            .get_session(session_id)
            .map_err(SessionLifecycleError::Internal)?
            .ok_or_else(|| SessionLifecycleError::SessionNotFound(session_id.to_string()))
    }

    fn persist_live_session_state(&self, session_id: &str, native_session_id: &str) {
        let now = chrono::Utc::now().to_rfc3339();
        let session_store = self.session_service.store();
        let _ = session_store.update_native_session_id(session_id, native_session_id, &now);
        let _ = session_store.update_status(session_id, "idle", &now);
    }

    fn mark_session_errored(&self, session_id: &str) {
        let now = chrono::Utc::now().to_rfc3339();
        let _ = self
            .session_service
            .store()
            .update_status(session_id, "errored", &now);
    }

    async fn summarize_workspace_session_records(
        &self,
        records: Vec<SessionRecord>,
    ) -> Option<WorkspaceExecutionSummary> {
        if records.is_empty() {
            return None;
        }

        let mut summaries = Vec::with_capacity(records.len());
        for record in &records {
            summaries.push(self.session_execution_summary(record).await);
        }

        Some(summarize_workspace_sessions(summaries.iter()))
    }
}

fn build_session_launch_env(resolved_agent: &ResolvedAgent) -> BTreeMap<String, String> {
    if resolved_agent.descriptor.kind != AgentKind::Claude {
        return BTreeMap::new();
    }

    let Some(path) = resolved_agent
        .native
        .as_ref()
        .and_then(|artifact| artifact.path.as_ref())
    else {
        return BTreeMap::new();
    };

    BTreeMap::from([(
        "CLAUDE_CODE_EXECUTABLE".to_string(),
        path.to_string_lossy().into_owned(),
    )])
}

fn join_system_prompt_append(system_prompt_append: Option<Vec<String>>) -> Option<String> {
    let parts = system_prompt_append?
        .into_iter()
        .map(|entry| entry.trim().to_string())
        .filter(|entry| !entry.is_empty())
        .collect::<Vec<_>>();

    if parts.is_empty() {
        return None;
    }

    Some(parts.join("\n\n"))
}

fn map_lifecycle_error_to_prompt(error: SessionLifecycleError) -> SendPromptError {
    match error {
        SessionLifecycleError::SessionNotFound(session_id) => {
            SendPromptError::SessionNotFound(session_id)
        }
        SessionLifecycleError::Internal(error) => SendPromptError::Internal(error),
    }
}

fn map_start_error_to_prompt(error: StartSessionError) -> SendPromptError {
    match error {
        StartSessionError::WorkspaceNotFound => {
            SendPromptError::Internal(anyhow::anyhow!("workspace not found for session"))
        }
        StartSessionError::AgentDescriptorNotFound(agent_kind) => {
            SendPromptError::Internal(anyhow::anyhow!("agent descriptor not found: {agent_kind}"))
        }
        StartSessionError::Internal(error) | StartSessionError::AcpStart(error) => {
            SendPromptError::Internal(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::{build_session_launch_env, join_system_prompt_append};
    use crate::agents::model::{
        AgentKind, ArtifactRole, CredentialState, ResolvedAgent, ResolvedAgentStatus,
        ResolvedArtifact,
    };
    use crate::agents::registry::built_in_registry;

    fn resolved_agent(kind: AgentKind, native_path: Option<&str>) -> ResolvedAgent {
        let descriptor = built_in_registry()
            .into_iter()
            .find(|descriptor| descriptor.kind == kind)
            .expect("missing descriptor");

        ResolvedAgent {
            descriptor,
            status: ResolvedAgentStatus::Ready,
            credential_state: CredentialState::Ready,
            native: native_path.map(|path| ResolvedArtifact {
                role: ArtifactRole::NativeCli,
                installed: true,
                source: Some("managed".into()),
                version: None,
                path: Some(PathBuf::from(path)),
                message: None,
            }),
            agent_process: ResolvedArtifact {
                role: ArtifactRole::AgentProcess,
                installed: true,
                source: Some("managed".into()),
                version: None,
                path: Some(PathBuf::from("/tmp/claude-agent-acp")),
                message: None,
            },
            spawn: None,
        }
    }

    #[test]
    fn join_system_prompt_append_trims_and_joins_entries() {
        let joined = join_system_prompt_append(Some(vec![
            "  Rename the branch  ".to_string(),
            "".to_string(),
            "Use kebab-case.".to_string(),
        ]));

        assert_eq!(
            joined.as_deref(),
            Some("Rename the branch\n\nUse kebab-case.")
        );
    }

    #[test]
    fn join_system_prompt_append_ignores_blank_inputs() {
        assert!(join_system_prompt_append(None).is_none());
        assert!(join_system_prompt_append(Some(vec!["   ".to_string()])).is_none());
    }

    #[test]
    fn build_session_launch_env_sets_claude_code_executable_for_claude() {
        let env = build_session_launch_env(&resolved_agent(
            AgentKind::Claude,
            Some("/tmp/managed/claude"),
        ));

        assert_eq!(
            env.get("CLAUDE_CODE_EXECUTABLE").map(String::as_str),
            Some("/tmp/managed/claude")
        );
    }

    #[test]
    fn build_session_launch_env_ignores_claude_without_native_path() {
        let env = build_session_launch_env(&resolved_agent(AgentKind::Claude, None));

        assert!(env.is_empty());
    }

    #[test]
    fn build_session_launch_env_ignores_non_claude_agents() {
        let env = build_session_launch_env(&resolved_agent(
            AgentKind::Codex,
            Some("/tmp/managed/codex"),
        ));

        assert!(env.is_empty());
    }
}
