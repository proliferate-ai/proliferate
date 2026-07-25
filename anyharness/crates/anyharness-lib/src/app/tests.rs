use std::path::PathBuf;
use std::sync::Mutex;

use anyharness_contract::v1::{
    SessionMcpBindingOutcome, SessionMcpBindingSummary, SessionMcpTransport,
};

use super::{proliferate_home_dir_name, test_support, AppState};
use crate::domains::agents::installer::seed::AgentSeedStore;
use crate::domains::sessions::mcp_bindings::crypto::{encrypt_bindings, SessionDataCipher};
use crate::domains::sessions::mcp_bindings::model::{
    SessionMcpHeader, SessionMcpHttpServer, SessionMcpServer,
};
use crate::domains::sessions::mcp_bindings::summaries::serialize_binding_summaries;
use crate::domains::sessions::model::{SessionMcpBindingPolicy, SessionRecord};
use crate::domains::sessions::store::SessionStore;
use crate::live::sessions::model::SessionProcessPolicy;
use crate::live::workflows::isolation::{
    WorkflowDeliveryIdentity, WorkflowProcessIdentity, WorkflowProcessSubject,
};
use crate::origin::OriginContext;
use crate::persistence::Db;

#[tokio::test(flavor = "current_thread")]
async fn app_state_allows_missing_bearer_token_when_not_required() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("expected env mutex");
    let _guard = test_support::set_bearer_token_env(None);
    let _data_key_guard = test_support::set_data_key_env(None);

    let state = AppState::new(
        PathBuf::from("/tmp/anyharness-app-state-no-token"),
        "http://127.0.0.1:8457".to_string(),
        Db::open_in_memory().expect("expected in-memory db"),
        false,
        AgentSeedStore::not_configured_dev(),
    )
    .expect("expected app state");

    assert_eq!(state.bearer_token, None);
}

#[tokio::test(flavor = "current_thread")]
async fn app_state_rejects_missing_bearer_token_when_required() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("expected env mutex");
    let _guard = test_support::set_bearer_token_env(None);
    let _data_key_guard = test_support::set_data_key_env(None);

    let error = AppState::new(
        PathBuf::from("/tmp/anyharness-app-state-required-token"),
        "http://127.0.0.1:8457".to_string(),
        Db::open_in_memory().expect("expected in-memory db"),
        true,
        AgentSeedStore::not_configured_dev(),
    )
    .err()
    .expect("expected missing bearer token error");

    assert_eq!(
        error.to_string(),
        "ANYHARNESS_BEARER_TOKEN is required when --require-bearer-auth is set, but the \
environment variable is missing or empty. Refusing to start without authentication."
    );
}

#[tokio::test(flavor = "current_thread")]
async fn app_state_rejects_blank_bearer_token_when_required() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("expected env mutex");
    let _guard = test_support::set_bearer_token_env(Some("   "));
    let _data_key_guard = test_support::set_data_key_env(None);

    let error = AppState::new(
        PathBuf::from("/tmp/anyharness-app-state-blank-token"),
        "http://127.0.0.1:8457".to_string(),
        Db::open_in_memory().expect("expected in-memory db"),
        true,
        AgentSeedStore::not_configured_dev(),
    )
    .err()
    .expect("expected blank bearer token error");

    assert_eq!(
        error.to_string(),
        "ANYHARNESS_BEARER_TOKEN is required when --require-bearer-auth is set, but the \
environment variable is missing or empty. Refusing to start without authentication."
    );
}

#[tokio::test(flavor = "current_thread")]
async fn app_state_rejects_invalid_data_key() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("expected env mutex");
    let _guard = test_support::set_bearer_token_env(None);
    let _data_key_guard = test_support::set_data_key_env(Some("not-base64"));

    let error = AppState::new(
        PathBuf::from("/tmp/anyharness-app-state-invalid-data-key"),
        "http://127.0.0.1:8457".to_string(),
        Db::open_in_memory().expect("expected in-memory db"),
        false,
        AgentSeedStore::not_configured_dev(),
    )
    .err()
    .expect("expected invalid data key error");

    assert!(
        error
            .to_string()
            .starts_with("Invalid ANYHARNESS_DATA_KEY:"),
        "unexpected error: {error}"
    );
}

#[tokio::test(flavor = "current_thread")]
async fn app_state_wires_integration_gateway_extension_to_served_runtime_home() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("expected env mutex");
    let _guard = test_support::set_bearer_token_env(None);
    let _data_key_guard = test_support::set_data_key_env(None);

    // Regression: the extension used to be constructed with
    // default_runtime_home(), so serving with --runtime-home never picked up
    // the worker-written integration-gateway.json dotfile.
    let runtime_home = PathBuf::from("/tmp/anyharness-app-state-gateway-home");
    let state = AppState::new(
        runtime_home.clone(),
        "http://127.0.0.1:8457".to_string(),
        Db::open_in_memory().expect("expected in-memory db"),
        false,
        AgentSeedStore::not_configured_dev(),
    )
    .expect("expected app state");

    assert_eq!(
        state
            .integration_gateway_session_launch_extension
            .runtime_home(),
        runtime_home.as_path()
    );
}

