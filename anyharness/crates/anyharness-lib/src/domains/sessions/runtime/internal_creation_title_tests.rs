use std::sync::Mutex;

use super::*;
use crate::app::{test_support, AppState};
use crate::domains::agents::installer::seed::AgentSeedStore;
use crate::domains::sessions::model::SessionMcpBindingPolicy;
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
        "internal-agent-title-{label}-{}",
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
async fn subagent_initial_task_persists_semantic_title_and_projects_agent_view() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap();
    let _bearer_guard = test_support::set_bearer_token_env(None);
    let _data_key_guard = test_support::set_data_key_env(None);
    let (state, _program_guard) = test_state("subagent-task-title", "#!/bin/sh\nexit 0\n");
    let parent_id = "35234567-89ab-4def-8123-456789abcdef";
    create_known_record(&state.session_runtime, parent_id);
    let (child, link) = state
        .session_runtime
        .create_durable_subagent_session_and_link(
            "workspace-1",
            "claude",
            None,
            None,
            parent_id,
            None,
        )
        .expect("durable initially untitled subagent");
    let child_id = child.id.clone();
    assert_eq!(child.title, None);

    // This stand-in replaces only provider execution. It preserves the real
    // runtime -> LiveSessionHandle mailbox, `Started` acceptance, initially
    // untitled SQLite row, pre-dispatch normalization/CAS, and production
    // Agent Operations projection used by the guarantee under test.
    let mut observed = state
        .session_runtime
        .acp_manager_for_test()
        .insert_prompt_observer_for_test(&child_id)
        .await;
    let task = format!("  Inspect\n the replay boundary  {}  ", "x".repeat(180));
    let expected_title = format!("Inspect the replay boundary {}", "x".repeat(132));
    assert_eq!(expected_title.chars().count(), 160);
    let created = state
        .session_runtime
        .start_new_agent_session(
            child,
            Some(task),
            PromptProvenance::AgentSession {
                source_session_id: parent_id.into(),
                session_link_id: Some(link.id),
                label: Some("Parent".into()),
            },
        )
        .await;
    let created = match created {
        Ok(created) => created,
        Err(_) => panic!("initial task should be accepted"),
    };
    observed.recv().await.expect("prompt observed");

    assert_eq!(created.title.as_deref(), Some(expected_title.as_str()));
    let fresh = state
        .session_service
        .get_session(&child_id)
        .expect("fresh SQLite read")
        .expect("child row");
    assert_eq!(fresh.title.as_deref(), Some(expected_title.as_str()));

    let caller = state.agent_operations.authenticated_caller(parent_id);
    let roster = state
        .agent_operations
        .list_subagents(&caller)
        .await
        .expect("production AgentView projection");
    let projected = roster
        .agents
        .into_iter()
        .find(|agent| agent.identity.session_id == child_id)
        .expect("projected child");
    assert_eq!(projected.title.as_deref(), Some(expected_title.as_str()));
}

#[tokio::test(flavor = "current_thread")]
async fn subagent_keeps_its_task_title_when_the_acknowledgement_is_lost() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap();
    let _bearer_guard = test_support::set_bearer_token_env(None);
    let _data_key_guard = test_support::set_data_key_env(None);
    let (state, _program_guard) = test_state("subagent-lost-ack", "#!/bin/sh\nexit 0\n");
    let parent_id = "45234567-89ab-4def-8123-456789abcdef";
    create_known_record(&state.session_runtime, parent_id);
    let (child, link) = state
        .session_runtime
        .create_durable_subagent_session_and_link(
            "workspace-1",
            "claude",
            None,
            None,
            parent_id,
            None,
        )
        .expect("durable initially untitled subagent");
    let child_id = child.id.clone();

    // The prompt enters the real mailbox and its reply sender is then dropped:
    // the acknowledgement is lost, the turn may be running, and the agent
    // survives. It must survive carrying the task title it was created with.
    let mut observed = state
        .session_runtime
        .acp_manager_for_test()
        .insert_prompt_response_dropper_for_test(&child_id)
        .await;
    let created = state
        .session_runtime
        .start_new_agent_session(
            child,
            Some("Inspect the replay boundary".into()),
            PromptProvenance::AgentSession {
                source_session_id: parent_id.into(),
                session_link_id: Some(link.id),
                label: Some("Parent".into()),
            },
        )
        .await;
    let created = match created {
        Ok(created) => created,
        Err(_) => panic!("ambiguous acknowledgement must preserve the agent"),
    };
    observed.recv().await.expect("prompt observed");

    assert_eq!(
        created.title.as_deref(),
        Some("Inspect the replay boundary")
    );
    let fresh = state
        .session_service
        .get_session(&child_id)
        .expect("fresh SQLite read")
        .expect("child row");
    assert_eq!(fresh.title.as_deref(), Some("Inspect the replay boundary"));
}
