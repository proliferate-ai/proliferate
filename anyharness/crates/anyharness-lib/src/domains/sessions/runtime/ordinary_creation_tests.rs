use std::sync::{Arc, Mutex};

use super::*;
use crate::app::{test_support, AppState};
use crate::domains::agents::installer::seed::AgentSeedStore;
use crate::domains::sessions::model::SessionMcpBindingPolicy;
use crate::live::sessions::{ScriptedSessionEvent, ScriptedSessionSpec};
use crate::origin::OriginContext;
use crate::persistence::Db;

struct AgentProgramGuard(Option<std::ffi::OsString>);

impl AgentProgramGuard {
    fn set(path: &std::path::Path) -> Self {
        let previous = std::env::var_os("ANYHARNESS_CLAUDE_AGENT_PROGRAM");
        std::env::set_var("ANYHARNESS_CLAUDE_AGENT_PROGRAM", path);
        Self(previous)
    }
}

impl Drop for AgentProgramGuard {
    fn drop(&mut self) {
        match self.0.as_ref() {
            Some(value) => std::env::set_var("ANYHARNESS_CLAUDE_AGENT_PROGRAM", value),
            None => std::env::remove_var("ANYHARNESS_CLAUDE_AGENT_PROGRAM"),
        }
    }
}

fn test_state(label: &str, program: &str) -> (AppState, AgentProgramGuard) {
    let runtime_home = std::env::temp_dir().join(format!(
        "ordinary-agent-create-{label}-{}",
        uuid::Uuid::new_v4()
    ));
    let workspace_path = runtime_home.join("workspace");
    std::fs::create_dir_all(&workspace_path).unwrap();
    std::fs::create_dir_all(runtime_home.join("secrets")).unwrap();
    std::fs::write(
        runtime_home.join("secrets/global.env"),
        "ANTHROPIC_API_KEY=test-not-a-real-key\n",
    )
    .unwrap();
    let agent_program = runtime_home.join("claude-agent-stub");
    std::fs::write(&agent_program, program).unwrap();
    crate::integrations::agent_cli::executable::make_executable(&agent_program).unwrap();
    let guard = AgentProgramGuard::set(&agent_program);
    let state = AppState::new(
        runtime_home,
        "http://127.0.0.1:8457".into(),
        Db::open_in_memory().unwrap(),
        false,
        AgentSeedStore::not_configured_dev(),
    )
    .unwrap();
    test_support::seed_workspace_with_repo_root(
        &state.db,
        "workspace-1",
        "local",
        &workspace_path.to_string_lossy(),
    );
    (state, guard)
}

fn create_known_record(runtime: &SessionRuntime, session_id: &str) -> SessionRecord {
    runtime
        .create_durable_session(
            "workspace-1",
            "claude",
            Some(session_id),
            None,
            None,
            None,
            Vec::new(),
            None,
            SessionMcpBindingPolicy::InheritWorkspace,
            true,
            OriginContext::system_local_runtime(),
        )
        .expect("durable session")
}

#[tokio::test(flavor = "current_thread")]
async fn start_failure_retires_only_new_handle_and_deletes_new_row() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap();
    let _bearer_guard = test_support::set_bearer_token_env(None);
    let _data_key_guard = test_support::set_data_key_env(None);
    let (state, _program_guard) = test_state("start-failure", "#!/bin/sh\nexit 1\n");

    let result = state
        .session_runtime
        .create_ordinary_agent_session("workspace-1", "claude", None, None, None)
        .await;
    assert!(matches!(
        result,
        Err(CreateOrdinaryAgentSessionError::Create(_))
    ));
    assert!(state
        .session_service
        .list_sessions(Some("workspace-1"), true)
        .unwrap()
        .is_empty());
}

#[tokio::test(flavor = "current_thread")]
async fn verified_initial_task_failure_removes_row_and_handle() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap();
    let _bearer_guard = test_support::set_bearer_token_env(None);
    let _data_key_guard = test_support::set_data_key_env(None);
    let (state, _program_guard) = test_state("task-failure", "#!/bin/sh\nexit 0\n");
    let session_id = "22234567-89ab-4def-8123-456789abcdef";
    let record = create_known_record(&state.session_runtime, session_id);
    state
        .session_runtime
        .acp_manager_for_test()
        .insert_unavailable_session_for_test(session_id)
        .await;

    let result = state
        .session_runtime
        .start_new_ordinary_agent_session(record, Some("initial task".into()))
        .await;
    assert!(matches!(
        result,
        Err(CreateOrdinaryAgentSessionError::InitialTask(_))
    ));
    assert!(state
        .session_service
        .get_session(session_id)
        .unwrap()
        .is_none());
    assert!(!state.session_runtime.has_live_session(session_id).await);
}

