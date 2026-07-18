use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use uuid::Uuid;

use super::{CreateSessionError, CreateSessionOutcome};
use crate::app::{test_support, AppState};
use crate::domains::agents::installer::seed::AgentSeedStore;
use crate::domains::sessions::model::{SessionMcpBindingPolicy, SessionRecord};
use crate::domains::sessions::runtime::CreateAndStartSessionError;
use crate::origin::OriginContext;
use crate::persistence::Db;

struct TestDir(PathBuf);

impl TestDir {
    fn new(label: &str) -> Self {
        let path = std::env::temp_dir().join(format!("{label}-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&path).expect("create test directory");
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

struct EnvVarGuard {
    name: &'static str,
    original: Option<OsString>,
}

impl EnvVarGuard {
    fn set(name: &'static str, value: &OsStr) -> Self {
        let original = std::env::var_os(name);
        std::env::set_var(name, value);
        Self { name, original }
    }

    fn remove(name: &'static str) -> Self {
        let original = std::env::var_os(name);
        std::env::remove_var(name);
        Self { name, original }
    }
}

impl Drop for EnvVarGuard {
    fn drop(&mut self) {
        if let Some(original) = &self.original {
            std::env::set_var(self.name, original);
        } else {
            std::env::remove_var(self.name);
        }
    }
}

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

#[tokio::test(flavor = "current_thread")]
async fn gated_create_preserves_context_without_a_session_row_or_live_process() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("env mutex");
    let _bearer_guard = test_support::set_bearer_token_env(None);
    let _data_key_guard = test_support::set_data_key_env(None);
    let runtime_home = TestDir::new("anyharness-gated-session-create");
    let empty_home = TestDir::new("anyharness-gated-session-home");
    let workspace_path = runtime_home.path().join("workspace");
    std::fs::create_dir_all(&workspace_path).expect("create workspace directory");
    let agent_auth_dir = runtime_home.path().join("agent-auth");
    std::fs::create_dir_all(&agent_auth_dir).expect("create agent-auth directory");
    std::fs::write(
        agent_auth_dir.join("state.json"),
        r#"{"version":2,"revision":1,"harnesses":[{"harness_kind":"grok","sources":[{"kind":"gateway","base_url":"https://gw","key":"sk-vk"}]}]}"#,
    )
    .expect("write gateway route state");

    let test_executable = std::env::current_exe().expect("current test executable");
    let _program_guard =
        EnvVarGuard::set("ANYHARNESS_GROK_AGENT_PROGRAM", test_executable.as_os_str());
    let _home_guard = EnvVarGuard::set("HOME", empty_home.path().as_os_str());
    let _xai_guard = EnvVarGuard::remove("XAI_API_KEY");
    let _grok_guard = EnvVarGuard::remove("GROK_API_KEY");

    let state = AppState::new(
        runtime_home.path().to_path_buf(),
        "http://127.0.0.1:8457".to_string(),
        Db::open_in_memory().expect("open in-memory db"),
        false,
        AgentSeedStore::not_configured_dev(),
    )
    .expect("create app state");
    test_support::seed_workspace_with_repo_root(
        &state.db,
        "workspace-gated",
        "local",
        &workspace_path.to_string_lossy(),
    );
    let attempted_session_id = "01234567-89ab-4def-8123-456789abcdef";

    let error = state
        .session_runtime
        .create_and_start_session_with_id(
            "workspace-gated",
            "grok",
            Some(attempted_session_id),
            Some("grok-4.3"),
            None,
            None,
            vec![],
            None,
            true,
            OriginContext::api_local_runtime(),
        )
        .await
        .expect_err("xai-only model must be gated on a gateway route");

    let CreateAndStartSessionError::ModelGated(context) = error else {
        panic!("expected model-gated context, got {error:?}");
    };
    assert_eq!(context.workspace_id, "workspace-gated");
    assert_eq!(
        context.attempted_session_id.as_deref(),
        Some(attempted_session_id)
    );
    assert_eq!(context.agent_kind, "grok");
    assert_eq!(context.requested_model_id, "grok-4.3");
    assert_eq!(context.canonical_model_id, "grok-4.3");
    assert_eq!(context.active_contexts, vec!["gateway".to_string()]);
    assert_eq!(context.required_contexts, vec!["xai-api".to_string()]);
    assert_eq!(
        context.catalog_version,
        state.catalog_sync_service.catalog_version()
    );
    assert!(state
        .session_service
        .store()
        .list_by_workspace("workspace-gated")
        .expect("list sessions")
        .is_empty());
    assert!(
        !state
            .session_runtime
            .has_live_session(attempted_session_id)
            .await
    );
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
