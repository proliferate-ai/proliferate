use std::path::PathBuf;
use std::time::Duration;

use anyharness_contract::v1::PromptProvenance;

use crate::app::{test_support, AppState};
use crate::domains::agent_operations::model::{AgentIdentity, SendMessageInput, SendMessageStatus};
use crate::domains::agents::installer::seed::AgentSeedStore;
use crate::domains::sessions::model::{SessionMcpBindingPolicy, SessionRecord};
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

#[tokio::test(flavor = "current_thread")]
async fn send_message_returns_before_target_startup_readiness_resolves() {
    let _env_lock = test_support::lock_env().await;
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let (state, _program) = state_with_sessions(&[
        session("caller", "workspace-a", "idle", "Exact Sender"),
        session("target", "workspace-b", "idle", "Target"),
    ]);
    // A pending, never-resolved target startup. Consumer activation blocks on
    // this readiness gate (bounded by SHARED_STARTUP_READINESS_TIMEOUT = 1s in
    // test), so if activation still ran inline under the caller, send_message
    // would take ~1s to return. Detached activation must let the receipt return
    // promptly, well before the gate resolves.
    let _startup = state
        .session_runtime
        .acp_manager_for_test()
        .insert_pending_startup_for_test("target")
        .await;

    // Negative control: this 500ms bound is shorter than the 1s readiness
    // timeout an inline activation would block on, so it fails if activation is
    // re-inlined, and is orders of magnitude above the detached path's cost.
    let receipt = tokio::time::timeout(
        Duration::from_millis(500),
        send_message(&state, "target", "persist before startup"),
    )
    .await
    .expect("send_message must return without waiting on target startup readiness")
    .expect("post-commit success");
    assert_eq!(receipt.status, SendMessageStatus::DurablyQueued);

    let row = state
        .session_service
        .store()
        .find_pending_prompt("target", receipt.queue_seq)
        .expect("read pending prompt")
        .expect("row committed before startup readiness");
    assert_eq!(row.text, "persist before startup");
    assert_eq!(
        row.prompt_payload().public_provenance(),
        Some(PromptProvenance::AgentSession {
            source_session_id: "caller".into(),
            session_link_id: None,
            label: Some("Exact Sender".into()),
        })
    );
}

#[tokio::test(flavor = "current_thread")]
async fn send_message_startup_failure_after_commit_still_returns_the_durable_receipt() {
    let _env_lock = test_support::lock_env().await;
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let (state, _program) = state_with_sessions(&[
        session("caller", "workspace-a", "idle", "Exact Sender"),
        session("target", "workspace-b", "idle", "Target"),
    ]);
    let startup = state
        .session_runtime
        .acp_manager_for_test()
        .insert_pending_startup_for_test("target")
        .await;
    let operations = state.agent_operations.clone();
    let send = tokio::spawn(async move {
        operations
            .send_message(
                &operations.authenticated_caller("caller"),
                SendMessageInput {
                    target: AgentIdentity::new(operations.runtime_identity().clone(), "target"),
                    message: "survive startup failure".into(),
                },
            )
            .await
    });
    wait_for_pending_row(&state, "target").await;
    startup
        .send(Some(Err("injected ACP startup failure".into())))
        .expect("fail pending startup");

    let receipt = tokio::time::timeout(Duration::from_secs(1), send)
        .await
        .expect("startup failure receipt timeout")
        .expect("send task")
        .expect("startup failure is post-commit success");
    assert_eq!(receipt.status, SendMessageStatus::DurablyQueued);
    assert!(state
        .session_service
        .store()
        .find_pending_prompt("target", receipt.queue_seq)
        .unwrap()
        .is_some());
}

#[tokio::test(flavor = "current_thread")]
async fn send_message_keeps_the_same_receipt_when_the_actor_drops_its_wake_response() {
    let _env_lock = test_support::lock_env().await;
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let (state, _program) = state_with_sessions(&[
        session("caller", "workspace-a", "idle", "Exact Sender"),
        session("target", "workspace-b", "idle", "Target"),
    ]);
    let mut observed = state
        .session_runtime
        .acp_manager_for_test()
        .insert_prompt_response_dropper_for_test("target")
        .await;

    let receipt = send_message(&state, "target", "survive ack loss")
        .await
        .expect("post-commit response loss is success");
    assert_eq!(receipt.status, SendMessageStatus::DurablyQueued);
    assert_eq!(
        serde_json::to_value(&receipt).unwrap(),
        serde_json::json!({
            "target": {
                "runtimeId": state.agent_operations.runtime_identity().as_str(),
                "sessionId": "target"
            },
            "queueSeq": receipt.queue_seq,
            "status": "durably_queued"
        })
    );

    let wake = tokio::time::timeout(Duration::from_secs(1), observed.recv())
        .await
        .expect("wake timeout")
        .expect("wake command accepted before response sender dropped");
    assert_eq!(wake.from_queue_seq, Some(receipt.queue_seq));
    assert_eq!(wake.payload.text_summary, "survive ack loss");
    assert!(state
        .session_service
        .store()
        .find_pending_prompt("target", receipt.queue_seq)
        .unwrap()
        .is_some());
}