#[tokio::test(flavor = "current_thread")]
async fn initial_task_uses_existing_prompt_owner_and_keeps_session() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap();
    let _bearer_guard = test_support::set_bearer_token_env(None);
    let _data_key_guard = test_support::set_data_key_env(None);
    let (state, _program_guard) = test_state("task-success", "#!/bin/sh\nexit 0\n");
    let session_id = "32234567-89ab-4def-8123-456789abcdef";
    let record = create_known_record(&state.session_runtime, session_id);
    let mut scripted = state
        .session_runtime
        .acp_manager_for_test()
        .insert_scripted_session_for_test(
            session_id,
            ScriptedSessionSpec {
                prompt_turn_id: "turn-created".into(),
                hold_config_replies: false,
                hold_cancel_replies: false,
            },
        )
        .await;

    let created = state
        .session_runtime
        .start_new_ordinary_agent_session(record, Some("initial task".into()))
        .await
        .expect("initial task accepted");
    assert_eq!(created.id, session_id);
    assert!(state
        .session_service
        .get_session(session_id)
        .unwrap()
        .is_some());
    assert!(matches!(
        scripted.events.recv().await,
        Some(ScriptedSessionEvent::Prompt {
            prompt_id: Some(prompt_id)
        }) if prompt_id.starts_with("agent-create-")
    ));
}

#[tokio::test(flavor = "current_thread")]
async fn ready_resume_reuses_handle_and_preserves_native_identity() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap();
    let _bearer_guard = test_support::set_bearer_token_env(None);
    let _data_key_guard = test_support::set_data_key_env(None);
    let (state, _program_guard) = test_state("ready-resume", "#!/bin/sh\nexit 0\n");
    let session_id = "42234567-89ab-4def-8123-456789abcdef";
    let before = create_known_record(&state.session_runtime, session_id);
    let manager = state.session_runtime.acp_manager_for_test();
    let _scripted = manager
        .insert_scripted_session_for_test(
            session_id,
            ScriptedSessionSpec {
                prompt_turn_id: "unused".into(),
                hold_config_replies: false,
                hold_cancel_replies: false,
            },
        )
        .await;
    let handle_before = manager.get_handle(session_id).await.unwrap();

    let resumed = state
        .session_runtime
        .ensure_live_session(session_id, None)
        .await
        .expect("ready resume");
    let handle_after = manager.get_handle(session_id).await.unwrap();

    assert!(Arc::ptr_eq(&handle_before, &handle_after));
    assert_eq!(resumed.id, before.id);
    assert_eq!(
        resumed.native_session_id.as_deref(),
        Some("native-42234567-89ab-4def-8123-456789abcdef")
    );
    assert_eq!(resumed.requested_model_id, before.requested_model_id);
    assert_eq!(resumed.requested_mode_id, before.requested_mode_id);
}

#[tokio::test(flavor = "current_thread")]
async fn interrupt_requests_running_cancel_and_never_starts_idle_or_cold_sessions() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap();
    let _bearer_guard = test_support::set_bearer_token_env(None);
    let _data_key_guard = test_support::set_data_key_env(None);
    let (state, _program_guard) = test_state("interrupt", "#!/bin/sh\nexit 0\n");
    let running_id = "52234567-89ab-4def-8123-456789abcdef";
    let idle_id = "62234567-89ab-4def-8123-456789abcdef";
    let cold_id = "72234567-89ab-4def-8123-456789abcdef";
    for session_id in [running_id, idle_id, cold_id] {
        create_known_record(&state.session_runtime, session_id);
    }
    let manager = state.session_runtime.acp_manager_for_test();
    let mut cancel_seen = manager.insert_cancel_observer_for_test(running_id).await;
    manager.insert_unavailable_session_for_test(idle_id).await;

    for session_id in [running_id, idle_id, cold_id] {
        let interrupted = state
            .session_runtime
            .cancel_live_session(session_id)
            .await
            .expect("interrupt is idempotent");
        assert_eq!(interrupted.id, session_id);
    }

    tokio::time::timeout(std::time::Duration::from_secs(1), cancel_seen.recv())
        .await
        .expect("running cancel should be sent")
        .expect("cancel observer");
    assert!(state.session_runtime.has_live_session(running_id).await);
    assert!(state.session_runtime.has_live_session(idle_id).await);
    assert!(!state.session_runtime.has_live_session(cold_id).await);
}
