use std::sync::Mutex;

use anyharness_contract::v1::PromptInputBlock;

use super::prompt_title::PromptTitleAssignment;
use super::*;
use crate::app::{test_support, AppState};
use crate::domains::agents::installer::seed::AgentSeedStore;
use crate::domains::sessions::model::SessionMcpBindingPolicy;
use crate::live::sessions::LiveSessionCommandError;
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

fn test_state(label: &str) -> (AppState, AgentProgramGuard) {
    let runtime_home = std::env::temp_dir().join(format!(
        "prompt-title-assignment-{label}-{}",
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
    std::fs::write(&agent_program, "#!/bin/sh\nexit 0\n").unwrap();
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

fn stored_title(state: &AppState, session_id: &str) -> Option<String> {
    state
        .session_service
        .get_session(session_id)
        .expect("fresh SQLite read")
        .expect("session row")
        .title
}

fn create_untitled_record(runtime: &SessionRuntime, session_id: &str) -> SessionRecord {
    let record = runtime
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
        .expect("durable session");
    assert_eq!(record.title, None);
    record
}

#[tokio::test(flavor = "current_thread")]
async fn authored_http_prompt_titles_the_session_before_the_prompt_is_dispatched() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap();
    let _bearer_guard = test_support::set_bearer_token_env(None);
    let _data_key_guard = test_support::set_data_key_env(None);
    let (state, _program_guard) = test_state("authored-http");
    let session_id = "85234567-89ab-4def-8123-456789abcdef";
    create_untitled_record(&state.session_runtime, session_id);
    let mut observed = state
        .session_runtime
        .acp_manager_for_test()
        .insert_prompt_observer_for_test(session_id)
        .await;

    // The observer resolves when the prompt reaches the provider seam, and a
    // harness `session_info_update` for this turn cannot be earlier than that.
    // Attempting the harness fallback there proves the authored title already
    // holds the row both sources write through.
    let (outcome, provider_fallback_applied) = tokio::join!(
        state.session_runtime.send_authored_prompt(
            session_id,
            vec![PromptInputBlock::Text {
                text: "  Inspect\n the replay boundary  ".into(),
            }],
            Some("http-authored-prompt".into()),
        ),
        async {
            observed.recv().await.expect("prompt observed");
            state
                .session_service
                .store()
                .update_title_if_absent(session_id, "Harness title", "2026-03-25T00:02:00Z")
                .expect("harness fallback compare-and-set")
        }
    );
    assert!(!provider_fallback_applied);

    let returned = match outcome.expect("authored prompt accepted") {
        SendPromptOutcome::Running { session, .. } => session,
        SendPromptOutcome::Queued { .. } => panic!("observer returns running for direct prompt"),
    };
    assert_eq!(
        returned.title.as_deref(),
        Some("Inspect the replay boundary")
    );
    let fresh = state
        .session_service
        .get_session(session_id)
        .expect("fresh SQLite read")
        .expect("session row");
    assert_eq!(fresh.title.as_deref(), Some("Inspect the replay boundary"));
}

#[tokio::test(flavor = "current_thread")]
async fn internal_plan_or_review_prompt_leaves_untitled_session_untitled() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap();
    let _bearer_guard = test_support::set_bearer_token_env(None);
    let _data_key_guard = test_support::set_data_key_env(None);
    let (state, _program_guard) = test_state("internal-opt-out");
    let session_id = "95234567-89ab-4def-8123-456789abcdef";
    create_untitled_record(&state.session_runtime, session_id);
    let mut observed = state
        .session_runtime
        .acp_manager_for_test()
        .insert_prompt_observer_for_test(session_id)
        .await;

    let internal_scaffold = concat!(
        "Use the approved plan document as context. ",
        "Do not treat this internal routing scaffold as user-authored title text."
    );
    let outcome = state
        .session_runtime
        .send_prompt(
            session_id,
            vec![PromptInputBlock::Text {
                text: internal_scaffold.into(),
            }],
            None,
        )
        .await
        .expect("internal prompt accepted");
    observed.recv().await.expect("prompt observed");

    let returned = match outcome {
        SendPromptOutcome::Running { session, .. } => session,
        SendPromptOutcome::Queued { .. } => panic!("observer returns running for direct prompt"),
    };
    assert_eq!(returned.title, None);
    let fresh = state
        .session_service
        .get_session(session_id)
        .expect("fresh SQLite read")
        .expect("session row");
    assert_eq!(fresh.title, None);
}

#[tokio::test(flavor = "current_thread")]
async fn verified_dispatch_failure_reverts_only_the_title_it_stored() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap();
    let _bearer_guard = test_support::set_bearer_token_env(None);
    let _data_key_guard = test_support::set_data_key_env(None);
    let (state, _program_guard) = test_state("dispatch-failure");
    let session_id = "a5234567-89ab-4def-8123-456789abcdef";
    create_untitled_record(&state.session_runtime, session_id);
    let runtime = &state.session_runtime;

    let assigned = PromptTitleAssignment::from_authored_texts(["Inspect the replay boundary"])
        .apply_before_dispatch(runtime, session_id);
    // A dropped acknowledgement is ambiguous: the turn may be running, so the
    // title stays with the session it titled.
    assigned.revert_if_undelivered(
        runtime,
        session_id,
        &LiveSessionCommandError::ResponseDropped,
    );
    assert_eq!(
        stored_title(&state, session_id).as_deref(),
        Some("Inspect the replay boundary")
    );
    assigned.revert_if_undelivered(
        runtime,
        session_id,
        &LiveSessionCommandError::ActorUnavailable,
    );
    assert_eq!(stored_title(&state, session_id), None);

    let assigned = PromptTitleAssignment::from_authored_texts(["Second attempt"])
        .apply_before_dispatch(runtime, session_id);
    state
        .session_service
        .update_session_title(session_id, "Renamed by the user")
        .expect("explicit rename");
    assigned.revert_if_undelivered(
        runtime,
        session_id,
        &LiveSessionCommandError::ActorUnavailable,
    );
    assert_eq!(
        stored_title(&state, session_id).as_deref(),
        Some("Renamed by the user")
    );
}
