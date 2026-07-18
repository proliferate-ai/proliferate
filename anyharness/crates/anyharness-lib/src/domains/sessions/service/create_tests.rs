use std::sync::Mutex;

use uuid::Uuid;

use super::{CreateSessionError, CreateSessionOutcome};
use crate::app::{test_support, AppState};
use crate::domains::agents::installer::seed::AgentSeedStore;
use crate::domains::sessions::model::{SessionMcpBindingPolicy, SessionRecord};
use crate::origin::OriginContext;
use crate::persistence::Db;

#[tokio::test(flavor = "current_thread")]
async fn idempotent_create_reuses_only_the_original_workspace_and_agent() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("env mutex");
    let _bearer_guard = test_support::set_bearer_token_env(None);
    let _data_key_guard = test_support::set_data_key_env(None);
    let state = AppState::new(
        std::env::temp_dir().join(format!(
            "anyharness-idempotent-session-create-{}",
            Uuid::new_v4()
        )),
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
        "/tmp/workspace",
    );
    let session_id = "01234567-89ab-4def-8123-456789abcdef";
    state
        .session_service
        .store()
        .insert(&session_record(session_id))
        .expect("insert original session");

    let replay = state
        .session_service
        .create_session(
            "workspace-1",
            "claude",
            Some(session_id),
            true,
            None,
            None,
            None,
            None,
            SessionMcpBindingPolicy::InheritWorkspace,
            None,
            true,
            OriginContext::api_local_runtime(),
        )
        .expect("replay original create");
    assert!(matches!(
        replay,
        CreateSessionOutcome::Existing(record) if record.id == session_id
    ));
    assert_eq!(
        state
            .session_service
            .store()
            .list_by_workspace("workspace-1")
            .expect("list sessions")
            .len(),
        1
    );

    let conflict = state
        .session_service
        .create_session(
            "workspace-1",
            "codex",
            Some(session_id),
            true,
            None,
            None,
            None,
            None,
            SessionMcpBindingPolicy::InheritWorkspace,
            None,
            true,
            OriginContext::api_local_runtime(),
        )
        .expect_err("cross-agent id reuse must conflict");
    assert!(matches!(
        conflict,
        CreateSessionError::SessionIdConflict { session_id: id } if id == session_id
    ));

    state
        .session_service
        .store()
        .mark_dismissed(session_id, "2026-07-17T00:01:00Z")
        .expect("dismiss original session");
    let dismissed_conflict = state
        .session_service
        .create_session(
            "workspace-1",
            "claude",
            Some(session_id),
            true,
            None,
            None,
            None,
            None,
            SessionMcpBindingPolicy::InheritWorkspace,
            None,
            true,
            OriginContext::api_local_runtime(),
        )
        .expect_err("dismissed idempotency ownership must not replay");
    assert!(matches!(
        dismissed_conflict,
        CreateSessionError::SessionIdConflict { session_id: id } if id == session_id
    ));
}

fn session_record(id: &str) -> SessionRecord {
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
