use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use agent_client_protocol as acp;
use anyharness_contract::v1::{
    NormalizedSessionControl, NormalizedSessionControlValue, NormalizedSessionControls,
    SessionEventEnvelope, SessionLiveConfigSnapshot,
};
use tokio::sync::{broadcast, mpsc, oneshot, Mutex};
use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};

use crate::app::test_support;
use crate::domains::sessions::model::{SessionMcpBindingPolicy, SessionRecord};
use crate::domains::sessions::store::SessionStore;
use crate::live::sessions::actor::config::apply::restore_persisted_live_config_if_needed;
use crate::live::sessions::actor::config::handle::{
    apply_requested_mode_preference, validate_requested_mode_outcome,
};
use crate::live::sessions::actor::config::persist::emit_live_config_update;
use crate::live::sessions::actor::config::types::{
    ConfigApplyOutcome, PersistedSessionConfigState,
};
use crate::live::sessions::actor::state::SessionStartupState;
use crate::live::sessions::sink::SessionEventSink;
use crate::persistence::Db;

const SESSION_ID: &str = "session-queued-mode";
const NATIVE_SESSION_ID: &str = "native-queued-mode";
const OLD_MODE: &str = "default";
const NEW_MODE: &str = "bypassPermissions";

#[test]
fn requested_startup_mode_requires_authoritative_confirmation() {
    for outcome in [
        ConfigApplyOutcome::NoChange,
        ConfigApplyOutcome::AppliedAuthoritative,
    ] {
        validate_requested_mode_outcome("claude", "bypassPermissions", outcome)
            .expect("authoritative mode outcome should be accepted");
    }

    for outcome in [
        ConfigApplyOutcome::AppliedRequested,
        ConfigApplyOutcome::NotApplied,
    ] {
        let error = validate_requested_mode_outcome("claude", "bypassPermissions", outcome)
            .expect_err("unconfirmed mode outcome must fail session startup");
        assert_eq!(
            error.to_string(),
            "mode 'bypassPermissions' is not supported by the active session for agent 'claude'"
        );
    }
}

#[tokio::test]
async fn queued_mode_wins_over_stale_snapshot_on_cold_resume() {
    tokio::task::LocalSet::new()
        .run_until(async {
            let (conn, _shutdown, mut applied_modes) = mode_test_connection().await;
            let session = queued_mode_session();
            let (store, event_sink) = session_store_and_sink(&session);
            let mut persisted_config_state = PersistedSessionConfigState::from_session(&session);
            // Recreate the vulnerable intermediate state: startup confirmed the queued
            // mode, but the captured pre-queue snapshot still contains the old mode.
            let mut startup_state = SessionStartupState {
                current_mode_id: Some(NEW_MODE.to_string()),
                legacy_mode_state: None,
                config_options: vec![mode_option(NEW_MODE)],
                current_model_id: None,
                available_models: Vec::new(),
                prompt_capabilities: Default::default(),
            };

            restore_persisted_live_config_if_needed(
                &conn,
                NATIVE_SESSION_ID,
                "claude",
                SESSION_ID,
                &store,
                &event_sink,
                &mut persisted_config_state,
                &mut startup_state,
                Some(&stale_mode_snapshot()),
            )
            .await
            .expect("restore stale pre-queue snapshot");
            assert_eq!(startup_state.current_mode_id.as_deref(), Some(OLD_MODE));

            apply_requested_mode_preference(&conn, NATIVE_SESSION_ID, &session, &mut startup_state)
                .await
                .expect("final requested-mode confirmation");
            emit_live_config_update(
                "claude",
                SESSION_ID,
                &store,
                &event_sink,
                &mut persisted_config_state,
                &mut startup_state,
                "2026-07-18T00:00:01Z".to_string(),
            )
            .await
            .expect("persist final live config");

            assert_eq!(
                next_applied_mode(&mut applied_modes).await.as_deref(),
                Some(OLD_MODE),
                "the resume restore reproduces the stale snapshot overwrite"
            );
            assert_eq!(
                next_applied_mode(&mut applied_modes).await.as_deref(),
                Some(NEW_MODE),
                "the queued requested mode must be the final authoritative write"
            );
            assert_eq!(startup_state.current_mode_id.as_deref(), Some(NEW_MODE));
            let persisted = store
                .find_by_id(SESSION_ID)
                .expect("read session")
                .expect("session exists");
            assert_eq!(persisted.requested_mode_id.as_deref(), Some(NEW_MODE));
            assert_eq!(persisted.current_mode_id.as_deref(), Some(NEW_MODE));
        })
        .await;
}

fn queued_mode_session() -> SessionRecord {
    SessionRecord {
        id: SESSION_ID.to_string(),
        workspace_id: "workspace-1".to_string(),
        agent_kind: "claude".to_string(),
        native_session_id: Some(NATIVE_SESSION_ID.to_string()),
        agent_auth_contexts: None,
        requested_model_id: None,
        current_model_id: None,
        requested_mode_id: Some(NEW_MODE.to_string()),
        current_mode_id: Some(OLD_MODE.to_string()),
        title: None,
        thinking_level_id: None,
        thinking_budget_tokens: None,
        status: "busy".to_string(),
        created_at: "2026-07-18T00:00:00Z".to_string(),
        updated_at: "2026-07-18T00:00:00Z".to_string(),
        last_prompt_at: None,
        closed_at: None,
        dismissed_at: None,
        mcp_bindings_ciphertext: None,
        mcp_binding_summaries_json: None,
        mcp_binding_policy: SessionMcpBindingPolicy::InheritWorkspace,
        system_prompt_append: None,
        subagents_enabled: true,
        action_capabilities_json: None,
        origin: None,
    }
}