#[tokio::test(flavor = "current_thread")]
async fn send_message_keeps_the_durable_receipt_when_the_wake_actor_is_unavailable() {
    let _env_lock = test_support::lock_env().await;
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let (state, _program) = state_with_sessions(&[
        session("caller", "workspace-a", "idle", "Exact Sender"),
        session("target", "workspace-b", "idle", "Target"),
    ]);
    state
        .session_runtime
        .acp_manager_for_test()
        .insert_unavailable_session_for_test("target")
        .await;

    let receipt = send_message(&state, "target", "survive unavailable actor")
        .await
        .expect("post-commit ActorUnavailable is success");
    assert_eq!(receipt.status, SendMessageStatus::DurablyQueued);
    assert!(state
        .session_service
        .store()
        .find_pending_prompt("target", receipt.queue_seq)
        .unwrap()
        .is_some());
}

#[tokio::test(flavor = "current_thread")]
async fn send_message_store_failure_returns_error_without_activating_the_actor() {
    let _env_lock = test_support::lock_env().await;
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let (state, _program) = state_with_sessions(&[
        session("caller", "workspace-a", "idle", "Caller"),
        session("target", "workspace-b", "idle", "Target"),
    ]);
    let mut observed = state
        .session_runtime
        .acp_manager_for_test()
        .insert_prompt_observer_for_test("target")
        .await;
    state
        .db
        .with_conn(|conn| {
            conn.execute_batch(
                "CREATE TRIGGER fail_agent_message_insert \
                 BEFORE INSERT ON session_pending_prompts \
                 BEGIN SELECT RAISE(ABORT, 'injected pending-row failure'); END;",
            )
        })
        .expect("install failing insert trigger");

    let error = send_message(&state, "target", "must not wake")
        .await
        .expect_err("store failure");
    assert_eq!(error.code(), "AGENT_OPERATIONS_INTERNAL");
    assert!(state
        .session_service
        .store()
        .list_pending_prompts("target")
        .unwrap()
        .is_empty());
    assert!(matches!(
        observed.try_recv(),
        Err(tokio::sync::mpsc::error::TryRecvError::Empty)
    ));
}

async fn send_message(
    state: &AppState,
    target: &str,
    message: &str,
) -> Result<
    crate::domains::agent_operations::model::SendMessageReceipt,
    crate::domains::agent_operations::runtime::AgentOperationsError,
> {
    state
        .agent_operations
        .send_message(
            &state.agent_operations.authenticated_caller("caller"),
            SendMessageInput {
                target: AgentIdentity::new(
                    state.agent_operations.runtime_identity().clone(),
                    target,
                ),
                message: message.into(),
            },
        )
        .await
}

async fn wait_for_pending_row(state: &AppState, target: &str) {
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            if !state
                .session_service
                .store()
                .list_pending_prompts(target)
                .unwrap()
                .is_empty()
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("pending row commit");
}

fn state_with_sessions(sessions: &[SessionRecord]) -> (AppState, AgentProgramGuard) {
    let db = Db::open_in_memory().expect("in-memory db");
    let runtime_home = PathBuf::from(format!(
        "/tmp/anyharness-agent-message-unit-{}",
        uuid::Uuid::new_v4()
    ));
    let workspace_a = runtime_home.join("workspace-a");
    let workspace_b = runtime_home.join("workspace-b");
    std::fs::create_dir_all(&workspace_a).expect("workspace A");
    std::fs::create_dir_all(&workspace_b).expect("workspace B");
    test_support::install_scripted_claude_auth(&runtime_home);
    let agent_program = runtime_home.join("claude-agent-stub");
    std::fs::write(&agent_program, "#!/bin/sh\nexit 0\n").expect("agent stub");
    crate::integrations::agent_cli::executable::make_executable(&agent_program)
        .expect("executable agent stub");
    let agent_program_guard = AgentProgramGuard::set(&agent_program);
    test_support::seed_workspace_with_repo_root(
        &db,
        "workspace-a",
        "local",
        &workspace_a.to_string_lossy(),
    );
    test_support::seed_workspace_with_repo_root(
        &db,
        "workspace-b",
        "local",
        &workspace_b.to_string_lossy(),
    );
    let state = AppState::new(
        runtime_home,
        "http://127.0.0.1:8457".into(),
        db,
        false,
        AgentSeedStore::not_configured_dev(),
    )
    .expect("app state");
    for session in sessions {
        state
            .session_service
            .store()
            .insert(session)
            .expect("insert session");
    }
    (state, agent_program_guard)
}

pub(super) fn session(id: &str, workspace_id: &str, status: &str, title: &str) -> SessionRecord {
    SessionRecord {
        id: id.into(),
        workspace_id: workspace_id.into(),
        agent_kind: "claude".into(),
        native_session_id: Some(format!("native-{id}")),
        agent_auth_contexts: None,
        requested_model_id: None,
        current_model_id: None,
        requested_mode_id: None,
        current_mode_id: None,
        title: Some(title.into()),
        thinking_level_id: None,
        thinking_budget_tokens: None,
        status: status.into(),
        created_at: "2026-08-11T00:00:00Z".into(),
        updated_at: "2026-08-11T00:00:00Z".into(),
        last_prompt_at: None,
        closed_at: None,
        dismissed_at: None,
        mcp_bindings_ciphertext: None,
        mcp_binding_summaries_json: None,
        mcp_binding_policy: SessionMcpBindingPolicy::InheritWorkspace,
        system_prompt_append: None,
        subagents_enabled: true,
        action_capabilities_json: None,
        origin: None,
    }
}
