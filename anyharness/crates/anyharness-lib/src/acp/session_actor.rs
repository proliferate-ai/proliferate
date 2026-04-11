use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use acp::Agent as _;
use agent_client_protocol as acp;
use tokio::sync::{broadcast, mpsc, oneshot, Mutex, RwLock};
use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};

use super::background_work::{BackgroundWorkOptions, BackgroundWorkRegistry, BackgroundWorkUpdate};
use super::event_sink::{AcpChunkPayload, AcpToolPayload, SessionEventSink};
use super::permission_broker::PermissionBroker;
use super::runtime_client::RuntimeClient;
use crate::agents::model::ResolvedAgent;
use crate::api::http::latency::{latency_trace_fields, LatencyRequestContext};
use crate::sessions::live_config::{
    build_live_config_snapshot, normalized_key_rank, option_matches_key, snapshot_from_record,
    snapshot_to_record, LegacyModeOption, LegacyModeState, NormalizedControlKind,
    LEGACY_MODE_COMPAT_CONFIG_ID,
};
use crate::sessions::mcp::{to_acp_servers, SessionMcpServer};
use crate::sessions::model::PendingConfigChangeRecord;
use crate::sessions::model::SessionRecord;
use crate::sessions::store::SessionStore;
use anyharness_contract::v1::{
    AvailableCommandsUpdatePayload, ConfigApplyState, ConfigOptionUpdatePayload,
    CurrentModeUpdatePayload, NormalizedSessionControl, PendingApprovalSummary,
    PendingPromptAddedPayload, PendingPromptRemovalReason, PendingPromptRemovedPayload,
    PendingPromptUpdatedPayload, PermissionOutcome, SessionEndReason, SessionEventEnvelope,
    SessionExecutionPhase, SessionExecutionSummary, SessionInfoUpdatePayload,
    SessionStateUpdatePayload, StopReason, UsageUpdatePayload,
};

#[derive(Debug)]
pub enum PromptAcceptError {
    ActorDead,
    EnqueueFailed(String),
}

#[derive(Debug, Clone, Copy)]
pub enum PromptAcceptance {
    Started,
    Queued { seq: i64 },
}

#[derive(Debug)]
pub enum QueueMutationError {
    NotFound,
    ActorDead,
}

#[derive(Debug)]
pub enum SetConfigOptionCommandError {
    Rejected(String),
}

pub enum SessionCommand {
    Prompt {
        text: String,
        prompt_id: Option<String>,
        latency: Option<LatencyRequestContext>,
        /// Set by the actor's own startup-drain path when self-dispatching a
        /// queue head. External callers always pass `None`. When `Some`, the
        /// first iteration of the drain loop will delete this row and emit
        /// `PendingPromptRemoved { Executed }` right after `begin_turn`.
        from_queue_seq: Option<i64>,
        respond_to: oneshot::Sender<Result<PromptAcceptance, PromptAcceptError>>,
    },
    EditPendingPrompt {
        seq: i64,
        text: String,
        respond_to: oneshot::Sender<Result<(), QueueMutationError>>,
    },
    DeletePendingPrompt {
        seq: i64,
        respond_to: oneshot::Sender<Result<(), QueueMutationError>>,
    },
    SetConfigOption {
        config_id: String,
        value: String,
        respond_to: oneshot::Sender<Result<ConfigApplyState, SetConfigOptionCommandError>>,
    },
    Cancel,
    Dismiss {
        respond_to: oneshot::Sender<anyhow::Result<()>>,
    },
    Close {
        respond_to: oneshot::Sender<anyhow::Result<()>>,
    },
}

#[derive(Debug, Clone)]
enum ActorExitDisposition {
    Error {
        message: String,
        code: Option<String>,
    },
    Close,
    Dismiss,
}

const IDLE_RESUME_REPLAY_QUIET_WINDOW: Duration = Duration::from_millis(100);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ResumeReplayNotificationClass {
    UserEcho,
    Transcript,
    Other,
}

#[derive(Debug, Clone, Copy)]
enum ResumeReplayFilterState {
    Monitoring,
    Suppressing { last_transcript_at: Instant },
    Disabled,
}

#[derive(Debug, Clone, Copy)]
struct ResumeReplayFilter {
    state: ResumeReplayFilterState,
}

impl ResumeReplayFilter {
    fn new(source_agent_kind: &str, is_resume: bool, session_status: &str) -> Self {
        let state = if is_resume && source_agent_kind == "claude" && session_status == "idle" {
            ResumeReplayFilterState::Monitoring
        } else {
            ResumeReplayFilterState::Disabled
        };

        Self { state }
    }

    #[cfg(test)]
    fn disabled() -> Self {
        Self {
            state: ResumeReplayFilterState::Disabled,
        }
    }

    fn disable(&mut self) {
        self.state = ResumeReplayFilterState::Disabled;
    }

    fn should_suppress(&mut self, notification: &acp::SessionNotification, now: Instant) -> bool {
        if let ResumeReplayFilterState::Suppressing { last_transcript_at } = self.state {
            if now.duration_since(last_transcript_at) >= IDLE_RESUME_REPLAY_QUIET_WINDOW {
                self.state = ResumeReplayFilterState::Monitoring;
            }
        }

        let class = classify_resume_replay_notification(&notification.update);
        match (self.state, class) {
            (ResumeReplayFilterState::Monitoring, ResumeReplayNotificationClass::UserEcho) => {
                self.state = ResumeReplayFilterState::Suppressing {
                    last_transcript_at: now,
                };
                true
            }
            (
                ResumeReplayFilterState::Suppressing { .. },
                ResumeReplayNotificationClass::UserEcho | ResumeReplayNotificationClass::Transcript,
            ) => {
                self.state = ResumeReplayFilterState::Suppressing {
                    last_transcript_at: now,
                };
                true
            }
            _ => false,
        }
    }
}

fn classify_resume_replay_notification(
    update: &acp::SessionUpdate,
) -> ResumeReplayNotificationClass {
    use acp::SessionUpdate::*;
    match update {
        UserMessageChunk(_) => ResumeReplayNotificationClass::UserEcho,
        AgentMessageChunk(_) | AgentThoughtChunk(_) | ToolCall(_) | ToolCallUpdate(_) | Plan(_) => {
            ResumeReplayNotificationClass::Transcript
        }
        _ => ResumeReplayNotificationClass::Other,
    }
}

pub struct LiveSessionHandle {
    pub session_id: String,
    pub command_tx: mpsc::Sender<SessionCommand>,
    pub event_tx: broadcast::Sender<SessionEventEnvelope>,
    pub busy: Arc<AtomicBool>,
    execution: Arc<RwLock<LiveSessionExecutionSnapshot>>,
}

#[derive(Debug, Clone)]
pub struct LiveSessionExecutionSnapshot {
    pub phase: SessionExecutionPhase,
    pub pending_approval: Option<PendingApprovalSummary>,
    pub updated_at: String,
}

impl LiveSessionExecutionSnapshot {
    pub fn new(phase: SessionExecutionPhase) -> Self {
        Self {
            phase,
            pending_approval: None,
            updated_at: chrono::Utc::now().to_rfc3339(),
        }
    }

    pub fn to_contract_summary(&self, has_live_handle: bool) -> SessionExecutionSummary {
        SessionExecutionSummary {
            phase: self.phase.clone(),
            has_live_handle,
            pending_approval: self.pending_approval.clone(),
            updated_at: self.updated_at.clone(),
        }
    }
}

impl LiveSessionHandle {
    pub fn subscribe(&self) -> broadcast::Receiver<SessionEventEnvelope> {
        self.event_tx.subscribe()
    }

    pub fn try_begin_prompt(&self) -> bool {
        self.busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }

    pub fn finish_prompt(&self) {
        self.busy.store(false, Ordering::Release);
    }

    pub async fn set_execution_phase(&self, phase: SessionExecutionPhase) {
        let mut execution = self.execution.write().await;
        execution.phase = phase;
        execution.pending_approval = None;
        execution.updated_at = chrono::Utc::now().to_rfc3339();
    }

    pub async fn set_pending_approval(&self, pending_approval: PendingApprovalSummary) {
        let mut execution = self.execution.write().await;
        execution.phase = SessionExecutionPhase::AwaitingPermission;
        execution.pending_approval = Some(pending_approval);
        execution.updated_at = chrono::Utc::now().to_rfc3339();
    }

    pub async fn execution_snapshot(&self) -> LiveSessionExecutionSnapshot {
        self.execution.read().await.clone()
    }
}

pub struct SessionActorConfig {
    pub session: SessionRecord,
    pub agent: ResolvedAgent,
    pub workspace_path: std::path::PathBuf,
    pub workspace_env: std::collections::BTreeMap<String, String>,
    pub session_launch_env: std::collections::BTreeMap<String, String>,
    pub permission_broker: Arc<PermissionBroker>,
    pub event_tx: broadcast::Sender<SessionEventEnvelope>,
    pub session_store: SessionStore,
    pub mcp_servers: Vec<SessionMcpServer>,
    pub is_resume: bool,
    pub last_seq: i64,
    pub system_prompt_append: Option<String>,
    pub latency: Option<LatencyRequestContext>,
    /// Called after the actor loop exits (normal or error). The bool indicates
    /// whether the actor exited with an error (true = errored).
    pub on_exit: Option<Box<dyn FnOnce(bool) + Send + 'static>>,
}

pub struct ActorReadyResult {
    pub native_session_id: String,
}

#[derive(Debug, Clone)]
struct SessionStartupState {
    current_mode_id: Option<String>,
    legacy_mode_state: Option<LegacyModeState>,
    config_options: Vec<acp::SessionConfigOption>,
    current_model_id: Option<String>,
    available_model_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PersistedSessionConfigState {
    requested_model_id: Option<String>,
    current_model_id: Option<String>,
    requested_mode_id: Option<String>,
    current_mode_id: Option<String>,
}

impl PersistedSessionConfigState {
    fn from_session(session: &SessionRecord) -> Self {
        Self {
            requested_model_id: session.requested_model_id.clone(),
            current_model_id: session.current_model_id.clone(),
            requested_mode_id: session.requested_mode_id.clone(),
            current_mode_id: session.current_mode_id.clone(),
        }
    }

    fn to_event_payload(&self) -> SessionStateUpdatePayload {
        SessionStateUpdatePayload {
            model_id: self.current_model_id.clone(),
            requested_model_id: self.requested_model_id.clone(),
            mode_id: self.current_mode_id.clone(),
            requested_mode_id: self.requested_mode_id.clone(),
        }
    }
}

impl SessionStartupState {
    fn from_new_session(response: &acp::NewSessionResponse) -> Self {
        Self {
            current_mode_id: response
                .modes
                .as_ref()
                .map(|m| m.current_mode_id.to_string()),
            legacy_mode_state: response.modes.as_ref().map(into_legacy_mode_state),
            config_options: response.config_options.clone().unwrap_or_default(),
            current_model_id: response
                .models
                .as_ref()
                .map(|models| models.current_model_id.to_string()),
            available_model_ids: response
                .models
                .as_ref()
                .map(|models| {
                    models
                        .available_models
                        .iter()
                        .map(|model| model.model_id.to_string())
                        .collect()
                })
                .unwrap_or_default(),
        }
    }

    fn from_load_session(response: &acp::LoadSessionResponse) -> Self {
        Self {
            current_mode_id: response
                .modes
                .as_ref()
                .map(|m| m.current_mode_id.to_string()),
            legacy_mode_state: response.modes.as_ref().map(into_legacy_mode_state),
            config_options: response.config_options.clone().unwrap_or_default(),
            current_model_id: response
                .models
                .as_ref()
                .map(|models| models.current_model_id.to_string()),
            available_model_ids: response
                .models
                .as_ref()
                .map(|models| {
                    models
                        .available_models
                        .iter()
                        .map(|model| model.model_id.to_string())
                        .collect()
                })
                .unwrap_or_default(),
        }
    }

    fn set_current_mode_id(&mut self, current_mode_id: impl Into<String>) {
        let current_mode_id = current_mode_id.into();
        self.current_mode_id = Some(current_mode_id.clone());
        if let Some(legacy_mode_state) = self.legacy_mode_state.as_mut() {
            legacy_mode_state.current_mode_id = current_mode_id;
        }
    }

    fn has_legacy_mode_control(&self) -> bool {
        self.legacy_mode_state
            .as_ref()
            .map(|state| !state.available_modes.is_empty())
            .unwrap_or(false)
    }

    fn has_raw_or_legacy_mode_control(&self) -> bool {
        self.has_legacy_mode_control()
            || find_select_option_by_purpose(&self.config_options, ConfigPurpose::Mode).is_some()
    }

