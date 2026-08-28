//! Shared fixtures for the targeted-fork scenario tests
//! (`fork_dispatch_and_restart_tests`): the fork-capable scripted stdio ACP
//! agent, the seeded fork parent/child state builders, and the wire-log and
//! provenance assertion helpers. The `_tests.rs` suffix marks this test-only
//! support module for the repo-shape scanners, like
//! `prompt_message_actor_tests`, which also hosts fixtures other test files
//! import.

use std::path::Path;
use std::time::Duration;

use anyharness_contract::v1::{ForkSessionTarget, ForkSessionTargetType};

use super::fork_anchor_gate_tests::{
    fork_gate_assistant_message, fork_gate_turn_ended, fork_gate_user_message,
};
use super::prompt_message_actor_tests::{read_requests, write_scripted_agent, ScriptedAgent};
use super::tests::session_record;
use crate::app::{test_support, AppState};
use crate::domains::agents::installer::seed::AgentSeedStore;
use crate::domains::sessions::links::model::{
    SessionLinkRecord, SessionLinkRelation, SessionLinkWorkspaceRelation,
};
use crate::domains::sessions::links::service::SessionLinkService;
use crate::domains::sessions::links::store::SessionLinkStore;
use crate::domains::sessions::model::{
    ForkOperationPhase, ForkOperationRecord, SessionEventRecord,
};
use crate::persistence::Db;

// --- Scripted fork-capable agent + state fixtures --------------------------

/// The Python ACP agent driving these tests. `__CAP_SHAPE__` is replaced with
/// `strict` (advertises the edit-safe `targetedFork` extension → targeted_fork
/// probes true) or `legacy` (the shipped Claude .2 shape: bare `fork` capability
/// plus init-level `_meta.anyharness.fork` → targeted_fork false). A `hold-fork`
/// control file stalls the agent inside `session/fork` for the double-fork race.
const FORK_AGENT_PY: &str = r#"#!/usr/bin/env python3
import json, os, select, sys, time, uuid
log_path = sys.argv[-2]
control_dir = sys.argv[-1]
CAP_SHAPE = "__CAP_SHAPE__"
resident_sessions = set()
resident_anchors = {}
def emit(payload):
    print(json.dumps(payload, separators=(",", ":")), flush=True)
def record(payload):
    logged = dict(payload)
    logged["__fixturePid"] = os.getpid()
    with open(log_path, "a", encoding="utf-8") as log:
        log.write(json.dumps(logged, separators=(",", ":")) + "\n")
def control(name):
    return os.path.join(control_dir, name)
def notify(session_id, text):
    emit({
        "jsonrpc": "2.0",
        "method": "session/update",
        "params": {
            "sessionId": session_id,
            "update": {
                "sessionUpdate": "agent_message_chunk",
                "content": {"type": "text", "text": text},
            },
        },
    })
def await_response(response_id):
    while True:
        response_line = sys.stdin.readline()
        if not response_line:
            sys.exit(0)
        response = json.loads(response_line)
        record(response)
        if response.get("id") == response_id and "method" not in response:
            return response
        if "id" in response and response.get("method") in ("session/set_model", "session/set_mode", "session/set_config_option"):
            emit({"jsonrpc": "2.0", "id": response["id"], "result": {}})
def await_control_servicing_config(name):
    while not os.path.exists(control(name)):
        readable, _, _ = select.select([sys.stdin], [], [], 0.01)
        if not readable:
            continue
        line = sys.stdin.readline()
        if not line:
            sys.exit(0)
        message = json.loads(line)
        record(message)
        if "id" in message and message.get("method") in ("session/set_model", "session/set_mode", "session/set_config_option"):
            emit({"jsonrpc": "2.0", "id": message["id"], "result": {}})
        elif "id" in message:
            emit({"jsonrpc": "2.0", "id": message["id"], "error": {"code": -32601, "message": "method not found"}})
def fork_capability():
    if CAP_SHAPE == "strict":
        return {"_meta": {"anyharness": {"schemaVersion": 1, "targetedFork": {"fileEffects": "none", "target": "message_id"}}}}
    return {}
