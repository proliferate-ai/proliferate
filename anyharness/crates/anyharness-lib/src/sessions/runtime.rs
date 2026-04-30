use std::collections::{BTreeMap, HashMap};
use std::fmt;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use anyharness_contract::v1::{
    ConfigApplyState, InteractionKind, McpElicitationSubmittedField,
    McpElicitationUrlRevealResponse, PromptInputBlock, ProposedPlanDecisionState,
    ReplayRecordingSummary, Session, SessionExecutionSummary, SessionLiveConfigSnapshot,
    SessionMcpBindingSummary, UserInputSubmittedAnswer, WorkspaceExecutionSummary,
};

use super::execution_summary::{
    idle_workspace_execution_summary, summarize_session_record, summarize_workspace_sessions,
};
use super::mcp::{
    decrypt_bindings, encrypt_bindings, serialize_binding_summaries, SessionDataCipher,
    SessionMcpBindingsError, SessionMcpServer, SessionMcpSummaryError,
    SESSION_RESTART_REQUIRED_DETAIL,
};
use super::model::{SessionMcpBindingPolicy, SessionRecord};
use super::replay::{
    derive_source_agent_kind, export_recording, list_recordings, load_recording, validate_speed,
    ReplayError,
};
use super::service::{SessionService, WorkspaceSessionLaunchCatalogData};
use crate::acp::manager::AcpManager;
use crate::acp::permission_broker::PermissionDecision;
use crate::acp::session_actor::{
    InteractionResolution, LiveSessionHandle, PromptAcceptError, PromptAcceptance,
    QueueMutationError, ResolveInteractionCommandError, SessionCommand, SessionStartupStrategy,
    SetConfigOptionCommandError,
};
use crate::agents::model::{AgentKind, ResolvedAgent};
use crate::agents::registry::built_in_registry;
use crate::agents::resolver::resolve_agent;
use crate::api::http::latency::{latency_trace_fields, LatencyRequestContext};
use crate::origin::OriginContext;
use crate::plans::model::PlanRecord;
use crate::plans::service::{PlanDecisionError, PlanService};
use crate::sessions::extensions::{
    SessionExtension, SessionLaunchContext, SessionLaunchExtras, SessionTurnFinishedContext,
};
use crate::sessions::model::PromptAttachmentState;
use crate::sessions::prompt::{
    capabilities_from_live_config, prepare_prompt, PlanReferenceResolver, PromptPrepareContext,
    PromptProvenance, PromptValidationError,
};
use crate::sessions::runtime_event::{RuntimeEventInjectionResult, RuntimeInjectedSessionEvent};
use crate::workspaces::access_gate::WorkspaceAccessGate;
use crate::workspaces::runtime::WorkspaceRuntime;

pub struct SessionRuntime {
    session_service: Arc<SessionService>,
    workspace_runtime: Arc<WorkspaceRuntime>,
    acp_manager: AcpManager,
    runtime_home: PathBuf,
    session_data_cipher: Option<SessionDataCipher>,
    session_extensions: Vec<Arc<dyn SessionExtension>>,
    access_gate: Arc<WorkspaceAccessGate>,
    plan_service: Arc<PlanService>,
}

impl PlanReferenceResolver for PlanService {
    fn resolve_plan_reference(&self, plan_id: &str) -> anyhow::Result<Option<PlanRecord>> {
        self.get(plan_id)
    }
}

#[derive(Debug)]
pub enum CreateAndStartSessionError {
    Invalid(String),
    WorkspaceNotFound,
    WorkspaceSingleSession { session_id: String },
    MissingDataKey,
    StartFailed(anyhow::Error),
    Internal(anyhow::Error),
}

#[derive(Debug)]
pub enum EnsureLiveSessionError {
    SessionNotFound(String),
    RestartRequired(String),
    Invalid(String),
    MissingDataKey,
    Internal(anyhow::Error),
}

#[derive(Debug)]
pub struct SessionMcpRefresh {
    pub mcp_servers: Vec<SessionMcpServer>,
    pub mcp_binding_summaries: Option<Vec<SessionMcpBindingSummary>>,
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
    InvalidPrompt(PromptValidationError),
    Internal(anyhow::Error),
}

#[derive(Debug)]
pub enum SendPromptOutcome {
    Running {
        session: SessionRecord,
        turn_id: String,
    },
    Queued {
        session: SessionRecord,
        seq: i64,
    },
}

#[derive(Debug)]
pub enum PendingPromptMutationError {
    SessionNotFound(String),
    NotFound,
    InvalidPrompt(PromptValidationError),
    Internal(anyhow::Error),
}

#[derive(Debug)]
pub enum SessionLifecycleError {
    SessionNotFound(String),
    Internal(anyhow::Error),
}

#[derive(Clone)]
pub enum InteractionResolutionRequest {
    Decision(PermissionDecision),
    OptionId(String),
    Submitted {
        answers: Vec<UserInputSubmittedAnswer>,
    },
    Accepted {
        fields: Vec<McpElicitationSubmittedField>,
    },
    Declined,
    Cancelled,
    Dismissed,
}

impl fmt::Debug for InteractionResolutionRequest {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Decision(decision) => f.debug_tuple("Decision").field(decision).finish(),
            Self::OptionId(option_id) => f.debug_tuple("OptionId").field(option_id).finish(),
            Self::Submitted { answers } => f
                .debug_struct("Submitted")
                .field("answer_count", &answers.len())
                .field(
                    "question_ids",
                    &answers
                        .iter()
                        .map(|answer| answer.question_id.as_str())
                        .collect::<Vec<_>>(),
                )
                .finish(),
            Self::Accepted { fields } => f
                .debug_struct("Accepted")
                .field("field_count", &fields.len())
                .field(
                    "field_ids",
                    &fields
                        .iter()
                        .map(|field| field.field_id.as_str())
                        .collect::<Vec<_>>(),
                )
                .finish(),
            Self::Declined => f.write_str("Declined"),
            Self::Cancelled => f.write_str("Cancelled"),
            Self::Dismissed => f.write_str("Dismissed"),
        }
    }
}