    fn legacy_mode_contains_value(&self, desired_mode_id: &str) -> bool {
        self.legacy_mode_state
            .as_ref()
            .map(|state| {
                state
                    .available_modes
                    .iter()
                    .any(|mode| mode.id == desired_mode_id)
            })
            .unwrap_or(false)
    }
}

async fn persist_session_config_state_if_changed(
    store: &SessionStore,
    event_sink: &Arc<Mutex<SessionEventSink>>,
    session_id: &str,
    state: &mut PersistedSessionConfigState,
    next: PersistedSessionConfigState,
    updated_at: String,
) -> anyhow::Result<bool> {
    let requested_changed = state.requested_model_id != next.requested_model_id
        || state.requested_mode_id != next.requested_mode_id;
    let current_changed = state.current_model_id != next.current_model_id
        || state.current_mode_id != next.current_mode_id;

    if !requested_changed && !current_changed {
        return Ok(false);
    }

    if requested_changed {
        store.update_requested_configuration(
            session_id,
            next.requested_model_id.as_deref(),
            next.requested_mode_id.as_deref(),
            &updated_at,
        )?;
    }

    if current_changed {
        store.update_current_configuration(
            session_id,
            next.current_model_id.as_deref(),
            next.current_mode_id.as_deref(),
            &updated_at,
        )?;
    }

    *state = next.clone();

    let mut sink = event_sink.lock().await;
    sink.session_state_update(next.to_event_payload());
    Ok(true)
}

async fn persist_requested_config_value_if_changed(
    store: &SessionStore,
    event_sink: &Arc<Mutex<SessionEventSink>>,
    session_id: &str,
    state: &mut PersistedSessionConfigState,
    purpose: Option<ConfigPurpose>,
    desired_value: &str,
    updated_at: String,
) -> anyhow::Result<bool> {
    let Some(purpose) = purpose else {
        return Ok(false);
    };

    let mut next = state.clone();
    match purpose {
        ConfigPurpose::Model => next.requested_model_id = Some(desired_value.to_string()),
        ConfigPurpose::Mode => next.requested_mode_id = Some(desired_value.to_string()),
    }

    persist_session_config_state_if_changed(store, event_sink, session_id, state, next, updated_at)
        .await
}

async fn persist_current_config_state_from_startup(
    store: &SessionStore,
    event_sink: &Arc<Mutex<SessionEventSink>>,
    session_id: &str,
    state: &mut PersistedSessionConfigState,
    startup_state: &SessionStartupState,
    updated_at: String,
) -> anyhow::Result<bool> {
    let mut next = state.clone();
    next.current_model_id = startup_state.current_model_id.clone();
    next.current_mode_id = startup_state.current_mode_id.clone();

    persist_session_config_state_if_changed(store, event_sink, session_id, state, next, updated_at)
        .await
}

fn into_legacy_mode_state(modes: &acp::SessionModeState) -> LegacyModeState {
    LegacyModeState {
        current_mode_id: modes.current_mode_id.to_string(),
        available_modes: modes
            .available_modes
            .iter()
            .map(|mode| LegacyModeOption {
                id: mode.id.to_string(),
                name: mode.name.clone(),
                description: mode.description.clone(),
            })
            .collect(),
    }
}

pub fn spawn_session_actor(
    mut config: SessionActorConfig,
) -> anyhow::Result<(Arc<LiveSessionHandle>, ActorReadyResult)> {
    let session_id = config.session.id.clone();
    let workspace_id = config.session.workspace_id.clone();
    let agent_kind = config.session.agent_kind.clone();
    let is_resume = config.is_resume;
    let actor_latency = config.latency.clone();
    let actor_latency_fields = latency_trace_fields(actor_latency.as_ref());
    let started = Instant::now();
    tracing::info!(
        session_id = %session_id,
        workspace_id = %workspace_id,
        agent_kind = %agent_kind,
        is_resume,
        flow_id = actor_latency_fields.flow_id,
            flow_kind = actor_latency_fields.flow_kind,
            flow_source = actor_latency_fields.flow_source,
            prompt_id = actor_latency_fields.prompt_id,
        "[workspace-latency] session.actor.spawn.start"
    );
    let (command_tx, command_rx) = mpsc::channel::<SessionCommand>(32);
    let event_tx = config.event_tx.clone();
    let busy = Arc::new(AtomicBool::new(false));
    let execution = Arc::new(RwLock::new(LiveSessionExecutionSnapshot::new(
        SessionExecutionPhase::Starting,
    )));

    let handle = Arc::new(LiveSessionHandle {
        session_id: session_id.clone(),
        command_tx,
        event_tx: event_tx.clone(),
        busy: busy.clone(),
        execution,
    });
    let actor_handle = handle.clone();

    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<anyhow::Result<String>>();

    let on_exit = config.on_exit.take();

    std::thread::Builder::new()
        .name(format!(
            "acp-session-{}",
            &session_id[..8.min(session_id.len())]
        ))
        .spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("build per-session tokio runtime");
            let local = tokio::task::LocalSet::new();
            let errored = local.block_on(&rt, async move {
                match run_actor(config, command_rx, ready_tx, actor_handle).await {
                    Ok(()) => false,
                    Err(e) => {
                        tracing::error!(error = %e, "session actor failed");
                        true
                    }
                }
            });
            if let Some(cb) = on_exit {
                cb(errored);
            }
        })?;

    let native_session_id = ready_rx
        .recv_timeout(std::time::Duration::from_secs(60))
        .map_err(|e| match e {
            std::sync::mpsc::RecvTimeoutError::Timeout => {
                anyhow::anyhow!(
                    "ACP session startup timed out after 60s. \
                     The agent may be waiting for authentication or is unresponsive."
                )
            }
            std::sync::mpsc::RecvTimeoutError::Disconnected => {
                anyhow::anyhow!("actor thread died before ACP init completed")
            }
        })??;

    tracing::info!(
        session_id = %session_id,
        workspace_id = %workspace_id,
        native_session_id = %native_session_id,
        elapsed_ms = started.elapsed().as_millis(),
        flow_id = actor_latency_fields.flow_id,
            flow_kind = actor_latency_fields.flow_kind,
            flow_source = actor_latency_fields.flow_source,
            prompt_id = actor_latency_fields.prompt_id,
        "[workspace-latency] session.actor.spawn.ready"
    );

    Ok((handle, ActorReadyResult { native_session_id }))
}

