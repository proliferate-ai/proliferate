//! Scripted ACP proofs for portable workflow effort ordering and exact replay.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::http::StatusCode;
use serde_json::{json, Value};

use super::workflow_runs_tests::{get, poll_run_until, put, session_count};
use crate::{
    app::{test_support, AppState},
    domains::agents::installer::seed::AgentSeedStore,
    persistence::Db,
};

struct EnvVarGuard {
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

fn write_scripted_claude_agent(runtime_home: &std::path::Path) -> (PathBuf, PathBuf) {
    std::fs::create_dir_all(runtime_home.join("secrets")).expect("create secrets directory");
    std::fs::write(
        runtime_home.join("secrets/global.env"),
        "ANTHROPIC_API_KEY=test-not-a-real-key\nCLAUDE_CODE_USE_BEDROCK=0\n",
    )
    .expect("write test credential");

    let native = runtime_home.join("agents/claude/native/claude");
    std::fs::create_dir_all(native.parent().expect("native parent"))
        .expect("create native directory");
    std::fs::write(&native, "#!/bin/sh\nexit 0\n").expect("write native stub");
    crate::integrations::agent_cli::executable::make_executable(&native)
        .expect("make native stub executable");

    let script = runtime_home.join("scripted-claude-agent.py");
    std::fs::write(
        &script,
        r#"#!/usr/bin/env python3
import json
import sys

log_path = sys.argv[-2]
behavior = sys.argv[-1]


def effort_option(current_value):
    return {
        "id": "effort",
        "name": "Effort",
        "category": "thought_level",
        "type": "select",
        "currentValue": current_value,
        "options": [
            {"value": "default", "name": "Default"},
            {"value": "high", "name": "High"},
        ],
    }


def emit(payload):
    print(json.dumps(payload, separators=(",", ":")), flush=True)


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
                "agentCapabilities": {},
                "authMethods": [],
            },
        })
    elif method == "session/new":
        result = {
            "sessionId": "scripted-native-session",
            "modes": {
                "currentModeId": "bypassPermissions",
                "availableModes": [
                    {"id": "bypassPermissions", "name": "Bypass permissions"}
                ],
            },
        }
        if behavior != "missing":
            result["configOptions"] = [effort_option("default")]
        emit({"jsonrpc": "2.0", "id": request_id, "result": result})
    elif method in ("session/set_model", "session/set_mode"):
        emit({"jsonrpc": "2.0", "id": request_id, "result": {}})
    elif method == "session/set_config_option":
        if behavior == "timeout":
            continue
        if behavior == "error":
            emit({
                "jsonrpc": "2.0",
                "id": request_id,
                "result": {"unexpected": True},
            })
            continue
        if behavior == "rejected":
            emit({
                "jsonrpc": "2.0",
                "id": request_id,
                "error": {"code": -32602, "message": "scripted rejection"},
            })
        else:
            emit({
                "jsonrpc": "2.0",
                "id": request_id,
                "result": {"configOptions": [effort_option("high")]},
            })
    elif method == "session/prompt":
        emit({
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {
                "sessionId": "scripted-native-session",
                "update": {
                    "sessionUpdate": "agent_message_chunk",
                    "content": {"type": "text", "text": "workflow-ok"},
                    "messageId": "scripted-message",
                },
            },
        })
        emit({
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {"stopReason": "end_turn"},
        })
    else:
        emit({
            "jsonrpc": "2.0",
            "id": request_id,
            "error": {"code": -32601, "message": "method not found"},
        })
"#,
    )
    .expect("write scripted ACP agent");
    crate::integrations::agent_cli::executable::make_executable(&script)
        .expect("make scripted ACP agent executable");
    (script, runtime_home.join("agent-requests.jsonl"))
}

