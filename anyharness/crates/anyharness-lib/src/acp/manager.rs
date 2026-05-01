use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, RwLock as StdRwLock};
use std::time::Instant;

use tokio::sync::{broadcast, oneshot, watch, RwLock};

use super::permission_broker::InteractionBroker;
use super::replay_actor::{spawn_replay_actor, ReplayActorConfig};
use super::session_actor::{
    spawn_session_actor_pending, ActorReadyResult, LiveSessionHandle, SessionActorConfig,
    SessionStartupStrategy, SessionTurnFinishResult,
};
use crate::agents::model::ResolvedAgent;
use crate::api::http::latency::{latency_trace_fields, LatencyRequestContext};
use crate::plans::service::PlanService;
use crate::reviews::service::ReviewService;
use crate::sessions::mcp::SessionMcpServer;
use crate::sessions::model::SessionRecord;
use crate::sessions::runtime_event::{
    RuntimeEventInjectionError, RuntimeEventInjectionResult, RuntimeInjectedSessionEvent,
};
use crate::sessions::store::SessionStore;
use anyharness_contract::v1::SessionEventEnvelope;

type StartupReadinessState = Option<Result<String, String>>;

pub struct AcpManager {
    live_sessions: Arc<RwLock<HashMap<String, Arc<LiveSessionHandle>>>>,
    pending_startups: Arc<RwLock<HashMap<String, watch::Receiver<StartupReadinessState>>>>,
    interaction_broker: Arc<InteractionBroker>,
    plan_service: Arc<PlanService>,
    review_service: Arc<StdRwLock<Option<Arc<ReviewService>>>>,
}

impl AcpManager {
    pub fn new(plan_service: Arc<PlanService>) -> Self {
        let interaction_broker = Arc::new(InteractionBroker::new());
        Self {
            live_sessions: Arc::new(RwLock::new(HashMap::new())),
            pending_startups: Arc::new(RwLock::new(HashMap::new())),
            interaction_broker,
            plan_service,
            review_service: Arc::new(StdRwLock::new(None)),
        }
    }

    pub fn interaction_broker(&self) -> &Arc<InteractionBroker> {
        &self.interaction_broker
    }

