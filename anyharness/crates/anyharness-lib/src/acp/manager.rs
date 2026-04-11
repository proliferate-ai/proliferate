use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use serde_json::{Map, Value};
use tokio::sync::{broadcast, RwLock};

use super::permission_broker::PermissionBroker;
use super::session_actor::{
    spawn_session_actor, ActorReadyResult, LiveSessionHandle, SessionActorConfig,
};
use crate::agents::model::ResolvedAgent;
use crate::api::http::latency::{latency_trace_fields, LatencyRequestContext};
use crate::sessions::mcp::SessionMcpServer;
use crate::sessions::model::SessionRecord;
use crate::sessions::store::SessionStore;
use anyharness_contract::v1::SessionEventEnvelope;

pub struct AcpManager {
    live_sessions: Arc<RwLock<HashMap<String, Arc<LiveSessionHandle>>>>,
    permission_broker: Arc<PermissionBroker>,
}

impl AcpManager {
    pub fn new() -> Self {
        let permission_broker = Arc::new(PermissionBroker::new());
        Self {
            live_sessions: Arc::new(RwLock::new(HashMap::new())),
            permission_broker,
        }
    }

    pub fn permission_broker(&self) -> &Arc<PermissionBroker> {
        &self.permission_broker
    }

    pub async fn start_session(
        &self,
        session: SessionRecord,
        agent: ResolvedAgent,
        workspace_path: PathBuf,
        workspace_env: std::collections::BTreeMap<String, String>,
        session_launch_env: std::collections::BTreeMap<String, String>,
        session_store: SessionStore,
        mcp_servers: Vec<SessionMcpServer>,
        is_resume: bool,
        last_seq: i64,
        system_prompt_append: Option<String>,
        startup_meta: Option<Map<String, Value>>,
        latency: Option<LatencyRequestContext>,
    ) -> anyhow::Result<(Arc<LiveSessionHandle>, ActorReadyResult)> {
        let session_id = session.id.clone();
        let started = Instant::now();
        let latency_fields = latency_trace_fields(latency.as_ref());
        tracing::info!(
            session_id = %session_id,
            workspace_id = %session.workspace_id,
            agent_kind = %session.agent_kind,
            is_resume,
            last_seq,
            flow_id = latency_fields.flow_id,
            flow_kind = latency_fields.flow_kind,
            flow_source = latency_fields.flow_source,
            prompt_id = latency_fields.prompt_id,
            "[workspace-latency] session.acp_manager.start.start"
        );

        let mut sessions = self.live_sessions.write().await;
        if let Some(existing) = sessions.get(&session_id) {
            tracing::info!(
                session_id = %session_id,
                elapsed_ms = started.elapsed().as_millis(),
                flow_id = latency_fields.flow_id,
            flow_kind = latency_fields.flow_kind,
            flow_source = latency_fields.flow_source,
            prompt_id = latency_fields.prompt_id,
                "[workspace-latency] session.acp_manager.start.reused_existing_handle"
            );
            return Ok((
                existing.clone(),
                ActorReadyResult {
                    native_session_id: session.native_session_id.unwrap_or_default(),
                },
            ));
        }

        let (event_tx, _) = broadcast::channel::<SessionEventEnvelope>(4096);

        let live_sessions = self.live_sessions.clone();
        let exit_session_id = session_id.clone();
        let exit_store = session_store.clone();
        let on_exit: Box<dyn FnOnce(bool) + Send + 'static> = Box::new(move |errored| {
            // Remove the dead handle from the live map so future callers
            // don't get a stale reference.
            let live = live_sessions.clone();
            let sid = exit_session_id.clone();
            // We're on the actor's thread (non-async context). Use
            // blocking_write to ensure the dead handle is always removed.
            // The actor thread is exiting, so a brief block is acceptable.
            live.blocking_write().remove(&sid);
            if errored {
                let now = chrono::Utc::now().to_rfc3339();
                let _ = exit_store.update_status(&sid, "errored", &now);
            }
        });

        let actor_latency = latency.clone();
        let actor_latency_fields = latency_trace_fields(actor_latency.as_ref());
        let config = SessionActorConfig {
            session,
            agent,
            workspace_path,
            workspace_env,
            session_launch_env,
            permission_broker: self.permission_broker.clone(),
            event_tx,
            session_store,
            mcp_servers,
            is_resume,
            last_seq,
            system_prompt_append,
            startup_meta,
            latency,
            on_exit: Some(on_exit),
        };

        // This blocks until ACP init + new_session completes
        let actor_start_started = Instant::now();
        let (handle, ready) = spawn_session_actor(config)?;
        sessions.insert(session_id, handle.clone());
        tracing::info!(
            session_id = %handle.session_id,
            native_session_id = %ready.native_session_id,
            elapsed_ms = actor_start_started.elapsed().as_millis(),
            total_elapsed_ms = started.elapsed().as_millis(),
            flow_id = actor_latency_fields.flow_id,
            flow_kind = actor_latency_fields.flow_kind,
            flow_source = actor_latency_fields.flow_source,
            prompt_id = actor_latency_fields.prompt_id,
            "[workspace-latency] session.acp_manager.start.actor_ready"
        );

        Ok((handle, ready))
    }

    pub async fn get_handle(&self, session_id: &str) -> Option<Arc<LiveSessionHandle>> {
        let sessions = self.live_sessions.read().await;
        sessions.get(session_id).cloned()
    }

    pub async fn remove_session(&self, session_id: &str) {
        let mut sessions = self.live_sessions.write().await;
        sessions.remove(session_id);
    }
}

impl Clone for AcpManager {
    fn clone(&self) -> Self {
        Self {
            live_sessions: self.live_sessions.clone(),
            permission_broker: self.permission_broker.clone(),
        }
    }
}