#[derive(Debug)]
pub enum ResolveInteractionError {
    SessionNotLive(String),
    InteractionNotFound(String),
    InteractionKindMismatch(String),
    PlanLinkedInteraction(String),
    InvalidOptionId(String),
    InvalidQuestionId(String),
    DuplicateQuestionAnswer(String),
    MissingQuestionAnswer(String),
    InvalidSelectedOptionLabel(String),
    InvalidMcpFieldId(String),
    DuplicateMcpField(String),
    MissingMcpField(String),
    InvalidMcpFieldValue(String),
    NotMcpUrlElicitation(String),
    Internal(anyhow::Error),
}

#[derive(Debug)]
enum StartSessionError {
    WorkspaceNotFound,
    AgentDescriptorNotFound(String),
    MissingDataKey,
    RestartRequired(String),
    Internal(anyhow::Error),
    AcpStart(anyhow::Error),
}

fn choose_session_startup_strategy(
    record: &SessionRecord,
    session_store: &crate::sessions::store::SessionStore,
) -> anyhow::Result<SessionStartupStrategy> {
    let Some(native_session_id) = record.native_session_id.clone() else {
        return Ok(SessionStartupStrategy::Fresh);
    };

    if record.agent_kind != AgentKind::Claude.as_str() {
        return Ok(SessionStartupStrategy::LoadNative(native_session_id));
    }

    // A durable `turn_started` protects the narrow crash window where the sink
    // has already persisted a real turn but `last_prompt_at` has not been
    // updated yet. Outside that window, `last_prompt_at` is the fast path.
    if record.last_prompt_at.is_some() || session_store.has_turn_started_event(&record.id)? {
        return Ok(SessionStartupStrategy::LoadNative(native_session_id));
    }

    Ok(SessionStartupStrategy::ResumeSeqFreshNative)
}