async fn run_actor(
    config: SessionActorConfig,
    mut command_rx: mpsc::Receiver<SessionCommand>,
    ready_tx: std::sync::mpsc::Sender<anyhow::Result<String>>,
    handle: Arc<LiveSessionHandle>,
) -> anyhow::Result<()> {
    let session_id = config.session.id.clone();
    let source_agent_kind = config.session.agent_kind.clone();
    let workspace_id = config.session.workspace_id.clone();
    let actor_latency = config.latency.clone();
    let actor_latency_fields = latency_trace_fields(actor_latency.as_ref());
    let startup_started = Instant::now();
    let busy = handle.busy.clone();

    let resolved_path = config
        .agent
        .agent_process
        .path
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("no executable path for agent"))?;

    let spawn_spec = config.agent.spawn.as_ref();
    let spawn_program = spawn_spec
        .map(|spec| spec.program.as_path())
        .unwrap_or(resolved_path);
    let spawn_args = spawn_spec
        .map(|spec| spec.args.as_slice())
        .unwrap_or(config.agent.descriptor.launch.default_args.as_slice());
    let spawn_cwd = spawn_spec
        .and_then(|spec| spec.cwd.as_ref())
        .unwrap_or(&config.workspace_path);
    let spawn_env = merge_spawn_env(
        &config.workspace_env,
        &config.session_launch_env,
        spawn_spec.map(|spec| &spec.env),
    );

    let process_spawn_started = Instant::now();
    let mut child = tokio::process::Command::new(spawn_program)
        .args(spawn_args)
        .envs(&spawn_env)
        .current_dir(spawn_cwd)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| {
            tracing::warn!(
                session_id = %session_id,
                workspace_id = %workspace_id,
                agent_kind = %source_agent_kind,
                elapsed_ms = process_spawn_started.elapsed().as_millis(),
                error = %e,
                flow_id = actor_latency_fields.flow_id,
            flow_kind = actor_latency_fields.flow_kind,
            flow_source = actor_latency_fields.flow_source,
            prompt_id = actor_latency_fields.prompt_id,
                "[workspace-latency] session.actor.process_spawn_failed"
            );
            let _ = ready_tx.send(Err(anyhow::anyhow!("spawn failed: {e}")));
            anyhow::anyhow!("spawn agent subprocess: {e}")
        })?;
    tracing::info!(
        session_id = %session_id,
        workspace_id = %workspace_id,
        agent_kind = %source_agent_kind,
        elapsed_ms = process_spawn_started.elapsed().as_millis(),
        flow_id = actor_latency_fields.flow_id,
            flow_kind = actor_latency_fields.flow_kind,
            flow_source = actor_latency_fields.flow_source,
            prompt_id = actor_latency_fields.prompt_id,
        "[workspace-latency] session.actor.process_spawned"
    );

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| anyhow::anyhow!("no stdin"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow::anyhow!("no stdout"))?;

    // Spawn a task to read stderr and log it so agent errors are visible
    if let Some(stderr) = child.stderr.take() {
        let agent_kind = source_agent_kind.clone();
        let sid = session_id.clone();
        tokio::task::spawn_local(async move {
            use tokio::io::AsyncBufReadExt;
            let reader = tokio::io::BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let line = sanitize_agent_stderr_line(&line);
                if line.is_empty() {
                    continue;
                }

                match classify_agent_stderr_line(&line) {
                    AgentStderrSeverity::Error => {
                        tracing::error!(
                            session_id = %sid,
                            agent = %agent_kind,
                            "[agent stderr] {line}"
                        );
                    }
                    AgentStderrSeverity::Warn => {
                        tracing::warn!(
                            session_id = %sid,
                            agent = %agent_kind,
                            "[agent stderr] {line}"
                        );
                    }
                    AgentStderrSeverity::Debug => {
                        tracing::debug!(
                            session_id = %sid,
                            agent = %agent_kind,
                            "[agent stderr] {line}"
                        );
                    }
                }
            }
        });
    }

    let (notification_tx, mut notification_rx) =
        mpsc::unbounded_channel::<acp::SessionNotification>();
    let store = config.session_store.clone();

    let event_sink = Arc::new(Mutex::new(if config.is_resume {
        SessionEventSink::resume_from_seq(
            session_id.clone(),
            source_agent_kind.clone(),
            config.workspace_path.clone(),
            config.last_seq,
            config.event_tx.clone(),
            config.session_store.clone(),
        )
    } else {
        SessionEventSink::new(
            session_id.clone(),
            source_agent_kind.clone(),
            config.workspace_path.clone(),
            config.event_tx.clone(),
            config.session_store.clone(),
        )
    }));
    let (background_work_tx, mut background_work_rx) =
        mpsc::unbounded_channel::<BackgroundWorkUpdate>();
    let mut background_work_registry = BackgroundWorkRegistry::new(
        session_id.clone(),
        source_agent_kind.clone(),
        config.session_store.clone(),
        background_work_tx,
        BackgroundWorkOptions::default(),
    );

    let client = RuntimeClient::new(
        session_id.clone(),
        notification_tx,
        config.permission_broker.clone(),
        event_sink.clone(),
        handle.clone(),
    );

    let (conn, io_task) =
        acp::ClientSideConnection::new(client, stdin.compat_write(), stdout.compat(), |fut| {
            tokio::task::spawn_local(fut);
        });

    tokio::task::spawn_local(async move {
        if let Err(e) = io_task.await {
            tracing::warn!(error = %e, "ACP IO task ended");
        }
    });
    let initialize_started = Instant::now();
    let init_response = match conn
        .initialize(
            acp::InitializeRequest::new(acp::ProtocolVersion::V1)
                .client_info(acp::Implementation::new("anyharness", "0.1.0")),
        )
        .await
    {
        Ok(resp) => {
            tracing::info!(
                session_id = %session_id,
                workspace_id = %workspace_id,
                auth_method_count = resp.auth_methods.len(),
                elapsed_ms = initialize_started.elapsed().as_millis(),
                "[workspace-latency] session.actor.acp_initialize.completed"
            );
            resp
        }
        Err(e) => {
            tracing::warn!(
                session_id = %session_id,
                workspace_id = %workspace_id,
                elapsed_ms = initialize_started.elapsed().as_millis(),
                error = %e,
                "[workspace-latency] session.actor.acp_initialize.failed"
            );
            let _ = ready_tx.send(Err(anyhow::anyhow!("ACP initialize: {e}")));
            return Err(anyhow::anyhow!("ACP initialize: {e}"));
        }
    };

    // If the agent advertises auth methods, attempt authenticate before new_session.
    // Some agents (e.g. cursor-agent) require this; others advertise methods but
    // don't require the call. We attempt it and only log a warning on failure,
    // letting new_session be the authoritative gate.
    if !init_response.auth_methods.is_empty() {
        let method_id = init_response.auth_methods[0].id().clone();
        let authenticate_started = Instant::now();
        tracing::info!(
            session_id = %session_id,
            method_id = %method_id,
            "agent advertises auth methods, calling authenticate"
        );
        match conn
            .authenticate(acp::AuthenticateRequest::new(method_id.clone()))
            .await
        {
            Ok(_) => {
                tracing::info!(session_id = %session_id, "ACP authentication succeeded");
                tracing::info!(
                    session_id = %session_id,
                    workspace_id = %workspace_id,
                    method_id = %method_id,
                    elapsed_ms = authenticate_started.elapsed().as_millis(),
                    "[workspace-latency] session.actor.acp_authenticate.completed"
                );
            }
            Err(e) => {
                tracing::warn!(
                    session_id = %session_id,
                    method_id = %method_id,
                    error = %e,
                    "ACP authenticate failed (non-fatal, will attempt new_session anyway)"
                );
                tracing::warn!(
                    session_id = %session_id,
                    workspace_id = %workspace_id,
                    method_id = %method_id,
                    elapsed_ms = authenticate_started.elapsed().as_millis(),
                    error = %e,
                    "[workspace-latency] session.actor.acp_authenticate.failed_non_fatal"
                );
            }
        }
    }

    let mut recovered_from_missing_load_session = false;
    let (native_session_id, mut startup_state) = if config.is_resume {
        let existing =
            config.session.native_session_id.clone().ok_or_else(|| {
                anyhow::anyhow!("cannot resume session without native_session_id")
            })?;
        let load_started = Instant::now();
        match conn
            .load_session(
                acp::LoadSessionRequest::new(existing.clone(), config.workspace_path.clone())
                    .mcp_servers(to_acp_servers(&config.mcp_servers)),
            )
            .await
        {
            Ok(resp) => {
                tracing::info!(
                    session_id = %session_id,
                    workspace_id = %workspace_id,
                    native_session_id = %existing,
                    elapsed_ms = load_started.elapsed().as_millis(),
                    "[workspace-latency] session.actor.load_session.completed"
                );
                (existing, SessionStartupState::from_load_session(&resp))
            }
            Err(e) if is_missing_load_session_resource(&e, &existing) => {
                tracing::warn!(
                    session_id = %session_id,
                    workspace_id = %workspace_id,
                    native_session_id = %existing,
                    elapsed_ms = load_started.elapsed().as_millis(),
                    error = %e,
                    "ACP load_session resource missing; falling back to new_session"
                );
                recovered_from_missing_load_session = true;

                let mut request = acp::NewSessionRequest::new(config.workspace_path.clone());
                if !config.mcp_servers.is_empty() {
                    request = request.mcp_servers(to_acp_servers(&config.mcp_servers));
                }
                if let Some(meta) = build_system_prompt_meta(config.system_prompt_append.as_deref())
                {
                    tracing::debug!(
                        session_id = %session_id,
                        system_prompt_append = config.system_prompt_append.as_deref().unwrap_or_default(),
                        system_prompt_append_len = config.system_prompt_append.as_ref().map(|value| value.len()).unwrap_or(0),
                        "attaching ACP startup system prompt append to fallback new_session"
                    );
                    request = request.meta(meta);
                }

                let new_session_started = Instant::now();
                let new_session_resp = match conn.new_session(request).await {
                    Ok(resp) => {
                        tracing::info!(
                            session_id = %session_id,
                            workspace_id = %workspace_id,
                            native_session_id = %resp.session_id,
                            elapsed_ms = new_session_started.elapsed().as_millis(),
                            "[workspace-latency] session.actor.new_session_after_missing_load.completed"
                        );
                        resp
                    }
                    Err(new_session_error) => {
                        tracing::warn!(
                            session_id = %session_id,
                            workspace_id = %workspace_id,
                            elapsed_ms = new_session_started.elapsed().as_millis(),
                            error = %new_session_error,
                            "[workspace-latency] session.actor.new_session_after_missing_load.failed"
                        );
                        let _ = ready_tx.send(Err(anyhow::anyhow!(
                                "ACP new_session after missing load_session resource: {new_session_error}"
                            )));
                        return Err(anyhow::anyhow!(
                                "ACP new_session after missing load_session resource: {new_session_error}"
                            ));
                    }
                };

                (
                    new_session_resp.session_id.to_string(),
                    SessionStartupState::from_new_session(&new_session_resp),
                )
            }
            Err(e) => {
                tracing::warn!(
                    session_id = %session_id,
                    workspace_id = %workspace_id,
                    native_session_id = %existing,
                    elapsed_ms = load_started.elapsed().as_millis(),
                    error = %e,
                    "[workspace-latency] session.actor.load_session.failed"
                );
                let _ = ready_tx.send(Err(anyhow::anyhow!("ACP load_session: {e}")));
                return Err(anyhow::anyhow!("ACP load_session: {e}"));
            }
        }
    } else {
        let mut request = acp::NewSessionRequest::new(config.workspace_path.clone());
        if !config.mcp_servers.is_empty() {
            request = request.mcp_servers(to_acp_servers(&config.mcp_servers));
        }
        if let Some(meta) = build_system_prompt_meta(config.system_prompt_append.as_deref()) {
            tracing::debug!(
                session_id = %session_id,
                system_prompt_append = config.system_prompt_append.as_deref().unwrap_or_default(),
                system_prompt_append_len = config.system_prompt_append.as_ref().map(|value| value.len()).unwrap_or(0),
                "attaching ACP startup system prompt append to new_session"
            );
            request = request.meta(meta);
        }

        let new_session_started = Instant::now();
        let new_session_resp = match conn.new_session(request).await {
            Ok(resp) => {
                tracing::info!(
                    session_id = %session_id,
                    workspace_id = %workspace_id,
                    native_session_id = %resp.session_id,
                    elapsed_ms = new_session_started.elapsed().as_millis(),
                    "[workspace-latency] session.actor.new_session.completed"
                );
                resp
            }
            Err(e) => {
                tracing::warn!(
                    session_id = %session_id,
                    workspace_id = %workspace_id,
                    elapsed_ms = new_session_started.elapsed().as_millis(),
                    error = %e,
                    "[workspace-latency] session.actor.new_session.failed"
                );
                let _ = ready_tx.send(Err(anyhow::anyhow!("ACP new_session: {e}")));
                return Err(anyhow::anyhow!("ACP new_session: {e}"));
            }
        };
        (
            new_session_resp.session_id.to_string(),
            SessionStartupState::from_new_session(&new_session_resp),
        )
    };

    tracing::info!(
        session_id = %session_id,
        native_session_id = %native_session_id,
        "ACP session established"
    );

    let mut persisted_config_state = PersistedSessionConfigState::from_session(&config.session);

    {
        let mut sink = event_sink.lock().await;
        if !config.is_resume || recovered_from_missing_load_session {
            sink.session_started(native_session_id.to_string());
        }
        emit_startup_state(&mut sink, &startup_state);
    }

    let initial_live_config_started = Instant::now();
    if let Err(error) = emit_live_config_update(
        &source_agent_kind,
        &session_id,
        &store,
        &event_sink,
        &mut persisted_config_state,
        &mut startup_state,
        chrono::Utc::now().to_rfc3339(),
    )
    .await
    {
        tracing::warn!(session_id = %session_id, error = %error, "failed to persist initial live config snapshot");
        tracing::warn!(
            session_id = %session_id,
            workspace_id = %workspace_id,
            error = %error,
            elapsed_ms = initial_live_config_started.elapsed().as_millis(),
            "[workspace-latency] session.actor.initial_live_config.failed"
        );
    } else {
        tracing::info!(
            session_id = %session_id,
            workspace_id = %workspace_id,
            elapsed_ms = initial_live_config_started.elapsed().as_millis(),
            "[workspace-latency] session.actor.initial_live_config.completed"
        );
    }

    let apply_preferences_started = Instant::now();
    if let Err(error) = apply_requested_session_preferences(
        &conn,
        &native_session_id,
        &source_agent_kind,
        &config.session,
        &mut startup_state,
        &event_sink,
    )
    .await
    {
        tracing::warn!(session_id = %session_id, error = %error, "failed to apply session preferences");
        tracing::warn!(
            session_id = %session_id,
            workspace_id = %workspace_id,
            error = %error,
            elapsed_ms = apply_preferences_started.elapsed().as_millis(),
            "[workspace-latency] session.actor.apply_preferences.failed"
        );
    } else {
        tracing::info!(
            session_id = %session_id,
            workspace_id = %workspace_id,
            elapsed_ms = apply_preferences_started.elapsed().as_millis(),
            "[workspace-latency] session.actor.apply_preferences.completed"
        );
    }
    let restore_live_config_started = Instant::now();
    if let Err(error) = restore_persisted_live_config_if_needed(
        &conn,
        &native_session_id,
        &source_agent_kind,
        &session_id,
        &store,
        &event_sink,
        &mut persisted_config_state,
        &mut startup_state,
        config.is_resume,
    )
    .await
    {
        tracing::warn!(session_id = %session_id, error = %error, "failed to restore persisted live config");
        tracing::warn!(
            session_id = %session_id,
            workspace_id = %workspace_id,
            error = %error,
            elapsed_ms = restore_live_config_started.elapsed().as_millis(),
            "[workspace-latency] session.actor.restore_live_config.failed"
        );
    } else {
        tracing::info!(
            session_id = %session_id,
            workspace_id = %workspace_id,
            elapsed_ms = restore_live_config_started.elapsed().as_millis(),
            "[workspace-latency] session.actor.restore_live_config.completed"
        );
    }
    let post_preferences_live_config_started = Instant::now();
    if let Err(error) = emit_live_config_update(
        &source_agent_kind,
        &session_id,
        &store,
        &event_sink,
        &mut persisted_config_state,
        &mut startup_state,
        chrono::Utc::now().to_rfc3339(),
    )
    .await
    {
        tracing::warn!(session_id = %session_id, error = %error, "failed to persist post-preference live config snapshot");
        tracing::warn!(
            session_id = %session_id,
            workspace_id = %workspace_id,
            error = %error,
            elapsed_ms = post_preferences_live_config_started.elapsed().as_millis(),
            "[workspace-latency] session.actor.post_preferences_live_config.failed"
        );
    } else {
        tracing::info!(
            session_id = %session_id,
            workspace_id = %workspace_id,
            elapsed_ms = post_preferences_live_config_started.elapsed().as_millis(),
            "[workspace-latency] session.actor.post_preferences_live_config.completed"
        );
    }

    let _ = ready_tx.send(Ok(native_session_id.to_string()));
    handle
        .set_execution_phase(SessionExecutionPhase::Idle)
        .await;
    background_work_registry.rehydrate_pending().await;
    tracing::info!(
        session_id = %session_id,
        workspace_id = %workspace_id,
        native_session_id = %native_session_id,
        total_elapsed_ms = startup_started.elapsed().as_millis(),
        flow_id = actor_latency_fields.flow_id,
            flow_kind = actor_latency_fields.flow_kind,
            flow_source = actor_latency_fields.flow_source,
            prompt_id = actor_latency_fields.prompt_id,
        "[workspace-latency] session.actor.startup_ready"
    );
    let mut resume_replay_filter =
        ResumeReplayFilter::new(&source_agent_kind, config.is_resume, &config.session.status);

    // Invariant 5: startup drain. If the durable queue is non-empty, self-dispatch
    // a Prompt command for the head row carrying `from_queue_seq`. The first
    // iteration of the outer Prompt arm will treat it as a drained iteration —
    // `begin_turn` runs, then the head row is deleted and `PendingPromptRemoved`
    // is emitted. If more items exist, the turn-end drain loop picks them up
    // naturally from there. Races: the main select loop hasn't started yet, so
    // no other command can interleave.
    match store.peek_head_pending_prompt(&session_id) {
        Ok(Some(head)) => {
            let (drain_respond_tx, _drain_respond_rx) = oneshot::channel();
            if let Err(error) = handle
                .command_tx
                .send(SessionCommand::Prompt {
                    text: head.text,
                    prompt_id: head.prompt_id,
                    latency: None,
                    from_queue_seq: Some(head.seq),
                    respond_to: drain_respond_tx,
                })
                .await
            {
                tracing::warn!(
                    session_id = %session_id,
                    error = %error,
                    "failed to self-dispatch startup drain prompt",
                );
            } else {
                tracing::info!(
                    session_id = %session_id,
                    seq = head.seq,
                    "session.actor.startup_drain.dispatched",
                );
            }
        }
        Ok(None) => {}
        Err(error) => {
            tracing::warn!(
                session_id = %session_id,
                error = %error,
                "failed to peek pending prompt queue at startup",
            );
        }
    }

    let mut exit_reason = ActorExitDisposition::Close;
    loop {
        tokio::select! {
            cmd = command_rx.recv() => {
                match cmd {
                    Some(SessionCommand::Prompt { text, prompt_id, latency, from_queue_seq, respond_to }) => {
                        // Invariant 2: the actor is the sole writer of `busy`.
                        busy.store(true, Ordering::Release);
                        let _ = respond_to.send(Ok(PromptAcceptance::Started));

                        let mut current_text = text;
                        let mut current_prompt_id = prompt_id;
                        let mut current_latency = latency;
                        let mut current_queue_seq: Option<i64> = from_queue_seq;
                        let mut exit_after_prompt: Option<ActorExitDisposition> = None;
                        let mut broken_session = false;

                        'drain: loop {
                            let latency_fields = latency_trace_fields(current_latency.as_ref());
                            tracing::info!(
                                session_id = %session_id,
                                flow_id = latency_fields.flow_id,
                                flow_kind = latency_fields.flow_kind,
                                flow_source = latency_fields.flow_source,
                                prompt_id = latency_fields.prompt_id,
                                "[workspace-latency] session.actor.prompt.received"
                            );
                            {
                                let mut sink = event_sink.lock().await;
                                sink.begin_turn(current_text.clone());
                                // Invariant 3: delete the queue row and emit Removed
                                // AFTER begin_turn has durably persisted the replacement
                                // turn events. `current_queue_seq` is only set on drained
                                // iterations; initial iterations get None.
                                if let Some(seq) = current_queue_seq.take() {
                                    if let Err(error) = store.delete_pending_prompt(&session_id, seq) {
                                        tracing::warn!(
                                            session_id = %session_id,
                                            seq,
                                            error = %error,
                                            "failed to delete pending prompt after begin_turn",
                                        );
                                    }
                                    sink.pending_prompt_removed(PendingPromptRemovedPayload {
                                        seq,
                                        reason: PendingPromptRemovalReason::Executed,
                                    });
                                }
                            }

                            let now = chrono::Utc::now().to_rfc3339();
                            handle.set_execution_phase(SessionExecutionPhase::Running).await;
                            let _ = store.update_status(&session_id, "running", &now);
                            let _ = store.update_last_prompt_at(&session_id, &now);
                            tracing::info!(
                                session_id = %session_id,
                                flow_id = latency_fields.flow_id,
                                flow_kind = latency_fields.flow_kind,
                                flow_source = latency_fields.flow_source,
                                prompt_id = latency_fields.prompt_id,
                                "[workspace-latency] session.actor.prompt.accepted"
                            );

                            let req = acp::PromptRequest::new(
                                native_session_id.clone(),
                                vec![current_text.clone().into()],
                            );

                            let mut prompt_result = None;
                            tracing::info!(
                                session_id = %session_id,
                                flow_id = latency_fields.flow_id,
                                flow_kind = latency_fields.flow_kind,
                                flow_source = latency_fields.flow_source,
                                prompt_id = latency_fields.prompt_id,
                                "[workspace-latency] session.actor.prompt.dispatch_started"
                            );
                            let prompt_fut = conn.prompt(req);
                            tokio::pin!(prompt_fut);

                            while prompt_result.is_none() {
                                tokio::select! {
                                    result = &mut prompt_fut => {
                                        prompt_result = Some(result);
                                    }
                                    notification = notification_rx.recv() => {
                                        if let Some(notif) = notification {
                                            handle_notification_with_resume_replay_filter(
                                                &notif,
                                                &mut resume_replay_filter,
                                                &event_sink,
                                                &mut background_work_registry,
                                                &store,
                                                &session_id,
                                                &source_agent_kind,
                                                &mut persisted_config_state,
                                                &mut startup_state,
                                            ).await;
                                        }
                                    }
                                    background_update = background_work_rx.recv() => {
                                        if let Some(update) = background_update {
                                            handle_background_work_update(&event_sink, &store, &session_id, update).await;
                                        }
                                    }
                                    cmd = command_rx.recv() => {
                                        match cmd {
                                            Some(SessionCommand::Cancel) => {
                                                let _ = conn
                                                    .cancel(acp::CancelNotification::new(native_session_id.clone()))
                                                    .await;
                                            }
                                            Some(SessionCommand::Dismiss { respond_to }) => {
                                                let _ = conn
                                                    .cancel(acp::CancelNotification::new(native_session_id.clone()))
                                                    .await;
                                                let _ = respond_to.send(Ok(()));
                                                exit_after_prompt = Some(ActorExitDisposition::Dismiss);
                                            }
                                            Some(SessionCommand::SetConfigOption { config_id, value, respond_to }) => {
                                                let option = find_select_option_for_request(&startup_state.config_options, &config_id);
                                                let result = queue_pending_config_change(
                                                    &store,
                                                    &session_id,
                                                    &startup_state,
                                                    &config_id,
                                                    &value,
                                                );
                                                let result = match result {
                                                    Ok(()) => {
                                                        if let Err(error) = persist_requested_config_value_if_changed(
                                                            &store,
                                                            &event_sink,
                                                            &session_id,
                                                            &mut persisted_config_state,
                                                            tracked_config_purpose(&config_id, option),
                                                            &value,
                                                            chrono::Utc::now().to_rfc3339(),
                                                        )
                                                        .await
                                                        {
                                                            let _ = store.delete_pending_config_change(&session_id, &config_id);
                                                            Err(SetConfigOptionCommandError::Rejected(error.to_string()))
                                                        } else {
                                                            Ok(ConfigApplyState::Queued)
                                                        }
                                                    }
                                                    Err(error) => Err(error),
                                                };
                                                let _ = respond_to.send(result);
                                            }
                                            Some(SessionCommand::Close { respond_to }) => {
                                                let _ = respond_to.send(Ok(()));
                                                exit_after_prompt = Some(ActorExitDisposition::Close);
                                            }
                                            Some(SessionCommand::Prompt { text: queued_text, prompt_id: queued_prompt_id, latency: _, from_queue_seq: _, respond_to }) => {
                                                // Invariant 2/3: busy-path enqueue. Insert durably,
                                                // emit PendingPromptAdded, respond Queued.
                                                match store.insert_pending_prompt(&session_id, &queued_text, queued_prompt_id.as_deref()) {
                                                    Ok(record) => {
                                                        let mut sink = event_sink.lock().await;
                                                        sink.pending_prompt_added(PendingPromptAddedPayload {
                                                            seq: record.seq,
                                                            prompt_id: record.prompt_id.clone(),
                                                            text: record.text.clone(),
                                                            queued_at: record.queued_at.clone(),
                                                        });
                                                        drop(sink);
                                                        let _ = respond_to.send(Ok(PromptAcceptance::Queued { seq: record.seq }));
                                                    }
                                                    Err(error) => {
                                                        tracing::warn!(
                                                            session_id = %session_id,
                                                            error = %error,
                                                            "failed to enqueue pending prompt",
                                                        );
                                                        let _ = respond_to.send(Err(PromptAcceptError::EnqueueFailed(error.to_string())));
                                                    }
                                                }
                                            }
                                            Some(SessionCommand::EditPendingPrompt { seq, text, respond_to }) => {
                                                let _ = respond_to.send(handle_edit_pending_prompt(&store, &event_sink, &session_id, seq, text).await);
                                            }
                                            Some(SessionCommand::DeletePendingPrompt { seq, respond_to }) => {
                                                let _ = respond_to.send(handle_delete_pending_prompt(&store, &event_sink, &session_id, seq).await);
                                            }
                                            None => {}
                                        }
                                    }
                                }
                            }

                            let result = prompt_result.expect("prompt_result must be set");
                            match &result {
                                Ok(resp) => {
                                    while let Ok(notif) = notification_rx.try_recv() {
                                        handle_notification_with_resume_replay_filter(
                                            &notif,
                                            &mut resume_replay_filter,
                                            &event_sink,
                                            &mut background_work_registry,
                                            &store,
                                            &session_id,
                                            &source_agent_kind,
                                            &mut persisted_config_state,
                                            &mut startup_state,
                                        ).await;
                                    }
                                    while let Ok(update) = background_work_rx.try_recv() {
                                        handle_background_work_update(&event_sink, &store, &session_id, update).await;
                                    }
                                    let stop = map_stop_reason(&resp.stop_reason);
                                    let mut sink = event_sink.lock().await;
                                    sink.turn_ended(stop);
                                    drop(sink);
                                    let now = chrono::Utc::now().to_rfc3339();
                                    handle.set_execution_phase(SessionExecutionPhase::Idle).await;
                                    let _ = store.update_status(&session_id, "idle", &now);
                                    if let Err(error) = apply_pending_config_changes_if_idle(
                                        &conn,
                                        &native_session_id,
                                        &source_agent_kind,
                                        &session_id,
                                        &store,
                                        &event_sink,
                                        &mut persisted_config_state,
                                        &mut startup_state,
                                    )
                                    .await
                                    {
                                        tracing::warn!(session_id = %session_id, error = %error, "failed to apply pending config changes after turn end");
                                    }
                                }
                                Err(e) => {
                                    let mut sink = event_sink.lock().await;
                                    sink.error(e.to_string(), None);
                                    drop(sink);
                                    let now = chrono::Utc::now().to_rfc3339();
                                    handle.set_execution_phase(SessionExecutionPhase::Errored).await;
                                    let _ = store.update_status(&session_id, "errored", &now);
                                    broken_session = true;
                                }
                            }

                            resume_replay_filter.disable();

                            // Suppress reference-unused warnings on latency locals so the
                            // drain body behaves symmetrically across iterations.
                            let _ = current_prompt_id.take();

                            if exit_after_prompt.is_some() || broken_session {
                                break 'drain;
                            }

                            // Invariant 2/3: peek the head of the queue BEFORE releasing
                            // `busy`. If present, re-enter the prompt body with the new text;
                            // begin_turn's event emission is what durably hands off the queue
                            // row (see the delete_pending_prompt call above).
                            match store.peek_head_pending_prompt(&session_id) {
                                Ok(Some(next)) => {
                                    current_text = next.text;
                                    current_prompt_id = next.prompt_id;
                                    current_latency = None;
                                    current_queue_seq = Some(next.seq);
                                    continue 'drain;
                                }
                                Ok(None) => break 'drain,
                                Err(error) => {
                                    tracing::warn!(
                                        session_id = %session_id,
                                        error = %error,
                                        "failed to peek pending prompt queue after turn end",
                                    );
                                    break 'drain;
                                }
                            }
                        }

                        busy.store(false, Ordering::Release);
                        if let Some(next_exit) = exit_after_prompt {
                            exit_reason = next_exit;
                            break;
                        }
                    }
                    Some(SessionCommand::EditPendingPrompt { seq, text, respond_to }) => {
                        let _ = respond_to.send(handle_edit_pending_prompt(&store, &event_sink, &session_id, seq, text).await);
                    }
                    Some(SessionCommand::DeletePendingPrompt { seq, respond_to }) => {
                        let _ = respond_to.send(handle_delete_pending_prompt(&store, &event_sink, &session_id, seq).await);
                    }
                    Some(SessionCommand::SetConfigOption {
                        config_id,
                        value,
                        respond_to,
                    }) => {
                        let result = apply_specific_config_option(
                            &conn,
                            &native_session_id,
                            &source_agent_kind,
                            &session_id,
                            &store,
                            &event_sink,
                            &mut persisted_config_state,
                            &mut startup_state,
                            &config_id,
                            &value,
                        )
                        .await;

                        match result {
                            Ok(state) => {
                                let _ = respond_to.send(Ok(state));
                            }
                            Err(error) => {
                                let _ = respond_to.send(Err(error));
                            }
                        }
                    }
                    Some(SessionCommand::Cancel) => {
                        let _ = conn
                            .cancel(acp::CancelNotification::new(native_session_id.clone()))
                            .await;
                    }
                    Some(SessionCommand::Dismiss { respond_to }) => {
                        let _ = respond_to.send(Ok(()));
                        exit_reason = ActorExitDisposition::Dismiss;
                        break;
                    }
                    Some(SessionCommand::Close { respond_to }) => {
                        let _ = respond_to.send(Ok(()));
                        exit_reason = ActorExitDisposition::Close;
                        break;
                    }
                    None => break,
                }
            }
            notification = notification_rx.recv() => {
                if let Some(notif) = notification {
                    handle_notification_with_resume_replay_filter(
                        &notif,
                        &mut resume_replay_filter,
                        &event_sink,
                        &mut background_work_registry,
                        &store,
                        &session_id,
                        &source_agent_kind,
                        &mut persisted_config_state,
                        &mut startup_state,
                    ).await;
                }
            }
            background_update = background_work_rx.recv() => {
                if let Some(update) = background_update {
                    handle_background_work_update(&event_sink, &store, &session_id, update).await;
                }
            }
        }
    }
    background_work_registry.shutdown();
    finalize_established_actor_exit(&handle, &event_sink, &store, &session_id, exit_reason).await;
    handle.finish_prompt();
    drop(child);
    Ok(())
}