fn scripted_v2_body(workspace_id: &str, attempt: Value) -> Value {
    json!({
        "schemaVersion": 2,
        "workspaceId": workspace_id,
        "definition": {
            "inputs": [
                { "name": "ticket", "type": "string", "required": true },
                { "name": "attempt", "type": "number", "required": true }
            ],
            "stages": [{
                "harnessConfig": {
                    "agentKind": "claude",
                    "modelSelection": { "kind": "exact", "modelId": "default" },
                    "effort": "high",
                    "permissionPolicy": "workflowDefault"
                },
                "steps": [{
                    "kind": "agent.prompt",
                    "prompt": "Return {{inputs.ticket}} attempt {{inputs.attempt}}"
                }]
            }]
        },
        "arguments": { "ticket": "PROL-321", "attempt": attempt }
    })
}

fn read_scripted_requests(path: &std::path::Path) -> Vec<Value> {
    std::fs::read_to_string(path)
        .expect("read scripted request log")
        .lines()
        .map(|line| serde_json::from_str(line).expect("parse scripted request"))
        .collect()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn v2_scripted_agent_applies_effort_runs_one_turn_and_replays_without_effects() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("env mutex");
    let _bearer_guard = test_support::set_bearer_token_env(None);
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("unix timestamp")
        .as_nanos();
    let runtime_home = PathBuf::from(format!("/tmp/anyharness-workflow-scripted-{unique}"));
    let (agent_program, request_log) = write_scripted_claude_agent(&runtime_home);
    let _program_guard = EnvVarGuard::set("ANYHARNESS_CLAUDE_AGENT_PROGRAM", &agent_program);
    let agent_args = serde_json::to_string(&vec![
        request_log.to_string_lossy().to_string(),
        "applied".to_string(),
    ])
    .expect("serialize agent args");
    let _args_guard = EnvVarGuard::set("ANYHARNESS_CLAUDE_AGENT_ARGS_JSON", &agent_args);

    {
        let state = AppState::new(
            runtime_home.clone(),
            "http://127.0.0.1:8457".to_string(),
            Db::open_in_memory().expect("in-memory db"),
            false,
            AgentSeedStore::not_configured_dev(),
        )
        .expect("app state");
        let workspace_id = "30000000-0000-4000-8000-000000000036";
        let workspace_dir = runtime_home.join("workspace");
        std::fs::create_dir_all(&workspace_dir).expect("create workspace directory");
        test_support::seed_workspace_with_repo_root(
            &state.db,
            workspace_id,
            "worktree",
            workspace_dir.to_str().expect("utf-8 workspace path"),
        );
        let run_id = uuid::Uuid::new_v4().to_string();
        let first_attempt: Value = serde_json::from_str("1.0").expect("numeric argument");
        let first_request = scripted_v2_body(workspace_id, first_attempt);
        let (status, created) = put(&state, &run_id, first_request).await;
        assert_eq!(status, StatusCode::CREATED, "response: {created}");
        assert_eq!(created["run"]["arguments"]["attempt"], json!(1));
        assert_eq!(created["resolvedHarness"]["agentKind"], "claude");
        assert_eq!(created["resolvedHarness"]["modelId"], "default");
        assert_eq!(created["resolvedHarness"]["modeId"], "bypassPermissions");
        assert_eq!(created["resolvedHarness"]["effort"], "high");

        let completed = poll_run_until(&state, &run_id, "scripted workflow completion", |body| {
            body["run"]["status"] == "completed"
        })
        .await;
        assert_eq!(completed["run"]["arguments"], created["run"]["arguments"]);
        assert_eq!(completed["steps"][0]["status"], "completed");
        assert_eq!(
            completed["steps"][0]["promptId"],
            format!("workflow:{run_id}:0:0")
        );
        assert!(completed["steps"][0]["turnId"]
            .as_str()
            .is_some_and(|turn_id| !turn_id.is_empty()));
        assert!(completed["run"]["sessionId"]
            .as_str()
            .is_some_and(|session_id| !session_id.is_empty()));
        assert_eq!(session_count(&state), 1);

        let requests = read_scripted_requests(&request_log);
        let methods: Vec<&str> = requests
            .iter()
            .filter_map(|request| request["method"].as_str())
            .collect();
        assert_eq!(
            methods
                .iter()
                .filter(|method| **method == "session/new")
                .count(),
            1
        );
        assert_eq!(
            methods
                .iter()
                .filter(|method| **method == "session/set_config_option")
                .count(),
            1
        );
        assert_eq!(
            methods
                .iter()
                .filter(|method| **method == "session/prompt")
                .count(),
            1
        );
        let new_index = methods
            .iter()
            .position(|method| *method == "session/new")
            .expect("session/new request");
        let config_index = methods
            .iter()
            .position(|method| *method == "session/set_config_option")
            .expect("config request");
        let prompt_index = methods
            .iter()
            .position(|method| *method == "session/prompt")
            .expect("prompt request");
        assert!(new_index < config_index && config_index < prompt_index);
        let config = requests
            .iter()
            .find(|request| request["method"] == "session/set_config_option")
            .expect("config request payload");
        assert_eq!(config["params"]["configId"], "effort");
        assert_eq!(config["params"]["value"], "high");
        let prompt = requests
            .iter()
            .find(|request| request["method"] == "session/prompt")
            .expect("prompt request payload");
        assert_eq!(
            prompt["params"]["prompt"][0]["text"],
            "Return PROL-321 attempt 1"
        );

        let effects_before_replay = requests.len();
        let sessions_before_replay = session_count(&state);
        let replay_attempt: Value = serde_json::from_str("1e0").expect("replay number");
        let (replay_status, replay) = put(
            &state,
            &run_id,
            scripted_v2_body(workspace_id, replay_attempt),
        )
        .await;
        assert_eq!(replay_status, StatusCode::OK);
        assert_eq!(replay, completed);
        assert_eq!(session_count(&state), sessions_before_replay);
        assert_eq!(
            read_scripted_requests(&request_log).len(),
            effects_before_replay
        );
        let (get_status, after_replay) = get(&state, &run_id).await;
        assert_eq!(get_status, StatusCode::OK);
        assert_eq!(after_replay, completed);
    }

    let _ = std::fs::remove_dir_all(&runtime_home);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn v2_effort_missing_rejected_or_response_error_fails_before_prompt() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("env mutex");
    let _bearer_guard = test_support::set_bearer_token_env(None);

    for (case_index, behavior) in ["missing", "rejected", "error"].into_iter().enumerate() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("unix timestamp")
            .as_nanos();
        let runtime_home = PathBuf::from(format!(
            "/tmp/anyharness-workflow-effort-{behavior}-{unique}"
        ));
        let (agent_program, request_log) = write_scripted_claude_agent(&runtime_home);
        let _program_guard = EnvVarGuard::set("ANYHARNESS_CLAUDE_AGENT_PROGRAM", &agent_program);
        let agent_args = serde_json::to_string(&vec![
            request_log.to_string_lossy().to_string(),
            behavior.to_string(),
        ])
        .expect("serialize agent args");
        let _args_guard = EnvVarGuard::set("ANYHARNESS_CLAUDE_AGENT_ARGS_JSON", &agent_args);

        {
            let state = AppState::new(
                runtime_home.clone(),
                "http://127.0.0.1:8457".to_string(),
                Db::open_in_memory().expect("in-memory db"),
                false,
                AgentSeedStore::not_configured_dev(),
            )
            .expect("app state");
            let workspace_id = format!("30000000-0000-4000-8000-00000000004{case_index}");
            let workspace_dir = runtime_home.join("workspace");
            std::fs::create_dir_all(&workspace_dir).expect("create workspace directory");
            test_support::seed_workspace_with_repo_root(
                &state.db,
                &workspace_id,
                "worktree",
                workspace_dir.to_str().expect("utf-8 workspace path"),
            );
            let run_id = uuid::Uuid::new_v4().to_string();
            let (status, _) = put(&state, &run_id, scripted_v2_body(&workspace_id, json!(1))).await;
            assert_eq!(status, StatusCode::CREATED, "behavior: {behavior}");

            let failed = poll_run_until(&state, &run_id, "effort apply failure", |body| {
                body["run"]["status"] == "failed"
            })
            .await;
            assert_eq!(
                failed["run"]["failureCode"], "session_config_apply_failed",
                "behavior: {behavior}"
            );
            assert_eq!(
                failed["steps"][0]["failureCode"], "session_config_apply_failed",
                "behavior: {behavior}"
            );
            assert_eq!(session_count(&state), 1, "behavior: {behavior}");

            let requests = read_scripted_requests(&request_log);
            assert_eq!(
                requests
                    .iter()
                    .filter(|request| request["method"] == "session/new")
                    .count(),
                1,
                "behavior: {behavior}"
            );
            assert_eq!(
                requests
                    .iter()
                    .filter(|request| request["method"] == "session/prompt")
                    .count(),
                0,
                "behavior: {behavior}"
            );
            let expected_config_requests = usize::from(behavior != "missing");
            assert_eq!(
                requests
                    .iter()
                    .filter(|request| request["method"] == "session/set_config_option")
                    .count(),
                expected_config_requests,
                "behavior: {behavior}"
            );
        }

        let _ = std::fs::remove_dir_all(&runtime_home);
    }
}

