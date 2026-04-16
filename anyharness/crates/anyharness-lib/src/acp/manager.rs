use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use tokio::sync::{broadcast, RwLock};

use super::permission_broker::InteractionBroker;
use super::replay_actor::{spawn_replay_actor, ReplayActorConfig};
use super::session_actor::{
    spawn_session_actor, ActorReadyResult, LiveSessionHandle, SessionActorConfig,
    SessionStartupStrategy, SessionTurnFinishResult,
};
use crate::agents::model::ResolvedAgent;
use crate::api::http::latency::{latency_trace_fields, LatencyRequestContext};
use crate::plans::service::PlanService;
use crate::sessions::mcp::SessionMcpServer;
use crate::sessions::model::SessionRecord;
use crate::sessions::store::SessionStore;
use anyharness_contract::v1::SessionEventEnvelope;

pub struct AcpManager {
    live_sessions: Arc<RwLock<HashMap<String, Arc<LiveSessionHandle>>>>,
    interaction_broker: Arc<InteractionBroker>,
    plan_service: Arc<PlanService>,
}

impl AcpManager {
    pub fn new(plan_service: Arc<PlanService>) -> Self {
        let interaction_broker = Arc::new(InteractionBroker::new());
        Self {
            live_sessions: Arc::new(RwLock::new(HashMap::new())),
            interaction_broker,
            plan_service,
        }
    }

    pub fn interaction_broker(&self) -> &Arc<InteractionBroker> {
        &self.interaction_broker
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
        startup_strategy: SessionStartupStrategy,
        last_seq: i64,
        system_prompt_append: Option<String>,
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
                    native_session_id: existing
                        .native_session_id()
                        .or(session.native_session_id)
                        .unwrap_or_default(),
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
            interaction_broker: self.interaction_broker.clone(),
            plan_service: self.plan_service.clone(),
            event_tx,
            session_store,
            mcp_servers,
            startup_strategy,
            last_seq,
            system_prompt_append,
            on_turn_finish,
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
            startup_strategy = startup_strategy_label,
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

    pub async fn start_replay_session(
        &self,
        session: SessionRecord,
        events: Vec<SessionEventEnvelope>,
        speed: f32,
        session_store: SessionStore,
        last_seq: i64,
    ) -> anyhow::Result<(Arc<LiveSessionHandle>, ActorReadyResult)> {
        let session_id = session.id.clone();
        let mut sessions = self.live_sessions.write().await;
        if let Some(existing) = sessions.get(&session_id) {
            return Ok((
                existing.clone(),
                ActorReadyResult {
                    native_session_id: existing
                        .native_session_id()
                        .or(session.native_session_id)
                        .unwrap_or_default(),
                },
            ));
        }

        let (event_tx, _) = broadcast::channel::<SessionEventEnvelope>(4096);
        let live_sessions = self.live_sessions.clone();
        let exit_session_id = session_id.clone();
        let exit_store = session_store.clone();
        let on_exit: Box<dyn FnOnce(bool) + Send + 'static> = Box::new(move |errored| {
            live_sessions.blocking_write().remove(&exit_session_id);
            if errored {
                let now = chrono::Utc::now().to_rfc3339();
                let _ = exit_store.update_status(&exit_session_id, "errored", &now);
            }
        });

        let config = ReplayActorConfig {
            session,
            events,
            speed,
            event_tx,
            session_store,
            last_seq,
            on_exit: Some(on_exit),
        };
        let (handle, ready) = spawn_replay_actor(config)?;
        sessions.insert(session_id, handle.clone());
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
            interaction_broker: self.interaction_broker.clone(),
            plan_service: self.plan_service.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::Arc;

    use tokio::sync::{broadcast, mpsc};

    use super::AcpManager;
    use crate::acp::session_actor::{LiveSessionHandle, SessionStartupStrategy};
    use crate::agents::model::{
        AgentKind, ArtifactRole, CredentialState, ResolvedAgent, ResolvedAgentStatus,
        ResolvedArtifact,
    };
    use crate::agents::registry::built_in_registry;
    use crate::persistence::Db;
    use crate::plans::{service::PlanService, store::PlanStore};
    use crate::sessions::model::SessionRecord;
    use crate::sessions::store::SessionStore;
    use anyharness_contract::v1::{SessionEventEnvelope, SessionExecutionPhase};

    fn resolved_agent(kind: AgentKind) -> ResolvedAgent {
        let descriptor = built_in_registry()
            .into_iter()
            .find(|descriptor| descriptor.kind == kind)
            .expect("missing descriptor");

        ResolvedAgent {
            descriptor,
            status: ResolvedAgentStatus::Ready,
            credential_state: CredentialState::Ready,
            native: Some(ResolvedArtifact {
                role: ArtifactRole::NativeCli,
                installed: true,
                source: Some("managed".into()),
                version: None,
                path: Some(PathBuf::from("/tmp/managed/claude")),
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

    fn session_record() -> SessionRecord {
        SessionRecord {
            id: "session-1".to_string(),
            workspace_id: "workspace-1".to_string(),
            agent_kind: AgentKind::Claude.as_str().to_string(),
            native_session_id: Some("stale-native".to_string()),
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
            system_prompt_append: None,
        }
    }

    #[tokio::test]
    async fn reused_live_handle_reports_the_live_native_session_id() {
        let plan_db = Db::open_in_memory().expect("open plan db");
        let manager = AcpManager::new(Arc::new(PlanService::new(PlanStore::new(plan_db))));
        let (command_tx, _command_rx) = mpsc::channel(4);
        let (event_tx, _) = broadcast::channel::<SessionEventEnvelope>(4);
        let handle = Arc::new(LiveSessionHandle::new_for_test(
            "session-1",
            command_tx,
            event_tx,
            Some("fresh-native".to_string()),
            SessionExecutionPhase::Idle,
        ));
        manager
            .live_sessions
            .write()
            .await
            .insert("session-1".to_string(), handle.clone());

        let (returned_handle, ready) = manager
            .start_session(
                session_record(),
                resolved_agent(AgentKind::Claude),
                PathBuf::from("/tmp/workspace"),
                Default::default(),
                Default::default(),
                SessionStore::new(Db::open_in_memory().expect("open db")),
                vec![],
                SessionStartupStrategy::ResumeSeqFreshNative,
                0,
                None,
                None,
                None,
            )
            .await
            .expect("reuse existing handle");

        assert!(Arc::ptr_eq(&returned_handle, &handle));
        assert_eq!(ready.native_session_id, "fresh-native");
    }
}
