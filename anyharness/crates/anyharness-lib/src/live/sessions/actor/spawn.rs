use std::sync::Arc;
use std::time::{Duration, Instant};

use anyharness_contract::v1::SessionExecutionPhase;
use tokio::sync::{mpsc, oneshot};

use crate::live::sessions::actor::command::SessionCommand;
use crate::live::sessions::actor::state::{SessionActor, SessionActorConfig};
use crate::live::sessions::handle::LiveSessionHandle;

const ACTOR_READINESS_TIMEOUT: Duration = Duration::from_secs(60);

pub struct ActorReadyResult {
    pub native_session_id: String,
}

pub struct PendingSessionActor {
    pub handle: Arc<LiveSessionHandle>,
    ready_rx: std::sync::mpsc::Receiver<anyhow::Result<String>>,
    startup_cancel_tx: Option<oneshot::Sender<()>>,
    readiness_timeout: Duration,
    session_id: String,
    workspace_id: String,
    startup_strategy: String,
    started: Instant,
}

impl PendingSessionActor {
    pub fn wait_ready(mut self) -> anyhow::Result<ActorReadyResult> {
        let native_session_id = match self.ready_rx.recv_timeout(self.readiness_timeout) {
            Ok(result) => result?,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                // The timeout is an ownership transition, not just a caller
                // error: cancel the exact actor generation before its handle
                // can be retired or an offline writer can take the sequence.
                if let Some(cancel_tx) = self.startup_cancel_tx.take() {
                    let _ = cancel_tx.send(());
                }
                return Err(anyhow::anyhow!(
                    "ACP session startup timed out after {}s. \
                     The agent may be waiting for authentication or is unresponsive.",
                    self.readiness_timeout.as_secs()
                ));
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                return Err(anyhow::anyhow!(
                    "actor thread died before ACP init completed"
                ));
            }
        };
        self.handle
            .native_session_id
            .write()
            .expect("native session id lock poisoned")
            .replace(native_session_id.clone());

        tracing::info!(
            target: "anyharness.session.spawn",
            session_id = %self.session_id,
            workspace_id = %self.workspace_id,
            native_session_id = %native_session_id,
            startup_strategy = %self.startup_strategy,
            phase = "ready",
            elapsed_ms = self.started.elapsed().as_millis(),
            "[workspace-latency] session.actor.spawn.ready"
        );

        Ok(ActorReadyResult { native_session_id })
    }

    #[cfg(test)]
    pub(in crate::live::sessions) fn new_for_test(
        handle: Arc<LiveSessionHandle>,
        ready_rx: std::sync::mpsc::Receiver<anyhow::Result<String>>,
        startup_cancel_tx: oneshot::Sender<()>,
        readiness_timeout: Duration,
    ) -> Self {
        Self {
            session_id: handle.session_id.clone(),
            workspace_id: "workspace-test".to_string(),
            startup_strategy: "test".to_string(),
            started: Instant::now(),
            handle,
            ready_rx,
            startup_cancel_tx: Some(startup_cancel_tx),
            readiness_timeout,
        }
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
        target: "anyharness.session.spawn",
        session_id = %session_id,
        workspace_id = %workspace_id,
        agent_kind = %agent_kind,
        startup_strategy,
        phase = "start",
        "[workspace-latency] session.actor.spawn.start"
    );
    let (command_tx, command_rx) = mpsc::channel::<SessionCommand>(32);
    let event_tx = config.event_tx.clone();
    let handle = Arc::new(LiveSessionHandle::new(
        session_id.clone(),
        config.launch.serving_seat_id.clone(),
        command_tx,
        event_tx.clone(),
        None,
        SessionExecutionPhase::Starting,
    ));
    let actor_handle = handle.clone();
    let event_sequence_releaser = handle.event_sequence_releaser();
    let actor_finished_releaser = handle.actor_finished_releaser();

    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<anyhow::Result<String>>();
    let (startup_cancel_tx, startup_cancel_rx) = oneshot::channel();

    let on_exit = config.hooks.on_exit.take();

    std::thread::Builder::new()
        .name(format!(
            "acp-session-{}",
            &session_id[..8.min(session_id.len())]
        ))
        .spawn(move || {
            let event_sequence_releaser = event_sequence_releaser;
            let actor_finished_releaser = actor_finished_releaser;
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("build per-session tokio runtime");
            let local = tokio::task::LocalSet::new();
            let errored = local.block_on(&rt, async move {
                let actor_lifecycle = async {
                    let (actor, notification_rx, background_work_rx) =
                        SessionActor::start(config, ready_tx, actor_handle).await?;
                    actor
                        .run(command_rx, notification_rx, background_work_rx)
                        .await
                };
                let startup_cancelled = async move {
                    if startup_cancel_rx.await.is_err() {
                        std::future::pending::<()>().await;
                    }
                };
                let run_result = tokio::select! {
                    biased;
                    _ = startup_cancelled => {
                        Err(anyhow::anyhow!("actor startup cancelled after readiness timeout"))
                    }
                    result = actor_lifecycle => result,
                };
                match run_result {
                    Ok(()) => false,
                    Err(e) => {
                        tracing::error!(error = %e, "session actor failed");
                        true
                    }
                }
            });
            // Local ACP tasks can retain InboundDoor clones. Destroy them
            // synchronously before the fallback RAII sequence handoff used by
            // startup and run errors.
            drop(local);
            drop(event_sequence_releaser);
            if let Some(cb) = on_exit {
                cb(errored);
            }
            drop(actor_finished_releaser);
        })?;

    Ok(PendingSessionActor {
        handle,
        ready_rx,
        startup_cancel_tx: Some(startup_cancel_tx),
        readiness_timeout: ACTOR_READINESS_TIMEOUT,
        session_id,
        workspace_id,
        startup_strategy,
        started,
    })
}