#[tokio::test(start_paused = true)]
async fn v2_effort_timeout_fails_durably_before_prompt() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("env mutex");
    let _bearer_guard = test_support::set_bearer_token_env(None);
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("unix timestamp")
        .as_nanos();
    let runtime_home = PathBuf::from(format!("/tmp/anyharness-workflow-effort-timeout-{unique}"));
    let (agent_program, request_log) = write_scripted_claude_agent(&runtime_home);
    let _program_guard = EnvVarGuard::set("ANYHARNESS_CLAUDE_AGENT_PROGRAM", &agent_program);
    let agent_args = serde_json::to_string(&vec![
        request_log.to_string_lossy().to_string(),
        "timeout".to_string(),
    ])
    .expect("serialize agent args");
    let _args_guard = EnvVarGuard::set("ANYHARNESS_CLAUDE_AGENT_ARGS_JSON", &agent_args);

    {
        let state = AppState::new(
            runtime_home.clone(),
            "http://127.0.0.1:8457".to_string(),
            Db::open_in_memory().expect("in-memory db"),
            false,
            AgentSeedStore::not_configured_dev(),
        )
        .expect("app state");
        let workspace_id = "30000000-0000-4000-8000-000000000043";
        let workspace_dir = runtime_home.join("workspace");
        std::fs::create_dir_all(&workspace_dir).expect("create workspace directory");
        test_support::seed_workspace_with_repo_root(
            &state.db,
            workspace_id,
            "worktree",
            workspace_dir.to_str().expect("utf-8 workspace path"),
        );
        let run_id = uuid::Uuid::new_v4().to_string();
        let (status, _) = put(&state, &run_id, scripted_v2_body(workspace_id, json!(1))).await;
        assert_eq!(status, StatusCode::CREATED);

        let wall_deadline = std::time::Instant::now() + Duration::from_secs(5);
        loop {
            let config_was_sent = request_log.exists()
                && read_scripted_requests(&request_log)
                    .iter()
                    .any(|request| request["method"] == "session/set_config_option");
            if config_was_sent {
                break;
            }
            assert!(
                std::time::Instant::now() < wall_deadline,
                "scripted agent never received effort config"
            );
            tokio::time::sleep(Duration::from_millis(1)).await;
        }

        tokio::time::advance(Duration::from_secs(46)).await;
        let failed = poll_run_until(&state, &run_id, "effort apply timeout", |body| {
            body["run"]["status"] == "failed"
        })
        .await;
        assert_eq!(failed["run"]["failureCode"], "session_config_apply_failed");
        assert_eq!(
            failed["steps"][0]["failureCode"],
            "session_config_apply_failed"
        );
        assert_eq!(failed["steps"][0]["status"], "failed");
        let requests = read_scripted_requests(&request_log);
        assert_eq!(
            requests
                .iter()
                .filter(|request| request["method"] == "session/prompt")
                .count(),
            0
        );
        assert_eq!(session_count(&state), 1);
    }

    let _ = std::fs::remove_dir_all(&runtime_home);
}