async fn next_applied_mode(receiver: &mut mpsc::UnboundedReceiver<String>) -> Option<String> {
    tokio::time::timeout(Duration::from_secs(2), receiver.recv())
        .await
        .expect("mode application timeout")
}

fn session_store_and_sink(session: &SessionRecord) -> (SessionStore, Arc<Mutex<SessionEventSink>>) {
    let db = Db::open_in_memory().expect("open db");
    test_support::seed_workspace_with_repo_root(&db, "workspace-1", "local", "/tmp/workspace");
    let store = SessionStore::new(db);
    store.insert(session).expect("insert session");
    let (event_tx, _) = broadcast::channel::<SessionEventEnvelope>(16);
    let sink = Arc::new(Mutex::new(SessionEventSink::new(
        SESSION_ID.to_string(),
        "claude".to_string(),
        PathBuf::from("/tmp/workspace"),
        event_tx,
        Arc::new(store.clone()),
    )));
    (store, sink)
}

fn stale_mode_snapshot() -> SessionLiveConfigSnapshot {
    SessionLiveConfigSnapshot {
        raw_config_options: Vec::new(),
        normalized_controls: NormalizedSessionControls {
            mode: Some(normalized_mode_control(OLD_MODE)),
            ..Default::default()
        },
        prompt_capabilities: Default::default(),
        source_seq: 1,
        updated_at: "2026-07-17T23:59:59Z".to_string(),
    }
}

fn normalized_mode_control(current: &str) -> NormalizedSessionControl {
    NormalizedSessionControl {
        key: "mode".to_string(),
        raw_config_id: "mode".to_string(),
        label: "Mode".to_string(),
        current_value: Some(current.to_string()),
        settable: true,
        values: vec![
            NormalizedSessionControlValue {
                value: OLD_MODE.to_string(),
                label: "Default".to_string(),
                description: None,
            },
            NormalizedSessionControlValue {
                value: NEW_MODE.to_string(),
                label: "Bypass permissions".to_string(),
                description: None,
            },
        ],
    }
}

fn mode_option(current: &str) -> acp::schema::SessionConfigOption {
    let mut option = acp::schema::SessionConfigOption::select(
        "mode",
        "Mode",
        current.to_string(),
        vec![
            acp::schema::SessionConfigSelectOption::new(OLD_MODE, "Default"),
            acp::schema::SessionConfigSelectOption::new(NEW_MODE, "Bypass permissions"),
        ],
    );
    option.category = Some(acp::schema::SessionConfigOptionCategory::Mode);
    option
}

async fn mode_test_connection() -> (
    acp::ConnectionTo<acp::Agent>,
    oneshot::Sender<()>,
    mpsc::UnboundedReceiver<String>,
) {
    let (client_io, agent_io) = tokio::io::duplex(64 * 1024);
    let (client_read, client_write) = tokio::io::split(client_io);
    let (agent_read, agent_write) = tokio::io::split(agent_io);
    let (cx_tx, cx_rx) = oneshot::channel::<acp::ConnectionTo<acp::Agent>>();
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let client_transport = acp::ByteStreams::new(client_write.compat_write(), client_read.compat());
    let client = acp::Client.builder().connect_with(
        client_transport,
        move |cx: acp::ConnectionTo<acp::Agent>| async move {
            let _ = cx_tx.send(cx);
            let _ = shutdown_rx.await;
            Ok(())
        },
    );
    tokio::task::spawn_local(async move {
        let _ = client.await;
    });

    let (applied_tx, applied_rx) = mpsc::unbounded_channel::<String>();
    let agent_transport = acp::ByteStreams::new(agent_write.compat_write(), agent_read.compat());
    let agent = acp::Agent
        .builder()
        .name("requested-mode-resume-test-agent")
        .on_receive_request(
            async move |request: acp::schema::SetSessionConfigOptionRequest,
                        responder: acp::Responder<acp::schema::SetSessionConfigOptionResponse>,
                        _cx| {
                let value = request
                    .value
                    .as_value_id()
                    .expect("mode request carries a value id")
                    .0
                    .to_string();
                let _ = applied_tx.send(value.clone());
                responder.respond(acp::schema::SetSessionConfigOptionResponse::new(vec![
                    mode_option(&value),
                ]))
            },
            acp::on_receive_request!(),
        )
        .connect_with(
            agent_transport,
            move |_cx: acp::ConnectionTo<acp::Client>| async move {
                std::future::pending::<()>().await;
                Ok(())
            },
        );
    tokio::task::spawn_local(async move {
        let _ = agent.await;
    });

    let conn = tokio::time::timeout(Duration::from_secs(2), cx_rx)
        .await
        .expect("client connection timeout")
        .expect("client connection established");
    (conn, shutdown_tx, applied_rx)
}
