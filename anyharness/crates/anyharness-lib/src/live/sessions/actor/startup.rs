use std::sync::Arc;
use std::time::Instant;

use agent_client_protocol as acp;
use anyharness_contract::v1::{SessionActionCapabilities, SessionExecutionPhase};
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};

use crate::acp::background_work::{
    BackgroundWorkOptions, BackgroundWorkRegistry, BackgroundWorkUpdate,
};
use crate::acp::event_sink::SessionEventSink;
use crate::acp::runtime_client::RuntimeClient;
use crate::live::sessions::actor::command::SessionCommand;
use crate::live::sessions::actor::config::apply::restore_persisted_live_config_if_needed;
use crate::live::sessions::actor::config::handle::apply_requested_session_preferences;
use crate::live::sessions::actor::config::persist::{
    emit_live_config_update, emit_startup_state, load_startup_restore_snapshot,
};
use crate::live::sessions::actor::config::types::PersistedSessionConfigState;
use crate::live::sessions::actor::notifications::replay_filter::ResumeReplayFilter;
use crate::live::sessions::actor::state::{SessionActorConfig, SessionStartupState};
use crate::live::sessions::connection::native_session::{
    has_anyharness_targeted_fork_extension, start_native_session,
};
use crate::live::sessions::connection::process::spawn_agent_process;
use crate::live::sessions::connection::start::initialize_connection;
use crate::live::sessions::connection::types::NativeSessionStartupDisposition;
use crate::live::sessions::handle::LiveSessionHandle;
use crate::observability::latency::latency_trace_fields;
use crate::sessions::model::serialize_action_capabilities;
use crate::sessions::prompt::capabilities_from_acp;
use crate::sessions::store::SessionStore;

pub(in crate::live::sessions::actor) struct StartedActor {
    pub child: tokio::process::Child,
    pub conn: acp::ClientSideConnection,
    pub notification_rx: mpsc::UnboundedReceiver<acp::SessionNotification>,
    pub background_work_rx: mpsc::UnboundedReceiver<BackgroundWorkUpdate>,
    pub background_work_registry: BackgroundWorkRegistry,
    pub event_sink: Arc<Mutex<SessionEventSink>>,
    pub native_session_id: String,
    pub startup_state: SessionStartupState,
    pub persisted_config_state: PersistedSessionConfigState,
    pub action_capabilities: SessionActionCapabilities,
    pub supports_native_close: bool,
    pub resume_replay_filter: ResumeReplayFilter,
}

