//! Lane H fork/checkpoint linkage suite, split out of `tests.rs` to stay
//! under the repo line cap; the shared fork-state harness
//! (`build_forkable_fork_state`) lives in `fork_anchor_gate_tests.rs`.

use std::path::{Path, PathBuf};
use std::time::Duration;

use super::fork_anchor_gate_tests::build_forkable_fork_state;
use super::tests::{link_record, session_record};
use crate::app::AppState;
use crate::domains::sessions::links::service::SessionLinkService;
use crate::domains::sessions::links::store::SessionLinkStore;

/// Positive Q-H4 linkage proof through the real OpenCode targeted-fork call
/// site. The scripted handle accepts the live readiness check, then drops the
/// side-door response after `fork_session` persists its operation, letting the
/// test inspect the exact prepared/in-flight record without starting a native
/// child.
#[tokio::test(flavor = "current_thread")]
async fn checkpoint_linkage_stamps_the_boundary_checkpoint_id_onto_the_fork_operation() {
    use anyharness_contract::v1::{ForkSessionTarget, ForkSessionTargetType};

    use crate::app::test_support;
    use crate::domains::agents::installer::seed::AgentSeedStore;
    use crate::domains::sessions::model::{ForkOperationPhase, SessionEventRecord};
    use crate::domains::sessions::runtime::ForkSessionError;
    use crate::domains::workspaces::checkpoints::{CheckpointOrigin, CheckpointRecord};
    use crate::persistence::Db;

    let _env = test_support::lock_env().await;
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let runtime_home = std::env::temp_dir().join(format!(
        "anyharness-fork-checkpoint-linkage-{}",
        uuid::Uuid::new_v4()
    ));
    let workspace_path = runtime_home.join("workspace");
    std::fs::create_dir_all(&workspace_path).expect("create workspace directory");
    let state = AppState::new(
        runtime_home.clone(),
        "http://127.0.0.1:8457".to_string(),
        Db::open_in_memory().expect("in-memory db"),
        false,
        AgentSeedStore::not_configured_dev(),
    )
    .expect("app state");
    test_support::seed_workspace_with_repo_root(
        &state.db,
        "workspace-fork-linkage",
        "local",
        &workspace_path.to_string_lossy(),
    );

    let mut parent = session_record("opencode");
    parent.id = "checkpoint-fork-parent".to_string();
    parent.workspace_id = "workspace-fork-linkage".to_string();
    parent.last_prompt_at = Some("2026-03-25T00:05:00Z".to_string());
    parent.action_capabilities_json = Some(r#"{"fork":true,"targetedFork":true}"#.to_string());
    state
        .session_service
        .store()
        .insert(&parent)
        .expect("insert OpenCode parent");
    state
        .session_service
        .store()
        .seed_empty_launch_intent(&parent.id);

    for event in [
        SessionEventRecord {
            id: 0,
            session_id: parent.id.clone(),
            seq: 1,
            timestamp: "2026-03-25T00:01:00Z".to_string(),
            event_type: "item_completed".to_string(),
            turn_id: Some("turn-7".to_string()),
            item_id: Some("item-7".to_string()),
            payload_json: serde_json::json!({
                "type": "item_completed",
                "item": {
                    "kind": "user_message",
                    "status": "completed",
                    "sourceAgentKind": "opencode"
                }
            })
            .to_string(),
        },
        SessionEventRecord {
            id: 0,
            session_id: parent.id.clone(),
            seq: 2,
            timestamp: "2026-03-25T00:02:00Z".to_string(),
            event_type: "turn_ended".to_string(),
            turn_id: Some("turn-7".to_string()),
            item_id: None,
            payload_json: r#"{"type":"turn_ended","stopReason":"end_turn"}"#.to_string(),
        },
    ] {
        state
            .session_service
            .store()
            .append_event(&event)
            .expect("append committed parent boundary");
    }
    state
        .session_service
        .store()
        .insert_opencode_message_id(
            &parent.id,
            "turn-7",
            "item-7",
            "vendor-message-7",
            "2026-03-25T00:02:00Z",
        )
        .expect("seed OpenCode vendor message mapping");

    // Seed a turn-start checkpoint at the (parent_session_id, turn_id) boundary.
    let checkpoint = CheckpointRecord {
        id: "chk-boundary-1".to_string(),
        workspace_id: "workspace-fork-linkage".to_string(),
        origin: CheckpointOrigin::TurnStart,
        session_id: Some(parent.id.clone()),
        turn_id: Some("turn-7".to_string()),
        prompt_id: None,
        fork_operation_id: None,
        revert_operation_id: None,
        head_sha: "0".repeat(40),
        work_tree_oid: "1".repeat(40),
        index_tree_oid: "2".repeat(40),
        work_tree_anchored: false,
        index_tree_anchored: false,
        notices_json: None,
        created_at: "2026-03-25T00:00:00Z".to_string(),
        updated_at: "2026-03-25T00:00:00Z".to_string(),
        expired_at: None,
    };
    state
        .workspace_checkpoint_service
        .store_for_tests()
        .insert_checkpoint(&checkpoint)
        .expect("seed checkpoint");

    state
        .session_runtime
        .acp_manager_for_test()
        .insert_targeted_fork_ready_sidedoor_dropper_for_test(&parent.id)
        .await;
    let error = state
        .session_runtime
        .fork_session(
            &parent.id,
            Some(ForkSessionTarget {
                target_type: ForkSessionTargetType::BeforeUserMessage,
                turn_id: "turn-7".to_string(),
                item_id: Some("item-7".to_string()),
            }),
            Some("linked-child".to_string()),
            None,
        )
        .await
        .expect_err("the side-door actor drops its post-persistence dispatch response");
    assert!(matches!(error, ForkSessionError::Internal(_)));

    let stored = state
        .session_service
        .store()
        .find_fork_operation_by_key("linked-child")
        .expect("read fork operation")
        .expect("operation row present");
    assert_eq!(
        stored.checkpoint_id.as_deref(),
        Some("chk-boundary-1"),
        "the fork operation row carries the boundary checkpoint id"
    );
    assert_eq!(stored.anchor_turn_id.as_deref(), Some("turn-7"));
    assert_eq!(stored.anchor_item_id.as_deref(), Some("item-7"));
    assert_eq!(stored.phase, ForkOperationPhase::NativeOutcomeUnknown);
    let _ = std::fs::remove_dir_all(&runtime_home);
}

/// Abort-policy cleanup regression (Lane H, `prompt.rs` site 1). Drives the real
/// `send_prompt` path over the scripted ACP actor (no mock LLM): the prompt
/// carries an image attachment that `prepare_prompt` persists to BOTH the store
/// and the attachment storage, then the turn-start checkpoint capture fails
/// because `target`'s workspace (`workspace-b`) is a plain directory, not a git
/// repository (HollowCheckout). Under the `Abort` policy `send_prompt` returns
/// `CheckpointCaptureFailed`, and the arm under test first calls
/// `prepared.cleanup_attachments`. This test binds that call: deleting it leaves
/// the persisted attachment row and its stored `content` file behind, and the
/// two post-condition assertions below fail.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn abort_capture_failure_cleans_up_the_persisted_prompt_attachment() {
    use anyharness_contract::v1::PromptInputBlock;
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine};

    use super::prompt_message_actor_tests::{
        build_state, install_scripted_agent_env, stop_target_actor, temp_runtime_home,
        wait_for_actor_idle, write_scripted_agent,
    };
    use crate::app::test_support;
    use crate::domains::workspaces::checkpoints::test_support::EnvGuard;
    use crate::persistence::Db;

    let _capture = EnvGuard::on().await;
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);

    let runtime_home = temp_runtime_home("checkpoint-abort-cleanup");
    let script = write_scripted_agent(&runtime_home);
    let (_program, _args) = install_scripted_agent_env(&script);
    let state = build_state(
        &runtime_home,
        Db::open_in_memory().expect("in-memory db"),
        true,
    );

    // Start the real target actor and let it settle idle, so the capture hook is
    // actually reached: it is skipped while `handle.is_busy()`.
    state
        .session_runtime
        .ensure_live_session("target", None)
        .await
        .expect("start target actor");
    wait_for_actor_idle(&state).await;
    // The persisted live config must advertise image capability before the
    // attachment can clear `prepare_prompt`'s capability gate.
    wait_for_image_capability(&state, "target").await;

    // A tiny blob is fine: prepare only checks the `image/` MIME prefix, and the
    // capture aborts before the agent ever sees the payload.
    let image_data = BASE64.encode([0u8, 1, 2, 3]);
    let blocks = vec![
        PromptInputBlock::Text {
            text: "prompt with an attachment".into(),
        },
        PromptInputBlock::Image {
            data: Some(image_data),
            attachment_id: None,
            mime_type: "image/png".into(),
            name: Some("shot.png".into()),
            uri: None,
            source: None,
        },
    ];

    let error = state
        .session_runtime
        .send_prompt("target", blocks, Some("prompt-abort-1".into()))
        .await
        .expect_err("capture failure aborts the turn");
    assert!(
        matches!(
            error,
            super::SendPromptError::CheckpointCaptureFailed { .. }
        ),
        "the abort policy surfaces a checkpoint-capture failure, got: {error:?}"
    );

    // Store side: the just-persisted attachment row is gone.
    let rows = state
        .session_service
        .store()
        .list_prompt_attachments("target")
        .expect("list prompt attachments");
    assert!(
        rows.is_empty(),
        "the aborted turn's persisted attachment row must be cleaned up, got: {rows:?}"
    );

    // Storage side: no stored `content` file survives under the session dir.
    let session_dir = runtime_home
        .join("attachments")
        .join("sessions")
        .join("target");
    let leftover = files_under(&session_dir);
    assert!(
        leftover.is_empty(),
        "the aborted turn's stored attachment file must be cleaned up, got: {leftover:?}"
    );

    stop_target_actor(&state).await;
    drop(state);
    let _ = std::fs::remove_dir_all(&runtime_home);
}