    pub fn set_review_service(&self, review_service: Arc<ReviewService>) {
        if let Ok(mut guard) = self.review_service.write() {
            *guard = Some(review_service);
        }
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
        let config = SessionActorConfig {
            session,
            agent,
            workspace_path,
            workspace_env,
            session_launch_env,
            interaction_broker: self.interaction_broker.clone(),
            plan_service: self.plan_service.clone(),
            review_service: self
                .review_service
                .read()
                .ok()
                .and_then(|guard| guard.clone()),
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

    #[cfg_attr(not(test), allow(dead_code))]
    /// Inject a runtime-owned event into a session.
    ///
    /// If the live actor dies between handle lookup and command delivery, this
    /// transparently removes the stale handle and appends the event offline
    /// under the same start/inject critical section. `ActorUnavailable` is
    /// therefore terminal from the caller's perspective, not a normal retry
    /// signal.
    pub(crate) async fn emit_runtime_event(
        &self,
        session_id: &str,
        session_store: SessionStore,
        event: RuntimeInjectedSessionEvent,
    ) -> RuntimeEventInjectionResult {
        loop {
            let handle = {
                let sessions = self.live_sessions.write().await;
                if let Some(handle) = sessions.get(session_id) {
                    handle.clone()
                } else {
                    return append_offline_runtime_event(session_id, &session_store, event);
                }
            };

            let (tx, rx) = oneshot::channel();
            let send_result = handle
                .command_tx
                .send(super::session_actor::SessionCommand::InjectRuntimeEvent {
                    event: event.clone(),
                    respond_to: tx,
                })
                .await
                .map_err(|_| RuntimeEventInjectionError::ActorUnavailable);
            let result = match send_result {
                Ok(()) => rx
                    .await
                    .map_err(|_| RuntimeEventInjectionError::ActorUnavailable),
                Err(error) => Err(error),
            };
            match result {
                Ok(result) => return result,
                Err(RuntimeEventInjectionError::ActorUnavailable) => {
                    let mut sessions = self.live_sessions.write().await;
                    match sessions.get(session_id) {
                        Some(current) if Arc::ptr_eq(current, &handle) => {
                            sessions.remove(session_id);
                            return append_offline_runtime_event(session_id, &session_store, event);
                        }
                        None => {
                            return append_offline_runtime_event(session_id, &session_store, event);
                        }
                        Some(_) => continue,
                    }
                }
                Err(error) => return Err(error),
            }
        }
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

fn append_offline_runtime_event(
    session_id: &str,
    session_store: &SessionStore,
    event: RuntimeInjectedSessionEvent,
) -> RuntimeEventInjectionResult {
    let touch_session_activity = event.updates_session_activity_at();
    session_store
        .append_event_with_next_seq(
            session_id,
            event.into_session_event(),
            touch_session_activity,
        )
        .map_err(|error| RuntimeEventInjectionError::PersistenceFailed(error.to_string()))
}

impl Clone for AcpManager {
    fn clone(&self) -> Self {
        Self {
            live_sessions: self.live_sessions.clone(),
            pending_startups: self.pending_startups.clone(),
            interaction_broker: self.interaction_broker.clone(),
            plan_service: self.plan_service.clone(),
            review_service: self.review_service.clone(),
        }
    }
}

async fn wait_for_new_startup_readiness(
    pending: super::session_actor::PendingSessionActor,
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

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::Arc;

    use rusqlite::params;
    use tokio::sync::{broadcast, mpsc, watch};
    use tokio::time::{sleep, Duration};

    use super::AcpManager;
    use crate::acp::session_actor::{LiveSessionHandle, SessionStartupStrategy};
    use crate::agents::model::{
        AgentKind, ArtifactRole, CredentialState, ResolvedAgent, ResolvedAgentStatus,
        ResolvedArtifact,
    };
    use crate::agents::registry::built_in_registry;
    use crate::persistence::Db;
    use crate::plans::{service::PlanService, store::PlanStore};
    use crate::sessions::model::{SessionEventRecord, SessionRecord};
    use crate::sessions::runtime_event::RuntimeInjectedSessionEvent;
    use crate::sessions::store::SessionStore;
    use anyharness_contract::v1::{
        SessionEvent, SessionEventEnvelope, SessionExecutionPhase, SessionInfoUpdatePayload,
        SubagentTurnCompletedPayload, SubagentTurnOutcome,
    };

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
            mcp_binding_policy: crate::sessions::model::SessionMcpBindingPolicy::InheritWorkspace,
            system_prompt_append: None,
            subagents_enabled: true,
            origin: None,
        }
    }

    fn seeded_session_store() -> SessionStore {
        let db = Db::open_in_memory().expect("open db");
        db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO workspaces (id, kind, path, source_repo_root_path, created_at, updated_at)
                 VALUES (?1, 'repo', '/tmp/workspace', '/tmp/workspace', ?2, ?2)",
                params!["workspace-1", "2026-03-25T00:00:00Z"],
            )?;
            Ok(())
        })
        .expect("seed workspace");
        let store = SessionStore::new(db);
        store.insert(&session_record()).expect("insert session");
        store
    }

    fn subagent_turn_completed_event() -> RuntimeInjectedSessionEvent {
        RuntimeInjectedSessionEvent::SubagentTurnCompleted(SubagentTurnCompletedPayload {
            completion_id: "completion-1".to_string(),
            session_link_id: "link-1".to_string(),
            parent_session_id: "session-1".to_string(),
            child_session_id: "child-session-1".to_string(),
            child_turn_id: "turn-1".to_string(),
            child_last_event_seq: 4,
            outcome: SubagentTurnOutcome::Completed,
            label: Some("worker".to_string()),
        })
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
                None,
                None,
                None,
            )
            .await
            .expect("reuse existing handle");

        assert!(Arc::ptr_eq(&returned_handle, &handle));
        assert_eq!(ready.native_session_id, "fresh-native");
    }

    #[tokio::test]
    async fn reused_pending_live_handle_waits_for_shared_startup_readiness() {
        let plan_db = Db::open_in_memory().expect("open plan db");
        let manager = AcpManager::new(Arc::new(PlanService::new(PlanStore::new(plan_db))));
        let (command_tx, _command_rx) = mpsc::channel(4);
        let (event_tx, _) = broadcast::channel::<SessionEventEnvelope>(4);
        let handle = Arc::new(LiveSessionHandle::new_for_test(
            "session-1",
            command_tx,
            event_tx,
            None,
            SessionExecutionPhase::Starting,
        ));
        let (ready_tx, ready_rx) = watch::channel::<super::StartupReadinessState>(None);
        manager
            .live_sessions
            .write()
            .await
            .insert("session-1".to_string(), handle.clone());
        manager
            .pending_startups
            .write()
            .await
            .insert("session-1".to_string(), ready_rx);

        let manager_for_start = manager.clone();
        let mut start = tokio::spawn(async move {
            manager_for_start
                .start_session(
                    session_record(),
                    resolved_agent(AgentKind::Claude),
                    PathBuf::from("/tmp/workspace"),
                    Default::default(),
                    Default::default(),
                    SessionStore::new(Db::open_in_memory().expect("open db")),
                    vec![],
                    SessionStartupStrategy::ResumeSeqFreshNative,
                    None,
                    None,
                    None,
                )
                .await
        });

        tokio::select! {
            _ = &mut start => panic!("pending handle reuse returned before startup readiness"),
            _ = sleep(Duration::from_millis(20)) => {}
        }

        ready_tx
            .send(Some(Ok("fresh-native".to_string())))
            .expect("send readiness");
        let (returned_handle, ready) = start
            .await
            .expect("start task")
            .expect("reuse pending handle");

        assert!(Arc::ptr_eq(&returned_handle, &handle));
        assert_eq!(ready.native_session_id, "fresh-native");
    }

    #[tokio::test]
    async fn offline_runtime_event_injection_appends_with_next_sequence() {
        let plan_db = Db::open_in_memory().expect("open plan db");
        let manager = AcpManager::new(Arc::new(PlanService::new(PlanStore::new(plan_db))));
        let store = seeded_session_store();
        store
            .append_event(&SessionEventRecord {
                id: 0,
                session_id: "session-1".to_string(),
                seq: 1,
                timestamp: "2026-03-25T00:01:00Z".to_string(),
                event_type: "turn_started".to_string(),
                turn_id: Some("turn-1".to_string()),
                item_id: None,
                payload_json: r#"{"type":"turn_started"}"#.to_string(),
            })
            .expect("append existing event");

        let envelope = manager
            .emit_runtime_event(
                "session-1",
                store.clone(),
                RuntimeInjectedSessionEvent::SessionInfoUpdate {
                    title: Some("Renamed".to_string()),
                    updated_at: Some("2026-03-25T00:02:00Z".to_string()),
                },
            )
            .await
            .expect("emit runtime event");

        assert_eq!(envelope.seq, 2);
        let events = store.list_events("session-1").expect("list events");
        assert_eq!(
            events.iter().map(|event| event.seq).collect::<Vec<_>>(),
            vec![1, 2]
        );
        assert_eq!(events[1].event_type, "session_info_update");
        let session = store
            .find_by_id("session-1")
            .expect("find session")
            .expect("session exists");
        assert_eq!(session.updated_at, "2026-03-25T00:00:00Z");
    }

    #[tokio::test]
    async fn offline_runtime_activity_event_touches_session_updated_at() {
        let plan_db = Db::open_in_memory().expect("open plan db");
        let manager = AcpManager::new(Arc::new(PlanService::new(PlanStore::new(plan_db))));
        let store = seeded_session_store();

        let envelope = manager
            .emit_runtime_event("session-1", store.clone(), subagent_turn_completed_event())
            .await
            .expect("emit runtime event");

        let session = store
            .find_by_id("session-1")
            .expect("find session")
            .expect("session exists");
        assert_eq!(session.updated_at, envelope.timestamp);

        let events = store.list_events("session-1").expect("list events");
        assert_eq!(events[0].event_type, "subagent_turn_completed");
    }

    #[tokio::test]
    async fn offline_runtime_event_injection_serializes_concurrent_appends() {
        let plan_db = Db::open_in_memory().expect("open plan db");
        let manager = AcpManager::new(Arc::new(PlanService::new(PlanStore::new(plan_db))));
        let store = seeded_session_store();

        let first = manager.emit_runtime_event(
            "session-1",
            store.clone(),
            RuntimeInjectedSessionEvent::SessionInfoUpdate {
                title: Some("First".to_string()),
                updated_at: None,
            },
        );
        let second = manager.emit_runtime_event(
            "session-1",
            store.clone(),
            RuntimeInjectedSessionEvent::SessionInfoUpdate {
                title: Some("Second".to_string()),
                updated_at: None,
            },
        );

        let (first, second) = tokio::join!(first, second);
        let mut seqs = vec![
            first.expect("first injection").seq,
            second.expect("second injection").seq,
        ];
        seqs.sort_unstable();
        assert_eq!(seqs, vec![1, 2]);

        let events = store.list_events("session-1").expect("list events");
        assert_eq!(
            events.iter().map(|event| event.seq).collect::<Vec<_>>(),
            vec![1, 2]
        );
    }

    #[tokio::test]
    async fn runtime_event_injection_falls_back_when_live_handle_is_stale() {
        let plan_db = Db::open_in_memory().expect("open plan db");
        let manager = AcpManager::new(Arc::new(PlanService::new(PlanStore::new(plan_db))));
        let store = seeded_session_store();
        let (command_tx, command_rx) = mpsc::channel(1);
        drop(command_rx);
        let (event_tx, _) = broadcast::channel::<SessionEventEnvelope>(4);
        let handle = Arc::new(LiveSessionHandle::new_for_test(
            "session-1",
            command_tx,
            event_tx,
            Some("native-1".to_string()),
            SessionExecutionPhase::Idle,
        ));
        manager
            .live_sessions
            .write()
            .await
            .insert("session-1".to_string(), handle);

        let envelope = manager
            .emit_runtime_event(
                "session-1",
                store.clone(),
                RuntimeInjectedSessionEvent::SessionInfoUpdate {
                    title: Some("Renamed".to_string()),
                    updated_at: None,
                },
            )
            .await
            .expect("fallback append");

        assert_eq!(envelope.seq, 1);
        assert!(manager
            .live_sessions
            .read()
            .await
            .get("session-1")
            .is_none());
        let events = store.list_events("session-1").expect("list events");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, "session_info_update");
    }

    #[tokio::test]
    async fn live_runtime_event_injection_routes_through_actor_command() {
        let plan_db = Db::open_in_memory().expect("open plan db");
        let manager = AcpManager::new(Arc::new(PlanService::new(PlanStore::new(plan_db))));
        let store = seeded_session_store();
        let (command_tx, mut command_rx) = mpsc::channel(4);
        let (event_tx, _) = broadcast::channel::<SessionEventEnvelope>(4);
        let handle = Arc::new(LiveSessionHandle::new_for_test(
            "session-1",
            command_tx,
            event_tx,
            Some("native-1".to_string()),
            SessionExecutionPhase::Idle,
        ));
        manager
            .live_sessions
            .write()
            .await
            .insert("session-1".to_string(), handle);

        let actor = tokio::spawn(async move {
            let Some(super::super::session_actor::SessionCommand::InjectRuntimeEvent {
                respond_to,
                ..
            }) = command_rx.recv().await
            else {
                panic!("expected InjectRuntimeEvent");
            };
            let _ = respond_to.send(Ok(SessionEventEnvelope {
                session_id: "session-1".to_string(),
                seq: 11,
                timestamp: "2026-03-25T00:02:00Z".to_string(),
                turn_id: None,
                item_id: None,
                event: SessionEvent::SessionInfoUpdate(SessionInfoUpdatePayload {
                    title: Some("Renamed".to_string()),
                    updated_at: Some("2026-03-25T00:02:00Z".to_string()),
                }),
            }));
        });

        let envelope = manager
            .emit_runtime_event(
                "session-1",
                store,
                RuntimeInjectedSessionEvent::SessionInfoUpdate {
                    title: Some("Renamed".to_string()),
                    updated_at: None,
                },
            )
            .await
            .expect("emit runtime event");

        assert_eq!(envelope.seq, 11);
        actor.await.expect("actor task");
    }
}
