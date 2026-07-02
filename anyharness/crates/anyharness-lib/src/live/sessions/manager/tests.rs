use std::path::PathBuf;
use std::sync::Arc;

use anyharness_contract::v1::{
    SessionEvent, SessionEventEnvelope, SessionExecutionPhase, SessionInfoUpdatePayload,
    SubagentTurnCompletedPayload, SubagentTurnOutcome,
};
use tokio::sync::{broadcast, mpsc, watch};
use tokio::time::{sleep, Duration};

use super::LiveSessionManager;
use crate::app::test_support;
use crate::domains::agents::model::{
    AgentKind, ArtifactRole, CredentialState, ResolvedAgent, ResolvedAgentStatus, ResolvedArtifact,
};
use crate::domains::agents::registry::built_in_registry;
use crate::domains::sessions::model::{SessionEventRecord, SessionRecord};
use crate::domains::sessions::runtime_event::RuntimeInjectedSessionEvent;
use crate::domains::sessions::store::SessionStore;
use crate::live::sessions::actor::command::SessionCommand;
use crate::live::sessions::handle::LiveSessionHandle;
use crate::live::sessions::model::{
    LaunchEnv, SessionHooks, SessionLaunch, SessionStartupStrategy, SystemPromptAppends,
};
use crate::persistence::Db;

fn resolved_agent(kind: AgentKind) -> ResolvedAgent {
    let descriptor = built_in_registry()
        .into_iter()
        .find(|descriptor| descriptor.kind == kind)
        .expect("missing descriptor");

    ResolvedAgent {
        descriptor,
        status: ResolvedAgentStatus::Ready,
        credential_state: CredentialState::Ready,
        auth_slots: Vec::new(),
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
        agent_auth_contexts: None,
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
        mcp_binding_policy:
            crate::domains::sessions::model::SessionMcpBindingPolicy::InheritWorkspace,
        system_prompt_append: None,
        subagents_enabled: true,
        action_capabilities_json: None,
        origin: None,
    }
}

fn seeded_session_store() -> SessionStore {
    let db = Db::open_in_memory().expect("open db");
    test_support::seed_workspace_with_repo_root(&db, "workspace-1", "local", "/tmp/workspace");
    let store = SessionStore::new(db);
    store.insert(&session_record()).expect("insert session");
    store
}

fn manager_for_store(store: &SessionStore) -> LiveSessionManager {
    LiveSessionManager::new(test_support::actor_capabilities_for_store(store))
}

fn test_launch(startup: SessionStartupStrategy) -> SessionLaunch {
    SessionLaunch {
        session: session_record(),
        agent: resolved_agent(AgentKind::Claude),
        workspace_path: PathBuf::from("/tmp/workspace"),
        env: LaunchEnv::default(),
        mcp_servers: vec![],
        startup,
        prompts: SystemPromptAppends::default(),
        last_seq: 0,
    }
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
    let manager = manager_for_store(&SessionStore::new(Db::open_in_memory().expect("open db")));
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
            test_launch(SessionStartupStrategy::ResumeSeqFreshNative),
            SessionHooks::default(),
        )
        .await
        .expect("reuse existing handle");

    assert!(Arc::ptr_eq(&returned_handle, &handle));
    assert_eq!(ready.native_session_id, "fresh-native");
}

#[tokio::test]
async fn reused_pending_live_handle_waits_for_shared_startup_readiness() {
    let manager = manager_for_store(&SessionStore::new(Db::open_in_memory().expect("open db")));
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
                test_launch(SessionStartupStrategy::ResumeSeqFreshNative),
                SessionHooks::default(),
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
async fn blocking_remove_discards_live_and_pending_handles() {
    let manager = manager_for_store(&SessionStore::new(Db::open_in_memory().expect("open db")));
    let (command_tx, _command_rx) = mpsc::channel(4);
    let (event_tx, _) = broadcast::channel::<SessionEventEnvelope>(4);
    let handle = Arc::new(LiveSessionHandle::new_for_test(
        "session-1",
        command_tx,
        event_tx,
        Some("old-native".to_string()),
        SessionExecutionPhase::Idle,
    ));
    let (_ready_tx, ready_rx) = watch::channel::<super::StartupReadinessState>(None);
    manager
        .live_sessions
        .write()
        .await
        .insert("session-1".to_string(), handle);
    manager
        .pending_startups
        .write()
        .await
        .insert("session-1".to_string(), ready_rx);

    let manager_for_remove = manager.clone();
    tokio::task::spawn_blocking(move || {
        manager_for_remove.remove_session_blocking("session-1");
    })
    .await
    .expect("blocking remove task");

    assert!(manager
        .live_sessions
        .read()
        .await
        .get("session-1")
        .is_none());
    assert!(manager
        .pending_startups
        .read()
        .await
        .get("session-1")
        .is_none());
}

#[tokio::test]
async fn async_remove_discards_live_and_pending_handles() {
    let manager = manager_for_store(&SessionStore::new(Db::open_in_memory().expect("open db")));
    let (command_tx, _command_rx) = mpsc::channel(4);
    let (event_tx, _) = broadcast::channel::<SessionEventEnvelope>(4);
    let handle = Arc::new(LiveSessionHandle::new_for_test(
        "session-1",
        command_tx,
        event_tx,
        Some("old-native".to_string()),
        SessionExecutionPhase::Idle,
    ));
    let (_ready_tx, ready_rx) = watch::channel::<super::StartupReadinessState>(None);
    manager
        .live_sessions
        .write()
        .await
        .insert("session-1".to_string(), handle);
    manager
        .pending_startups
        .write()
        .await
        .insert("session-1".to_string(), ready_rx);

    manager.remove_session("session-1").await;

    assert!(manager
        .live_sessions
        .read()
        .await
        .get("session-1")
        .is_none());
    assert!(manager
        .pending_startups
        .read()
        .await
        .get("session-1")
        .is_none());
}

#[tokio::test]
async fn offline_runtime_event_injection_appends_with_next_sequence() {
    let store = seeded_session_store();
    let manager = manager_for_store(&store);
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
    let store = seeded_session_store();
    let manager = manager_for_store(&store);

    let envelope = manager
        .emit_runtime_event("session-1", subagent_turn_completed_event())
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
    let store = seeded_session_store();
    let manager = manager_for_store(&store);

    let first = manager.emit_runtime_event(
        "session-1",
        RuntimeInjectedSessionEvent::SessionInfoUpdate {
            title: Some("First".to_string()),
            updated_at: None,
        },
    );
    let second = manager.emit_runtime_event(
        "session-1",
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
    let store = seeded_session_store();
    let manager = manager_for_store(&store);
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
    let store = seeded_session_store();
    let manager = manager_for_store(&store);
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
        let Some(SessionCommand::InjectRuntimeEvent { respond_to, .. }) = command_rx.recv().await
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