async fn finalize_established_actor_exit(
    handle: &Arc<LiveSessionHandle>,
    event_sink: &Arc<Mutex<SessionEventSink>>,
    store: &SessionStore,
    session_id: &str,
    disposition: ActorExitDisposition,
) {
    let pending_approval = handle.execution_snapshot().await.pending_approval;
    let now = chrono::Utc::now().to_rfc3339();

    {
        let mut sink = event_sink.lock().await;
        if let Some(pending_approval) = &pending_approval {
            sink.permission_resolved(
                pending_approval.request_id.clone(),
                PermissionOutcome::Cancelled,
            );
        }

        match &disposition {
            ActorExitDisposition::Error { message, code } => {
                sink.error(message.clone(), code.clone());
                sink.session_ended(SessionEndReason::Error);
            }
            ActorExitDisposition::Close => {
                sink.session_ended(SessionEndReason::Closed);
            }
            ActorExitDisposition::Dismiss => {}
        }
    }

    match disposition {
        ActorExitDisposition::Error { .. } => {
            handle
                .set_execution_phase(SessionExecutionPhase::Errored)
                .await;
            let _ = store.update_status(session_id, "errored", &now);
        }
        ActorExitDisposition::Close => {
            handle
                .set_execution_phase(SessionExecutionPhase::Closed)
                .await;
        }
        ActorExitDisposition::Dismiss => {
            handle
                .set_execution_phase(SessionExecutionPhase::Idle)
                .await;
        }
    }
}

async fn handle_background_work_update(
    event_sink: &Arc<Mutex<SessionEventSink>>,
    store: &SessionStore,
    session_id: &str,
    update: BackgroundWorkUpdate,
) {
    let marked_terminal = match store.mark_background_work_terminal(
        session_id,
        &update.tool_call_id,
        update.state,
        &chrono::Utc::now().to_rfc3339(),
    ) {
        Ok(marked_terminal) => marked_terminal,
        Err(error) => {
            tracing::warn!(
                session_id = %session_id,
                tool_call_id = %update.tool_call_id,
                error = %error,
                "failed to mark background work terminal"
            );
            return;
        }
    };

    if !marked_terminal {
        return;
    }

    let mut sink = event_sink.lock().await;
    sink.resolve_background_tool_call(
        update.turn_id.clone(),
        update.tool_call_id.clone(),
        update.state,
        update.agent_id,
        update.output_file,
        update.result_text,
    );
}

fn merge_spawn_env(
    workspace_env: &std::collections::BTreeMap<String, String>,
    session_launch_env: &std::collections::BTreeMap<String, String>,
    override_env: Option<&std::collections::HashMap<String, String>>,
) -> std::collections::BTreeMap<String, String> {
    let mut merged = workspace_env.clone();
    for (key, value) in session_launch_env {
        merged.insert(key.clone(), value.clone());
    }
    if let Some(override_env) = override_env {
        for (key, value) in override_env {
            merged.insert(key.clone(), value.clone());
        }
    }
    merged
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AgentStderrSeverity {
    Error,
    Warn,
    Debug,
}

fn sanitize_agent_stderr_line(line: &str) -> String {
    strip_ansi_escape_codes(line).trim().to_string()
}

fn classify_agent_stderr_line(line: &str) -> AgentStderrSeverity {
    let upper = line.to_ascii_uppercase();

    if has_log_level_token(&upper, "ERROR") {
        AgentStderrSeverity::Error
    } else if has_log_level_token(&upper, "WARN") || has_log_level_token(&upper, "WARNING") {
        AgentStderrSeverity::Warn
    } else if has_log_level_token(&upper, "INFO")
        || has_log_level_token(&upper, "DEBUG")
        || has_log_level_token(&upper, "TRACE")
    {
        AgentStderrSeverity::Debug
    } else {
        AgentStderrSeverity::Warn
    }
}

fn has_log_level_token(line: &str, level: &str) -> bool {
    line.starts_with(level)
        || line.contains(&format!(" {level} "))
        || line.contains(&format!(":{level} "))
        || line.contains(&format!(" {level}:"))
}

fn strip_ansi_escape_codes(input: &str) -> String {
    let mut cleaned = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' {
            if matches!(chars.peek(), Some('[')) {
                chars.next();
                for escape_char in chars.by_ref() {
                    if ('@'..='~').contains(&escape_char) {
                        break;
                    }
                }
            }
            continue;
        }

        cleaned.push(ch);
    }

    cleaned
}

#[cfg(test)]
async fn handle_notification(
    notif: &acp::SessionNotification,
    event_sink: &Arc<Mutex<SessionEventSink>>,
    background_work_registry: &mut BackgroundWorkRegistry,
    session_store: &SessionStore,
    session_id: &str,
    source_agent_kind: &str,
    persisted_config_state: &mut PersistedSessionConfigState,
    startup_state: &mut SessionStartupState,
) {
    let mut replay_filter = ResumeReplayFilter::disabled();
    handle_notification_with_resume_replay_filter(
        notif,
        &mut replay_filter,
        event_sink,
        background_work_registry,
        session_store,
        session_id,
        source_agent_kind,
        persisted_config_state,
        startup_state,
    )
    .await;
}

async fn handle_notification_with_resume_replay_filter(
    notif: &acp::SessionNotification,
    replay_filter: &mut ResumeReplayFilter,
    event_sink: &Arc<Mutex<SessionEventSink>>,
    background_work_registry: &mut BackgroundWorkRegistry,
    session_store: &SessionStore,
    session_id: &str,
    source_agent_kind: &str,
    persisted_config_state: &mut PersistedSessionConfigState,
    startup_state: &mut SessionStartupState,
) {
    let kind = super::runtime_client::session_update_kind(&notif.update);
    tracing::info!(
        session_id = %session_id,
        agent = %source_agent_kind,
        kind = kind,
        "handle_notification: received ACP notification"
    );
    if let Err(error) = persist_raw_notification(session_store, session_id, kind, notif) {
        tracing::warn!(
            session_id = %session_id,
            kind = kind,
            error = %error,
            "failed to persist raw ACP notification"
        );
    }

    if replay_filter.should_suppress(notif, Instant::now()) {
        tracing::info!(
            session_id = %session_id,
            agent = %source_agent_kind,
            kind = kind,
            "suppressing resumed-session replay notification before transcript normalization"
        );
        return;
    }

    normalize_notification(
        notif,
        event_sink,
        background_work_registry,
        session_store,
        session_id,
        source_agent_kind,
        persisted_config_state,
        startup_state,
    )
    .await;
}

