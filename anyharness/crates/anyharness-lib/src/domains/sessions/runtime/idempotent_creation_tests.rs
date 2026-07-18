use std::sync::Mutex;

use tokio::time::{sleep, Duration};

use crate::app::{test_support, AppState};
use crate::domains::agents::installer::seed::AgentSeedStore;
use crate::domains::sessions::model::{SessionMcpBindingPolicy, SessionRecord};
use crate::live::sessions::ScriptedSessionSpec;
use crate::origin::OriginContext;
use crate::persistence::Db;

#[tokio::test(flavor = "current_thread")]
async fn create_replay_joins_pending_startup_and_persists_readiness() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("env mutex");
    let _bearer_guard = test_support::set_bearer_token_env(None);
    let _data_key_guard = test_support::set_data_key_env(None);
    let state = test_state("pending");
    let session_id = "01234567-89ab-4def-8123-456789abcdef";
    state
        .session_service
        .store()
        .insert(&starting_session(session_id))
        .expect("insert interrupted create row");
    let readiness = state
        .session_runtime
        .acp_manager_for_test()
        .insert_pending_startup_for_test(session_id)
        .await;

    let runtime = state.session_runtime.clone();
    let mut replay = tokio::spawn(async move {
        runtime
            .create_and_start_session_with_id(
                "workspace-1",
                "claude",
                Some(session_id),
                None,
                None,
                None,
                vec![],
                None,
                true,
                OriginContext::api_local_runtime(),
            )
            .await
    });
    tokio::select! {
        result = &mut replay => panic!("replay returned before readiness: {result:?}"),
        _ = sleep(Duration::from_millis(20)) => {}
    }
    let pending = state
        .session_service
        .get_session(session_id)
        .expect("load pending session")
        .expect("pending session exists");
    assert_eq!(pending.status, "starting");
    assert_eq!(pending.native_session_id, None);

    readiness
        .send(Some(Ok("fresh-native".to_string())))
        .expect("release startup readiness");
    let replayed = replay
        .await
        .expect("join replay")
        .expect("replay succeeds after readiness");
    assert_eq!(replayed.status, "idle");
    assert_eq!(replayed.native_session_id.as_deref(), Some("fresh-native"));

    let stored = state
        .session_service
        .get_session(session_id)
        .expect("load replayed session")
        .expect("replayed session exists");
    assert_eq!(stored.status, "idle");
    assert_eq!(stored.native_session_id.as_deref(), Some("fresh-native"));
}

#[tokio::test(flavor = "current_thread")]
async fn create_replay_persists_ready_handle_when_the_first_request_was_cancelled() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("env mutex");
    let _bearer_guard = test_support::set_bearer_token_env(None);
    let _data_key_guard = test_support::set_data_key_env(None);
    let state = test_state("ready");
    let session_id = "11234567-89ab-4def-8123-456789abcdef";
    state
        .session_service
        .store()
        .insert(&starting_session(session_id))
        .expect("insert interrupted create row");
    let _scripted = state
        .session_runtime
        .acp_manager_for_test()
        .insert_scripted_session_for_test(
            session_id,
            ScriptedSessionSpec {
                prompt_turn_id: "turn-unused".to_string(),
                hold_config_replies: false,
                hold_cancel_replies: false,
            },
        )
        .await;

    let replayed = state
        .session_runtime
        .create_and_start_session_with_id(
            "workspace-1",
            "claude",
            Some(session_id),
            None,
            None,
            None,
            vec![],
            None,
            true,
            OriginContext::api_local_runtime(),
        )
        .await
        .expect("ready replay succeeds");
    assert_eq!(replayed.status, "idle");
    assert_eq!(
        replayed.native_session_id.as_deref(),
        Some("native-11234567-89ab-4def-8123-456789abcdef")
    );

    let stored = state
        .session_service
        .get_session(session_id)
        .expect("load replayed session")
        .expect("replayed session exists");
    assert_eq!(stored.status, "idle");
    assert_eq!(stored.native_session_id, replayed.native_session_id);
}

fn test_state(label: &str) -> AppState {
    let runtime_home = std::env::temp_dir().join(format!(
        "anyharness-idempotent-startup-replay-{label}-{}",
        uuid::Uuid::new_v4()
    ));
    let workspace_path = runtime_home.join("workspace");
    std::fs::create_dir_all(&workspace_path).expect("create workspace directory");
    let state = AppState::new(
        runtime_home,
        "http://127.0.0.1:8457".to_string(),
        Db::open_in_memory().expect("open in-memory db"),
        false,
        AgentSeedStore::not_configured_dev(),
    )
    .expect("create app state");
    test_support::seed_workspace_with_repo_root(
        &state.db,
        "workspace-1",
        "local",
        &workspace_path.to_string_lossy(),
    );
    state
}

fn starting_session(id: &str) -> SessionRecord {
    SessionRecord {
        id: id.to_string(),
        workspace_id: "workspace-1".to_string(),
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
        status: "starting".to_string(),
        created_at: "2026-07-17T00:00:00Z".to_string(),
        updated_at: "2026-07-17T00:00:00Z".to_string(),
        last_prompt_at: None,
        closed_at: None,
        dismissed_at: None,
        mcp_bindings_ciphertext: None,
        mcp_binding_summaries_json: None,
        mcp_binding_policy: SessionMcpBindingPolicy::InheritWorkspace,
        system_prompt_append: None,
        subagents_enabled: true,
        action_capabilities_json: None,
        origin: Some(OriginContext::api_local_runtime()),
    }
}
