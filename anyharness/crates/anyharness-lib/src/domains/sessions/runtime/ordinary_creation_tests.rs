use std::collections::BTreeMap;
use std::sync::Arc;

use super::*;
use crate::app::{test_support, AppState};
use crate::domains::agents::installer::seed::AgentSeedStore;
use crate::domains::sessions::model::SessionMcpBindingPolicy;
use crate::domains::sessions::task_output::TaskOutputSender;
use crate::live::sessions::{ScriptedSessionSpec, SessionEventSink};
use crate::origin::OriginContext;
use crate::persistence::Db;
use anyharness_contract::v1::{PromptProvenance as PublicPromptProvenance, SessionEvent};

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
    test_support::install_scripted_claude_auth(&runtime_home);
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
    test_support::seed_scripted_claude_launch_options(&state.launch_options_service);
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
            &BTreeMap::new(),
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
    let _lock = test_support::lock_env().await;
    let _bearer_guard = test_support::set_bearer_token_env(None);
    let _data_key_guard = test_support::set_data_key_env(None);
    let (state, _program_guard) = test_state("start-failure", "#!/bin/sh\nexit 1\n");

    let result = state
        .session_runtime
        .create_ordinary_agent_session(
            "workspace-1",
            "claude",
            None,
            &BTreeMap::new(),
            None,
            "caller-session".into(),
            "Caller".into(),
        )
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
async fn subagent_start_failure_compensates_both_child_and_relationship() {
    let _lock = test_support::lock_env().await;
    let _bearer_guard = test_support::set_bearer_token_env(None);
    let _data_key_guard = test_support::set_data_key_env(None);
    let (state, _program_guard) = test_state("subagent-start-failure", "#!/bin/sh\nexit 1\n");
    let parent_id = "12234567-89ab-4def-8123-456789abcdef";
    create_known_record(&state.session_runtime, parent_id);

    let result = state
        .session_runtime
        .create_subagent_agent_session(
            "workspace-1",
            "claude",
            None,
            &BTreeMap::new(),
            "initial subagent task".into(),
            parent_id,
            "Parent",
        )
        .await;
    assert!(matches!(
        result,
        Err(CreateSubagentAgentSessionError::Create(_))
    ));
    let sessions = state
        .session_service
        .list_sessions(Some("workspace-1"), true)
        .unwrap();
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].id, parent_id);
    assert!(state
        .session_runtime
        .session_link_service
        .list_subagent_children(parent_id)
        .unwrap()
        .is_empty());
}

#[tokio::test(flavor = "current_thread")]
async fn subagent_fanout_failure_rolls_back_the_atomic_child_insert() {
    let _lock = test_support::lock_env().await;
    let _bearer_guard = test_support::set_bearer_token_env(None);
    let _data_key_guard = test_support::set_data_key_env(None);
    let (state, _program_guard) = test_state("subagent-fanout", "#!/bin/sh\nexit 0\n");
    let parent_id = "41234567-89ab-4def-8123-456789abcdef";
    create_known_record(&state.session_runtime, parent_id);
    for index in 0..8 {
        let child_id = format!("{index}1234567-89ab-4def-8123-456789abcde0");
        create_known_record(&state.session_runtime, &child_id);
        state
            .subagent_service
            .link_child(parent_id, &child_id, None, None, None)
            .expect("fill fanout");
    }
    let before = state
        .session_service
        .list_sessions(Some("workspace-1"), true)
        .unwrap();

    let result = state
        .session_runtime
        .create_subagent_agent_session(
            "workspace-1",
            "claude",
            None,
            &BTreeMap::new(),
            "must not survive".into(),
            parent_id,
            "Parent",
        )
        .await;
    assert!(matches!(
        result,
        Err(CreateSubagentAgentSessionError::Relationship(
            crate::domains::sessions::links::service::CreateSessionLinkError::FanoutLimit
        ))
    ));
    let after = state
        .session_service
        .list_sessions(Some("workspace-1"), true)
        .unwrap();
    assert_eq!(after.len(), before.len());
    assert_eq!(
        state
            .session_runtime
            .session_link_service
            .list_subagent_children(parent_id)
            .unwrap()
            .len(),
        8
    );
}