/// Poll the persisted live config until it advertises image capability, matching
/// the wait style of the actor suite's `wait_for_actor_idle`.
async fn wait_for_image_capability(state: &AppState, session_id: &str) {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let ready = state
                .session_service
                .get_live_config_snapshot(session_id)
                .ok()
                .flatten()
                .is_some_and(|snapshot| snapshot.prompt_capabilities.image);
            if ready {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("target advertises image capability");
}

/// Every regular file beneath `dir` (recursively). Empty when `dir` is absent.
fn files_under(dir: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(path) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&path) else {
            continue;
        };
        for entry in entries.flatten() {
            let entry_path = entry.path();
            if entry_path.is_dir() {
                stack.push(entry_path);
            } else {
                found.push(entry_path);
            }
        }
    }
    found
}

#[tokio::test(flavor = "current_thread")]
async fn same_key_same_payload_resumes_the_existing_child() {
    // The idempotency contract's success arm, shared by the insert-time
    // UNIQUE-constraint TOCTOU fallback: a repeat with the same key + same
    // canonical payload returns the already-persisted child, never a second.
    use super::fork::canonical_fork_request_digest;
    use crate::domains::sessions::links::model::SessionLinkRelation;
    use crate::domains::sessions::model::{ForkOperationPhase, ForkOperationRecord};
    let (state, parent_id, runtime_home) = build_forkable_fork_state(r#"{"fork":true}"#);

    // Seed a completed fork: child session + fork link + a completed operation.
    let mut child = session_record("claude");
    child.id = "reserved-child".to_string();
    child.workspace_id = "workspace-fork-rung2".to_string();
    let link = link_record(
        "fork-link-1",
        SessionLinkRelation::Fork,
        &parent_id,
        "reserved-child",
    );
    state
        .session_service
        .store()
        .insert_session_with_link(&child, &link)
        .expect("insert child + link");

    let operation = ForkOperationRecord {
        id: uuid::Uuid::new_v4().to_string(),
        idempotency_key: "reserved-child".to_string(),
        request_digest: canonical_fork_request_digest(&parent_id, None),
        parent_session_id: parent_id.clone(),
        child_session_id: "reserved-child".to_string(),
        phase: ForkOperationPhase::Completed,
        anchor_turn_id: None,
        anchor_item_id: None,
        provider_anchor_kind: Some("tip".to_string()),
        provider_anchor_value: None,
        provider_anchor_inclusive: None,
        prefix_terminal_seq: Some(0),
        prefix_digest: Some("digest".to_string()),
        adapter_version: None,
        native_version: None,
        native_child_session_id: None,
        checkpoint_id: None,
        created_at: "2026-03-25T00:00:00Z".to_string(),
        updated_at: "2026-03-25T00:00:00Z".to_string(),
    };
    state
        .session_service
        .store()
        .insert_fork_operation(&operation)
        .expect("insert operation");

    let outcome = state
        .session_runtime
        .fork_session(&parent_id, None, Some("reserved-child".to_string()), None)
        .await
        .expect("same key + same payload resumes");
    assert_eq!(outcome.session.id, "reserved-child");
    assert_eq!(outcome.link.child_session_id, "reserved-child");

    // Checkpoint linkage is best-effort (Lane H, Q-H4) and never a fork blocker:
    // with no checkpoint at the boundary the fork completes normally and the
    // stored operation row carries `checkpoint_id = NULL`. This also guards the
    // ?1..?19 insert / map-row column offset that the new column added.
    let stored = state
        .session_service
        .store()
        .find_fork_operation_by_key("reserved-child")
        .expect("read fork operation")
        .expect("operation row present");
    assert_eq!(
        stored.checkpoint_id, None,
        "a fork with no boundary checkpoint stores checkpoint_id = NULL"
    );

    // Exactly one fork child — the resume created no second child.
    let link_service = SessionLinkService::new(
        SessionLinkStore::new(state.db.clone()),
        state.session_service.store().clone(),
    );
    let children = link_service.list_by_parent(&parent_id).expect("list links");
    assert_eq!(children.len(), 1);
    let _ = std::fs::remove_dir_all(&runtime_home);
}