async fn normalize_notification(
    notif: &acp::SessionNotification,
    event_sink: &Arc<Mutex<SessionEventSink>>,
    background_work_registry: &mut BackgroundWorkRegistry,
    session_store: &SessionStore,
    session_id: &str,
    source_agent_kind: &str,
    persisted_config_state: &mut PersistedSessionConfigState,
    startup_state: &mut SessionStartupState,
) {
    use acp::SessionUpdate::*;
    match &notif.update {
        AgentMessageChunk(chunk) => {
            let mut sink = event_sink.lock().await;
            sink.agent_message_chunk(AcpChunkPayload {
                content: serialize_content_block(&chunk.content),
                meta: serialize_meta(chunk.meta.as_ref()),
                message_id: chunk.message_id.clone(),
            });
        }
        AgentThoughtChunk(chunk) => {
            let mut sink = event_sink.lock().await;
            sink.agent_thought_chunk(AcpChunkPayload {
                content: serialize_content_block(&chunk.content),
                meta: serialize_meta(chunk.meta.as_ref()),
                message_id: chunk.message_id.clone(),
            });
        }
        ToolCall(tc) => {
            let payload = AcpToolPayload {
                tool_call_id: tc.tool_call_id.to_string(),
                title: Some(tc.title.clone()),
                kind: serde_json::to_value(tc.kind)
                    .ok()
                    .and_then(|v| v.as_str().map(String::from)),
                status: serde_json::to_value(tc.status)
                    .ok()
                    .and_then(|v| v.as_str().map(String::from)),
                content: Some(
                    tc.content
                        .iter()
                        .filter_map(|c| serde_json::to_value(c).ok())
                        .collect(),
                ),
                locations: Some(
                    tc.locations
                        .iter()
                        .filter_map(|l| serde_json::to_value(l).ok())
                        .collect(),
                ),
                raw_input: tc
                    .raw_input
                    .as_ref()
                    .and_then(|v| serde_json::to_value(v).ok()),
                raw_output: tc
                    .raw_output
                    .as_ref()
                    .and_then(|v| serde_json::to_value(v).ok()),
                meta: serialize_meta(tc.meta.as_ref()),
            };
            let turn_id = {
                let mut sink = event_sink.lock().await;
                sink.tool_call(payload.clone());
                sink.current_turn_id()
            };
            background_work_registry
                .observe_tool_payload(turn_id, &payload)
                .await;
        }
        ToolCallUpdate(tcu) => {
            let payload = AcpToolPayload {
                tool_call_id: tcu.tool_call_id.to_string(),
                title: tcu.fields.title.clone(),
                kind: tcu
                    .fields
                    .kind
                    .as_ref()
                    .and_then(|k| serde_json::to_value(k).ok())
                    .and_then(|v| v.as_str().map(String::from)),
                status: tcu
                    .fields
                    .status
                    .as_ref()
                    .and_then(|s| serde_json::to_value(s).ok())
                    .and_then(|v| v.as_str().map(String::from)),
                content: tcu.fields.content.as_ref().map(|cs| {
                    cs.iter()
                        .filter_map(|c| serde_json::to_value(c).ok())
                        .collect()
                }),
                locations: tcu.fields.locations.as_ref().map(|ls| {
                    ls.iter()
                        .filter_map(|l| serde_json::to_value(l).ok())
                        .collect()
                }),
                raw_input: tcu
                    .fields
                    .raw_input
                    .as_ref()
                    .and_then(|v| serde_json::to_value(v).ok()),
                raw_output: tcu
                    .fields
                    .raw_output
                    .as_ref()
                    .and_then(|v| serde_json::to_value(v).ok()),
                meta: serialize_meta(tcu.meta.as_ref()),
            };
            let turn_id = {
                let mut sink = event_sink.lock().await;
                sink.tool_call_update(payload.clone());
                sink.current_turn_id()
            };
            background_work_registry
                .observe_tool_payload(turn_id, &payload)
                .await;
        }
        Plan(plan) => {
            let entries = plan
                .entries
                .iter()
                .filter_map(|e| serde_json::to_value(e).ok())
                .collect();
            let mut sink = event_sink.lock().await;
            sink.plan(entries);
        }
        AvailableCommandsUpdate(cmds) => {
            let payload = AvailableCommandsUpdatePayload {
                available_commands: cmds
                    .available_commands
                    .iter()
                    .filter_map(|c| serde_json::to_value(c).ok())
                    .collect(),
            };
            let mut sink = event_sink.lock().await;
            sink.available_commands_update(payload);
        }
        CurrentModeUpdate(mode) => {
            let next_mode_id = mode.current_mode_id.to_string();
            startup_state.set_current_mode_id(next_mode_id.clone());
            set_select_option_current_value_for_purpose(
                &mut startup_state.config_options,
                ConfigPurpose::Mode,
                &next_mode_id,
            );
            let now = chrono::Utc::now().to_rfc3339();
            if startup_state.has_raw_or_legacy_mode_control() {
                emit_live_config_update(
                    source_agent_kind,
                    session_id,
                    session_store,
                    event_sink,
                    persisted_config_state,
                    startup_state,
                    now.clone(),
                )
                .await
                .map(|()| true)
                .unwrap_or_else(|error| {
                    tracing::warn!(session_id = %session_id, error = %error, "failed to persist live config after current mode update");
                    false
                })
            } else {
                persist_current_config_state_from_startup(
                    session_store,
                    event_sink,
                    session_id,
                    persisted_config_state,
                    startup_state,
                    now.clone(),
                )
                .await
                .unwrap_or_else(|error| {
                    tracing::warn!(session_id = %session_id, error = %error, "failed to persist current session state after current mode update");
                    false
                })
            };
            let payload = CurrentModeUpdatePayload {
                current_mode_id: next_mode_id,
            };
            let mut sink = event_sink.lock().await;
            sink.current_mode_update(payload);
        }
        ConfigOptionUpdate(config) => {
            startup_state.config_options = config.config_options.clone();
            if let Err(error) = emit_live_config_update(
                source_agent_kind,
                session_id,
                session_store,
                event_sink,
                persisted_config_state,
                startup_state,
                chrono::Utc::now().to_rfc3339(),
            )
            .await
            {
                tracing::warn!(session_id = %session_id, error = %error, "failed to persist config option update");
            }
        }
        SessionInfoUpdate(info) => {
            let title = info
                .title
                .as_opt_ref()
                .and_then(|t| t.map(|s| s.to_string()));

            let updated_at = info
                .updated_at
                .as_opt_ref()
                .and_then(|t| t.map(|s| s.to_string()));

            if let Some(ref t) = title {
                let now = chrono::Utc::now().to_rfc3339();
                let _ = session_store.update_title(session_id, t, &now);
            }

            let payload = SessionInfoUpdatePayload { title, updated_at };
            let mut sink = event_sink.lock().await;
            sink.session_info_update(payload);
        }
        UsageUpdate(usage) => {
            let payload = UsageUpdatePayload {
                used: usage.used,
                size: usage.size,
                cost: serde_json::to_value(&usage.cost).ok(),
            };
            let mut sink = event_sink.lock().await;
            sink.usage_update(payload);
        }
        UserMessageChunk(_) => {
            tracing::trace!("ACP UserMessageChunk echo received (deduplicated)");
        }
        #[allow(unreachable_patterns)]
        other => {
            tracing::debug!("unrecognized ACP SessionUpdate variant: {other:?}");
        }
    }
}

fn persist_raw_notification(
    session_store: &SessionStore,
    session_id: &str,
    kind: &str,
    notif: &acp::SessionNotification,
) -> anyhow::Result<()> {
    let payload_json = serde_json::to_string(notif)?;
    session_store.append_raw_notification(
        session_id,
        kind,
        &chrono::Utc::now().to_rfc3339(),
        &payload_json,
    )
}

fn serialize_content_block(content: &acp::ContentBlock) -> serde_json::Value {
    serde_json::to_value(content).unwrap_or(serde_json::json!({ "type": "text", "text": "" }))
}

fn serialize_meta(meta: Option<&acp::Meta>) -> Option<serde_json::Value> {
    meta.and_then(|value| serde_json::to_value(value).ok())
}

fn build_system_prompt_meta(system_prompt_append: Option<&str>) -> Option<acp::Meta> {
    let append = system_prompt_append?.trim();
    if append.is_empty() {
        return None;
    }

    Some(acp::Meta::from_iter([(
        "systemPrompt".to_string(),
        serde_json::json!({
            "append": append,
        }),
    )]))
}

fn is_missing_load_session_resource(error: &acp::Error, expected_uri: &str) -> bool {
    if !matches!(error.code, acp::ErrorCode::ResourceNotFound) {
        return false;
    }

    match error
        .data
        .as_ref()
        .and_then(|data| data.get("uri"))
        .and_then(|uri| uri.as_str())
    {
        Some(uri) => uri == expected_uri,
        None => true,
    }
}

fn map_stop_reason(stop_reason: &acp::StopReason) -> StopReason {
    match stop_reason {
        acp::StopReason::EndTurn => StopReason::EndTurn,
        acp::StopReason::MaxTokens => StopReason::MaxTokens,
        acp::StopReason::MaxTurnRequests => StopReason::MaxTurnRequests,
        acp::StopReason::Refusal => StopReason::Refusal,
        acp::StopReason::Cancelled => StopReason::Cancelled,
        #[allow(unreachable_patterns)]
        _ => StopReason::Cancelled,
    }
}

fn emit_startup_state(sink: &mut SessionEventSink, startup_state: &SessionStartupState) {
    if let Some(current_mode_id) = &startup_state.current_mode_id {
        sink.current_mode_update(CurrentModeUpdatePayload {
            current_mode_id: current_mode_id.clone(),
        });
    }
}

async fn apply_requested_session_preferences(
    conn: &acp::ClientSideConnection,
    native_session_id: &str,
    source_agent_kind: &str,
    session: &SessionRecord,
    startup_state: &mut SessionStartupState,
    event_sink: &Arc<Mutex<SessionEventSink>>,
) -> anyhow::Result<()> {
    if let Some(model_id) = session.requested_model_id.as_deref() {
        let outcome =
            try_apply_model_via_models(conn, native_session_id, model_id, startup_state).await?;
        let outcome = if outcome != ConfigApplyOutcome::NotApplied {
            outcome
        } else {
            try_apply_curated_claude_model_alias_via_setter(
                conn,
                native_session_id,
                source_agent_kind,
                model_id,
                startup_state,
            )
            .await?
        };
        if outcome == ConfigApplyOutcome::NotApplied {
            let _ = try_apply_config_option(
                conn,
                native_session_id,
                startup_state,
                ConfigPurpose::Model,
                model_id,
                event_sink,
            )
            .await?;
        }
    }
    if let Some(mode_id) = session.requested_mode_id.as_deref() {
        let outcome = try_apply_config_option(
            conn,
            native_session_id,
            startup_state,
            ConfigPurpose::Mode,
            mode_id,
            event_sink,
        )
        .await?;
        if outcome == ConfigApplyOutcome::NotApplied {
            let _ = apply_mode_via_direct_setter_legacy(
                conn,
                native_session_id,
                startup_state,
                mode_id,
            )
            .await?;
        }
    }

    Ok(())
}

async fn try_apply_model_via_models(
    conn: &acp::ClientSideConnection,
    native_session_id: &str,
    desired_model_id: &str,
    startup_state: &mut SessionStartupState,
) -> anyhow::Result<ConfigApplyOutcome> {
    if startup_state.current_model_id.as_deref() == Some(desired_model_id) {
        set_select_option_current_value_for_purpose(
            &mut startup_state.config_options,
            ConfigPurpose::Model,
            desired_model_id,
        );
        return Ok(ConfigApplyOutcome::NoChange);
    }

    if !startup_state
        .available_model_ids
        .iter()
        .any(|id| id == desired_model_id)
    {
        return Ok(ConfigApplyOutcome::NotApplied);
    }

    conn.set_session_model(acp::SetSessionModelRequest::new(
        native_session_id.to_string(),
        desired_model_id.to_string(),
    ))
    .await?;

    Ok(ConfigApplyOutcome::RequestedOnly)
}