#[tokio::test(flavor = "current_thread")]
async fn concrete_subagent_close_open_and_live_promotion_preserve_session_state() {
    let _lock = test_support::lock_env().await;
    let _bearer_guard = test_support::set_bearer_token_env(None);
    let _data_key_guard = test_support::set_data_key_env(None);
    let (state, _program_guard) = test_state("subagent-lifecycle", "#!/bin/sh\nexit 0\n");
    let parent_id = "81234567-89ab-4def-8123-456789abcdef";
    let child_id = "82234567-89ab-4def-8123-456789abcdef";
    let promoted_id = "83234567-89ab-4def-8123-456789abcdef";
    for session_id in [parent_id, child_id, promoted_id] {
        create_known_record(&state.session_runtime, session_id);
    }
    let make_link = |child_session_id: &str| {
        state
            .session_runtime
            .session_link_service
            .create_subagent_link_with_child_limit(
                crate::domains::sessions::links::service::CreateSessionLinkInput {
                    relation: crate::domains::sessions::links::model::SessionLinkRelation::Subagent,
                    parent_session_id: parent_id.into(),
                    child_session_id: child_session_id.into(),
                    workspace_relation:
                        crate::domains::sessions::links::model::SessionLinkWorkspaceRelation::SameWorkspace,
                    label: None,
                    created_by_turn_id: None,
                    created_by_tool_call_id: None,
                },
                8,
            )
            .expect("create relationship")
    };
    make_link(child_id);
    make_link(promoted_id);
    let now = chrono::Utc::now().to_rfc3339();
    for session_id in [child_id, promoted_id] {
        state
            .session_service
            .store()
            .update_native_session_id(session_id, &format!("native-{session_id}"), &now)
            .unwrap();
    }
    state
        .session_service
        .store()
        .insert_pending_prompt(child_id, "discard me", Some("prompt-1"))
        .unwrap();

    let manager = state.session_runtime.acp_manager_for_test();
    let _closing_actor = manager
        .insert_scripted_session_for_test(
            child_id,
            ScriptedSessionSpec {
                prompt_turn_id: "turn-close".into(),
                hold_config_replies: false,
                hold_cancel_replies: false,
            },
        )
        .await;
    let closed = state
        .session_runtime
        .close_subagent(parent_id, child_id)
        .await
        .expect("reversible close");
    assert!(closed.closed_at.is_none());
    assert!(closed.dismissed_at.is_none());
    assert_eq!(
        closed.native_session_id.as_deref(),
        Some(format!("native-{child_id}").as_str())
    );
    assert!(!state.session_runtime.has_live_session(child_id).await);
    assert!(state
        .session_service
        .store()
        .list_pending_prompts(child_id)
        .unwrap()
        .is_empty());
    assert!(state
        .session_runtime
        .session_link_service
        .find_subagent_link(parent_id, child_id)
        .unwrap()
        .unwrap()
        .subagent_closed_at
        .is_some());

    let _opened_actor = manager
        .insert_scripted_session_for_test(
            child_id,
            ScriptedSessionSpec {
                prompt_turn_id: "turn-open".into(),
                hold_config_replies: false,
                hold_cancel_replies: false,
            },
        )
        .await;
    let opened = state
        .session_runtime
        .open_subagent(parent_id, child_id)
        .await
        .expect("reversible open");
    assert_eq!(opened.id, child_id);
    assert_eq!(
        opened.native_session_id.as_deref(),
        Some(format!("native-{child_id}").as_str())
    );
    assert!(state
        .session_runtime
        .session_link_service
        .find_subagent_link(parent_id, child_id)
        .unwrap()
        .unwrap()
        .subagent_closed_at
        .is_none());

    let _promoted_actor = manager
        .insert_scripted_session_for_test(
            promoted_id,
            ScriptedSessionSpec {
                prompt_turn_id: "turn-running".into(),
                hold_config_replies: false,
                hold_cancel_replies: false,
            },
        )
        .await;
    let handle_before = manager.get_handle(promoted_id).await.unwrap();
    let promoted = state
        .session_runtime
        .promote_subagent(parent_id, promoted_id)
        .await
        .expect("live promotion");
    let handle_after = manager.get_handle(promoted_id).await.unwrap();
    assert!(Arc::ptr_eq(&handle_before, &handle_after));
    assert_eq!(promoted.id, promoted_id);
    assert_eq!(
        promoted.native_session_id.as_deref(),
        Some(format!("native-{promoted_id}").as_str())
    );
    assert!(state
        .session_runtime
        .session_link_service
        .find_subagent_link(parent_id, promoted_id)
        .unwrap()
        .is_none());
}

