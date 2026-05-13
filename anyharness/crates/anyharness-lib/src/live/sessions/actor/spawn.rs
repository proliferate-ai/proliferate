use crate::live::sessions::actor::event_loop::run_actor;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Instant;

use anyharness_contract::v1::SessionExecutionPhase;
use tokio::sync::{mpsc, RwLock};

use crate::live::sessions::actor::command::SessionCommand;
use crate::live::sessions::actor::state::SessionActorConfig;
use crate::live::sessions::handle::{LiveSessionExecutionSnapshot, LiveSessionHandle};
use crate::observability::latency::{latency_trace_fields, LatencyRequestContext};

pub struct ActorReadyResult {
    pub native_session_id: String,
}

pub struct PendingSessionActor {
    pub handle: Arc<LiveSessionHandle>,
    ready_rx: std::sync::mpsc::Receiver<anyhow::Result<String>>,
    session_id: String,
    workspace_id: String,
    startup_strategy: String,
    started: Instant,
    latency: Option<LatencyRequestContext>,
}

impl PendingSessionActor {
    pub fn wait_ready(self) -> anyhow::Result<ActorReadyResult> {
        let native_session_id = self
            .ready_rx
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
        self.handle
            .native_session_id
            .write()
            .expect("native session id lock poisoned")
            .replace(native_session_id.clone());

        let latency_fields = latency_trace_fields(self.latency.as_ref());
        tracing::info!(
            session_id = %self.session_id,
            workspace_id = %self.workspace_id,
            native_session_id = %native_session_id,
            startup_strategy = %self.startup_strategy,
            elapsed_ms = self.started.elapsed().as_millis(),
            flow_id = latency_fields.flow_id,
            flow_kind = latency_fields.flow_kind,
            flow_source = latency_fields.flow_source,
            prompt_id = latency_fields.prompt_id,
            "[workspace-latency] session.actor.spawn.ready"
        );

        Ok(ActorReadyResult { native_session_id })
    }
}

pub fn spawn_session_actor(
    config: SessionActorConfig,
) -> anyhow::Result<(Arc<LiveSessionHandle>, ActorReadyResult)> {
    let pending = spawn_session_actor_pending(config)?;
    let handle = pending.handle.clone();
    let ready = pending.wait_ready()?;
    Ok((handle, ready))
}

pub fn spawn_session_actor_pending(
    mut config: SessionActorConfig,
) -> anyhow::Result<PendingSessionActor> {
    let session_id = config.session.id.clone();
    let workspace_id = config.session.workspace_id.clone();
    let agent_kind = config.session.agent_kind.clone();
    let startup_strategy = config.startup_strategy.as_str().to_string();
    let actor_latency = config.latency.clone();
    let actor_latency_fields = latency_trace_fields(actor_latency.as_ref());
    let started = Instant::now();
    tracing::info!(
        session_id = %session_id,
        workspace_id = %workspace_id,
        agent_kind = %agent_kind,
        startup_strategy,
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
        native_session_id: Arc::new(std::sync::RwLock::new(None)),
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

    Ok(PendingSessionActor {
        handle,
        ready_rx,
        session_id,
        workspace_id,
        startup_strategy,
        started,
        latency: actor_latency,
    })
}
