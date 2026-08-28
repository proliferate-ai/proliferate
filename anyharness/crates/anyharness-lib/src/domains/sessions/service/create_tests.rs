use std::collections::BTreeMap;
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

use uuid::Uuid;

use super::{CreateSessionError, CreateSessionOutcome};
use crate::app::{test_support, AppState};
use crate::domains::agents::installer::seed::AgentSeedStore;
use crate::domains::agents::launch_options::{
    HarnessLaunchControl, HarnessLaunchControlValue, HarnessLaunchDefaults, HarnessLaunchModel,
    HarnessLaunchModelControls, HarnessLaunchOptions, LaunchSelection, LaunchSelectionUnsupported,
};
use crate::domains::sessions::launch_intent::ResolvedLaunchIntent;
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
async fn idempotent_create_requires_exact_intent_and_current_observation() {
    let _lock = test_support::lock_env().await;
    let _bearer_guard = test_support::set_bearer_token_env(None);
    let _data_key_guard = test_support::set_data_key_env(None);
    let runtime_home = TestDir::new("anyharness-idempotent-session-create");
    let workspace_path = runtime_home.path().join("workspace");
    std::fs::create_dir_all(&workspace_path).expect("create workspace directory");
    let agent_auth_dir = runtime_home.path().join("agent-auth");
    std::fs::create_dir_all(&agent_auth_dir).expect("create agent-auth directory");
    std::fs::write(
        agent_auth_dir.join("state.json"),
        r#"{"version":2,"sequence":1,"lineage":"test-lineage","harnesses":[{"harness_kind":"grok","sources":[{"kind":"gateway","base_url":"https://gw","key":"sk-vk"}]}]}"#,
    )
    .expect("write gateway route state");
    let test_executable = std::env::current_exe().expect("current test executable");
    let _program_guard =
        EnvVarGuard::set("ANYHARNESS_GROK_AGENT_PROGRAM", test_executable.as_os_str());
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
        "workspace-1",
        "local",
        &workspace_path.to_string_lossy(),
    );
    let started = state
        .launch_options_service
        .begin_probe("grok", "2026-08-19T00:00:00Z")
        .expect("begin observed launch options");
    state
        .launch_options_service
        .record_success(
            &started,
            &HarnessLaunchOptions {
                models: vec![
                    HarnessLaunchModel {
                        id: "model-a".to_string(),
                        observed_name: None,
                        observed_description: None,
                    },
                    HarnessLaunchModel {
                        id: "model-b".to_string(),
                        observed_name: None,
                        observed_description: None,
                    },
                ],
                controls: vec![],
                defaults: HarnessLaunchDefaults::default(),
                model_controls: Vec::new(),
            },
            "2026-08-19T00:00:00Z",
        )
        .expect("record observed launch options");
    let session_id = "01234567-89ab-4def-8123-456789abcdef";
    let original_selection = LaunchSelection {
        model_id: Some("model-a".to_string()),
        control_values: BTreeMap::new(),
    };
    let original_intent = ResolvedLaunchIntent {
        model_id: original_selection.model_id.clone(),
        control_values: original_selection.control_values.clone(),
        created_at: "2026-08-19T00:00:00Z".to_string(),
    };
    let basis = state.launch_options_service.basis_revision("grok");
    let basis_revision = || basis.clone();
    let mut original = session_record(session_id);
    original.agent_kind = "grok".to_string();
    state
        .session_service
        .store()
        .insert_with_launch_intent(
            &original,
            &original_intent,
            "grok",
            &basis_revision,
            &original_selection,
        )
        .expect("insert original session");

    let replay = state
        .session_service
        .create_session(
            "workspace-1",
            "grok",
            Some(session_id),
            true,
            Some("model-a"),
            &BTreeMap::new(),
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
            "grok",
            Some(session_id),
            true,
            Some("model-b"),
            &BTreeMap::new(),
            None,
            None,
            SessionMcpBindingPolicy::InheritWorkspace,
            None,
            true,
            OriginContext::api_local_runtime(),
        )
        .expect_err("different immutable launch intent must conflict");
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
            "grok",
            Some(session_id),
            true,
            Some("model-a"),
            &BTreeMap::new(),
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

    let refreshed = state
        .launch_options_service
        .begin_probe("grok", "2026-08-19T00:01:00Z")
        .expect("begin changed observation");
    state
        .launch_options_service
        .record_success(
            &refreshed,
            &HarnessLaunchOptions::default(),
            "2026-08-19T00:01:01Z",
        )
        .expect("replace observed universe");
    assert!(matches!(
        state
            .session_service
            .validate_persisted_launch_intent(&original),
        Err(crate::domains::agents::launch_options::LaunchSelectionUnsupported::Model {
            model_id,
            ..
        }) if model_id == "model-a"
    ));
}

