use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

use anyharness_contract::v1::SessionEventEnvelope;
use tokio::sync::{broadcast, watch, RwLock};

use super::{LiveSessionManager, StartupReadinessState};
use crate::live::sessions::actor::spawn::{
    spawn_session_actor_pending, ActorReadyResult, PendingSessionActor,
};
use crate::live::sessions::actor::state::SessionActorConfig;
use crate::live::sessions::handle::LiveSessionHandle;
use crate::live::sessions::model::{SessionHooks, SessionLaunch};

impl LiveSessionManager {
    #[tracing::instrument(skip_all, fields(session_id = %launch.session.id))]
    pub async fn start_session(
        &self,
        mut launch: SessionLaunch,
        mut hooks: SessionHooks,
    ) -> anyhow::Result<(Arc<LiveSessionHandle>, ActorReadyResult)> {
        let session_id = launch.session.id.clone();
        let started = Instant::now();
        let startup_strategy_label = launch.startup.as_str();
        tracing::info!(
            session_id = %session_id,
            workspace_id = %launch.session.workspace_id,
            agent_kind = %launch.session.agent_kind,
            startup_strategy = startup_strategy_label,
            "[workspace-latency] session.acp_manager.start.start"
        );

        let mut sessions = self.live_sessions.write().await;
        if let Some(existing) = sessions.get(&session_id) {
            let existing = existing.clone();
            let ready_native_session_id = existing.native_session_id();
            drop(sessions);
            tracing::info!(
                session_id = %session_id,
                elapsed_ms = started.elapsed().as_millis(),
                "[workspace-latency] session.acp_manager.start.reused_existing_handle"
            );
            if let Some(native_session_id) = ready_native_session_id {
                return Ok((existing, ActorReadyResult { native_session_id }));
            }

            let pending_startup = self.pending_startups.read().await.get(&session_id).cloned();
            if let Some(mut pending_startup) = pending_startup {
                let ready = wait_for_startup_readiness(&mut pending_startup).await?;
                return Ok((existing, ready));
            }

            if let Some(native_session_id) = launch.session.native_session_id {
                return Ok((existing, ActorReadyResult { native_session_id }));
            }

            anyhow::bail!(
                "live session handle for {session_id} has no native session id and no pending startup readiness"
            );
        }

        // The manager owns the last-seq read: it must happen under the
        // live-sessions write lock (start/inject critical section), so any
        // caller-provided value is overwritten here.
        launch.last_seq = self.caps.events.last_event_seq(&session_id)?;

        let (event_tx, _) = broadcast::channel::<SessionEventEnvelope>(4096);

        let live_sessions = self.live_sessions.clone();
        let exit_session_id = session_id.clone();
        let exit_state = self.caps.state.clone();
        let caller_on_exit = hooks.on_exit.take();
        let on_exit: Box<dyn FnOnce(bool) + Send + 'static> = Box::new(move |errored| {
            // Remove the dead handle from the live map so future callers do not
            // get a stale reference after the actor thread exits.
            let live = live_sessions.clone();
            let sid = exit_session_id.clone();
            live.blocking_write().remove(&sid);
            if errored {
                let now = chrono::Utc::now().to_rfc3339();
                let _ = exit_state.update_status(&sid, "errored", &now);
            }
            if let Some(caller_on_exit) = caller_on_exit {
                caller_on_exit(errored);
            }
        });
        hooks.on_exit = Some(on_exit);

        let config = SessionActorConfig {
            launch,
            caps: self.caps.clone(),
            hooks,
            interaction_broker: self.interaction_broker.clone(),
            event_tx,
        };

        // Make the live handle visible before waiting on ACP new_session so
        // stream subscribers do not block behind the live-session write lock.
        let actor_start_started = Instant::now();
        let pending = spawn_session_actor_pending(config)?;
        let handle = pending.handle.clone();
        let (startup_tx, startup_rx) = watch::channel::<StartupReadinessState>(None);
        sessions.insert(session_id.clone(), handle.clone());
        self.pending_startups
            .write()
            .await
            .insert(session_id.clone(), startup_rx.clone());
        drop(sessions);

        let ready = wait_for_new_startup_readiness(
            pending,
            startup_tx,
            self.live_sessions.clone(),
            self.pending_startups.clone(),
            handle.clone(),
            startup_strategy_label.to_string(),
            actor_start_started,
            started,
        )
        .await?;

        Ok((handle, ready))
    }
}

async fn wait_for_new_startup_readiness(
    pending: PendingSessionActor,
    startup_tx: watch::Sender<StartupReadinessState>,
    live_sessions: Arc<RwLock<HashMap<String, Arc<LiveSessionHandle>>>>,
    pending_startups: Arc<RwLock<HashMap<String, watch::Receiver<StartupReadinessState>>>>,
    handle: Arc<LiveSessionHandle>,
    startup_strategy_label: String,
    actor_start_started: Instant,
    manager_started: Instant,
) -> anyhow::Result<ActorReadyResult> {
    let session_id = handle.session_id.clone();
    tokio::task::spawn_blocking(move || {
        let ready_result = pending.wait_ready();

        match &ready_result {
            Ok(ready) => {
                tracing::info!(
                    session_id = %session_id,
                    native_session_id = %ready.native_session_id.as_str(),
                    startup_strategy = %startup_strategy_label,
                    elapsed_ms = actor_start_started.elapsed().as_millis(),
                    total_elapsed_ms = manager_started.elapsed().as_millis(),
                    "[workspace-latency] session.acp_manager.start.actor_ready"
                );

                let _ = startup_tx.send(Some(Ok(ready.native_session_id.clone())));
            }
            Err(error) => {
                let message = error.to_string();
                let _ = startup_tx.send(Some(Err(message)));
                let mut sessions = live_sessions.blocking_write();
                if matches!(sessions.get(&session_id), Some(current) if Arc::ptr_eq(current, &handle))
                {
                    sessions.remove(&session_id);
                }
            }
        }

        pending_startups.blocking_write().remove(&session_id);
        ready_result
    })
    .await
    .map_err(|error| anyhow::anyhow!("actor startup wait task failed: {error}"))?
}

async fn wait_for_startup_readiness(
    receiver: &mut watch::Receiver<StartupReadinessState>,
) -> anyhow::Result<ActorReadyResult> {
    loop {
        if let Some(result) = receiver.borrow().clone() {
            return result
                .map(|native_session_id| ActorReadyResult { native_session_id })
                .map_err(anyhow::Error::msg);
        }

        receiver
            .changed()
            .await
            .map_err(|_| anyhow::anyhow!("actor startup readiness channel closed before ready"))?;
    }
}