async fn try_apply_curated_claude_model_alias_via_setter(
    conn: &acp::ClientSideConnection,
    native_session_id: &str,
    source_agent_kind: &str,
    desired_model_id: &str,
    startup_state: &mut SessionStartupState,
) -> anyhow::Result<ConfigApplyOutcome> {
    if !should_try_direct_claude_model_setter(
        source_agent_kind,
        desired_model_id,
        &startup_state.available_model_ids,
    ) {
        return Ok(ConfigApplyOutcome::NotApplied);
    }

    if startup_state.current_model_id.as_deref() == Some(desired_model_id) {
        set_select_option_current_value_for_purpose(
            &mut startup_state.config_options,
            ConfigPurpose::Model,
            desired_model_id,
        );
        return Ok(ConfigApplyOutcome::NoChange);
    }

    conn.set_session_model(acp::SetSessionModelRequest::new(
        native_session_id.to_string(),
        desired_model_id.to_string(),
    ))
    .await?;

    Ok(ConfigApplyOutcome::RequestedOnly)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ConfigPurpose {
    Model,
    Mode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ConfigApplyOutcome {
    NoChange,
    AppliedAuthoritative,
    RequestedOnly,
    NotApplied,
}

fn tracked_config_purpose(
    config_id: &str,
    option: Option<&acp::SessionConfigOption>,
) -> Option<ConfigPurpose> {
    if is_model_config_request(config_id, option) {
        Some(ConfigPurpose::Model)
    } else if is_mode_config_request(config_id, option) {
        Some(ConfigPurpose::Mode)
    } else {
        None
    }
}

async fn try_apply_config_option(
    conn: &acp::ClientSideConnection,
    native_session_id: &str,
    startup_state: &mut SessionStartupState,
    purpose: ConfigPurpose,
    desired_value: &str,
    _event_sink: &Arc<Mutex<SessionEventSink>>,
) -> anyhow::Result<ConfigApplyOutcome> {
    let Some(option) =
        find_select_option_for_value(&startup_state.config_options, purpose, desired_value)
    else {
        return Ok(ConfigApplyOutcome::NotApplied);
    };

    if current_select_value(option).as_deref() == Some(desired_value) {
        return Ok(ConfigApplyOutcome::NoChange);
    }

    let response = conn
        .set_session_config_option(acp::SetSessionConfigOptionRequest::new(
            native_session_id.to_string(),
            option.id.to_string(),
            desired_value,
        ))
        .await?;

    startup_state.config_options = response.config_options;

    Ok(ConfigApplyOutcome::AppliedAuthoritative)
}

async fn apply_specific_config_option(
    conn: &acp::ClientSideConnection,
    native_session_id: &str,
    source_agent_kind: &str,
    session_id: &str,
    store: &SessionStore,
    event_sink: &Arc<Mutex<SessionEventSink>>,
    persisted_config_state: &mut PersistedSessionConfigState,
    startup_state: &mut SessionStartupState,
    config_id: &str,
    desired_value: &str,
) -> Result<ConfigApplyState, SetConfigOptionCommandError> {
    let option = find_select_option_for_request(&startup_state.config_options, config_id);
    let is_model_request = is_model_config_request(config_id, option);
    let is_mode_request = is_mode_config_request(config_id, option);
    let tracked_purpose = tracked_config_purpose(config_id, option);

    if option.is_none() && !is_model_request && !is_mode_request {
        return Err(SetConfigOptionCommandError::Rejected(format!(
            "Config option '{config_id}' is not exposed by the active session."
        )));
    }

    if let Some(option) = option {
        if !select_option_contains_value(option, desired_value)
            && !is_model_request
            && !is_mode_request
        {
            return Err(SetConfigOptionCommandError::Rejected(format!(
                "Value '{desired_value}' is not valid for config option '{config_id}'."
            )));
        }
    }

    let outcome = apply_config_option_if_possible(
        conn,
        native_session_id,
        startup_state,
        config_id,
        desired_value,
    )
    .await
    .map_err(|error| {
        SetConfigOptionCommandError::Rejected(format!(
            "Failed to update config option '{config_id}' to '{desired_value}': {error}"
        ))
    })?;
    if outcome == ConfigApplyOutcome::NotApplied {
        if config_request_matches_current_state(startup_state, config_id, desired_value) {
            persist_requested_config_value_if_changed(
                store,
                event_sink,
                session_id,
                persisted_config_state,
                tracked_purpose,
                desired_value,
                chrono::Utc::now().to_rfc3339(),
            )
            .await
            .map_err(|error| SetConfigOptionCommandError::Rejected(error.to_string()))?;
            return Ok(ConfigApplyState::Applied);
        }

        if is_mode_request && !startup_state.legacy_mode_contains_value(desired_value) {
            return Err(SetConfigOptionCommandError::Rejected(format!(
                "Value '{desired_value}' is not valid for config option '{config_id}'."
            )));
        }

        if let Some(option) =
            find_select_option_for_request(&startup_state.config_options, config_id)
        {
            if !select_option_contains_value(option, desired_value) && !is_model_request {
                return Err(SetConfigOptionCommandError::Rejected(format!(
                    "Value '{desired_value}' is not valid for config option '{config_id}'."
                )));
            }
        }

        return Err(SetConfigOptionCommandError::Rejected(format!(
            "Config option '{config_id}' did not apply value '{desired_value}'."
        )));
    }

    persist_requested_config_value_if_changed(
        store,
        event_sink,
        session_id,
        persisted_config_state,
        tracked_purpose,
        desired_value,
        chrono::Utc::now().to_rfc3339(),
    )
    .await
    .map_err(|error| SetConfigOptionCommandError::Rejected(error.to_string()))?;

    if outcome == ConfigApplyOutcome::AppliedAuthoritative {
        emit_live_config_update(
            source_agent_kind,
            session_id,
            store,
            event_sink,
            persisted_config_state,
            startup_state,
            chrono::Utc::now().to_rfc3339(),
        )
        .await
        .map_err(|error| SetConfigOptionCommandError::Rejected(error.to_string()))?;
    }

    Ok(ConfigApplyState::Applied)
}

async fn restore_persisted_live_config_if_needed(
    conn: &acp::ClientSideConnection,
    native_session_id: &str,
    source_agent_kind: &str,
    session_id: &str,
    store: &SessionStore,
    event_sink: &Arc<Mutex<SessionEventSink>>,
    persisted_config_state: &mut PersistedSessionConfigState,
    startup_state: &mut SessionStartupState,
    is_resume: bool,
) -> anyhow::Result<()> {
    if !is_resume || source_agent_kind != "claude" {
        return Ok(());
    }

    let Some(record) = store.find_live_config_snapshot(session_id)? else {
        return Ok(());
    };
    let snapshot = snapshot_from_record(&record)?;
    let desired = persisted_control_values(&snapshot.normalized_controls);
    if desired.is_empty() {
        return Ok(());
    }

    let mut changed = false;
    for (_, config_id, value) in desired {
        if apply_config_option_if_possible(
            conn,
            native_session_id,
            startup_state,
            &config_id,
            &value,
        )
        .await?
            == ConfigApplyOutcome::AppliedAuthoritative
        {
            changed = true;
        }
    }

    if changed {
        emit_live_config_update(
            source_agent_kind,
            session_id,
            store,
            event_sink,
            persisted_config_state,
            startup_state,
            chrono::Utc::now().to_rfc3339(),
        )
        .await?;
    }

    Ok(())
}

async fn apply_config_option_if_possible(
    conn: &acp::ClientSideConnection,
    native_session_id: &str,
    startup_state: &mut SessionStartupState,
    config_id: &str,
    desired_value: &str,
) -> anyhow::Result<ConfigApplyOutcome> {
    let option = find_select_option_for_request(&startup_state.config_options, config_id);
    let is_model_request = is_model_config_request(config_id, option);
    let is_mode_request = is_mode_config_request(config_id, option);

    if option.is_none() && !is_model_request && !is_mode_request {
        return Ok(ConfigApplyOutcome::NotApplied);
    }

    if let Some(option) = option {
        if current_select_value(option).as_deref() == Some(desired_value) {
            return Ok(ConfigApplyOutcome::NoChange);
        }

        if !select_option_contains_value(option, desired_value) && is_model_request {
            return apply_model_via_direct_setter(
                conn,
                native_session_id,
                startup_state,
                desired_value,
            )
            .await;
        }

        if !select_option_contains_value(option, desired_value) && is_mode_request {
            return apply_mode_via_direct_setter_legacy(
                conn,
                native_session_id,
                startup_state,
                desired_value,
            )
            .await;
        }

        if !select_option_contains_value(option, desired_value) {
            return Ok(ConfigApplyOutcome::NotApplied);
        }
    } else if is_model_request {
        return apply_model_via_direct_setter(
            conn,
            native_session_id,
            startup_state,
            desired_value,
        )
        .await;
    } else if is_mode_request {
        return apply_mode_via_direct_setter_legacy(
            conn,
            native_session_id,
            startup_state,
            desired_value,
        )
        .await;
    }

    let response = conn
        .set_session_config_option(acp::SetSessionConfigOptionRequest::new(
            native_session_id.to_string(),
            config_id.to_string(),
            desired_value,
        ))
        .await?;
    startup_state.config_options = response.config_options;
    Ok(ConfigApplyOutcome::AppliedAuthoritative)
}

async fn emit_live_config_update(
    source_agent_kind: &str,
    session_id: &str,
    store: &SessionStore,
    event_sink: &Arc<Mutex<SessionEventSink>>,
    persisted_config_state: &mut PersistedSessionConfigState,
    startup_state: &mut SessionStartupState,
    updated_at: String,
) -> anyhow::Result<()> {
    let next_seq = {
        let sink = event_sink.lock().await;
        sink.next_seq()
    };
    let snapshot = build_live_config_snapshot(
        source_agent_kind,
        &startup_state.config_options,
        startup_state.legacy_mode_state.as_ref(),
        next_seq,
        updated_at.clone(),
    );
    if let Some(model_id) = snapshot
        .normalized_controls
        .model
        .as_ref()
        .and_then(|control| control.current_value.clone())
    {
        startup_state.current_model_id = Some(model_id);
    }
    if let Some(mode_id) = snapshot
        .normalized_controls
        .mode
        .as_ref()
        .and_then(|control| control.current_value.clone())
    {
        startup_state.current_mode_id = Some(mode_id);
    }

    store.upsert_live_config_snapshot(&snapshot_to_record(session_id, &snapshot)?)?;
    persist_current_config_state_from_startup(
        store,
        event_sink,
        session_id,
        persisted_config_state,
        startup_state,
        updated_at.clone(),
    )
    .await?;

    let mut sink = event_sink.lock().await;
    sink.config_option_update(ConfigOptionUpdatePayload {
        live_config: snapshot,
    });
    Ok(())
}

fn queue_pending_config_change(
    store: &SessionStore,
    session_id: &str,
    startup_state: &SessionStartupState,
    config_id: &str,
    value: &str,
) -> Result<(), SetConfigOptionCommandError> {
    let option = find_select_option_for_request(&startup_state.config_options, config_id);
    let is_model_request = is_model_config_request(config_id, option);
    let is_mode_request = is_mode_config_request(config_id, option);

    if option.is_none() && !is_model_request && !is_mode_request {
        return Err(SetConfigOptionCommandError::Rejected(format!(
            "Config option '{config_id}' is not exposed by the active session."
        )));
    }

    if let Some(option) = option {
        if !select_option_contains_value(option, value) && !is_model_request && !is_mode_request {
            return Err(SetConfigOptionCommandError::Rejected(format!(
                "Value '{value}' is not valid for config option '{config_id}'."
            )));
        }
    }

    if is_mode_request && !startup_state.legacy_mode_contains_value(value) {
        return Err(SetConfigOptionCommandError::Rejected(format!(
            "Value '{value}' is not valid for config option '{config_id}'."
        )));
    }

    let queued_at = chrono::Utc::now().to_rfc3339();
    store
        .upsert_pending_config_change(&PendingConfigChangeRecord {
            session_id: session_id.to_string(),
            config_id: config_id.to_string(),
            value: value.to_string(),
            queued_at,
        })
        .map_err(|error| SetConfigOptionCommandError::Rejected(error.to_string()))
}

fn config_request_matches_current_state(
    startup_state: &SessionStartupState,
    config_id: &str,
    desired_value: &str,
) -> bool {
    let option = find_select_option_for_request(&startup_state.config_options, config_id);
    let is_model_request = is_model_config_request(config_id, option);
    let is_mode_request = is_mode_config_request(config_id, option);

    option
        .and_then(current_select_value)
        .as_deref()
        .is_some_and(|current| current == desired_value)
        || (is_model_request && startup_state.current_model_id.as_deref() == Some(desired_value))
        || (is_mode_request && startup_state.current_mode_id.as_deref() == Some(desired_value))
}

async fn handle_edit_pending_prompt(
    store: &SessionStore,
    event_sink: &Arc<Mutex<SessionEventSink>>,
    session_id: &str,
    seq: i64,
    text: String,
) -> Result<(), QueueMutationError> {
    match store.update_pending_prompt_text(session_id, seq, &text) {
        Ok(true) => {
            let mut sink = event_sink.lock().await;
            sink.pending_prompt_updated(PendingPromptUpdatedPayload { seq, text });
            Ok(())
        }
        Ok(false) => Err(QueueMutationError::NotFound),
        Err(error) => {
            tracing::warn!(
                session_id = %session_id,
                seq,
                error = %error,
                "failed to update pending prompt",
            );
            Err(QueueMutationError::NotFound)
        }
    }
}

async fn handle_delete_pending_prompt(
    store: &SessionStore,
    event_sink: &Arc<Mutex<SessionEventSink>>,
    session_id: &str,
    seq: i64,
) -> Result<(), QueueMutationError> {
    match store.delete_pending_prompt(session_id, seq) {
        Ok(true) => {
            let mut sink = event_sink.lock().await;
            sink.pending_prompt_removed(PendingPromptRemovedPayload {
                seq,
                reason: PendingPromptRemovalReason::Deleted,
            });
            Ok(())
        }
        Ok(false) => Err(QueueMutationError::NotFound),
        Err(error) => {
            tracing::warn!(
                session_id = %session_id,
                seq,
                error = %error,
                "failed to delete pending prompt",
            );
            Err(QueueMutationError::NotFound)
        }
    }
}

async fn apply_pending_config_changes_if_idle(
    conn: &acp::ClientSideConnection,
    native_session_id: &str,
    source_agent_kind: &str,
    session_id: &str,
    store: &SessionStore,
    event_sink: &Arc<Mutex<SessionEventSink>>,
    persisted_config_state: &mut PersistedSessionConfigState,
    startup_state: &mut SessionStartupState,
) -> anyhow::Result<()> {
    let mut pending = store.list_pending_config_changes(session_id)?;
    pending.sort_by_key(|change| pending_config_rank(startup_state, &change.config_id));

    for change in pending {
        let result = apply_specific_config_option(
            conn,
            native_session_id,
            source_agent_kind,
            session_id,
            store,
            event_sink,
            persisted_config_state,
            startup_state,
            &change.config_id,
            &change.value,
        )
        .await;

        match result {
            Ok(_) => {
                store.delete_pending_config_change(session_id, &change.config_id)?;
            }
            Err(SetConfigOptionCommandError::Rejected(_)) => {
                store.delete_pending_config_change(session_id, &change.config_id)?;
            }
        }
    }

    Ok(())
}

fn pending_config_rank(startup_state: &SessionStartupState, config_id: &str) -> usize {
    let kind = startup_state
        .config_options
        .iter()
        .find(|option| {
            option.id.to_string() == config_id
                || (config_id == "model" && option_matches_purpose(option, ConfigPurpose::Model))
                || (config_id == LEGACY_MODE_COMPAT_CONFIG_ID
                    && option_matches_purpose(option, ConfigPurpose::Mode))
        })
        .map(|option| {
            let raw = into_raw_pending_option(option);
            if option_matches_key(&raw, NormalizedControlKind::Model) {
                NormalizedControlKind::Model
            } else if option_matches_key(&raw, NormalizedControlKind::CollaborationMode) {
                NormalizedControlKind::CollaborationMode
            } else if option_matches_key(&raw, NormalizedControlKind::Mode) {
                NormalizedControlKind::Mode
            } else if option_matches_key(&raw, NormalizedControlKind::Reasoning) {
                NormalizedControlKind::Reasoning
            } else if option_matches_key(&raw, NormalizedControlKind::Effort) {
                NormalizedControlKind::Effort
            } else if option_matches_key(&raw, NormalizedControlKind::FastMode) {
                NormalizedControlKind::FastMode
            } else {
                NormalizedControlKind::Extra
            }
        })
        .unwrap_or_else(|| {
            if config_id == LEGACY_MODE_COMPAT_CONFIG_ID
                && startup_state.has_raw_or_legacy_mode_control()
            {
                NormalizedControlKind::Mode
            } else {
                NormalizedControlKind::Extra
            }
        });

    normalized_key_rank(kind)
}

fn persisted_control_values(
    controls: &anyharness_contract::v1::NormalizedSessionControls,
) -> Vec<(usize, String, String)> {
    let mut values = Vec::new();
    push_persisted_control(
        &mut values,
        controls.model.as_ref(),
        NormalizedControlKind::Model,
    );
    push_persisted_control(
        &mut values,
        controls.collaboration_mode.as_ref(),
        NormalizedControlKind::CollaborationMode,
    );
    push_persisted_control(
        &mut values,
        controls.mode.as_ref(),
        NormalizedControlKind::Mode,
    );
    push_persisted_control(
        &mut values,
        controls.reasoning.as_ref(),
        NormalizedControlKind::Reasoning,
    );
    push_persisted_control(
        &mut values,
        controls.effort.as_ref(),
        NormalizedControlKind::Effort,
    );
    push_persisted_control(
        &mut values,
        controls.fast_mode.as_ref(),
        NormalizedControlKind::FastMode,
    );
    values.extend(controls.extras.iter().filter_map(|control| {
        control.current_value.as_ref().map(|value| {
            (
                normalized_key_rank(NormalizedControlKind::Extra),
                control.raw_config_id.clone(),
                value.clone(),
            )
        })
    }));
    values.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)));
    values
}

fn push_persisted_control(
    values: &mut Vec<(usize, String, String)>,
    control: Option<&NormalizedSessionControl>,
    kind: NormalizedControlKind,
) {
    let Some(control) = control else {
        return;
    };
    let Some(current_value) = control.current_value.as_ref() else {
        return;
    };

    values.push((
        normalized_key_rank(kind),
        control.raw_config_id.clone(),
        current_value.clone(),
    ));
}

fn into_raw_pending_option(
    option: &acp::SessionConfigOption,
) -> anyharness_contract::v1::RawSessionConfigOption {
    let acp::SessionConfigKind::Select(select) = &option.kind else {
        return anyharness_contract::v1::RawSessionConfigOption {
            id: option.id.to_string(),
            name: option.name.clone(),
            description: option.description.clone(),
            category: option.category.as_ref().map(|category| {
                serde_json::to_string(category)
                    .unwrap_or_default()
                    .trim_matches('"')
                    .to_string()
            }),
            option_type: anyharness_contract::v1::SessionConfigOptionType::Select,
            current_value: String::new(),
            options: Vec::new(),
        };
    };

    let options = match &select.options {
        acp::SessionConfigSelectOptions::Ungrouped(values) => values
            .iter()
            .map(|value| anyharness_contract::v1::RawSessionConfigValue {
                value: value.value.to_string(),
                name: value.name.clone(),
                description: value.description.clone(),
            })
            .collect(),
        acp::SessionConfigSelectOptions::Grouped(groups) => groups
            .iter()
            .flat_map(|group| {
                group
                    .options
                    .iter()
                    .map(|value| anyharness_contract::v1::RawSessionConfigValue {
                        value: value.value.to_string(),
                        name: value.name.clone(),
                        description: value.description.clone(),
                    })
            })
            .collect(),
        _ => Vec::new(),
    };

    anyharness_contract::v1::RawSessionConfigOption {
        id: option.id.to_string(),
        name: option.name.clone(),
        description: option.description.clone(),
        category: option.category.as_ref().map(|category| {
            serde_json::to_string(category)
                .unwrap_or_default()
                .trim_matches('"')
                .to_string()
        }),
        option_type: anyharness_contract::v1::SessionConfigOptionType::Select,
        current_value: select.current_value.to_string(),
        options,
    }
}

fn find_select_option_for_value<'a>(
    config_options: &'a [acp::SessionConfigOption],
    purpose: ConfigPurpose,
    desired_value: &str,
) -> Option<&'a acp::SessionConfigOption> {
    config_options.iter().find(|option| {
        matches!(&option.kind, acp::SessionConfigKind::Select(_))
            && option_matches_purpose(option, purpose)
            && select_option_contains_value(option, desired_value)
    })
}

fn option_matches_purpose(option: &acp::SessionConfigOption, purpose: ConfigPurpose) -> bool {
    let raw = into_raw_pending_option(option);
    match purpose {
        ConfigPurpose::Model => option_matches_key(&raw, NormalizedControlKind::Model),
        ConfigPurpose::Mode => option_matches_key(&raw, NormalizedControlKind::Mode),
    }
}