for raw_line in sys.stdin:
    message = json.loads(raw_line)
    record(message)
    if "id" not in message:
        continue
    request_id = message["id"]
    method = message.get("method")
    if method == "initialize":
        result = {
            "protocolVersion": 1,
            "agentCapabilities": {"loadSession": True, "sessionCapabilities": {"fork": fork_capability()}},
            "authMethods": [],
        }
        if CAP_SHAPE == "legacy":
            result["_meta"] = {"anyharness": {"fork": {"version": 1, "anchor": "upToMessageId"}}}
        emit({"jsonrpc": "2.0", "id": request_id, "result": result})
    elif method == "session/new":
        emit({"jsonrpc": "2.0", "id": request_id, "result": {"sessionId": "native-new-" + uuid.uuid4().hex}})
    elif method == "session/load":
        parent_id = message["params"]["sessionId"]
        resident_sessions.add(parent_id)
        resident_anchors[parent_id] = {"msg-0", "msg-1"}
        notify(parent_id, "PARENT-REPLAY-MUST-NOT-PERSIST")
        if os.path.exists(control("parent-permission-on-load")):
            emit({
                "jsonrpc": "2.0",
                "id": "parent-permission",
                "method": "session/request_permission",
                "params": {
                    "sessionId": parent_id,
                    "toolCall": {"toolCallId": "parent-replay-tool"},
                    "options": [],
                },
            })
            response = await_response("parent-permission")
            with open(control("parent-permission-response"), "w", encoding="utf-8") as receipt:
                receipt.write(json.dumps(response, separators=(",", ":")))
        emit({"jsonrpc": "2.0", "id": request_id, "result": {}})
    elif method == "session/fork":
        parent_id = message["params"]["sessionId"]
        if parent_id not in resident_sessions:
            emit({"jsonrpc": "2.0", "id": request_id, "error": {"code": -32602, "message": "parent not resident"}})
            continue
        anchor = message.get("params", {}).get("_meta", {}).get("anyharness", {}).get("upToMessageId")
        if anchor is not None and anchor not in resident_anchors.get(parent_id, set()):
            emit({"jsonrpc": "2.0", "id": request_id, "error": {"code": -32602, "message": "anchor not resident"}})
            continue
        if os.path.exists(control("fork-explicit-error")):
            emit({"jsonrpc": "2.0", "id": request_id, "error": {"code": -32602, "message": "explicit rejection"}})
            continue
        if os.path.exists(control("fork-malformed-result")):
            emit({
                "jsonrpc": "2.0",
                "id": request_id,
                "result": {"sessionId": "native-malformed-child"},
                "error": {"code": -32602, "message": "malformed both-fields response"},
            })
            continue
        if os.path.exists(control("fork-malformed-typed-result")):
            emit({
                "jsonrpc": "2.0",
                "id": request_id,
                "result": {"sessionId": {"provider-response-secret": True}},
            })
            continue
        if os.path.exists(control("fork-malformed-wire")):
            print('{"jsonrpc":"2.0","id":{"provider-secret-wire":true}}', flush=True)
            sys.exit(0)
        if os.path.exists(control("fork-drop")):
            sys.exit(0)
        if os.path.exists(control("hold-fork")):
            open(control("fork-hold-seen"), "w", encoding="utf-8").close()
            while not os.path.exists(control("release-fork")):
                time.sleep(0.01)
        child_id = "native-fork-" + uuid.uuid4().hex
        if os.path.exists(control("fork-race")):
            notify(child_id, "CHILD-BEFORE-FORK-RESULT")
        emit({"jsonrpc": "2.0", "id": request_id, "result": {"sessionId": child_id}})
        if os.path.exists(control("fork-race")):
            notify(child_id, "CHILD-AFTER-FORK-RESULT")
            await_control_servicing_config("release-delayed-parent")
            notify(parent_id, "DELAYED-PARENT-MUST-NOT-PERSIST")
            open(control("delayed-parent-emitted"), "w", encoding="utf-8").close()
            emit({
                "jsonrpc": "2.0",
                "id": "delayed-parent-barrier",
                "method": "session/request_permission",
                "params": {
                    "sessionId": parent_id,
                    "toolCall": {"toolCallId": "delayed-parent-tool"},
                    "options": [],
                },
            })
            barrier = await_response("delayed-parent-barrier")
            with open(control("delayed-parent-barrier-response"), "w", encoding="utf-8") as receipt:
                receipt.write(json.dumps(barrier, separators=(",", ":")))
    elif method == "session/prompt":
        if os.path.exists(control("child-prompt-explicit-error")):
            emit({
                "jsonrpc": "2.0",
                "id": request_id,
                "error": {
                    "code": -32000,
                    "message": "provider-secret-prompt-message",
                    "data": {"detail": "provider-secret-prompt-data"},
                },
            })
            continue
        if os.path.exists(control("child-prompt-malformed-result")):
            emit({
                "jsonrpc": "2.0",
                "id": request_id,
                "result": None,
                "error": {
                    "code": -32000,
                    "message": "provider-secret-malformed-message",
                    "data": {"detail": "provider-secret-malformed-data"},
                },
            })
            continue
        emit({"jsonrpc": "2.0", "id": request_id, "result": {"stopReason": "end_turn"}})
    elif method in ("session/set_model", "session/set_mode", "session/set_config_option"):
        emit({"jsonrpc": "2.0", "id": request_id, "result": {}})
    else:
        emit({"jsonrpc": "2.0", "id": request_id, "error": {"code": -32601, "message": "method not found"}})