#[tokio::test(flavor = "current_thread")]
async fn model_scoped_control_refusal_is_atomic_and_valid_fable_intent_persists() {
    let runtime_home = TestDir::new("anyharness-model-scoped-session-create");
    let workspace_path = runtime_home.path().join("workspace");
    std::fs::create_dir_all(&workspace_path).expect("create workspace directory");
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
        "workspace-scoped",
        "local",
        &workspace_path.to_string_lossy(),
    );
    let started = state
        .launch_options_service
        .begin_probe("claude", "2026-08-20T00:00:00Z")
        .expect("begin observed launch options");
    state
        .launch_options_service
        .record_success(
            &started,
            &claude_model_scoped_options(),
            "2026-08-20T00:00:01Z",
        )
        .expect("record model-scoped launch options");
    let basis = state.launch_options_service.basis_revision("claude");
    let basis_revision = || basis.clone();

    let invalid_selection = LaunchSelection {
        model_id: Some("fable".to_string()),
        control_values: BTreeMap::from([("fast".to_string(), "off".to_string())]),
    };
    let invalid_intent = ResolvedLaunchIntent {
        model_id: invalid_selection.model_id.clone(),
        control_values: invalid_selection.control_values.clone(),
        created_at: "2026-08-20T00:00:02Z".to_string(),
    };
    let mut invalid_record = session_record("01234567-89ab-4def-8123-456789abc001");
    invalid_record.workspace_id = "workspace-scoped".to_string();
    let error = state
        .session_service
        .store()
        .insert_with_launch_intent(
            &invalid_record,
            &invalid_intent,
            "claude",
            &basis_revision,
            &invalid_selection,
        )
        .expect_err("Fable must reject the absent fast control before commit");
    assert!(matches!(
        error,
        LaunchSelectionUnsupported::Control { control_id, .. } if control_id == "fast"
    ));
    assert!(state
        .session_service
        .store()
        .find_by_id(&invalid_record.id)
        .expect("read rejected session")
        .is_none());

    let valid_selection = LaunchSelection {
        model_id: Some("fable".to_string()),
        control_values: BTreeMap::from([
            ("effort".to_string(), "high".to_string()),
            ("mode".to_string(), "default".to_string()),
        ]),
    };
    let valid_intent = ResolvedLaunchIntent {
        model_id: valid_selection.model_id.clone(),
        control_values: valid_selection.control_values.clone(),
        created_at: "2026-08-20T00:00:03Z".to_string(),
    };
    let mut valid_record = session_record("01234567-89ab-4def-8123-456789abc002");
    valid_record.workspace_id = "workspace-scoped".to_string();
    state
        .session_service
        .store()
        .insert_with_launch_intent(
            &valid_record,
            &valid_intent,
            "claude",
            &basis_revision,
            &valid_selection,
        )
        .expect("valid Fable intent commits");
    assert_eq!(
        state
            .session_service
            .store()
            .find_launch_intent(&valid_record.id)
            .expect("read Fable launch intent"),
        Some(valid_intent)
    );
}

#[tokio::test(flavor = "current_thread")]
async fn unsupported_model_refusal_leaves_no_session_row_or_live_process() {
    let _lock = test_support::lock_env().await;
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
        r#"{"version":2,"sequence":1,"lineage":"test-lineage","harnesses":[{"harness_kind":"grok","sources":[{"kind":"gateway","base_url":"https://gw","key":"sk-vk"}]}]}"#,
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
    let started = state
        .launch_options_service
        .begin_probe("grok", "2026-08-19T00:00:00Z")
        .expect("begin observed launch options");
    state
        .launch_options_service
        .record_success(
            &started,
            &HarnessLaunchOptions::default(),
            "2026-08-19T00:00:00Z",
        )
        .expect("record empty observed universe");

    let error = state
        .session_runtime
        .create_and_start_session_with_id(
            "workspace-gated",
            "grok",
            Some(attempted_session_id),
            Some("grok-4.3"),
            &BTreeMap::new(),
            None,
            vec![],
            None,
            true,
            OriginContext::api_local_runtime(),
        )
        .await
        .expect_err("xai-only model must be refused on a gateway route");

    let CreateAndStartSessionError::LaunchValueUnsupported {
        agent_kind,
        key,
        value,
        state: launch_options_state,
    } = error
    else {
        panic!("expected the single unsupported-model refusal, got {error:?}");
    };
    assert_eq!(agent_kind, "grok");
    assert_eq!(key, "modelId");
    assert_eq!(value, "grok-4.3");
    assert_eq!(
        launch_options_state,
        crate::domains::agents::launch_options::HarnessLaunchOptionsState::ObservedEmpty
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

fn claude_model_scoped_options() -> HarnessLaunchOptions {
    let control = |id: &str, values: &[&str]| HarnessLaunchControl {
        id: id.to_string(),
        observed_label: None,
        observed_description: None,
        values: values
            .iter()
            .map(|value| HarnessLaunchControlValue {
                value: (*value).to_string(),
                observed_label: None,
                observed_description: None,
            })
            .collect(),
    };
    let mode = control("mode", &["default", "plan"]);
    let effort = control("effort", &["low", "high"]);
    let fast = control("fast", &["off", "on"]);
    HarnessLaunchOptions {
        models: vec![
            HarnessLaunchModel {
                id: "opus".to_string(),
                observed_name: None,
                observed_description: None,
            },
            HarnessLaunchModel {
                id: "fable".to_string(),
                observed_name: None,
                observed_description: None,
            },
        ],
        controls: vec![mode.clone(), effort.clone(), fast.clone()],
        defaults: HarnessLaunchDefaults {
            model_id: Some("opus".to_string()),
            control_values: BTreeMap::from([
                ("effort".to_string(), "high".to_string()),
                ("fast".to_string(), "off".to_string()),
                ("mode".to_string(), "default".to_string()),
            ]),
        },
        model_controls: vec![
            HarnessLaunchModelControls {
                model_id: "opus".to_string(),
                controls: vec![mode.clone(), effort.clone(), fast],
                default_control_values: BTreeMap::from([
                    ("effort".to_string(), "high".to_string()),
                    ("fast".to_string(), "off".to_string()),
                    ("mode".to_string(), "default".to_string()),
                ]),
            },
            HarnessLaunchModelControls {
                model_id: "fable".to_string(),
                controls: vec![mode, effort],
                default_control_values: BTreeMap::from([
                    ("effort".to_string(), "high".to_string()),
                    ("mode".to_string(), "default".to_string()),
                ]),
            },
        ],
    }
}
