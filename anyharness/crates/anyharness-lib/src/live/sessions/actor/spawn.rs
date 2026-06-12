use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Instant;

use anyharness_contract::v1::SessionExecutionPhase;
use tokio::sync::{mpsc, RwLock};

use crate::live::sessions::actor::command::SessionCommand;
use crate::live::sessions::actor::state::{SessionActor, SessionActorConfig};
use crate::live::sessions::handle::{LiveSessionExecutionSnapshot, LiveSessionHandle};

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
}

impl PendingSessionActor {
    pub fn wait_ready(self) -> anyhow::Result<ActorReadyResult> {
        let native_session_id = self
            .ready_rx
            .recv_timeout(std::time::Duration::from_secs(60))
            .map_err(|e| match e {
                std::sync::mpsc::RecvTimeoutError::Timeout => {
                    // Agent-process exits during the handshake fail fast in
                    // SessionActor::start, so this is reached only for an
                    // agent that is alive but unresponsive (e.g. a genuine
                    // auth wait). TODO: thread the AgentStderrTail up here so
                    // the residual timeout cases are equally diagnosable.
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

        tracing::info!(
            session_id = %self.session_id,
            workspace_id = %self.workspace_id,
            native_session_id = %native_session_id,
            startup_strategy = %self.startup_strategy,
            elapsed_ms = self.started.elapsed().as_millis(),
            "[workspace-latency] session.actor.spawn.ready"
        );

        Ok(ActorReadyResult { native_session_id })
    }
}


pub fn spawn_session_actor_pending(
    mut config: SessionActorConfig,
) -> anyhow::Result<PendingSessionActor> {
    let session_id = config.launch.session.id.clone();
    let workspace_id = config.launch.session.workspace_id.clone();
    let agent_kind = config.launch.session.agent_kind.clone();
    let startup_strategy = config.launch.startup.as_str().to_string();
    let started = Instant::now();
    tracing::info!(
        session_id = %session_id,
        workspace_id = %workspace_id,
        agent_kind = %agent_kind,
        startup_strategy,
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

    let on_exit = config.hooks.on_exit.take();

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
                let run_result = async {
                    let (actor, notification_rx, background_work_rx) =
                        SessionActor::start(config, ready_tx, actor_handle).await?;
                    actor
                        .run(command_rx, notification_rx, background_work_rx)
                        .await
                }
                .await;
                match run_result {
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
    })
}