fn find_select_option_by_purpose<'a>(
    config_options: &'a [acp::SessionConfigOption],
    purpose: ConfigPurpose,
) -> Option<&'a acp::SessionConfigOption> {
    config_options.iter().find(|option| {
        matches!(&option.kind, acp::SessionConfigKind::Select(_))
            && option_matches_purpose(option, purpose)
    })
}

fn find_select_option_for_request<'a>(
    config_options: &'a [acp::SessionConfigOption],
    config_id: &str,
) -> Option<&'a acp::SessionConfigOption> {
    config_options
        .iter()
        .find(|option| option.id.to_string() == config_id)
        .or_else(|| {
            if config_id == "model" {
                find_select_option_by_purpose(config_options, ConfigPurpose::Model)
            } else if config_id == LEGACY_MODE_COMPAT_CONFIG_ID {
                find_select_option_by_purpose(config_options, ConfigPurpose::Mode)
            } else {
                None
            }
        })
}

fn is_model_config_request(config_id: &str, option: Option<&acp::SessionConfigOption>) -> bool {
    config_id == "model"
        || option
            .map(|option| option_matches_purpose(option, ConfigPurpose::Model))
            .unwrap_or(false)
}

fn is_mode_config_request(config_id: &str, option: Option<&acp::SessionConfigOption>) -> bool {
    config_id == LEGACY_MODE_COMPAT_CONFIG_ID
        || option
            .map(|option| option_matches_purpose(option, ConfigPurpose::Mode))
            .unwrap_or(false)
}

async fn apply_model_via_direct_setter(
    conn: &acp::ClientSideConnection,
    native_session_id: &str,
    startup_state: &mut SessionStartupState,
    desired_model_id: &str,
) -> anyhow::Result<ConfigApplyOutcome> {
    if startup_state.current_model_id.as_deref() == Some(desired_model_id) {
        return Ok(ConfigApplyOutcome::NoChange);
    }

    conn.set_session_model(acp::SetSessionModelRequest::new(
        native_session_id.to_string(),
        desired_model_id.to_string(),
    ))
    .await?;

    Ok(ConfigApplyOutcome::RequestedOnly)
}

async fn apply_mode_via_direct_setter_legacy(
    conn: &acp::ClientSideConnection,
    native_session_id: &str,
    startup_state: &mut SessionStartupState,
    desired_mode_id: &str,
) -> anyhow::Result<ConfigApplyOutcome> {
    if startup_state.current_mode_id.as_deref() == Some(desired_mode_id) {
        return Ok(ConfigApplyOutcome::NoChange);
    }

    if !startup_state.legacy_mode_contains_value(desired_mode_id) {
        return Ok(ConfigApplyOutcome::NotApplied);
    }

    conn.set_session_mode(acp::SetSessionModeRequest::new(
        native_session_id.to_string(),
        desired_mode_id.to_string(),
    ))
    .await?;

    startup_state.set_current_mode_id(desired_mode_id.to_string());
    set_select_option_current_value_for_purpose(
        &mut startup_state.config_options,
        ConfigPurpose::Mode,
        desired_mode_id,
    );

    Ok(ConfigApplyOutcome::AppliedAuthoritative)
}

fn set_select_option_current_value_for_purpose(
    config_options: &mut [acp::SessionConfigOption],
    purpose: ConfigPurpose,
    desired_value: &str,
) -> bool {
    let Some(option) = config_options
        .iter_mut()
        .find(|option| option_matches_purpose(option, purpose))
    else {
        return false;
    };

    let acp::SessionConfigKind::Select(select) = &mut option.kind else {
        return false;
    };

    select.current_value = desired_value.to_string().into();
    true
}

fn should_try_direct_claude_model_setter(
    source_agent_kind: &str,
    desired_model_id: &str,
    available_model_ids: &[String],
) -> bool {
    source_agent_kind == "claude"
        && is_curated_claude_model_id(desired_model_id)
        && !available_model_ids.iter().any(|id| id == desired_model_id)
}

fn is_curated_claude_model_id(model_id: &str) -> bool {
    matches!(
        model_id,
        "default" | "sonnet" | "sonnet[1m]" | "haiku" | "opus"
    )
}

fn current_select_value(option: &acp::SessionConfigOption) -> Option<String> {
    match &option.kind {
        acp::SessionConfigKind::Select(select) => Some(select.current_value.to_string()),
        _ => None,
    }
}

