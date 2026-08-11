use std::path::PathBuf;
use std::sync::Arc;

use anyharness_contract::v1::{PromptProvenance, SessionExecutionPhase};
use tokio::sync::broadcast;

use crate::app::{test_support, AppState};
use crate::domains::agent_operations::model::{AgentIdentity, SendMessageInput, SendMessageStatus};
use crate::domains::agents::installer::seed::AgentSeedStore;
use crate::domains::sessions::model::{SessionMcpBindingPolicy, SessionRecord};
use crate::domains::sessions::store::SessionStore;
use crate::domains::sessions::task_output::{TaskOutputRole, TaskOutputSender};
use crate::live::sessions::SessionEventSink;
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
async fn send_message_idle_and_running_commit_attributed_rows_before_the_wake_receipt() {
    let _env_lock = test_support::lock_env();
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let (state, _agent_program_guard) = state_with_sessions(&[
        session("caller", "workspace-a", "idle", "Caller Label"),
        session("idle-target", "workspace-b", "idle", "Idle"),
        session("running-target", "workspace-b", "running", "Running"),
    ]);

    for (target, phase) in [
        ("idle-target", SessionExecutionPhase::Idle),
        ("running-target", SessionExecutionPhase::Running),
    ] {
        let mut observed = state
            .session_runtime
            .acp_manager_for_test()
            .insert_prompt_observer_with_phase_for_test(target, phase)
            .await;
        let receipt = state
            .agent_operations
            .send_message(
                &state.agent_operations.authenticated_caller("caller"),
                SendMessageInput {
                    target: AgentIdentity::new(
                        state.agent_operations.runtime_identity().clone(),
                        target,
                    ),
                    message: format!("message for {target}"),
                },
            )
            .await
            .expect("durable message");
        assert_eq!(receipt.status, SendMessageStatus::DurablyQueued);

        let wake = observed.recv().await.expect("wake command");
        assert_eq!(wake.from_queue_seq, Some(receipt.queue_seq));
        assert_eq!(wake.prompt_id, None);
        assert_eq!(wake.payload.text_summary, format!("message for {target}"));

        let row = state
            .session_service
            .store()
            .find_pending_prompt(target, receipt.queue_seq)
            .expect("read pending prompt")
            .expect("durable pending prompt");
        assert_eq!(row.text, format!("message for {target}"));
        assert_eq!(
            row.prompt_payload().public_provenance(),
            Some(PromptProvenance::AgentSession {
                source_session_id: "caller".into(),
                session_link_id: None,
                label: Some("Caller Label".into()),
            })
        );
    }
}

#[tokio::test(flavor = "current_thread")]
async fn send_message_survives_wake_loss_and_cold_replay_is_visible_exactly_once() {
    let _env_lock = test_support::lock_env();
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let (state, _agent_program_guard) = state_with_sessions(&[
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
                    message: "survive restart".into(),
                },
            )
            .await
    });
    tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    assert!(
        !send.is_finished(),
        "cold send must wait for the target actor before committing"
    );
    assert!(state
        .session_service
        .store()
        .list_pending_prompts("target")
        .unwrap()
        .is_empty());
    startup
        .send(Some(Ok("native-target".into())))
        .expect("finish cold target startup");

    let receipt = send
        .await
        .expect("join cold send")
        .expect("wake loss is post-commit success");
    assert_eq!(receipt.status, SendMessageStatus::DurablyQueued);
    assert_eq!(receipt.target.session_id, "target");
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

    let restarted_store = SessionStore::new(state.db.clone());
    let pending = restarted_store
        .list_pending_prompts("target")
        .expect("restart queue read");
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].seq, receipt.queue_seq);

    assert!(replay_one_pending_prompt(&restarted_store, "target"));
    assert!(
        !replay_one_pending_prompt(&restarted_store, "target"),
        "the committed row is consumed by only one replay"
    );
    assert!(restarted_store
        .list_pending_prompts("target")
        .unwrap()
        .is_empty());

    let output = state
        .session_service
        .get_task_output("target", None, 10)
        .expect("task output");
    assert_eq!(output.messages.len(), 1);
    assert_eq!(output.messages[0].role, TaskOutputRole::User);
    assert_eq!(output.messages[0].text, "survive restart");
    assert_eq!(
        output.messages[0].sender,
        TaskOutputSender::Agent {
            session_id: Some("caller".into()),
            label: "Exact Sender".into(),
        }
    );
    assert!(state
        .session_service
        .get_task_output("caller", None, 10)
        .expect("caller output")
        .messages
        .is_empty());
    assert_eq!(
        state
            .session_service
            .get_session("target")
            .unwrap()
            .unwrap()
            .native_session_id
            .as_deref(),
        Some("native-target")
    );
}

fn replay_one_pending_prompt(store: &SessionStore, session_id: &str) -> bool {
    let Some(row) = store
        .peek_head_pending_prompt(session_id)
        .expect("peek restart queue")
    else {
        return false;
    };
    let payload = row.prompt_payload();
    let (event_tx, _) = broadcast::channel(16);
    let last_seq = store.last_event_seq(session_id).expect("last event seq");
    let mut sink = SessionEventSink::resume_from_seq(
        session_id.into(),
        "claude".into(),
        PathBuf::from("/tmp/workspace-b"),
        last_seq,
        event_tx,
        Arc::new(store.clone()),
    );
    sink.begin_turn(
        payload.text_summary.clone(),
        row.prompt_id.clone(),
        payload.content_parts(),
        payload.public_provenance(),
    );
    store
        .delete_pending_prompt(session_id, row.seq)
        .expect("consume replayed row");
    true
}

fn state_with_sessions(sessions: &[SessionRecord]) -> (AppState, AgentProgramGuard) {
    let db = Db::open_in_memory().expect("in-memory db");
    let runtime_home = std::env::temp_dir().join(format!("agent-message-{}", uuid::Uuid::new_v4()));
    let workspace_a = runtime_home.join("workspace-a");
    let workspace_b = runtime_home.join("workspace-b");
    std::fs::create_dir_all(&workspace_a).expect("workspace A");
    std::fs::create_dir_all(&workspace_b).expect("workspace B");
    std::fs::create_dir_all(runtime_home.join("secrets")).expect("secrets directory");
    std::fs::write(
        runtime_home.join("secrets/global.env"),
        "ANTHROPIC_API_KEY=test-not-a-real-key\n",
    )
    .expect("test credential");
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

fn session(id: &str, workspace_id: &str, status: &str, title: &str) -> SessionRecord {
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
