use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use anyharness_contract::v1::SessionEventEnvelope;
use tokio::sync::{broadcast, watch, RwLock};

use super::{LiveSessionManager, StartupReadinessState};
use crate::domains::agents::model::ResolvedAgent;
use crate::domains::sessions::attachment_storage::PromptAttachmentStorage;
use crate::domains::sessions::mcp_bindings::model::SessionMcpServer;
use crate::domains::sessions::model::SessionRecord;
use crate::domains::sessions::store::SessionStore;
use crate::live::sessions::actor::spawn::{
    spawn_session_actor_pending, ActorReadyResult, PendingSessionActor,
};
use crate::live::sessions::actor::state::{SessionActorConfig, SessionStartupStrategy};
use crate::live::sessions::actor::turn::types::SessionTurnFinishResult;
use crate::live::sessions::handle::LiveSessionHandle;
use crate::observability::latency::{latency_trace_fields, LatencyRequestContext};

impl LiveSessionManager {
    pub async fn start_session(
        &self,
        session: SessionRecord,
        agent: ResolvedAgent,
        workspace_path: PathBuf,
        workspace_env: std::collections::BTreeMap<String, String>,
        session_launch_env: std::collections::BTreeMap<String, String>,
        agent_auth_env: std::collections::BTreeMap<String, String>,
        protected_agent_auth_env: std::collections::BTreeMap<String, String>,
        session_store: SessionStore,
        attachment_storage: PromptAttachmentStorage,
        mcp_servers: Vec<SessionMcpServer>,
        startup_strategy: SessionStartupStrategy,
        system_prompt_append: Option<String>,
        first_prompt_system_prompt_append: Option<String>,
        on_turn_finish: Option<Arc<dyn Fn(SessionTurnFinishResult) + Send + Sync + 'static>>,
        latency: Option<LatencyRequestContext>,
    ) -> anyhow::Result<(Arc<LiveSessionHandle>, ActorReadyResult)> {
        let session_id = session.id.clone();
        let started = Instant::now();
        let latency_fields = latency_trace_fields(latency.as_ref());
        let startup_strategy_label = startup_strategy.as_str();
        tracing::info!(
            session_id = %session_id,
            workspace_id = %session.workspace_id,
            agent_kind = %session.agent_kind,
            startup_strategy = startup_strategy_label,
            flow_id = latency_fields.flow_id,
            flow_kind = latency_fields.flow_kind,
            flow_source = latency_fields.flow_source,
            prompt_id = latency_fields.prompt_id,
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
                flow_id = latency_fields.flow_id,
                flow_kind = latency_fields.flow_kind,
                flow_source = latency_fields.flow_source,
                prompt_id = latency_fields.prompt_id,
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

            if let Some(native_session_id) = session.native_session_id {
                return Ok((existing, ActorReadyResult { native_session_id }));
            }

            anyhow::bail!(
                "live session handle for {session_id} has no native session id and no pending startup readiness"
            );
        }

        let last_seq = session_store.last_event_seq(&session_id)?;

        let (event_tx, _) = broadcast::channel::<SessionEventEnvelope>(4096);

        let live_sessions = self.live_sessions.clone();
        let exit_session_id = session_id.clone();
        let exit_store = session_store.clone();
        let on_exit: Box<dyn FnOnce(bool) + Send + 'static> = Box::new(move |errored| {
            // Remove the dead handle from the live map so future callers do not
            // get a stale reference after the actor thread exits.
            let live = live_sessions.clone();
            let sid = exit_session_id.clone();
            live.blocking_write().remove(&sid);
            if errored {
                let now = chrono::Utc::now().to_rfc3339();
                let _ = exit_store.update_status(&sid, "errored", &now);
            }
        });

        let actor_latency = latency.clone();
        let config = SessionActorConfig {
            session,
            agent,
            workspace_path,
            workspace_env,
            session_launch_env,
            agent_auth_env,
            protected_agent_auth_env,
            interaction_broker: self.interaction_broker.clone(),
            plan_service: self.plan_service.clone(),
            review_service: self
                .review_service
                .read()
                .ok()
                .and_then(|guard| guard.clone()),
            event_tx,
            session_store,
            attachment_storage,
            mcp_servers,
            startup_strategy,
            last_seq,
            system_prompt_append,
            first_prompt_system_prompt_append,
            on_turn_finish,
            latency,
            on_exit: Some(on_exit),
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
            actor_latency,
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
    latency: Option<LatencyRequestContext>,
) -> anyhow::Result<ActorReadyResult> {
    let session_id = handle.session_id.clone();
    tokio::task::spawn_blocking(move || {
        let ready_result = pending.wait_ready();

        match &ready_result {
            Ok(ready) => {
                let latency_fields = latency_trace_fields(latency.as_ref());
                tracing::info!(
                    session_id = %session_id,
                    native_session_id = %ready.native_session_id.as_str(),
                    startup_strategy = %startup_strategy_label,
                    elapsed_ms = actor_start_started.elapsed().as_millis(),
                    total_elapsed_ms = manager_started.elapsed().as_millis(),
                    flow_id = latency_fields.flow_id,
                    flow_kind = latency_fields.flow_kind,
                    flow_source = latency_fields.flow_source,
                    prompt_id = latency_fields.prompt_id,
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