#[tokio::test(flavor = "current_thread")]
async fn verified_initial_task_failure_removes_row_and_handle() {
    let _lock = test_support::lock_env().await;
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
        .start_new_ordinary_agent_session(
            record,
            Some("initial task".into()),
            "caller-session".into(),
            "Caller".into(),
        )
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
async fn initial_task_persists_exact_caller_provenance_and_projects_task_output() {
    let _lock = test_support::lock_env().await;
    let _bearer_guard = test_support::set_bearer_token_env(None);
    let _data_key_guard = test_support::set_data_key_env(None);
    let (state, _program_guard) = test_state("task-success", "#!/bin/sh\nexit 0\n");
    let session_id = "32234567-89ab-4def-8123-456789abcdef";
    let record = create_known_record(&state.session_runtime, session_id);
    let mut observed = state
        .session_runtime
        .acp_manager_for_test()
        .insert_prompt_observer_for_test(session_id)
        .await;

    let created = state
        .session_runtime
        .start_new_ordinary_agent_session(
            record,
            Some("initial task".into()),
            "caller-session-exact".into(),
            "Caller Label".into(),
        )
        .await
        .expect("initial task accepted");
    assert_eq!(created.id, session_id);
    assert!(state
        .session_service
        .get_session(session_id)
        .unwrap()
        .is_some());
    let observed = observed.recv().await.expect("prompt observed");
    assert!(observed
        .prompt_id
        .as_deref()
        .is_some_and(|prompt_id| prompt_id.starts_with("agent-create-")));

    let (event_tx, _) = tokio::sync::broadcast::channel(8);
    let mut sink = SessionEventSink::new(
        session_id.into(),
        "claude".into(),
        std::path::PathBuf::from("/tmp/workspace"),
        event_tx,
        Arc::new(state.session_service.store().clone()),
    );
    sink.begin_turn(
        observed.payload.text_summary.clone(),
        observed.prompt_id,
        observed.payload.content_parts(),
        observed.payload.public_provenance(),
    )
    .expect("begin observed prompt turn");

    let completed = state
        .session_service
        .store()
        .list_events(session_id)
        .unwrap()
        .into_iter()
        .find(|event| event.event_type == "item_completed")
        .expect("persisted item_completed");
    let event: SessionEvent = serde_json::from_str(&completed.payload_json).unwrap();
    let SessionEvent::ItemCompleted(completed) = event else {
        panic!("expected item_completed");
    };
    assert!(matches!(
        completed.item.prompt_provenance,
        Some(PublicPromptProvenance::AgentSession {
            source_session_id,
            label: Some(label),
            ..
        }) if source_session_id == "caller-session-exact" && label == "Caller Label"
    ));

    let output = state
        .session_service
        .get_task_output(session_id, None, 10)
        .expect("task output");
    assert_eq!(output.messages.len(), 1);
    assert_eq!(
        output.messages[0].sender,
        TaskOutputSender::Agent {
            session_id: Some("caller-session-exact".into()),
            label: "Caller Label".into(),
        }
    );
}

#[tokio::test(flavor = "current_thread")]
async fn ready_resume_reuses_handle_and_preserves_native_identity() {
    let _lock = test_support::lock_env().await;
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
    let _lock = test_support::lock_env().await;
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