"#;

/// Reuse the shared scripted-agent scaffolding (secrets, native stub, control
/// dir, request log) but swap in the fork-capable Python for the given shape.
pub(super) fn write_fork_agent(runtime_home: &Path, shape: &str) -> ScriptedAgent {
    let script = write_scripted_agent(runtime_home);
    std::fs::write(
        &script.program,
        FORK_AGENT_PY.replace("__CAP_SHAPE__", shape),
    )
    .expect("overwrite fork agent");
    crate::integrations::agent_cli::executable::make_executable(&script.program)
        .expect("executable fork agent");
    script
}

/// A real `AppState` over one seeded on-disk local workspace. Modeled on
/// `prompt_message_actor_tests::build_state` but with a single controlled
/// workspace so the caller owns every session row. `seed` must be false when
/// reopening an already-seeded on-disk db (the seeder is a plain INSERT).
pub(super) fn build_fork_runtime_state(runtime_home: &Path, db: Db, seed: bool) -> AppState {
    let workspace_path = runtime_home.join("workspace");
    std::fs::create_dir_all(&workspace_path).expect("workspace directory");
    let state = AppState::new(
        runtime_home.to_path_buf(),
        "http://127.0.0.1:8457".to_string(),
        db,
        false,
        AgentSeedStore::not_configured_dev(),
    )
    .expect("app state");
    if seed {
        test_support::seed_workspace_with_repo_root(
            &state.db,
            "workspace-fork",
            "local",
            &workspace_path.to_string_lossy(),
        );
    }
    state
}

/// Seed the forkable Claude parent: recorded native id + `last_prompt_at` so a
/// live start loads (not creates) the native session. `caps_json` is the durable
/// action-capabilities gate value; pass `None` to let the live probe persist it.
pub(super) fn seed_parent(state: &AppState, caps_json: Option<&str>) -> String {
    let mut parent = session_record("claude");
    parent.id = "fork-parent".to_string();
    parent.workspace_id = "workspace-fork".to_string();
    parent.native_session_id = Some("native-parent".to_string());
    parent.last_prompt_at = Some("2026-08-17T00:00:00Z".to_string());
    parent.action_capabilities_json = caps_json.map(str::to_string);
    state
        .session_service
        .store()
        .insert(&parent)
        .expect("insert parent");
    // The launch-options cutover requires every session that can start live to
    // carry an immutable launch intent plus a current observation for its
    // harness; these fixtures insert rows directly.
    test_support::seed_observed_launch_options(&state.launch_options_service, &parent.agent_kind);
    state
        .session_service
        .store()
        .seed_empty_launch_intent(&parent.id);
    parent.id
}

pub(super) fn before_user_message(turn: &str, item: &str) -> ForkSessionTarget {
    ForkSessionTarget {
        target_type: ForkSessionTargetType::BeforeUserMessage,
        turn_id: turn.to_string(),
        item_id: Some(item.to_string()),
    }
}