#[tokio::test(flavor = "current_thread")]
async fn workflow_rebind_and_restart_preserve_durable_mcp_bindings() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("expected env mutex");
    let _token_guard = test_support::set_bearer_token_env(None);
    let _data_key_guard =
        test_support::set_data_key_env(Some("MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="));

    let db = Db::open_in_memory().expect("expected in-memory db");
    test_support::seed_workspace_with_repo_root(
        &db,
        "workspace-mcp-preserve",
        "local",
        "/tmp/workspace-mcp-preserve",
    );
    let state = AppState::new(
        PathBuf::from("/tmp/anyharness-app-state-mcp-preserve"),
        "http://127.0.0.1:8457".to_string(),
        db.clone(),
        false,
        AgentSeedStore::not_configured_dev(),
    )
    .expect("expected app state");
    let binding = SessionMcpServer::Http(SessionMcpHttpServer {
        connection_id: "connection-preserved".to_string(),
        catalog_entry_id: Some("test-provider".to_string()),
        server_name: "test-provider".to_string(),
        url: "https://provider.invalid/mcp".to_string(),
        headers: vec![SessionMcpHeader {
            name: "Authorization".to_string(),
            value: "Bearer encrypted-user-binding-canary".to_string(),
        }],
    });
    let summary = SessionMcpBindingSummary {
        id: "connection-preserved".to_string(),
        server_name: "test-provider".to_string(),
        display_name: Some("Preserved provider".to_string()),
        transport: SessionMcpTransport::Http,
        outcome: SessionMcpBindingOutcome::Applied,
        reason: None,
    };
    let cipher = SessionDataCipher::from_env_value("MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")
        .expect("data cipher");
    let encrypted = encrypt_bindings(Some(&cipher), &[binding])
        .expect("encrypt binding")
        .expect("encrypted binding payload");
    let summaries = serialize_binding_summaries(Some(vec![summary]))
        .expect("serialize summary")
        .expect("summary payload");
    let session = SessionRecord {
        id: "session-mcp-preserve".to_string(),
        workspace_id: "workspace-mcp-preserve".to_string(),
        agent_kind: "claude".to_string(),
        native_session_id: None,
        agent_auth_contexts: None,
        requested_model_id: None,
        current_model_id: None,
        requested_mode_id: None,
        current_mode_id: None,
        title: None,
        thinking_level_id: None,
        thinking_budget_tokens: None,
        status: "idle".to_string(),
        created_at: "2026-07-11T00:00:00Z".to_string(),
        updated_at: "2026-07-11T00:00:00Z".to_string(),
        last_prompt_at: None,
        closed_at: None,
        dismissed_at: None,
        mcp_bindings_ciphertext: Some(encrypted),
        mcp_binding_summaries_json: Some(summaries),
        mcp_binding_policy: SessionMcpBindingPolicy::InheritWorkspace,
        system_prompt_append: None,
        subagents_enabled: true,
        action_capabilities_json: None,
        origin: Some(OriginContext::system_local_runtime()),
    };
    SessionStore::new(db)
        .insert(&session)
        .expect("insert durable bound session");
    let before_ciphertext = session
        .mcp_bindings_ciphertext
        .clone()
        .expect("encrypted bindings");
    let before_summaries = session
        .mcp_binding_summaries_json
        .clone()
        .expect("binding summaries");

    let delivery = WorkflowDeliveryIdentity::try_new(
        "run-mcp-preserve",
        Some("sha256:1111111111111111111111111111111111111111111111111111111111111111"),
        Some("sha256:2222222222222222222222222222222222222222222222222222222222222222"),
        Some(1),
    )
    .expect("workflow delivery identity");
    let policy = SessionProcessPolicy::Workflow {
        identity: WorkflowProcessIdentity::new(
            delivery.clone(),
            WorkflowProcessSubject::Session {
                slot_id: "main".to_string(),
                session_id: session.id.clone(),
                root: std::path::PathBuf::from("/tmp/workspace-1"),
            },
        ),
        capability: crate::live::workflows::isolation::test_isolation_capability(delivery),
    };

    // Phase A intentionally has no platform broker, so these launches fail
    // closed. The regression assertion is that neither the workflow topology
    // relaunch nor the later ordinary restart treats that as an MCP refresh.
    let transition = state
        .session_runtime
        .lock_session_process_transition(&session.id)
        .await;
    let _ = state
        .session_runtime
        .relaunch_session_for_workflow_rebind_under_transition(&session.id, policy, &transition)
        .await;
    drop(transition);
    state.acp_manager.remove_session(&session.id).await;
    let _ = state
        .session_runtime
        .ensure_live_session(&session.id, None)
        .await;

    let after = state
        .session_service
        .get_session(&session.id)
        .expect("read session")
        .expect("session survives");
    assert_eq!(
        after.mcp_bindings_ciphertext.as_deref(),
        Some(before_ciphertext.as_str())
    );
    let after_summaries: Vec<SessionMcpBindingSummary> = serde_json::from_str(
        after
            .mcp_binding_summaries_json
            .as_deref()
            .expect("binding summaries survive"),
    )
    .expect("parse post-restart summaries");
    let before_summaries: Vec<SessionMcpBindingSummary> =
        serde_json::from_str(&before_summaries).expect("parse original summaries");
    for original in before_summaries {
        assert!(
            after_summaries.contains(&original),
            "durable user MCP summary was erased during workflow rebind/restart"
        );
    }
}

#[test]
fn proliferate_home_dir_name_uses_local_dir_for_debug_builds() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("expected env mutex");
    let _dev_guard = test_support::set_proliferate_dev_env(None);

    assert_eq!(proliferate_home_dir_name(true), ".proliferate-local");
}

#[test]
fn proliferate_home_dir_name_uses_local_dir_when_env_is_set() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("expected env mutex");
    let _dev_guard = test_support::set_proliferate_dev_env(Some("1"));

    assert_eq!(proliferate_home_dir_name(false), ".proliferate-local");
}

#[test]
fn proliferate_home_dir_name_uses_production_dir_for_release_without_env() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("expected env mutex");
    let _dev_guard = test_support::set_proliferate_dev_env(None);

    assert_eq!(proliferate_home_dir_name(false), ".proliferate");
}