fn select_option_contains_value(option: &acp::SessionConfigOption, desired_value: &str) -> bool {
    match &option.kind {
        acp::SessionConfigKind::Select(select) => match &select.options {
            acp::SessionConfigSelectOptions::Ungrouped(options) => options
                .iter()
                .any(|candidate| candidate.value.to_string() == desired_value),
            acp::SessionConfigSelectOptions::Grouped(groups) => groups.iter().any(|group| {
                group
                    .options
                    .iter()
                    .any(|candidate| candidate.value.to_string() == desired_value)
            }),
            _ => false,
        },
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::path::PathBuf;
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    use super::{
        build_system_prompt_meta, classify_agent_stderr_line, finalize_established_actor_exit,
        find_select_option_for_request, handle_notification,
        handle_notification_with_resume_replay_filter, is_missing_load_session_resource,
        is_mode_config_request, is_model_config_request, merge_spawn_env, normalized_key_rank,
        pending_config_rank, persisted_control_values, sanitize_agent_stderr_line, serialize_meta,
        should_try_direct_claude_model_setter, tracked_config_purpose, ActorExitDisposition,
        AgentStderrSeverity, LiveSessionExecutionSnapshot, LiveSessionHandle,
        PersistedSessionConfigState, ResumeReplayFilter, SessionCommand, SessionStartupState,
        IDLE_RESUME_REPLAY_QUIET_WINDOW,
    };
    use crate::acp::background_work::{BackgroundWorkOptions, BackgroundWorkRegistry};
    use crate::acp::event_sink::SessionEventSink;
    use crate::persistence::Db;
    use crate::sessions::live_config::NormalizedControlKind;
    use crate::sessions::{model::SessionRecord, store::SessionStore};
    use agent_client_protocol as acp;
    use anyharness_contract::v1::{
        NormalizedSessionControl, NormalizedSessionControlValue, NormalizedSessionControls,
        PendingApprovalSummary, SessionEventEnvelope, SessionExecutionPhase,
    };
    use tokio::sync::{broadcast, mpsc, Mutex, RwLock};

    #[test]
    fn sanitize_agent_stderr_line_strips_ansi_sequences() {
        let line = "\u{1b}[2m2026-03-28T03:11:55.593240Z\u{1b}[0m \u{1b}[32m INFO\u{1b}[0m codex_otel.log_only";

        assert_eq!(
            sanitize_agent_stderr_line(line),
            "2026-03-28T03:11:55.593240Z  INFO codex_otel.log_only"
        );
    }

    #[test]
    fn classify_agent_stderr_line_downgrades_info_logs() {
        let line = "2026-03-28T03:11:55.593240Z INFO codex_otel.log_only";

        assert_eq!(classify_agent_stderr_line(line), AgentStderrSeverity::Debug);
    }

    #[test]
    fn classify_agent_stderr_line_preserves_warnings() {
        let line = "2026-03-28T03:11:55.593240Z WARN auth refresh failed";

        assert_eq!(classify_agent_stderr_line(line), AgentStderrSeverity::Warn);
    }

    #[test]
    fn classify_agent_stderr_line_preserves_errors() {
        let line = "2026-03-28T03:11:55.593240Z ERROR session crashed";

        assert_eq!(classify_agent_stderr_line(line), AgentStderrSeverity::Error);
    }

    #[test]
    fn classify_agent_stderr_line_keeps_unknown_stderr_visible() {
        let line = "fatal: failed to resolve workspace";

        assert_eq!(classify_agent_stderr_line(line), AgentStderrSeverity::Warn);
    }

    #[tokio::test]
    async fn handle_notification_persists_raw_acp_notifications() {
        let db = Db::open_in_memory().expect("open db");
        db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO workspaces (id, kind, path, source_repo_root_path, created_at, updated_at)
                 VALUES (?1, 'repo', '/tmp/workspace', '/tmp/workspace', ?2, ?2)",
                rusqlite::params!["workspace-1", "2026-03-25T00:00:00Z"],
            )?;
            Ok(())
        })
        .expect("seed workspace");

        let store = SessionStore::new(db.clone());
        store
            .insert(&SessionRecord {
                id: "session-1".to_string(),
                workspace_id: "workspace-1".to_string(),
                agent_kind: "claude".to_string(),
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
            })
            .expect("insert session");

        let (event_tx, _) = broadcast::channel(16);
        let event_sink = Arc::new(Mutex::new(SessionEventSink::new(
            "session-1".to_string(),
            "claude".to_string(),
            PathBuf::from("/tmp/workspace"),
            event_tx,
            store.clone(),
        )));
        let mut startup_state = SessionStartupState {
            current_mode_id: None,
            legacy_mode_state: None,
            config_options: vec![],
            current_model_id: None,
            available_model_ids: vec![],
        };
        let mut persisted_config_state = PersistedSessionConfigState {
            requested_model_id: None,
            current_model_id: None,
            requested_mode_id: None,
            current_mode_id: None,
        };
        let mut background_work_registry = test_background_work_registry(&store);

        let notif = acp::SessionNotification::new(
            "native-1",
            acp::SessionUpdate::AgentMessageChunk(acp::ContentChunk::new("hello".into())),
        );

        handle_notification(
            &notif,
            &event_sink,
            &mut background_work_registry,
            &store,
            "session-1",
            "claude",
            &mut persisted_config_state,
            &mut startup_state,
        )
        .await;

        let raw = store
            .list_raw_notifications("session-1")
            .expect("list raw notifications");
        assert_eq!(raw.len(), 1);
        assert_eq!(raw[0].seq, 1);
        assert_eq!(raw[0].notification_kind, "agent_message_chunk");

        let payload: serde_json::Value =
            serde_json::from_str(&raw[0].payload_json).expect("deserialize raw payload");
        assert_eq!(payload["sessionId"], "native-1");
        assert_eq!(payload["update"]["sessionUpdate"], "agent_message_chunk");
    }

    #[test]
    fn resume_replay_filter_suppresses_after_user_echo_until_quiet_gap() {
        let mut filter = ResumeReplayFilter::new("claude", true, "idle");
        let base = Instant::now();

        let user_echo = acp::SessionNotification::new(
            "native-1",
            acp::SessionUpdate::UserMessageChunk(acp::ContentChunk::new("older prompt".into())),
        );
        let replay_assistant = acp::SessionNotification::new(
            "native-1",
            acp::SessionUpdate::AgentMessageChunk(acp::ContentChunk::new("older answer".into())),
        );
        let available_commands = acp::SessionNotification::new(
            "native-1",
            acp::SessionUpdate::AvailableCommandsUpdate(acp::AvailableCommandsUpdate::new(vec![])),
        );
        let fresh_assistant = acp::SessionNotification::new(
            "native-1",
            acp::SessionUpdate::AgentMessageChunk(acp::ContentChunk::new("fresh answer".into())),
        );

        assert!(filter.should_suppress(&user_echo, base));
        assert!(filter.should_suppress(&replay_assistant, base + Duration::from_millis(10)));
        assert!(!filter.should_suppress(&available_commands, base + Duration::from_millis(20)));
        assert!(!filter.should_suppress(
            &fresh_assistant,
            base + IDLE_RESUME_REPLAY_QUIET_WINDOW + Duration::from_millis(10),
        ));
    }

    #[test]
    fn resume_replay_filter_ignores_non_resume_agent_chunks() {
        let mut filter = ResumeReplayFilter::new("claude", false, "idle");
        let base = Instant::now();
        let assistant = acp::SessionNotification::new(
            "native-1",
            acp::SessionUpdate::AgentMessageChunk(acp::ContentChunk::new("fresh answer".into())),
        );

        assert!(!filter.should_suppress(&assistant, base));
    }

    #[tokio::test]
    async fn replay_filter_keeps_raw_notifications_but_skips_normalized_transcript_events() {
        let db = Db::open_in_memory().expect("open db");
        db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO workspaces (id, kind, path, source_repo_root_path, created_at, updated_at)
                 VALUES (?1, 'repo', '/tmp/workspace', '/tmp/workspace', ?2, ?2)",
                rusqlite::params!["workspace-1", "2026-03-25T00:00:00Z"],
            )?;
            Ok(())
        })
        .expect("seed workspace");

        let store = SessionStore::new(db.clone());
        store
            .insert(&SessionRecord {
                id: "session-1".to_string(),
                workspace_id: "workspace-1".to_string(),
                agent_kind: "claude".to_string(),
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
            })
            .expect("insert session");

        let (event_tx, _) = broadcast::channel(16);
        let event_sink = Arc::new(Mutex::new(SessionEventSink::new(
            "session-1".to_string(),
            "claude".to_string(),
            PathBuf::from("/tmp/workspace"),
            event_tx,
            store.clone(),
        )));
        let mut startup_state = SessionStartupState {
            current_mode_id: None,
            legacy_mode_state: None,
            config_options: vec![],
            current_model_id: None,
            available_model_ids: vec![],
        };
        let mut persisted_config_state = PersistedSessionConfigState {
            requested_model_id: None,
            current_model_id: None,
            requested_mode_id: None,
            current_mode_id: None,
        };
        let mut replay_filter = ResumeReplayFilter::new("claude", true, "idle");
        let mut background_work_registry = test_background_work_registry(&store);

        let replay_user = acp::SessionNotification::new(
            "native-1",
            acp::SessionUpdate::UserMessageChunk(acp::ContentChunk::new("older prompt".into())),
        );
        handle_notification_with_resume_replay_filter(
            &replay_user,
            &mut replay_filter,
            &event_sink,
            &mut background_work_registry,
            &store,
            "session-1",
            "claude",
            &mut persisted_config_state,
            &mut startup_state,
        )
        .await;

        assert_eq!(
            store
                .list_raw_notifications("session-1")
                .expect("raw")
                .len(),
            1
        );
        assert!(store.list_events("session-1").expect("events").is_empty());

        let available_commands = acp::SessionNotification::new(
            "native-1",
            acp::SessionUpdate::AvailableCommandsUpdate(acp::AvailableCommandsUpdate::new(vec![])),
        );
        handle_notification_with_resume_replay_filter(
            &available_commands,
            &mut replay_filter,
            &event_sink,
            &mut background_work_registry,
            &store,
            "session-1",
            "claude",
            &mut persisted_config_state,
            &mut startup_state,
        )
        .await;

        let raw = store
            .list_raw_notifications("session-1")
            .expect("raw after passthrough");
        let events = store
            .list_events("session-1")
            .expect("events after passthrough");
        assert_eq!(raw.len(), 2);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, "available_commands_update");
    }

    #[tokio::test]
    async fn finalize_error_exit_cancels_pending_permission_and_marks_session_errored() {
        let (store, event_sink, handle) = actor_exit_test_context(Some(PendingApprovalSummary {
            request_id: "perm-1".to_string(),
            title: "Run command".to_string(),
            tool_call_id: Some("tool-1".to_string()),
            tool_kind: Some("execute".to_string()),
        }));

        finalize_established_actor_exit(
            &handle,
            &event_sink,
            &store,
            "session-1",
            ActorExitDisposition::Error {
                message: "server shut down unexpectedly".to_string(),
                code: None,
            },
        )
        .await;

        let events = store.list_events("session-1").expect("list events");
        let event_types = events
            .iter()
            .map(|event| event.event_type.as_str())
            .collect::<Vec<_>>();
        assert_eq!(
            event_types,
            vec!["permission_resolved", "error", "session_ended"]
        );

        let payload: serde_json::Value =
            serde_json::from_str(&events[0].payload_json).expect("deserialize permission resolved");
        assert_eq!(payload["requestId"], "perm-1");
        assert_eq!(payload["outcome"]["outcome"], "cancelled");

        let snapshot = handle.execution_snapshot().await;
        assert_eq!(snapshot.phase, SessionExecutionPhase::Errored);
        assert!(snapshot.pending_approval.is_none());

        let record = store
            .find_by_id("session-1")
            .expect("fetch session")
            .expect("session exists");
        assert_eq!(record.status, "errored");
    }

    #[tokio::test]
    async fn finalize_close_exit_cancels_pending_permission_and_emits_closed_event() {
        let (store, event_sink, handle) = actor_exit_test_context(Some(PendingApprovalSummary {
            request_id: "perm-1".to_string(),
            title: "Run command".to_string(),
            tool_call_id: Some("tool-1".to_string()),
            tool_kind: Some("execute".to_string()),
        }));

        finalize_established_actor_exit(
            &handle,
            &event_sink,
            &store,
            "session-1",
            ActorExitDisposition::Close,
        )
        .await;

        let events = store.list_events("session-1").expect("list events");
        let event_types = events
            .iter()
            .map(|event| event.event_type.as_str())
            .collect::<Vec<_>>();
        assert_eq!(event_types, vec!["permission_resolved", "session_ended"]);

        let snapshot = handle.execution_snapshot().await;
        assert_eq!(snapshot.phase, SessionExecutionPhase::Closed);
        assert!(snapshot.pending_approval.is_none());

        let record = store
            .find_by_id("session-1")
            .expect("fetch session")
            .expect("session exists");
        assert_eq!(record.status, "idle");
    }

    #[tokio::test]
    async fn finalize_dismiss_exit_cancels_pending_permission_without_terminal_event() {
        let (store, event_sink, handle) = actor_exit_test_context(Some(PendingApprovalSummary {
            request_id: "perm-1".to_string(),
            title: "Run command".to_string(),
            tool_call_id: Some("tool-1".to_string()),
            tool_kind: Some("execute".to_string()),
        }));

        finalize_established_actor_exit(
            &handle,
            &event_sink,
            &store,
            "session-1",
            ActorExitDisposition::Dismiss,
        )
        .await;

        let events = store.list_events("session-1").expect("list events");
        let event_types = events
            .iter()
            .map(|event| event.event_type.as_str())
            .collect::<Vec<_>>();
        assert_eq!(event_types, vec!["permission_resolved"]);

        let snapshot = handle.execution_snapshot().await;
        assert_eq!(snapshot.phase, SessionExecutionPhase::Idle);
        assert!(snapshot.pending_approval.is_none());
    }

    #[tokio::test]
    async fn finalize_exit_without_pending_permission_skips_permission_resolved_event() {
        let (store, event_sink, handle) = actor_exit_test_context(None);

        finalize_established_actor_exit(
            &handle,
            &event_sink,
            &store,
            "session-1",
            ActorExitDisposition::Error {
                message: "server shut down unexpectedly".to_string(),
                code: None,
            },
        )
        .await;

        let event_types = store
            .list_events("session-1")
            .expect("list events")
            .into_iter()
            .map(|event| event.event_type)
            .collect::<Vec<_>>();
        assert_eq!(event_types, vec!["error", "session_ended"]);
    }

    #[test]
    fn merge_spawn_env_prefers_session_launch_over_workspace_env() {
        let workspace_env = BTreeMap::from([
            (
                "CLAUDE_CODE_EXECUTABLE".to_string(),
                "/workspace/bin/claude".to_string(),
            ),
            ("PATH".to_string(), "/usr/bin".to_string()),
        ]);
        let session_launch_env = BTreeMap::from([(
            "CLAUDE_CODE_EXECUTABLE".to_string(),
            "/managed/bin/claude".to_string(),
        )]);

        let merged = merge_spawn_env(&workspace_env, &session_launch_env, None);

        assert_eq!(
            merged.get("CLAUDE_CODE_EXECUTABLE").map(String::as_str),
            Some("/managed/bin/claude")
        );
        assert_eq!(merged.get("PATH").map(String::as_str), Some("/usr/bin"));
    }

    #[test]
    fn merge_spawn_env_prefers_explicit_override_env_over_session_env() {
        let workspace_env = BTreeMap::from([("PATH".to_string(), "/usr/bin".to_string())]);
        let session_launch_env = BTreeMap::from([("DEBUG".to_string(), "0".to_string())]);
        let override_env = std::collections::HashMap::from([
            ("DEBUG".to_string(), "1".to_string()),
            ("FOO".to_string(), "bar".to_string()),
        ]);

        let merged = merge_spawn_env(&workspace_env, &session_launch_env, Some(&override_env));

        assert_eq!(merged.get("PATH").map(String::as_str), Some("/usr/bin"));
        assert_eq!(merged.get("DEBUG").map(String::as_str), Some("1"));
        assert_eq!(merged.get("FOO").map(String::as_str), Some("bar"));
    }

    #[test]
    fn persisted_control_values_orders_standard_controls_before_extras() {
        let controls = NormalizedSessionControls {
            model: Some(NormalizedSessionControl {
                key: "model".into(),
                raw_config_id: "model".into(),
                label: "Model".into(),
                current_value: Some("default".into()),
                settable: true,
                values: vec![NormalizedSessionControlValue {
                    value: "default".into(),
                    label: "Default".into(),
                    description: None,
                }],
            }),
            collaboration_mode: Some(NormalizedSessionControl {
                key: "collaboration_mode".into(),
                raw_config_id: "collaboration_mode".into(),
                label: "Mode".into(),
                current_value: Some("plan".into()),
                settable: true,
                values: vec![],
            }),
            mode: Some(NormalizedSessionControl {
                key: "mode".into(),
                raw_config_id: "mode".into(),
                label: "Mode".into(),
                current_value: Some("default".into()),
                settable: true,
                values: vec![],
            }),
            reasoning: Some(NormalizedSessionControl {
                key: "reasoning".into(),
                raw_config_id: "thinking".into(),
                label: "Thinking".into(),
                current_value: Some("off".into()),
                settable: true,
                values: vec![],
            }),
            effort: Some(NormalizedSessionControl {
                key: "effort".into(),
                raw_config_id: "effort".into(),
                label: "Effort".into(),
                current_value: Some("max".into()),
                settable: true,
                values: vec![],
            }),
            fast_mode: Some(NormalizedSessionControl {
                key: "fast_mode".into(),
                raw_config_id: "fast_mode".into(),
                label: "Fast Mode".into(),
                current_value: Some("on".into()),
                settable: true,
                values: vec![],
            }),
            extras: vec![NormalizedSessionControl {
                key: "extra:foo".into(),
                raw_config_id: "foo".into(),
                label: "Foo".into(),
                current_value: Some("bar".into()),
                settable: true,
                values: vec![],
            }],
        };

        let values = persisted_control_values(&controls);
        let ids = values
            .into_iter()
            .map(|(_, config_id, value)| format!("{config_id}={value}"))
            .collect::<Vec<_>>();

        assert_eq!(
            ids,
            vec![
                "model=default",
                "collaboration_mode=plan",
                "thinking=off",
                "effort=max",
                "fast_mode=on",
                "mode=default",
                "foo=bar",
            ]
        );
    }

    #[test]
    fn pending_config_rank_keeps_collaboration_mode_in_standard_order() {
        let mut collaboration_mode = acp::SessionConfigOption::select(
            "collaboration_mode",
            "Mode",
            "plan",
            vec![
                acp::SessionConfigSelectOption::new("default", "Default"),
                acp::SessionConfigSelectOption::new("plan", "Plan"),
            ],
        );
        collaboration_mode.category = Some(acp::SessionConfigOptionCategory::Other(
            "collaboration_mode".into(),
        ));

        let startup_state = SessionStartupState {
            current_mode_id: None,
            legacy_mode_state: None,
            config_options: vec![collaboration_mode],
            current_model_id: None,
            available_model_ids: Vec::new(),
        };

        assert_eq!(
            pending_config_rank(&startup_state, "collaboration_mode"),
            normalized_key_rank(NormalizedControlKind::CollaborationMode)
        );
    }

    #[test]
    fn direct_claude_model_setter_supports_curated_aliases_missing_from_live_options() {
        let available = vec![
            "default".to_string(),
            "sonnet".to_string(),
            "sonnet[1m]".to_string(),
            "haiku".to_string(),
        ];

        assert!(should_try_direct_claude_model_setter(
            "claude", "opus", &available
        ));
        assert!(!should_try_direct_claude_model_setter(
            "claude", "sonnet", &available
        ));
        assert!(!should_try_direct_claude_model_setter(
            "codex", "opus", &available
        ));
    }

    #[test]
    fn generic_model_request_can_resolve_model_option_by_purpose() {
        let mut option = acp::SessionConfigOption::select(
            "provider_model",
            "Model",
            "sonnet",
            vec![
                acp::SessionConfigSelectOption::new("sonnet", "Sonnet"),
                acp::SessionConfigSelectOption::new("haiku", "Haiku"),
            ],
        );
        option.category = Some(acp::SessionConfigOptionCategory::Model);

        let options = [option];
        let resolved = find_select_option_for_request(&options, "model");

        assert!(resolved.is_some());
        assert!(is_model_config_request("model", resolved));
    }

    #[test]
    fn generic_mode_request_can_resolve_mode_option_by_purpose() {
        let mut option = acp::SessionConfigOption::select(
            "approval_mode",
            "Mode",
            "ask",
            vec![
                acp::SessionConfigSelectOption::new("ask", "Ask"),
                acp::SessionConfigSelectOption::new("code", "Code"),
            ],
        );
        option.category = Some(acp::SessionConfigOptionCategory::Mode);

        let options = [option];
        let resolved = find_select_option_for_request(&options, "mode");

        assert!(resolved.is_some());
        assert!(is_mode_config_request("mode", resolved));
    }

    #[test]
    fn fast_mode_option_is_not_treated_as_mode_request() {
        let mut option = acp::SessionConfigOption::select(
            "fast_mode",
            "Fast Mode",
            "off",
            vec![
                acp::SessionConfigSelectOption::new("off", "Off"),
                acp::SessionConfigSelectOption::new("on", "On"),
            ],
        );
        option.category = Some(acp::SessionConfigOptionCategory::Other("fast_mode".into()));

        let options = [option];
        let resolved = find_select_option_for_request(&options, "fast_mode");

        assert!(resolved.is_some());
        assert!(!is_mode_config_request("fast_mode", resolved));
        assert_eq!(tracked_config_purpose("fast_mode", resolved), None);
        assert!(find_select_option_for_request(&options, "mode").is_none());
    }

    #[test]
    fn collaboration_mode_option_is_not_treated_as_mode_request() {
        let mut option = acp::SessionConfigOption::select(
            "collaboration_mode",
            "Collaboration Mode",
            "plan",
            vec![
                acp::SessionConfigSelectOption::new("default", "Default"),
                acp::SessionConfigSelectOption::new("plan", "Plan"),
            ],
        );
        option.category = Some(acp::SessionConfigOptionCategory::Other(
            "collaboration_mode".into(),
        ));

        let options = [option];
        let resolved = find_select_option_for_request(&options, "collaboration_mode");

        assert!(resolved.is_some());
        assert!(!is_mode_config_request("collaboration_mode", resolved));
        assert_eq!(tracked_config_purpose("collaboration_mode", resolved), None);
        assert!(find_select_option_for_request(&options, "mode").is_none());
    }

    #[test]
    fn build_system_prompt_meta_uses_append_shape() {
        let meta = build_system_prompt_meta(Some("Rename the branch")).expect("meta");

        assert_eq!(
            serialize_meta(Some(&meta)),
            Some(serde_json::json!({
                "systemPrompt": {
                    "append": "Rename the branch",
                },
            }))
        );
    }

    #[test]
    fn build_system_prompt_meta_skips_blank_values() {
        assert!(build_system_prompt_meta(None).is_none());
        assert!(build_system_prompt_meta(Some("   ")).is_none());
    }

    #[test]
    fn missing_load_session_resource_matches_expected_uri() {
        let error = acp::Error::resource_not_found(Some("session-123".to_string()));
        assert!(is_missing_load_session_resource(&error, "session-123"));
        assert!(!is_missing_load_session_resource(&error, "session-xyz"));
    }

    #[test]
    fn missing_load_session_resource_without_uri_still_matches() {
        let error = acp::Error::resource_not_found(None);
        assert!(is_missing_load_session_resource(&error, "session-123"));
    }

    #[test]
    fn missing_load_session_resource_ignores_other_error_codes() {
        let error = acp::Error::internal_error().data(serde_json::json!({
            "uri": "session-123",
        }));
        assert!(!is_missing_load_session_resource(&error, "session-123"));
    }

    fn actor_exit_test_context(
        pending_approval: Option<PendingApprovalSummary>,
    ) -> (
        SessionStore,
        Arc<Mutex<SessionEventSink>>,
        Arc<LiveSessionHandle>,
    ) {
        let db = Db::open_in_memory().expect("open db");
        db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO workspaces (id, kind, path, source_repo_root_path, created_at, updated_at)
                 VALUES (?1, 'repo', '/tmp/workspace', '/tmp/workspace', ?2, ?2)",
                rusqlite::params!["workspace-1", "2026-03-25T00:00:00Z"],
            )?;
            Ok(())
        })
        .expect("seed workspace");

        let store = SessionStore::new(db.clone());
        store
            .insert(&SessionRecord {
                id: "session-1".to_string(),
                workspace_id: "workspace-1".to_string(),
                agent_kind: "claude".to_string(),
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
            })
            .expect("insert session");

        let (command_tx, _command_rx) = mpsc::channel::<SessionCommand>(4);
        let (event_tx, _) = broadcast::channel::<SessionEventEnvelope>(16);
        let mut execution =
            LiveSessionExecutionSnapshot::new(SessionExecutionPhase::AwaitingPermission);
        execution.pending_approval = pending_approval;

        let handle = Arc::new(LiveSessionHandle {
            session_id: "session-1".to_string(),
            command_tx,
            event_tx: event_tx.clone(),
            busy: Arc::new(AtomicBool::new(false)),
            execution: Arc::new(RwLock::new(execution)),
        });

        let event_sink = Arc::new(Mutex::new(SessionEventSink::new(
            "session-1".to_string(),
            "claude".to_string(),
            PathBuf::from("/tmp/workspace"),
            event_tx,
            store.clone(),
        )));

        (store, event_sink, handle)
    }

    fn test_background_work_registry(store: &SessionStore) -> BackgroundWorkRegistry {
        let (updates_tx, _updates_rx) = mpsc::unbounded_channel();
        BackgroundWorkRegistry::new(
            "session-1".to_string(),
            "claude".to_string(),
            store.clone(),
            updates_tx,
            BackgroundWorkOptions::default(),
        )
    }
}
