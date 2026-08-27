use std::path::{Path, PathBuf};
use std::time::Duration;

use anyharness_contract::v1::PromptInputBlock;
use serde_json::Value;

use super::prompt_message_tests::session;
use crate::app::{test_support, AppState};
use crate::domains::agent_operations::model::{
    AgentIdentity, SendMessageInput, SendMessageReceipt,
};
use crate::domains::agents::installer::seed::AgentSeedStore;
use crate::domains::sessions::prompt::PromptPayload;
use crate::domains::sessions::task_output::{TaskOutputRole, TaskOutputSender};
use crate::persistence::Db;

mod pending_prompt_protection_tests;
mod subagent_lifecycle_tests;

pub(crate) struct EnvVarGuard {
    name: &'static str,
    previous: Option<std::ffi::OsString>,
}

impl EnvVarGuard {
    fn set(name: &'static str, value: impl AsRef<std::ffi::OsStr>) -> Self {
        let previous = std::env::var_os(name);
        std::env::set_var(name, value);
        Self { name, previous }
    }
}

impl Drop for EnvVarGuard {
    fn drop(&mut self) {
        match self.previous.take() {
            Some(value) => std::env::set_var(self.name, value),
            None => std::env::remove_var(self.name),
        }
    }
}

pub(crate) struct ScriptedAgent {
    pub(crate) program: PathBuf,
    pub(crate) request_log: PathBuf,
    pub(crate) control_dir: PathBuf,
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn send_message_real_actor_executes_idle_running_fifo_and_ignores_a_stale_wake() {
    let _env_lock = test_support::lock_env();
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let runtime_home = temp_runtime_home("actor-fifo");
    let script = write_scripted_agent(&runtime_home);
    let (_program, _args) = install_scripted_agent_env(&script);
    let state = build_state(
        &runtime_home,
        Db::open_in_memory().expect("in-memory db"),
        true,
    );

    let resumed = state
        .session_runtime
        .ensure_live_session("target", None)
        .await
        .expect("start real target actor");
    assert_eq!(resumed.native_session_id.as_deref(), Some("native-target"));
    let idle = send_message(&state, "idle agent message")
        .await
        .expect("idle send");
    wait_for_prompt_count(&script.request_log, 1).await;
    wait_for_queue_len(&state, 0).await;
    wait_for_actor_idle(&state).await;
    assert_eq!(prompt_texts(&script.request_log), ["idle agent message"]);
    let handle = state
        .acp_manager
        .get_ready_handle("target")
        .await
        .expect("ready target handle");
    handle
        .send_queued_prompt(
            PromptPayload::text("stale copied payload".into()),
            idle.queue_seq,
        )
        .await
        .expect("stale marker acknowledgement");
    send_direct_prompt(&state, "stale wake fence").await;
    wait_for_prompt_count(&script.request_log, 2).await;
    wait_for_actor_idle(&state).await;
    assert_eq!(
        prompt_texts(&script.request_log),
        ["idle agent message", "stale wake fence"]
    );

    send_direct_prompt(&state, "blocking turn").await;
    wait_for_path(&script.control_dir.join("turn-seen")).await;
    let first = send_message(&state, "running message one")
        .await
        .expect("first running send");
    let second = send_message(&state, "running message two")
        .await
        .expect("second running send");
    assert!(first.queue_seq < second.queue_seq);
    let pending = state
        .session_service
        .store()
        .list_pending_prompts("target")
        .expect("running queue");
    assert_eq!(
        pending
            .iter()
            .map(|row| row.text.as_str())
            .collect::<Vec<_>>(),
        ["running message one", "running message two"]
    );
    assert_eq!(prompt_texts(&script.request_log).len(), 3);

    std::fs::write(script.control_dir.join("release-turn"), b"").expect("release held turn");
    wait_for_prompt_count(&script.request_log, 5).await;
    wait_for_queue_len(&state, 0).await;
    wait_for_actor_idle(&state).await;
    assert_eq!(
        prompt_texts(&script.request_log),
        [
            "idle agent message",
            "stale wake fence",
            "blocking turn",
            "running message one",
            "running message two",
        ]
    );
    assert_agent_output(
        &state,
        &[
            "idle agent message",
            "running message one",
            "running message two",
        ],
    );

    stop_target_actor(&state).await;
    drop(state);
    std::fs::remove_dir_all(&runtime_home).expect("remove runtime home");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn send_message_cold_runtime_reconstruction_replays_two_rows_once_in_order() {
    let _env_lock = test_support::lock_env();
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let runtime_home = temp_runtime_home("actor-restart");
    let script = write_scripted_agent(&runtime_home);
    let (_program, _args) = install_scripted_agent_env(&script);

    let state_a = build_state(
        &runtime_home,
        Db::open(&runtime_home).expect("file-backed db"),
        true,
    );
    state_a
        .session_runtime
        .ensure_live_session("target", None)
        .await
        .expect("start first runtime actor");
    send_direct_prompt(&state_a, "restart boundary turn").await;
    wait_for_path(&script.control_dir.join("turn-seen")).await;

    let first = send_message(&state_a, "restart message one")
        .await
        .expect("first committed row");
    let second = send_message(&state_a, "restart message two")
        .await
        .expect("second committed row");
    assert!(first.queue_seq < second.queue_seq);
    let before_restart = state_a
        .session_service
        .store()
        .list_pending_prompts("target")
        .expect("rows before restart");
    assert_eq!(
        before_restart.iter().map(|row| row.seq).collect::<Vec<_>>(),
        [first.queue_seq, second.queue_seq]
    );

    let handle = state_a
        .acp_manager
        .get_ready_handle("target")
        .await
        .expect("first runtime actor");
    handle.dismiss().await.expect("detach first runtime actor");
    std::fs::write(script.control_dir.join("release-turn"), b"")
        .expect("finish restart-boundary turn");
    wait_for_actor_gone(&state_a).await;
    assert_eq!(
        state_a
            .session_service
            .store()
            .list_pending_prompts("target")
            .unwrap()
            .len(),
        2
    );
    drop(state_a);
    std::fs::remove_file(script.control_dir.join("turn-seen")).expect("clear turn marker");

    let state_b = build_state(
        &runtime_home,
        Db::open(&runtime_home).expect("reopen durable db"),
        false,
    );
    let resumed = state_b
        .session_runtime
        .ensure_live_session("target", None)
        .await
        .expect("reconstruct runtime and actor");
    assert_eq!(resumed.native_session_id.as_deref(), Some("native-target"));
    wait_for_prompt_count(&script.request_log, 3).await;
    wait_for_queue_len(&state_b, 0).await;
    wait_for_actor_idle(&state_b).await;

    let requests = read_requests(&script.request_log);
    let loads = requests
        .iter()
        .filter(|request| request["method"] == "session/load")
        .collect::<Vec<_>>();
    assert_eq!(
        loads.len(),
        2,
        "both runtime actors must load the same native session"
    );
    assert!(loads
        .iter()
        .all(|request| request["params"]["sessionId"] == "native-target"));
    let texts = prompt_texts(&script.request_log);
    assert_eq!(
        texts,
        [
            "restart boundary turn",
            "restart message one",
            "restart message two"
        ]
    );
    assert_eq!(
        texts
            .iter()
            .filter(|text| *text == "restart message one")
            .count(),
        1
    );
    assert_eq!(
        texts
            .iter()
            .filter(|text| *text == "restart message two")
            .count(),
        1
    );
    assert_agent_output(&state_b, &["restart message one", "restart message two"]);

    stop_target_actor(&state_b).await;
    drop(state_b);
    std::fs::remove_dir_all(&runtime_home).expect("remove runtime home");
}

pub(crate) async fn send_message(
    state: &AppState,
    message: &str,
) -> Result<SendMessageReceipt, crate::domains::agent_operations::runtime::AgentOperationsError> {
    state
        .agent_operations
        .send_message(
            &state.agent_operations.authenticated_caller("caller"),
            SendMessageInput {
                target: AgentIdentity::new(
                    state.agent_operations.runtime_identity().clone(),
                    "target",
                ),
                message: message.into(),
            },
        )
        .await
}

async fn send_direct_prompt(state: &AppState, text: &str) {
    state
        .session_runtime
        .send_prompt(
            "target",
            vec![PromptInputBlock::Text { text: text.into() }],
            Some(format!("test:{text}")),
        )
        .await
        .expect("direct prompt");
}

pub(crate) fn build_state(runtime_home: &Path, db: Db, seed: bool) -> AppState {
    let workspace_a = runtime_home.join("workspace-a");
    let workspace_b = runtime_home.join("workspace-b");
    std::fs::create_dir_all(&workspace_a).expect("workspace A");
    std::fs::create_dir_all(&workspace_b).expect("workspace B");
    if seed {
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
    }
    let state = AppState::new(
        runtime_home.to_path_buf(),
        "http://127.0.0.1:8457".into(),
        db,
        false,
        AgentSeedStore::not_configured_dev(),
    )
    .expect("app state");
    test_support::seed_scripted_claude_launch_options(&state.launch_options_service);
    if seed {
        let caller = session("caller", "workspace-a", "idle", "Exact Sender");
        let mut target = session("target", "workspace-b", "idle", "Target");
        target.last_prompt_at = Some("2026-08-10T23:59:00Z".into());
        state
            .session_service
            .store()
            .insert(&caller)
            .expect("caller");
        state
            .session_service
            .store()
            .insert(&target)
            .expect("target");
        state
            .session_service
            .store()
            .seed_empty_launch_intent("caller");
        state
            .session_service
            .store()
            .seed_empty_launch_intent("target");
    }
    state
}

pub(super) fn assert_agent_output(state: &AppState, expected_texts: &[&str]) {
    let output = state
        .session_service
        .get_task_output("target", None, 50)
        .expect("target task output");
    let messages = output
        .messages
        .iter()
        .filter(|message| {
            message.role == TaskOutputRole::User
                && matches!(&message.sender, TaskOutputSender::Agent { .. })
        })
        .collect::<Vec<_>>();
    assert_eq!(
        messages
            .iter()
            .map(|message| message.text.as_str())
            .collect::<Vec<_>>(),
        expected_texts
    );
    assert!(messages.iter().all(|message| {
        message.sender
            == TaskOutputSender::Agent {
                session_id: Some("caller".into()),
                label: "Exact Sender".into(),
            }
    }));
    assert!(state
        .session_service
        .get_task_output("caller", None, 50)
        .expect("caller task output")
        .messages
        .is_empty());
}

pub(crate) fn temp_runtime_home(label: &str) -> PathBuf {
    PathBuf::from(format!(
        "/tmp/anyharness-agent-message-{label}-{}",
        uuid::Uuid::new_v4()
    ))
}

pub(crate) fn install_scripted_agent_env(script: &ScriptedAgent) -> (EnvVarGuard, EnvVarGuard) {
    let program = EnvVarGuard::set("ANYHARNESS_CLAUDE_AGENT_PROGRAM", &script.program);
    let args = serde_json::to_string(&vec![
        script.request_log.to_string_lossy().to_string(),
        script.control_dir.to_string_lossy().to_string(),
    ])
    .expect("agent args");
    let args = EnvVarGuard::set("ANYHARNESS_CLAUDE_AGENT_ARGS_JSON", args);
    (program, args)
}

pub(crate) fn write_scripted_agent(runtime_home: &Path) -> ScriptedAgent {
    test_support::install_scripted_claude_auth(runtime_home);
    let native = runtime_home.join("agents/claude/native/claude");
    std::fs::create_dir_all(native.parent().expect("native parent")).expect("native directory");
    std::fs::write(&native, "#!/bin/sh\nexit 0\n").expect("native stub");
    crate::integrations::agent_cli::executable::make_executable(&native)
        .expect("executable native stub");

    let control_dir = runtime_home.join("script-control");
    std::fs::create_dir_all(&control_dir).expect("control directory");
    let request_log = runtime_home.join("agent-requests.jsonl");
    let program = runtime_home.join("scripted-agent.py");
    std::fs::write(
        &program,
        r#"#!/usr/bin/env python3
import json, os, sys, time
log_path = sys.argv[-2]
control_dir = sys.argv[-1]
native_session_id = "native-target"
def emit(payload):
    print(json.dumps(payload, separators=(",", ":")), flush=True)
def control(name):
    return os.path.join(control_dir, name)
for raw_line in sys.stdin:
    message = json.loads(raw_line)
    with open(log_path, "a", encoding="utf-8") as log:
        log.write(json.dumps(message, separators=(",", ":")) + "\n")
    if "id" not in message:
        continue
    request_id = message["id"]
    method = message.get("method")
    if method == "initialize":
        emit({
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {
                "protocolVersion": 1,
                "agentCapabilities": {"loadSession": True, "promptCapabilities": {"image": True}},
                "authMethods": [],
            },
        })
    elif method == "session/new":
        native_session_id = "native-target"
        emit({"jsonrpc": "2.0", "id": request_id, "result": {
            "sessionId": native_session_id, "configOptions": [{"id": "model", "name": "Model",
            "category": "model", "type": "select", "currentValue": "haiku",
            "options": [{"value": "haiku", "name": "Haiku"}]}]}})
    elif method == "session/load":
        native_session_id = message["params"]["sessionId"]
        open(control("load-seen"), "w", encoding="utf-8").close()
        while os.path.exists(control("hold-load")) and not os.path.exists(control("release-load")):
            time.sleep(0.01)
        emit({"jsonrpc": "2.0", "id": request_id, "result": {}})
    elif method in ("session/set_model", "session/set_mode", "session/set_config_option"):
        emit({"jsonrpc": "2.0", "id": request_id, "result": {}})
    elif method == "session/prompt":
        text_blocks = [
            block.get("text", "")
            for block in message["params"]["prompt"]
            if block.get("type") == "text"
        ]
        text = text_blocks[-1] if text_blocks else ""
        if text in ("blocking turn", "restart boundary turn"):
            open(control("turn-seen"), "w", encoding="utf-8").close()
            while not os.path.exists(control("release-turn")):
                time.sleep(0.01)
        emit({
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {
                "sessionId": native_session_id,
                "update": {
                    "sessionUpdate": "agent_message_chunk",
                    "content": {"type": "text", "text": "reply:" + text},
                    "messageId": "reply-" + str(request_id),
                },
            },
        })
        stop_reason = "refusal" if "PLEASE-REFUSE" in text else "end_turn"
        emit({
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {"stopReason": stop_reason},
        })
    else:
        emit({
            "jsonrpc": "2.0",
            "id": request_id,
            "error": {"code": -32601, "message": "method not found"},
        })
"#,
    )
    .expect("scripted agent");
    crate::integrations::agent_cli::executable::make_executable(&program)
        .expect("executable scripted agent");
    ScriptedAgent {
        program,
        request_log,
        control_dir,
    }
}

pub(crate) fn read_requests(path: &Path) -> Vec<Value> {
    let Ok(contents) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    contents
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| serde_json::from_str(line).expect("script request JSON"))
        .collect()
}

pub(crate) fn prompt_texts(path: &Path) -> Vec<String> {
    read_requests(path)
        .into_iter()
        .filter(|request| request["method"] == "session/prompt")
        .filter_map(|request| {
            request["params"]["prompt"]
                .as_array()?
                .iter()
                .rev()
                .find_map(|block| block["text"].as_str().map(str::to_string))
        })
        .collect()
}

pub(super) async fn wait_for_prompt_count(path: &Path, expected: usize) {
    wait_for("scripted prompt count", || {
        prompt_texts(path).len() >= expected
    })
    .await;
}

pub(super) async fn wait_for_queue_len(state: &AppState, expected: usize) {
    wait_for("pending queue length", || {
        state
            .session_service
            .store()
            .list_pending_prompts("target")
            .is_ok_and(|rows| rows.len() == expected)
    })
    .await;
}

async fn wait_for_path(path: &Path) {
    wait_for("script control path", || path.exists()).await;
}

async fn wait_for(description: &str, mut condition: impl FnMut() -> bool) {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if condition() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("timed out waiting for {description}"));
}

pub(crate) async fn wait_for_actor_idle(state: &AppState) {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if state
                .acp_manager
                .get_ready_handle("target")
                .await
                .is_some_and(|handle| !handle.is_busy())
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("target actor idle");
}

async fn wait_for_actor_gone(state: &AppState) {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if state.acp_manager.get_handle("target").await.is_none() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("target actor exit");
}

pub(crate) async fn stop_target_actor(state: &AppState) {
    if let Some(handle) = state.acp_manager.get_handle("target").await {
        tokio::time::timeout(Duration::from_secs(2), handle.close())
            .await
            .expect("close actor timeout")
            .expect("close actor");
    }
    wait_for_actor_gone(state).await;
}