pub(in crate::live::sessions::actor) async fn start_actor(
    config: &SessionActorConfig,
    ready_tx: std::sync::mpsc::Sender<anyhow::Result<String>>,
    handle: &Arc<LiveSessionHandle>,
) -> anyhow::Result<StartedActor> {
    let session_id = config.session.id.clone();
    let source_agent_kind = config.session.agent_kind.clone();
    let workspace_id = config.session.workspace_id.clone();
    let startup_strategy = config.startup_strategy.clone();
    let startup_strategy_label = startup_strategy.as_str();
    let actor_latency = config.latency.clone();
    let actor_latency_fields = latency_trace_fields(actor_latency.as_ref());
    let startup_started = Instant::now();

    let spawned = spawn_agent_process(
        &config.agent,
        &config.workspace_path,
        &config.workspace_env,
        &config.session_launch_env,
        &config.agent_auth_env,
        &config.protected_agent_auth_env,
        &session_id,
        &workspace_id,
        &source_agent_kind,
        actor_latency.as_ref(),
        &ready_tx,
    )?;
    let child = spawned.child;
    let stdin = spawned.stdin;
    let stdout = spawned.stdout;

    let (notification_tx, notification_rx) = mpsc::unbounded_channel::<acp::SessionNotification>();
    let store = config.session_store.clone();

    let event_sink = Arc::new(Mutex::new(if startup_strategy.resumes_durable_history() {
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
    let (background_work_tx, background_work_rx) =
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
        config.interaction_broker.clone(),
        event_sink.clone(),
        handle.clone(),
        config.plan_service.clone(),
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
    let init_response = initialize_connection(
        &conn,
        &source_agent_kind,
        &config.agent,
        &session_id,
        &workspace_id,
        &ready_tx,
    )
    .await?;

    persist_session_action_capabilities(&store, &session_id, &init_response.agent_capabilities);
    let action_capabilities = action_capabilities_from_acp(&init_response.agent_capabilities);
    let supports_native_close = init_response
        .agent_capabilities
        .session_capabilities
        .close
        .is_some();

    let (native_session_id, native_startup_state, startup_disposition) = start_native_session(
        &conn,
        &config.workspace_path,
        &config.mcp_servers,
        config.system_prompt_append.as_deref(),
        &startup_strategy,
        action_capabilities,
        &session_id,
        &workspace_id,
        &ready_tx,
    )
    .await?;
    let mut startup_state: SessionStartupState = native_startup_state.into();
    startup_state.prompt_capabilities =
        capabilities_from_acp(Some(&init_response.agent_capabilities.prompt_capabilities));

    tracing::info!(
        session_id = %session_id,
        native_session_id = %native_session_id,
        startup_strategy = startup_strategy_label,
        native_startup_disposition = startup_disposition.as_str(),
        "ACP session established"
    );

    let mut persisted_config_state = PersistedSessionConfigState::from_session(&config.session);
    let startup_restore_snapshot = load_startup_restore_snapshot(
        &store,
        &session_id,
        &source_agent_kind,
        startup_strategy.resumes_durable_history(),
    )?;

    {
        let mut sink = event_sink.lock().await;
        if startup_disposition == NativeSessionStartupDisposition::CreatedFresh {
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
        &config.session,
        &mut startup_state,
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
        startup_restore_snapshot.as_ref(),
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
        startup_strategy = startup_strategy_label,
        native_startup_disposition = startup_disposition.as_str(),
        total_elapsed_ms = startup_started.elapsed().as_millis(),
        flow_id = actor_latency_fields.flow_id,
        flow_kind = actor_latency_fields.flow_kind,
        flow_source = actor_latency_fields.flow_source,
        prompt_id = actor_latency_fields.prompt_id,
        "[workspace-latency] session.actor.startup_ready"
    );
    let resume_replay_filter = ResumeReplayFilter::new(
        &source_agent_kind,
        startup_disposition,
        &config.session.status,
    );

    dispatch_startup_drain(&store, &session_id, handle).await;

    Ok(StartedActor {
        child,
        conn,
        notification_rx,
        background_work_rx,
        background_work_registry,
        event_sink,
        native_session_id,
        startup_state,
        persisted_config_state,
        action_capabilities,
        supports_native_close,
        resume_replay_filter,
    })
}

async fn dispatch_startup_drain(
    store: &SessionStore,
    session_id: &str,
    handle: &Arc<LiveSessionHandle>,
) {
    // Invariant 5: startup drain. If the durable queue is non-empty, self-dispatch
    // a Prompt command for the head row carrying `from_queue_seq`. The first
    // iteration of the outer Prompt arm treats it as a drained iteration:
    // `begin_turn` runs, then the head row is deleted and PendingPromptRemoved
    // is emitted. If more items exist, the turn-end drain loop picks them up
    // naturally from there. Races: the main select loop has not started yet.
    match store.peek_head_pending_prompt(session_id) {
        Ok(Some(head)) => {
            let (drain_respond_tx, _drain_respond_rx) = oneshot::channel();
            if let Err(error) = handle
                .command_tx
                .send(SessionCommand::Prompt {
                    payload: head.prompt_payload(),
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
}
pub(in crate::live::sessions::actor) fn persist_session_action_capabilities(
    store: &SessionStore,
    session_id: &str,
    agent_capabilities: &acp::AgentCapabilities,
) {
    let capabilities = action_capabilities_from_acp(agent_capabilities);
    let Ok(json) = serialize_action_capabilities(capabilities) else {
        tracing::warn!(
            session_id,
            "failed to serialize session action capabilities"
        );
        return;
    };
    let now = chrono::Utc::now().to_rfc3339();
    if let Err(error) = store.update_action_capabilities_json(session_id, Some(json), &now) {
        tracing::warn!(
            session_id,
            error = %error,
            "failed to persist session action capabilities"
        );
    }
}

pub(in crate::live::sessions::actor) fn action_capabilities_from_acp(
    agent_capabilities: &acp::AgentCapabilities,
) -> SessionActionCapabilities {
    let fork_capability = agent_capabilities.session_capabilities.fork.as_ref();
    let fork = agent_capabilities.load_session && fork_capability.is_some();
    let adapter_targeted_fork_ready = fork
        && fork_capability
            .and_then(|capability| capability.meta.as_ref())
            .map(has_anyharness_targeted_fork_extension)
            .unwrap_or(false);
    if adapter_targeted_fork_ready {
        tracing::debug!(
            "agent advertises edit-safe targeted fork metadata; public targeted fork remains disabled until runtime target dispatch is implemented"
        );
    }
    SessionActionCapabilities {
        fork,
        targeted_fork: false,
    }
}