/// u0 / a0(msg-0) / t0 → item-1 / a1(msg-1) / turn-1 → item-2 / turn-2. The
/// boundary before item-1 keeps a0 (anchor msg-0); before item-2 keeps a1
/// (anchor msg-1).
pub(super) fn seed_three_turn_transcript(state: &AppState, parent_id: &str) {
    let store = state.session_service.store();
    for event in [
        fork_gate_user_message(1, "t0", "u0"),
        fork_gate_assistant_message(2, "t0", "a0", "msg-0"),
        fork_gate_turn_ended(3, "t0"),
        fork_gate_user_message(4, "turn-1", "item-1"),
        fork_gate_assistant_message(5, "turn-1", "a1", "msg-1"),
        fork_gate_turn_ended(6, "turn-1"),
        fork_gate_user_message(7, "turn-2", "item-2"),
        fork_gate_turn_ended(8, "turn-2"),
    ] {
        store
            .append_event(&SessionEventRecord {
                session_id: parent_id.to_string(),
                ..event
            })
            .expect("append parent event");
    }
}

pub(super) enum ForkChildAnchor {
    /// Recorded-anchor-missing corruption: targeted (anchor_turn_id set) but no
    /// provider anchor kind/value.
    Missing,
    MessageId(&'static str),
}

/// Seed a targeted fork child directly: child session + fork link + completed
/// fork operation. No live agent is involved.
pub(super) fn seed_fork_child(state: &AppState, child_id: &str, anchor: ForkChildAnchor) {
    let mut child = session_record("claude");
    child.id = child_id.to_string();
    child.workspace_id = "workspace-fork".to_string();
    child.native_session_id = None;
    child.last_prompt_at = None;
    let link = SessionLinkRecord {
        id: format!("fork-link-{child_id}"),
        public_id: Some(format!("fk_{}", child_id.replace('-', ""))),
        relation: SessionLinkRelation::Fork,
        parent_session_id: "fork-parent".to_string(),
        child_session_id: child_id.to_string(),
        workspace_relation: SessionLinkWorkspaceRelation::SameWorkspace,
        label: None,
        created_by_turn_id: None,
        created_by_tool_call_id: None,
        created_at: "2026-08-17T00:00:00Z".to_string(),
        subagent_closed_at: None,
        closed_at: None,
    };
    state
        .session_service
        .store()
        .insert_session_with_link(&child, &link)
        .expect("insert child + link");
    test_support::seed_observed_launch_options(&state.launch_options_service, &child.agent_kind);
    state
        .session_service
        .store()
        .seed_empty_launch_intent(child_id);
    let (kind, value, inclusive) = match anchor {
        ForkChildAnchor::Missing => (None, None, None),
        ForkChildAnchor::MessageId(id) => (
            Some("message_id".to_string()),
            Some(id.to_string()),
            Some(true),
        ),
    };
    let now = "2026-08-17T00:00:00Z".to_string();
    let operation = ForkOperationRecord {
        id: uuid::Uuid::new_v4().to_string(),
        idempotency_key: child_id.to_string(),
        request_digest: "digest".to_string(),
        parent_session_id: "fork-parent".to_string(),
        child_session_id: child_id.to_string(),
        phase: ForkOperationPhase::Completed,
        anchor_turn_id: Some("turn-1".to_string()),
        anchor_item_id: Some("item-1".to_string()),
        provider_anchor_kind: kind,
        provider_anchor_value: value,
        provider_anchor_inclusive: inclusive,
        prefix_terminal_seq: Some(0),
        prefix_digest: Some("digest".to_string()),
        adapter_version: None,
        native_version: None,
        native_child_session_id: None,
        checkpoint_id: None,
        created_at: now.clone(),
        updated_at: now,
    };
    state
        .session_service
        .store()
        .insert_fork_operation(&operation)
        .expect("insert fork operation");
}

pub(super) fn fork_children(state: &AppState, parent_id: &str) -> Vec<String> {
    let link_service = SessionLinkService::new(
        SessionLinkStore::new(state.db.clone()),
        state.session_service.store().clone(),
    );
    link_service
        .list_by_parent(parent_id)
        .expect("list parent links")
        .into_iter()
        .filter(|link| link.relation == SessionLinkRelation::Fork)
        .map(|link| link.child_session_id)
        .collect()
}

/// The sorted `_meta.anyharness.upToMessageId` values carried by every logged
/// `session/fork` wire request.
pub(super) fn fork_wire_anchors(path: &Path) -> Vec<String> {
    let mut anchors = read_requests(path)
        .into_iter()
        .filter(|request| request["method"] == "session/fork")
        .filter_map(|request| {
            request["params"]["_meta"]["anyharness"]["upToMessageId"]
                .as_str()
                .map(str::to_string)
        })
        .collect::<Vec<_>>();
    anchors.sort();
    anchors
}

pub(super) fn assert_process_local_fork_wire_contract(path: &Path) {
    let requests = read_requests(path);
    let lifecycle = requests
        .iter()
        .filter(|request| {
            matches!(
                request["method"].as_str(),
                Some("initialize") | Some("session/load") | Some("session/fork")
            )
        })
        .collect::<Vec<_>>();
    for (index, request) in lifecycle.iter().enumerate() {
        if request["method"] != "session/fork" {
            continue;
        }
        assert!(index >= 2, "fork request must follow initialize and load");
        assert_eq!(lifecycle[index - 2]["method"], "initialize");
        assert_eq!(lifecycle[index - 1]["method"], "session/load");
        assert_eq!(
            lifecycle[index - 2]["__fixturePid"],
            request["__fixturePid"],
            "initialize and fork must use one process"
        );
        assert_eq!(
            lifecycle[index - 1]["__fixturePid"],
            request["__fixturePid"],
            "parent load and fork must use one process"
        );
        assert_eq!(
            lifecycle[index - 1]["params"]["sessionId"],
            request["params"]["sessionId"],
            "the same process must load and fork the exact parent"
        );
        assert_eq!(
            lifecycle[index - 1]["params"]["_meta"]["systemPrompt"],
            request["params"]["_meta"]["systemPrompt"],
            "parent hydration and fork must carry the same system-prompt metadata"
        );
        assert!(
            lifecycle[index - 1]["params"]["_meta"]["anyharness"]["upToMessageId"].is_null(),
            "the fork-only anchor must not alter parent hydration"
        );
    }
    assert!(
        requests.iter().all(|request| {
            request["method"] != "session/close"
                || request["params"]["sessionId"] != "native-parent"
        }),
        "process-local hydration must not close the parent"
    );
}

pub(super) async fn wait_for_child_notification_text(
    state: &AppState,
    child_id: &str,
    expected: &str,
) {
    for _ in 0..500 {
        let notifications = state
            .session_service
            .store()
            .list_raw_notifications(child_id)
            .expect("list child raw notifications");
        if notifications
            .iter()
            .any(|notification| notification.payload_json.contains(expected))
        {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("timed out waiting for child notification {expected}");
}

pub(super) fn assert_child_anchor_provenance(
    state: &AppState,
    child_id: &str,
    expected_anchor: &str,
    expected_checkpoint_id: Option<&str>,
) {
    let operation = state
        .session_service
        .store()
        .find_fork_operation_by_child(child_id)
        .expect("query fork operation")
        .expect("fork operation row exists");
    assert_eq!(operation.phase, ForkOperationPhase::Completed);
    assert_eq!(
        operation.provider_anchor_kind.as_deref(),
        Some("message_id")
    );
    assert_eq!(
        operation.provider_anchor_value.as_deref(),
        Some(expected_anchor)
    );
    assert_eq!(operation.provider_anchor_inclusive, Some(true));
    assert_eq!(operation.checkpoint_id.as_deref(), expected_checkpoint_id);
    assert!(operation.native_child_session_id.is_none());
    let child = state
        .session_service
        .get_session(child_id)
        .expect("get child session")
        .expect("child session exists");
    assert_eq!(child.status, "idle");
    assert!(
        child
            .native_session_id
            .as_deref()
            .is_some_and(|native_id| !native_id.trim().is_empty()),
        "the child session row owns the process-local native id"
    );
}

pub(super) async fn wait_for_control(path: &Path) {
    for _ in 0..500 {
        if path.exists() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("timed out waiting for control file {}", path.display());
}

pub(super) async fn wait_for_fork_wire_count(path: &Path, expected: usize) {
    for _ in 0..500 {
        let count = read_requests(path)
            .iter()
            .filter(|request| request["method"] == "session/fork")
            .count();
        if count >= expected {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("timed out waiting for {expected} session/fork wire requests");
}

pub(super) async fn close_all(state: &AppState, ids: &[&str]) {
    for id in ids {
        if let Some(handle) = state.acp_manager.get_handle(id).await {
            let _ = tokio::time::timeout(Duration::from_secs(2), handle.close()).await;
        }
    }
}
