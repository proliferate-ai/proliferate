use std::collections::BTreeMap;

use tokio::time::{sleep, Duration};

use crate::app::{test_support, AppState};
use crate::domains::agents::installer::seed::AgentSeedStore;
use crate::domains::agents::launch_options::{HarnessLaunchOptions, LaunchSelection};
use crate::domains::sessions::launch_intent::ResolvedLaunchIntent;
use crate::domains::sessions::model::{SessionMcpBindingPolicy, SessionRecord};
use crate::live::sessions::ScriptedSessionSpec;
use crate::origin::OriginContext;
use crate::persistence::Db;

// A9 Scope C: `start_live_session` now checks readiness (mirroring
// create_session's gate), so this suite's bare "claude" sessions need a
// credentialed, installed claude to reach the scripted/pending startup it
// actually exercises — otherwise every case here fails closed on
// AgentNotReady before ever reaching the replay-join behavior under test.
// The `ANYHARNESS_CLAUDE_AGENT_PROGRAM` override (like the scripted-agent
// suite in `scripted-agent suites`) makes the agent-process
// artifact resolve as installed without faking the managed npm install
// layout; `test_state`'s product-owned API-key route gives Claude its required
// credential, so `credential_state` is `Ready` and the native-artifact check
// in `compute_readiness` is never reached.
struct AgentProgramGuard {
    previous: Option<std::ffi::OsString>,
}

impl AgentProgramGuard {
    fn set(path: &std::path::Path) -> Self {
        let previous = std::env::var_os("ANYHARNESS_CLAUDE_AGENT_PROGRAM");
        std::env::set_var("ANYHARNESS_CLAUDE_AGENT_PROGRAM", path);
        Self { previous }
    }
}

impl Drop for AgentProgramGuard {
    fn drop(&mut self) {
        match self.previous.as_ref() {
            Some(value) => std::env::set_var("ANYHARNESS_CLAUDE_AGENT_PROGRAM", value),
            None => std::env::remove_var("ANYHARNESS_CLAUDE_AGENT_PROGRAM"),
        }
    }
}

#[tokio::test(flavor = "current_thread")]
async fn create_replay_joins_pending_startup_and_persists_readiness() {
    let _lock = test_support::lock_env().await;
    let _bearer_guard = test_support::set_bearer_token_env(None);
    let _data_key_guard = test_support::set_data_key_env(None);
    let state = test_state("pending");
    let _agent_program_guard =
        AgentProgramGuard::set(&state.runtime_home.join("claude-agent-stub"));
    let session_id = "01234567-89ab-4def-8123-456789abcdef";
    seed_starting_session(&state, session_id);
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
                &BTreeMap::new(),
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
    let _lock = test_support::lock_env().await;
    let _bearer_guard = test_support::set_bearer_token_env(None);
    let _data_key_guard = test_support::set_data_key_env(None);
    let state = test_state("ready");
    let _agent_program_guard =
        AgentProgramGuard::set(&state.runtime_home.join("claude-agent-stub"));
    let session_id = "11234567-89ab-4def-8123-456789abcdef";
    seed_starting_session(&state, session_id);
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
            &BTreeMap::new(),
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
    // Give Claude a product-owned API-key route and a real (stub) executable
    // for the program override, so credential and artifact readiness agree.
    test_support::install_scripted_claude_auth(&runtime_home);
    let agent_program = runtime_home.join("claude-agent-stub");
    std::fs::write(&agent_program, "#!/bin/sh\nexit 0\n").expect("write agent stub");
    crate::integrations::agent_cli::executable::make_executable(&agent_program)
        .expect("make agent stub executable");
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

fn seed_starting_session(state: &AppState, session_id: &str) {
    let started = state
        .launch_options_service
        .begin_probe("claude", "2026-08-19T00:00:00Z")
        .expect("begin replay launch options");
    state
        .launch_options_service
        .record_success(
            &started,
            &HarnessLaunchOptions::default(),
            "2026-08-19T00:00:01Z",
        )
        .expect("record replay launch options");
    let selection = LaunchSelection::default();
    let intent = ResolvedLaunchIntent {
        created_at: "2026-08-19T00:00:00Z".to_string(),
        ..Default::default()
    };
    let basis = state.launch_options_service.basis_revision("claude");
    let basis_revision = || basis.clone();
    state
        .session_service
        .store()
        .insert_with_launch_intent(
            &starting_session(session_id),
            &intent,
            "claude",
            &basis_revision,
            &selection,
        )
        .expect("insert interrupted create row with immutable intent");
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