impl SessionRuntime {
    pub fn new(
        session_service: Arc<SessionService>,
        workspace_runtime: Arc<WorkspaceRuntime>,
        acp_manager: AcpManager,
        runtime_home: PathBuf,
        session_data_cipher: Option<SessionDataCipher>,
        session_extensions: Vec<Arc<dyn SessionExtension>>,
        access_gate: Arc<WorkspaceAccessGate>,
        plan_service: Arc<PlanService>,
    ) -> Self {
        Self {
            session_service,
            workspace_runtime,
            acp_manager,
            runtime_home,
            session_data_cipher,
            session_extensions,
            access_gate,
            plan_service,
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
        let mut session = record.to_contract_with_details(live_config, Some(execution_summary));
        session.pending_prompts = self
            .session_service
            .store()
            .list_pending_prompts(&record.id)?
            .into_iter()
            .map(|record| record.to_contract())
            .collect();
        Ok(session)
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
        let records = self
            .session_service
            .list_sessions(Some(workspace_id), false)?;
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

    pub fn workspace_session_launch_catalog(
        &self,
        workspace_id: &str,
    ) -> anyhow::Result<WorkspaceSessionLaunchCatalogData> {
        self.session_service
            .get_workspace_session_launch_catalog(workspace_id)
    }

    pub fn live_config_snapshot(
        &self,
        session_id: &str,
    ) -> anyhow::Result<Option<SessionLiveConfigSnapshot>> {
        self.session_service.get_live_config_snapshot(session_id)
    }

    pub async fn create_and_start_session(
        &self,
        workspace_id: &str,
        agent_kind: &str,
        model_id: Option<&str>,
        mode_id: Option<&str>,
        system_prompt_append: Option<Vec<String>>,
        mcp_servers: Vec<SessionMcpServer>,
        mcp_binding_summaries: Option<Vec<SessionMcpBindingSummary>>,
        subagents_enabled: bool,
        origin: OriginContext,
        latency: Option<&LatencyRequestContext>,
    ) -> Result<SessionRecord, CreateAndStartSessionError> {
        self.access_gate
            .assert_can_mutate_for_workspace(workspace_id)
            .map_err(|error| CreateAndStartSessionError::Invalid(error.to_string()))?;
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
        let mut record = self.create_durable_session(
            workspace_id,
            agent_kind,
            model_id,
            mode_id,
            system_prompt_append,
            mcp_servers,
            mcp_binding_summaries,
            SessionMcpBindingPolicy::InheritWorkspace,
            subagents_enabled,
            origin,
        )?;
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
        record = self.start_persisted_session(&record, latency).await?;
        tracing::info!(
            workspace_id = %workspace_id,
            session_id = %record.id,
            native_session_id = %record.native_session_id.as_deref().unwrap_or_default(),
            total_elapsed_ms = started.elapsed().as_millis(),
            flow_id = latency_fields.flow_id,
            flow_kind = latency_fields.flow_kind,
            flow_source = latency_fields.flow_source,
            prompt_id = latency_fields.prompt_id,
            "[workspace-latency] session.runtime.create_and_start.completed"
        );

        Ok(record)
    }

    pub fn list_replay_recordings(&self) -> Result<Vec<ReplayRecordingSummary>, ReplayError> {
        list_recordings(&self.runtime_home)
    }

    pub fn export_replay_recording(
        &self,
        session_id: &str,
        name: Option<String>,
    ) -> Result<ReplayRecordingSummary, ReplayError> {
        self.access_gate
            .assert_can_mutate_for_session(session_id)
            .map_err(|error| ReplayError::Internal(anyhow::anyhow!(error.to_string())))?;
        let session = self
            .session_service
            .get_session(session_id)
            .map_err(ReplayError::Internal)?
            .ok_or_else(|| ReplayError::SessionNotFound(session_id.to_string()))?;
        let records = self
            .session_service
            .list_session_event_records(session_id, None)
            .map_err(ReplayError::Internal)?
            .ok_or_else(|| ReplayError::SessionNotFound(session_id.to_string()))?;

        export_recording(&self.runtime_home, &session, records, name)
    }

    pub async fn create_and_start_replay_session(
        &self,
        workspace_id: &str,
        recording_id: &str,
        speed: Option<f32>,
    ) -> Result<SessionRecord, ReplayError> {
        self.access_gate
            .assert_can_mutate_for_workspace(workspace_id)
            .map_err(|error| ReplayError::Internal(anyhow::anyhow!(error.to_string())))?;
        let speed = validate_speed(speed)?;
        let events = load_recording(&self.runtime_home, recording_id)?;
        let source_agent_kind = derive_source_agent_kind(&events).ok_or_else(|| {
            ReplayError::InvalidJson("recording has no source agent kind".to_string())
        })?;
        let workspace = self
            .workspace_runtime
            .get_workspace(workspace_id)
            .map_err(ReplayError::Internal)?
            .ok_or_else(|| ReplayError::WorkspaceNotFound(workspace_id.to_string()))?;
        if workspace.surface == "cowork"
            && self
                .session_service
                .list_sessions(Some(workspace_id), true)
                .map_err(ReplayError::Internal)?
                .into_iter()
                .next()
                .is_some()
        {
            return Err(ReplayError::Internal(anyhow::anyhow!(
                "cowork workspaces support only one session"
            )));
        }

        let now = chrono::Utc::now().to_rfc3339();
        let mut record = SessionRecord {
            id: uuid::Uuid::new_v4().to_string(),
            workspace_id: workspace_id.to_string(),
            agent_kind: source_agent_kind,
            native_session_id: None,
            requested_model_id: None,
            current_model_id: None,
            requested_mode_id: None,
            current_mode_id: None,
            title: Some(format!("Replay: {recording_id}")),
            thinking_level_id: None,
            thinking_budget_tokens: None,
            status: "starting".into(),
            created_at: now.clone(),
            updated_at: now,
            last_prompt_at: None,
            closed_at: None,
            dismissed_at: None,
            mcp_bindings_ciphertext: None,
            mcp_binding_summaries_json: None,
            mcp_binding_policy: crate::sessions::model::SessionMcpBindingPolicy::InheritWorkspace,
            system_prompt_append: None,
            subagents_enabled: true,
            origin: Some(OriginContext::system_local_runtime()),
        };
        self.session_service
            .store()
            .insert(&record)
            .map_err(ReplayError::Internal)?;

        let session_store = self.session_service.store().clone();
        let (_handle, ready) = self
            .acp_manager
            .start_replay_session(record.clone(), events, speed, session_store, 0)
            .await
            .map_err(ReplayError::Internal)?;
        self.persist_live_session_state(&record.id, &ready.native_session_id);
        record.native_session_id = Some(ready.native_session_id);
        record.status = "idle".to_string();
        Ok(record)
    }

    pub async fn advance_replay_session(&self, session_id: &str) -> Result<(), ReplayError> {
        self.access_gate
            .assert_can_mutate_for_session(session_id)
            .map_err(|error| ReplayError::Internal(anyhow::anyhow!(error.to_string())))?;
        let handle = self
            .acp_manager
            .get_handle(session_id)
            .await
            .ok_or_else(|| ReplayError::SessionNotLive(session_id.to_string()))?;
        let (tx, rx) = tokio::sync::oneshot::channel();
        handle
            .command_tx
            .send(SessionCommand::ReplayAdvance { respond_to: tx })
            .await
            .map_err(|_| ReplayError::SessionNotLive(session_id.to_string()))?;
        rx.await
            .map_err(|_| ReplayError::SessionNotLive(session_id.to_string()))?
            .map_err(ReplayError::Internal)
    }

    pub fn create_durable_session(
        &self,
        workspace_id: &str,
        agent_kind: &str,
        model_id: Option<&str>,
        mode_id: Option<&str>,
        system_prompt_append: Option<Vec<String>>,
        mcp_servers: Vec<SessionMcpServer>,
        mcp_binding_summaries: Option<Vec<SessionMcpBindingSummary>>,
        mcp_binding_policy: SessionMcpBindingPolicy,
        subagents_enabled: bool,
        origin: OriginContext,
    ) -> Result<SessionRecord, CreateAndStartSessionError> {
        let system_prompt_append = join_system_prompt_append(system_prompt_append);
        let mcp_bindings_ciphertext =
            encrypt_bindings(self.session_data_cipher.as_ref(), &mcp_servers)
                .map_err(map_encrypt_bindings_error_to_create)?;
        let mcp_binding_summaries_json = serialize_binding_summaries(mcp_binding_summaries)
            .map_err(map_mcp_summary_error_to_create)?;
        self.session_service
            .create_session(
                workspace_id,
                agent_kind,
                model_id,
                mode_id,
                mcp_bindings_ciphertext,
                mcp_binding_summaries_json,
                mcp_binding_policy,
                system_prompt_append,
                subagents_enabled,
                origin,
            )
            .map_err(map_create_session_service_error)
    }

    pub async fn start_persisted_session(
        &self,
        record: &SessionRecord,
        latency: Option<&LatencyRequestContext>,
    ) -> Result<SessionRecord, CreateAndStartSessionError> {
        let live_start_started = Instant::now();
        let latency_fields = latency_trace_fields(latency);
        let (_handle, native_session_id) = match self
            .start_live_session(
                record,
                SessionStartupStrategy::Fresh,
                record.system_prompt_append.clone(),
                latency,
            )
            .await
        {
            Ok(result) => {
                tracing::info!(
                    workspace_id = %record.workspace_id,
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
                self.mark_session_errored(&record.id);
                tracing::warn!(
                    workspace_id = %record.workspace_id,
                    session_id = %record.id,
                    elapsed_ms = live_start_started.elapsed().as_millis(),
                    error = ?error,
                    flow_id = latency_fields.flow_id,
                    flow_kind = latency_fields.flow_kind,
                    flow_source = latency_fields.flow_source,
                    prompt_id = latency_fields.prompt_id,
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
            flow_id = latency_fields.flow_id,
            flow_kind = latency_fields.flow_kind,
            flow_source = latency_fields.flow_source,
            prompt_id = latency_fields.prompt_id,
            "[workspace-latency] session.runtime.live_session_persisted"
        );
        Ok(updated)
    }

    pub async fn ensure_live_session(
        &self,
        session_id: &str,
        mcp_refresh: Option<SessionMcpRefresh>,
        latency: Option<&LatencyRequestContext>,
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

        self.ensure_live_session_handle(&record, mcp_refresh, latency)
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
                StartSessionError::MissingDataKey => EnsureLiveSessionError::MissingDataKey,
                StartSessionError::RestartRequired(detail) => {
                    EnsureLiveSessionError::RestartRequired(detail)
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
        self.access_gate
            .assert_can_mutate_for_session(session_id)
            .map_err(|error| {
                SetSessionConfigOptionError::Internal(anyhow::anyhow!(error.to_string()))
            })?;
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
            .ensure_live_session_handle(&record, None, None)
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
                StartSessionError::MissingDataKey | StartSessionError::RestartRequired(_) => {
                    SetSessionConfigOptionError::Internal(anyhow::anyhow!(
                        "{SESSION_RESTART_REQUIRED_DETAIL}"
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
        blocks: Vec<PromptInputBlock>,
        latency: Option<&LatencyRequestContext>,
    ) -> Result<SendPromptOutcome, SendPromptError> {
        self.access_gate
            .assert_can_mutate_for_session(session_id)
            .map_err(|error| SendPromptError::Internal(anyhow::anyhow!(error.to_string())))?;
        if blocks.is_empty() {
            return Err(SendPromptError::EmptyPrompt);
        }
        let started = Instant::now();
        let latency_fields = latency_trace_fields(latency);
        let prompt_id = latency_fields.prompt_id.map(|s| s.to_string());
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
            .ensure_live_session_handle(&record, None, latency)
            .await
            .map_err(map_start_error_to_prompt)?;
        let live_config = self
            .session_service
            .get_live_config_snapshot(session_id)
            .map_err(SendPromptError::Internal)?;
        let prepared = prepare_prompt(
            PromptPrepareContext {
                store: self.session_service.store(),
                session_id,
                workspace_id: &record.workspace_id,
                capabilities: capabilities_from_live_config(live_config.as_ref()),
                attachment_state: PromptAttachmentState::Pending,
                plan_resolver: self.plan_service.as_ref(),
            },
            blocks,
        )
        .map_err(SendPromptError::InvalidPrompt)?;
        prepared
            .persist_attachments(self.session_service.store())
            .map_err(SendPromptError::Internal)?;
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

        // Invariant 1/2: the actor is the sole writer of `busy` and the queue.
        // The runtime no longer precaptures `busy`; it just forwards the command
        // and awaits the actor's decision (Started vs Queued).
        let (tx, rx) = tokio::sync::oneshot::channel();
        if handle
            .command_tx
            .send(SessionCommand::Prompt {
                payload: prepared.payload.clone(),
                prompt_id,
                latency: latency.cloned(),
                from_queue_seq: None,
                respond_to: tx,
            })
            .await
            .is_err()
        {
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

        let acceptance = rx
            .await
            .map_err(|_| {
                SendPromptError::Internal(anyhow::anyhow!("session actor dropped response"))
            })?
            .map_err(|error| match error {
                PromptAcceptError::ActorDead => {
                    SendPromptError::Internal(anyhow::anyhow!("session actor is not responding"))
                }
                PromptAcceptError::EnqueueFailed(detail) => {
                    let _ = prepared.cleanup_attachments(self.session_service.store(), session_id);
                    SendPromptError::Internal(anyhow::anyhow!("failed to enqueue prompt: {detail}"))
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

        let session = self
            .session_service
            .get_session(session_id)
            .map_err(SendPromptError::Internal)?
            .unwrap_or(record);

        Ok(match acceptance {
            PromptAcceptance::Started { turn_id } => {
                SendPromptOutcome::Running { session, turn_id }
            }
            PromptAcceptance::Queued { seq } => SendPromptOutcome::Queued { session, seq },
        })
    }

    pub(crate) async fn send_text_prompt_with_provenance(
        &self,
        session_id: &str,
        text: String,
        provenance: PromptProvenance,
    ) -> Result<SendPromptOutcome, SendPromptError> {
        self.access_gate
            .assert_can_mutate_for_session(session_id)
            .map_err(|error| SendPromptError::Internal(anyhow::anyhow!(error.to_string())))?;
        if text.trim().is_empty() {
            return Err(SendPromptError::EmptyPrompt);
        }
        let record = self
            .get_session_or_not_found(session_id)
            .map_err(map_lifecycle_error_to_prompt)?;
        let handle = self
            .ensure_live_session_handle(&record, None, None)
            .await
            .map_err(map_start_error_to_prompt)?;
        let payload =
            crate::sessions::prompt::PromptPayload::text(text).with_provenance(provenance);
        let (tx, rx) = tokio::sync::oneshot::channel();
        handle
            .command_tx
            .send(SessionCommand::Prompt {
                payload,
                prompt_id: None,
                latency: None,
                from_queue_seq: None,
                respond_to: tx,
            })
            .await
            .map_err(|_| {
                SendPromptError::Internal(anyhow::anyhow!("session actor channel closed"))
            })?;
        let acceptance = rx
            .await
            .map_err(|_| {
                SendPromptError::Internal(anyhow::anyhow!("session actor dropped response"))
            })?
            .map_err(|error| match error {
                PromptAcceptError::ActorDead => {
                    SendPromptError::Internal(anyhow::anyhow!("session actor is not responding"))
                }
                PromptAcceptError::EnqueueFailed(detail) => {
                    SendPromptError::Internal(anyhow::anyhow!("failed to enqueue prompt: {detail}"))
                }
            })?;
        let session = self
            .session_service
            .get_session(session_id)
            .map_err(SendPromptError::Internal)?
            .unwrap_or(record);
        Ok(match acceptance {
            PromptAcceptance::Started { turn_id } => {
                SendPromptOutcome::Running { session, turn_id }
            }
            PromptAcceptance::Queued { seq } => SendPromptOutcome::Queued { session, seq },
        })
    }

    pub async fn apply_plan_decision(
        &self,
        plan_id: &str,
        expected_version: i64,
        decision: ProposedPlanDecisionState,
    ) -> Result<PlanRecord, PlanDecisionError> {
        let plan = self
            .plan_service
            .get(plan_id)
            .map_err(PlanDecisionError::Store)?
            .ok_or(PlanDecisionError::NotFound)?;
        self.access_gate
            .assert_can_mutate_for_session(&plan.session_id)
            .map_err(|error| PlanDecisionError::Store(anyhow::anyhow!(error.to_string())))?;

        if let Some(handle) = self.acp_manager.get_handle(&plan.session_id).await {
            let (tx, rx) = tokio::sync::oneshot::channel();
            handle
                .command_tx
                .send(SessionCommand::ApplyPlanDecision {
                    plan_id: plan_id.to_string(),
                    expected_version,
                    decision,
                    respond_to: tx,
                })
                .await
                .map_err(|_| {
                    PlanDecisionError::Store(anyhow::anyhow!(
                        "session actor is not available for plan decision"
                    ))
                })?;
            return rx.await.map_err(|_| {
                PlanDecisionError::Store(anyhow::anyhow!(
                    "session actor dropped plan decision response"
                ))
            })?;
        }

        let (plan, _) =
            self.plan_service
                .update_decision_offline(plan_id, expected_version, decision)?;
        Ok(plan)
    }

    pub async fn edit_pending_prompt(
        &self,
        session_id: &str,
        seq: i64,
        blocks: Vec<PromptInputBlock>,
    ) -> Result<SessionRecord, PendingPromptMutationError> {
        self.access_gate
            .assert_can_mutate_for_session(session_id)
            .map_err(|error| {
                PendingPromptMutationError::Internal(anyhow::anyhow!(error.to_string()))
            })?;
        let record = self
            .get_session_or_not_found(session_id)
            .map_err(|error| match error {
                SessionLifecycleError::SessionNotFound(id) => {
                    PendingPromptMutationError::SessionNotFound(id)
                }
                SessionLifecycleError::Internal(error) => {
                    PendingPromptMutationError::Internal(error)
                }
            })?;
        let handle = self
            .ensure_live_session_handle(&record, None, None)
            .await
            .map_err(|error| {
                PendingPromptMutationError::Internal(anyhow::anyhow!(
                    "failed to ensure live session handle: {error:?}"
                ))
            })?;
        let live_config = self
            .session_service
            .get_live_config_snapshot(session_id)
            .map_err(PendingPromptMutationError::Internal)?;
        let prepared = prepare_prompt(
            PromptPrepareContext {
                store: self.session_service.store(),
                session_id,
                workspace_id: &record.workspace_id,
                capabilities: capabilities_from_live_config(live_config.as_ref()),
                attachment_state: PromptAttachmentState::Pending,
                plan_resolver: self.plan_service.as_ref(),
            },
            blocks,
        )
        .map_err(PendingPromptMutationError::InvalidPrompt)?;
        prepared
            .persist_attachments(self.session_service.store())
            .map_err(PendingPromptMutationError::Internal)?;

        let (tx, rx) = tokio::sync::oneshot::channel();
        if handle
            .command_tx
            .send(SessionCommand::EditPendingPrompt {
                seq,
                payload: prepared.payload.clone(),
                respond_to: tx,
            })
            .await
            .is_err()
        {
            let _ = prepared.cleanup_attachments(self.session_service.store(), session_id);
            return Err(PendingPromptMutationError::Internal(anyhow::anyhow!(
                "session actor channel closed"
            )));
        }
        rx.await
            .map_err(|_| {
                PendingPromptMutationError::Internal(anyhow::anyhow!(
                    "session actor dropped edit-pending-prompt response"
                ))
            })?
            .map_err(|error| match error {
                QueueMutationError::NotFound => {
                    let _ = prepared.cleanup_attachments(self.session_service.store(), session_id);
                    PendingPromptMutationError::NotFound
                }
                QueueMutationError::ActorDead => PendingPromptMutationError::Internal(
                    anyhow::anyhow!("session actor is not responding"),
                ),
            })?;

        self.session_service
            .get_session(session_id)
            .map_err(PendingPromptMutationError::Internal)?
            .ok_or_else(|| PendingPromptMutationError::SessionNotFound(session_id.to_string()))
    }

    pub async fn delete_pending_prompt(
        &self,
        session_id: &str,
        seq: i64,
    ) -> Result<SessionRecord, PendingPromptMutationError> {
        self.access_gate
            .assert_can_mutate_for_session(session_id)
            .map_err(|error| {
                PendingPromptMutationError::Internal(anyhow::anyhow!(error.to_string()))
            })?;
        let record = self
            .get_session_or_not_found(session_id)
            .map_err(|error| match error {
                SessionLifecycleError::SessionNotFound(id) => {
                    PendingPromptMutationError::SessionNotFound(id)
                }
                SessionLifecycleError::Internal(error) => {
                    PendingPromptMutationError::Internal(error)
                }
            })?;
        let handle = self
            .ensure_live_session_handle(&record, None, None)
            .await
            .map_err(|error| {
                PendingPromptMutationError::Internal(anyhow::anyhow!(
                    "failed to ensure live session handle: {error:?}"
                ))
            })?;

        let (tx, rx) = tokio::sync::oneshot::channel();
        if handle
            .command_tx
            .send(SessionCommand::DeletePendingPrompt {
                seq,
                respond_to: tx,
            })
            .await
            .is_err()
        {
            return Err(PendingPromptMutationError::Internal(anyhow::anyhow!(
                "session actor channel closed"
            )));
        }
        rx.await
            .map_err(|_| {
                PendingPromptMutationError::Internal(anyhow::anyhow!(
                    "session actor dropped delete-pending-prompt response"
                ))
            })?
            .map_err(|error| match error {
                QueueMutationError::NotFound => PendingPromptMutationError::NotFound,
                QueueMutationError::ActorDead => PendingPromptMutationError::Internal(
                    anyhow::anyhow!("session actor is not responding"),
                ),
            })?;

        self.session_service
            .get_session(session_id)
            .map_err(PendingPromptMutationError::Internal)?
            .ok_or_else(|| PendingPromptMutationError::SessionNotFound(session_id.to_string()))
    }

    pub async fn cancel_live_session(
        &self,
        session_id: &str,
    ) -> Result<SessionRecord, SessionLifecycleError> {
        self.access_gate
            .assert_can_mutate_for_session(session_id)
            .map_err(|error| SessionLifecycleError::Internal(anyhow::anyhow!(error.to_string())))?;
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
        self.access_gate
            .assert_can_mutate_for_session(session_id)
            .map_err(|error| SessionLifecycleError::Internal(anyhow::anyhow!(error.to_string())))?;
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
        self.access_gate
            .assert_can_mutate_for_session(session_id)
            .map_err(|error| SessionLifecycleError::Internal(anyhow::anyhow!(error.to_string())))?;
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
        self.access_gate
            .assert_can_mutate_for_workspace(workspace_id)
            .map_err(|error| SessionLifecycleError::Internal(anyhow::anyhow!(error.to_string())))?;
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

    pub async fn resolve_interaction_request(
        &self,
        session_id: &str,
        request_id: &str,
        resolution: InteractionResolutionRequest,
    ) -> Result<(), ResolveInteractionError> {
        self.access_gate
            .assert_can_mutate_for_session(session_id)
            .map_err(|error| ResolveInteractionError::SessionNotLive(error.to_string()))?;

        let handle = self
            .acp_manager
            .get_handle(session_id)
            .await
            .ok_or_else(|| ResolveInteractionError::SessionNotLive(session_id.to_string()))?;

        let pending_kind = handle
            .execution_snapshot()
            .await
            .pending_interactions
            .iter()
            .find(|pending| pending.request_id == request_id)
            .map(|pending| pending.kind.clone())
            .ok_or_else(|| ResolveInteractionError::InteractionNotFound(request_id.to_string()))?;

        if self
            .plan_service
            .store()
            .find_link_by_request(session_id, request_id)
            .map_err(ResolveInteractionError::Internal)?
            .is_some()
        {
            return Err(ResolveInteractionError::PlanLinkedInteraction(
                request_id.to_string(),
            ));
        }

        let kind_matches = matches!(
            (&resolution, pending_kind),
            (
                InteractionResolutionRequest::Decision(_),
                InteractionKind::Permission
            ) | (
                InteractionResolutionRequest::OptionId(_),
                InteractionKind::Permission
            ) | (
                InteractionResolutionRequest::Submitted { .. },
                InteractionKind::UserInput
            ) | (
                InteractionResolutionRequest::Accepted { .. },
                InteractionKind::McpElicitation
            ) | (
                InteractionResolutionRequest::Declined,
                InteractionKind::McpElicitation
            ) | (InteractionResolutionRequest::Cancelled, _)
                | (InteractionResolutionRequest::Dismissed, _)
        );
        if !kind_matches {
            return Err(ResolveInteractionError::InteractionKindMismatch(
                request_id.to_string(),
            ));
        }

        let actor_resolution = match resolution {
            InteractionResolutionRequest::Decision(decision) => {
                InteractionResolution::Decision(decision)
            }
            InteractionResolutionRequest::OptionId(option_id) => {
                InteractionResolution::Selected { option_id }
            }
            InteractionResolutionRequest::Submitted { answers } => {
                InteractionResolution::Submitted { answers }
            }
            InteractionResolutionRequest::Accepted { fields } => {
                InteractionResolution::Accepted { fields }
            }
            InteractionResolutionRequest::Declined => InteractionResolution::Declined,
            InteractionResolutionRequest::Cancelled => InteractionResolution::Cancelled,
            InteractionResolutionRequest::Dismissed => InteractionResolution::Dismissed,
        };

        handle
            .resolve_interaction(request_id.to_string(), actor_resolution)
            .await
            .map_err(|error| match error {
                ResolveInteractionCommandError::NotFound => {
                    ResolveInteractionError::InteractionNotFound(request_id.to_string())
                }
                ResolveInteractionCommandError::KindMismatch => {
                    ResolveInteractionError::InteractionKindMismatch(request_id.to_string())
                }
                ResolveInteractionCommandError::InvalidOptionId => {
                    ResolveInteractionError::InvalidOptionId(request_id.to_string())
                }
                ResolveInteractionCommandError::InvalidQuestionId => {
                    ResolveInteractionError::InvalidQuestionId(request_id.to_string())
                }
                ResolveInteractionCommandError::DuplicateQuestionAnswer => {
                    ResolveInteractionError::DuplicateQuestionAnswer(request_id.to_string())
                }
                ResolveInteractionCommandError::MissingQuestionAnswer => {
                    ResolveInteractionError::MissingQuestionAnswer(request_id.to_string())
                }
                ResolveInteractionCommandError::InvalidSelectedOptionLabel => {
                    ResolveInteractionError::InvalidSelectedOptionLabel(request_id.to_string())
                }
                ResolveInteractionCommandError::InvalidMcpFieldId => {
                    ResolveInteractionError::InvalidMcpFieldId(request_id.to_string())
                }
                ResolveInteractionCommandError::DuplicateMcpField => {
                    ResolveInteractionError::DuplicateMcpField(request_id.to_string())
                }
                ResolveInteractionCommandError::MissingMcpField => {
                    ResolveInteractionError::MissingMcpField(request_id.to_string())
                }
                ResolveInteractionCommandError::InvalidMcpFieldValue => {
                    ResolveInteractionError::InvalidMcpFieldValue(request_id.to_string())
                }
                ResolveInteractionCommandError::NotMcpUrlElicitation => {
                    ResolveInteractionError::NotMcpUrlElicitation(request_id.to_string())
                }
                ResolveInteractionCommandError::ActorDead => {
                    ResolveInteractionError::SessionNotLive(session_id.to_string())
                }
            })?;

        Ok(())
    }

    pub async fn reveal_mcp_elicitation_url(
        &self,
        session_id: &str,
        request_id: &str,
    ) -> Result<McpElicitationUrlRevealResponse, ResolveInteractionError> {
        self.access_gate
            .assert_can_mutate_for_session(session_id)
            .map_err(|error| ResolveInteractionError::SessionNotLive(error.to_string()))?;

        let handle = self
            .acp_manager
            .get_handle(session_id)
            .await
            .ok_or_else(|| ResolveInteractionError::SessionNotLive(session_id.to_string()))?;

        let pending_kind = handle
            .execution_snapshot()
            .await
            .pending_interactions
            .iter()
            .find(|pending| pending.request_id == request_id)
            .map(|pending| pending.kind.clone())
            .ok_or_else(|| ResolveInteractionError::InteractionNotFound(request_id.to_string()))?;

        if pending_kind != InteractionKind::McpElicitation {
            return Err(ResolveInteractionError::InteractionKindMismatch(
                request_id.to_string(),
            ));
        }

        let url = self
            .acp_manager
            .interaction_broker()
            .reveal_mcp_elicitation_url(session_id, request_id)
            .await
            .map_err(|error| match error {
                crate::acp::permission_broker::ResolveInteractionError::NotFound => {
                    ResolveInteractionError::InteractionNotFound(request_id.to_string())
                }
                crate::acp::permission_broker::ResolveInteractionError::KindMismatch => {
                    ResolveInteractionError::InteractionKindMismatch(request_id.to_string())
                }
                crate::acp::permission_broker::ResolveInteractionError::NotMcpUrlElicitation => {
                    ResolveInteractionError::NotMcpUrlElicitation(request_id.to_string())
                }
                _ => ResolveInteractionError::InvalidMcpFieldValue(request_id.to_string()),
            })?;

        Ok(McpElicitationUrlRevealResponse { url })
    }

    async fn ensure_live_session_handle(
        &self,
        record: &SessionRecord,
        mcp_refresh: Option<SessionMcpRefresh>,
        latency: Option<&LatencyRequestContext>,
    ) -> Result<Arc<LiveSessionHandle>, StartSessionError> {
        self.access_gate
            .assert_can_start_live_session(&record.id)
            .map_err(|error| StartSessionError::Internal(anyhow::anyhow!(error.to_string())))?;
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
        // turn_ended) before starting the actor. AcpManager reads last_seq
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
        startup_strategy: SessionStartupStrategy,
        system_prompt_append: Option<String>,
        latency: Option<&LatencyRequestContext>,
    ) -> Result<(Arc<LiveSessionHandle>, String), StartSessionError> {
        let started = Instant::now();
        let latency_fields = latency_trace_fields(latency);
        let startup_strategy_label = startup_strategy.as_str();
        tracing::info!(
            session_id = %record.id,
            workspace_id = %record.workspace_id,
            agent_kind = %record.agent_kind,
            startup_strategy = startup_strategy_label,
            has_system_prompt_append = system_prompt_append.is_some(),
            flow_id = latency_fields.flow_id,
            flow_kind = latency_fields.flow_kind,
            flow_source = latency_fields.flow_source,
            prompt_id = latency_fields.prompt_id,
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
        let workspace_env = self
            .workspace_runtime
            .workspace_env(&workspace)
            .map_err(StartSessionError::Internal)?;
        let mut mcp_servers = if record.mcp_binding_policy == SessionMcpBindingPolicy::InternalOnly
        {
            Vec::new()
        } else {
            decrypt_bindings(
                self.session_data_cipher.as_ref(),
                record.mcp_bindings_ciphertext.as_deref(),
            )
            .map_err(map_decrypt_bindings_error_to_start)?
        };
        let launch_extras = self
            .resolve_extension_launch_extras(&workspace, record)
            .map_err(StartSessionError::Internal)?;
        let system_prompt_append =
            merge_system_prompt_append(system_prompt_append, launch_extras.system_prompt_append);
        self.persist_extension_binding_summaries(record, &launch_extras.mcp_binding_summaries)
            .map_err(StartSessionError::Internal)?;
        mcp_servers.extend(launch_extras.mcp_servers);
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
                mcp_servers,
                startup_strategy,
                system_prompt_append,
                Some(Arc::new({
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
                            });
                        }
                    }
                })),
                latency.cloned(),
            )
            .await
            .map_err(StartSessionError::AcpStart)?;
        tracing::info!(
            session_id = %record.id,
            workspace_id = %record.workspace_id,
            native_session_id = %ready.native_session_id,
            startup_strategy = startup_strategy_label,
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

    #[allow(dead_code)]
    pub(crate) async fn emit_runtime_event(
        &self,
        session_id: &str,
        event: RuntimeInjectedSessionEvent,
    ) -> RuntimeEventInjectionResult {
        self.acp_manager
            .emit_runtime_event(session_id, self.session_service.store().clone(), event)
            .await
    }

    fn resolve_extension_launch_extras(
        &self,
        workspace: &crate::workspaces::model::WorkspaceRecord,
        record: &SessionRecord,
    ) -> anyhow::Result<SessionLaunchExtras> {
        let ctx = SessionLaunchContext {
            workspace,
            session: record,
        };
        let mut combined = SessionLaunchExtras::default();
        for extension in &self.session_extensions {
            let mut extras = extension.resolve_launch_extras(&ctx)?;
            combined
                .system_prompt_append
                .append(&mut extras.system_prompt_append);
            combined.mcp_servers.append(&mut extras.mcp_servers);
            combined
                .mcp_binding_summaries
                .append(&mut extras.mcp_binding_summaries);
        }
        Ok(combined)
    }

    fn persist_extension_binding_summaries(
        &self,
        record: &SessionRecord,
        extension_summaries: &[SessionMcpBindingSummary],
    ) -> anyhow::Result<()> {
        if extension_summaries.is_empty() {
            return Ok(());
        }
        let mut summaries = record
            .to_contract()
            .mcp_binding_summaries
            .unwrap_or_default();
        for summary in extension_summaries {
            if summaries.iter().all(|existing| existing.id != summary.id) {
                summaries.push(summary.clone());
            }
        }
        let summaries_json = serialize_binding_summaries(Some(summaries))
            .map_err(|error| anyhow::anyhow!("serialize MCP binding summaries: {error}"))?;
        self.session_service
            .store()
            .update_mcp_binding_summaries(&record.id, summaries_json)?;
        Ok(())
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

fn merge_system_prompt_append(
    persisted: Option<String>,
    extra_lines: Vec<String>,
) -> Option<String> {
    let mut parts = Vec::new();
    if let Some(persisted) = persisted
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        parts.push(persisted);
    }
    if let Some(extra) = join_system_prompt_append(Some(extra_lines)) {
        parts.push(extra);
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("\n\n"))
    }
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
        StartSessionError::MissingDataKey | StartSessionError::RestartRequired(_) => {
            SendPromptError::Internal(anyhow::anyhow!(SESSION_RESTART_REQUIRED_DETAIL))
        }
        StartSessionError::Internal(error) | StartSessionError::AcpStart(error) => {
            SendPromptError::Internal(error)
        }
    }
}

fn map_encrypt_bindings_error_to_create(
    error: SessionMcpBindingsError,
) -> CreateAndStartSessionError {
    match error {
        SessionMcpBindingsError::MissingDataKey => CreateAndStartSessionError::MissingDataKey,
        SessionMcpBindingsError::Encrypt(error) | SessionMcpBindingsError::Decrypt(error) => {
            CreateAndStartSessionError::Internal(error)
        }
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

fn map_mcp_summary_error_to_create(error: SessionMcpSummaryError) -> CreateAndStartSessionError {
    match error {
        SessionMcpSummaryError::Invalid(detail) => CreateAndStartSessionError::Invalid(detail),
        SessionMcpSummaryError::Serialize(error) => CreateAndStartSessionError::Internal(error),
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

fn map_decrypt_bindings_error_to_start(error: SessionMcpBindingsError) -> StartSessionError {
    match error {
        SessionMcpBindingsError::MissingDataKey => StartSessionError::MissingDataKey,
        SessionMcpBindingsError::Encrypt(error) => StartSessionError::Internal(error),
        SessionMcpBindingsError::Decrypt(_) => {
            StartSessionError::RestartRequired(SESSION_RESTART_REQUIRED_DETAIL.to_string())
        }
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
        StartSessionError::MissingDataKey => CreateAndStartSessionError::MissingDataKey,
        StartSessionError::RestartRequired(detail) => {
            CreateAndStartSessionError::Internal(anyhow::anyhow!(detail))
        }
        StartSessionError::Internal(error) => CreateAndStartSessionError::Internal(error),
        StartSessionError::AcpStart(error) => CreateAndStartSessionError::StartFailed(error),
    }
}

fn map_create_session_service_error(
    error: crate::sessions::service::CreateSessionError,
) -> CreateAndStartSessionError {
    match error {
        crate::sessions::service::CreateSessionError::WorkspaceNotFound(_) => {
            CreateAndStartSessionError::WorkspaceNotFound
        }
        crate::sessions::service::CreateSessionError::WorkspaceSingleSession {
            session_id, ..
        } => CreateAndStartSessionError::WorkspaceSingleSession { session_id },
        crate::sessions::service::CreateSessionError::Invalid(detail) => {
            CreateAndStartSessionError::Invalid(detail)
        }
        crate::sessions::service::CreateSessionError::Internal(error) => {
            CreateAndStartSessionError::Internal(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::{
        build_session_launch_env, choose_session_startup_strategy, join_system_prompt_append,
    };
    use crate::acp::session_actor::SessionStartupStrategy;
    use crate::agents::model::{
        AgentKind, ArtifactRole, CredentialState, ResolvedAgent, ResolvedAgentStatus,
        ResolvedArtifact,
    };
    use crate::agents::registry::built_in_registry;
    use crate::persistence::Db;
    use crate::sessions::{model::SessionEventRecord, model::SessionRecord, store::SessionStore};

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

    fn seed_workspace(db: &Db) {
        db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO workspaces (id, kind, path, source_repo_root_path, created_at, updated_at)
                 VALUES (?1, 'repo', '/tmp/workspace', '/tmp/workspace', ?2, ?2)",
                rusqlite::params!["workspace-1", "2026-03-25T00:00:00Z"],
            )?;
            Ok(())
        })
        .expect("seed workspace");
    }

    fn session_record(agent_kind: &str) -> SessionRecord {
        SessionRecord {
            id: "session-1".to_string(),
            workspace_id: "workspace-1".to_string(),
            agent_kind: agent_kind.to_string(),
            native_session_id: Some("native-1".to_string()),
            requested_model_id: None,
            current_model_id: None,
            requested_mode_id: None,
            current_mode_id: None,
            title: None,
            thinking_level_id: None,
            thinking_budget_tokens: None,
            status: "idle".to_string(),
            created_at: "2026-03-25T00:00:00Z".to_string(),
            updated_at: "2026-03-25T00:00:00Z".to_string(),
            last_prompt_at: None,
            closed_at: None,
            dismissed_at: None,
            mcp_bindings_ciphertext: None,
            mcp_binding_summaries_json: None,
            mcp_binding_policy: crate::sessions::model::SessionMcpBindingPolicy::InheritWorkspace,
            system_prompt_append: None,
            subagents_enabled: true,
            origin: None,
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

    #[test]
    fn choose_startup_strategy_prefers_fresh_when_no_native_session_exists() {
        let db = Db::open_in_memory().expect("open db");
        seed_workspace(&db);

        let store = SessionStore::new(db);
        let mut record = session_record("claude");
        record.native_session_id = None;

        let strategy =
            choose_session_startup_strategy(&record, &store).expect("select startup strategy");

        assert_eq!(strategy, SessionStartupStrategy::Fresh);
    }

    #[test]
    fn choose_startup_strategy_uses_fresh_native_for_zero_turn_claude_sessions() {
        let db = Db::open_in_memory().expect("open db");
        seed_workspace(&db);

        let store = SessionStore::new(db);
        let record = session_record("claude");

        let strategy =
            choose_session_startup_strategy(&record, &store).expect("select startup strategy");

        assert_eq!(strategy, SessionStartupStrategy::ResumeSeqFreshNative);
    }

    #[test]
    fn choose_startup_strategy_loads_claude_when_last_prompt_was_recorded() {
        let db = Db::open_in_memory().expect("open db");
        seed_workspace(&db);

        let store = SessionStore::new(db);
        let mut record = session_record("claude");
        record.last_prompt_at = Some("2026-03-25T00:05:00Z".to_string());

        let strategy =
            choose_session_startup_strategy(&record, &store).expect("select startup strategy");

        assert_eq!(
            strategy,
            SessionStartupStrategy::LoadNative("native-1".to_string())
        );
    }

    #[test]
    fn choose_startup_strategy_loads_claude_when_turn_history_exists_without_last_prompt_at() {
        let db = Db::open_in_memory().expect("open db");
        seed_workspace(&db);

        let store = SessionStore::new(db);
        let record = session_record("claude");
        store.insert(&record).expect("insert session");
        store
            .append_event(&SessionEventRecord {
                id: 0,
                session_id: "session-1".to_string(),
                seq: 1,
                timestamp: "2026-03-25T00:01:00Z".to_string(),
                event_type: "turn_started".to_string(),
                turn_id: Some("turn-1".to_string()),
                item_id: None,
                payload_json: r#"{"type":"turn_started"}"#.to_string(),
            })
            .expect("append turn_started");

        let strategy =
            choose_session_startup_strategy(&record, &store).expect("select startup strategy");

        assert_eq!(
            strategy,
            SessionStartupStrategy::LoadNative("native-1".to_string())
        );
    }

    #[test]
    fn choose_startup_strategy_keeps_non_claude_agents_on_native_load_path() {
        let db = Db::open_in_memory().expect("open db");
        seed_workspace(&db);

        let store = SessionStore::new(db);
        let record = session_record("codex");

        let strategy =
            choose_session_startup_strategy(&record, &store).expect("select startup strategy");

        assert_eq!(
            strategy,
            SessionStartupStrategy::LoadNative("native-1".to_string())
        );
    }
}
