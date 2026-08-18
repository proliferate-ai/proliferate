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

#[cfg(not(test))]
const SHARED_STARTUP_READINESS_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);
#[cfg(test)]
const SHARED_STARTUP_READINESS_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(1);

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

        // The absence check, crash repair, last-sequence read, and handle
        // installation are one manager-owned critical section. A concurrent
        // start therefore either installs the sole pending actor or observes
        // that actor above and joins its readiness; it can never repair a
        // turn after another actor has taken ownership of event sequencing.
        let repaired_turns = self.caps.state.repair_unclosed_turns(&session_id)?;
        if repaired_turns > 0 {
            tracing::info!(
                session_id = %session_id,
                repaired_turns,
                "repaired unclosed turns before actor installation"
            );
        }

        // The manager owns the last-seq read: it must happen under the
        // same start/inject critical section as repair and installation, so
        // any caller-provided value is overwritten here.
        launch.last_seq = self.caps.events.last_event_seq(&session_id)?;

        let (event_tx, _) = broadcast::channel::<SessionEventEnvelope>(4096);

        let exit_session_id = session_id.clone();
        let exit_state = self.caps.state.clone();
        let caller_on_exit = hooks.on_exit.take();
        let on_exit: Box<dyn FnOnce(bool) + Send + 'static> = Box::new(move |errored| {
            if errored {
                let now = chrono::Utc::now().to_rfc3339();
                let _ = exit_state.update_status(&exit_session_id, "errored", &now);
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
        self.retire_generation_after_actor_finish(session_id.clone(), handle.clone());
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

pub(super) async fn wait_for_new_startup_readiness(
    pending: PendingSessionActor,
    startup_tx: watch::Sender<StartupReadinessState>,
    live_sessions: Arc<RwLock<HashMap<String, Arc<LiveSessionHandle>>>>,
    pending_startups: Arc<RwLock<HashMap<String, watch::Receiver<StartupReadinessState>>>>,
    handle: Arc<LiveSessionHandle>,
    startup_strategy_label: String,
    actor_start_started: Instant,
    manager_started: Instant,
) -> anyhow::Result<ActorReadyResult> {
    let (result_tx, result_rx) = tokio::sync::oneshot::channel();
    tokio::spawn(async move {
        let result = own_new_startup_readiness(
            pending,
            startup_tx,
            live_sessions,
            pending_startups,
            handle,
            startup_strategy_label,
            actor_start_started,
            manager_started,
        )
        .await;
        let _ = result_tx.send(result);
    });

    result_rx
        .await
        .map_err(|_| anyhow::anyhow!("manager-owned actor startup wait task stopped"))?
}

async fn own_new_startup_readiness(
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
    let wait_session_id = session_id.clone();
    let wait_startup_tx = startup_tx.clone();
    let ready_result = match tokio::task::spawn_blocking(move || {
        let ready_result = pending.wait_ready();

        match &ready_result {
            Ok(ready) => {
                tracing::info!(
                    session_id = %wait_session_id,
                    native_session_id = %ready.native_session_id.as_str(),
                    startup_strategy = %startup_strategy_label,
                    elapsed_ms = actor_start_started.elapsed().as_millis(),
                    total_elapsed_ms = manager_started.elapsed().as_millis(),
                    "[workspace-latency] session.acp_manager.start.actor_ready"
                );

                let _ = wait_startup_tx.send(Some(Ok(ready.native_session_id.clone())));
            }
            Err(error) => {
                let message = error.to_string();
                let _ = wait_startup_tx.send(Some(Err(message)));
            }
        }

        ready_result
    })
    .await
    {
        Ok(result) => result,
        Err(error) => {
            let error = anyhow::anyhow!("actor startup wait task failed: {error}");
            let _ = startup_tx.send(Some(Err(error.to_string())));
            Err(error)
        }
    };

    if ready_result.is_ok() {
        let sessions = live_sessions.write().await;
        let remove_pending_startup = match sessions.get(&session_id) {
            Some(current) => Arc::ptr_eq(current, &handle),
            None => true,
        };
        if remove_pending_startup {
            // Keep the live-map lock while removing readiness. If explicit
            // removal installed a newer generation after this one became
            // ready, that generation owns the current pending entry.
            pending_startups.write().await.remove(&session_id);
        }
    } else {
        // A readiness timeout actively cancels this generation. Keep its
        // handle installed until every sequence writer has gone and the exit
        // hook has finished, then remove only this exact generation.
        handle.wait_for_event_sequence_relinquishment().await;
        handle.wait_until_actor_finished().await;
        let mut sessions = live_sessions.write().await;
        let remove_pending_startup = match sessions.get(&session_id) {
            Some(current) if Arc::ptr_eq(current, &handle) => {
                sessions.remove(&session_id);
                true
            }
            None => true,
            Some(_) => false,
        };
        if remove_pending_startup {
            // Keep the live-map lock while removing readiness so startup's
            // live -> pending lock order cannot install a replacement in the
            // middle. A newer current handle owns any newer pending entry.
            pending_startups.write().await.remove(&session_id);
        }
    }

    ready_result
}

async fn wait_for_startup_readiness(
    receiver: &mut watch::Receiver<StartupReadinessState>,
) -> anyhow::Result<ActorReadyResult> {
    tokio::time::timeout(SHARED_STARTUP_READINESS_TIMEOUT, async {
        loop {
            if let Some(result) = receiver.borrow().clone() {
                return result
                    .map(|native_session_id| ActorReadyResult { native_session_id })
                    .map_err(anyhow::Error::msg);
            }

            receiver.changed().await.map_err(|_| {
                anyhow::anyhow!("actor startup readiness channel closed before ready")
            })?;
        }
    })
    .await
    .map_err(|_| {
        anyhow::anyhow!(
            "actor startup readiness wait timed out after {}s",
            SHARED_STARTUP_READINESS_TIMEOUT.as_secs()
        )
    })?
}
