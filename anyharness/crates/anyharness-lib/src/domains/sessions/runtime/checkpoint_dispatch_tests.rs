//! Real Git + SQLite regressions for post-capture prompt settlement. Each test
//! drives a distinct `SessionRuntime` dispatch seam so a future call-site that
//! skips settlement cannot silently strand or discard checkpoint bytes.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use anyharness_contract::v1::{NormalizedSessionControls, PromptCapabilities, PromptInputBlock};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};

use super::prompt_message_actor_tests::{build_state, temp_runtime_home};
use super::prompt_message_tests::session;
use super::TextPromptDispatchError;
use crate::app::{test_support, AppState};
use crate::domains::sessions::model::SessionLiveConfigSnapshotRecord;
use crate::domains::sessions::prompt::provenance::PromptProvenance;
use crate::domains::workspaces::checkpoints::{
    flags::checkpoint_capture_enabled, refs, test_support::EnvGuard,
};
use crate::domains::workspaces::operation_gate::WorkspaceOperationKind;
use crate::persistence::Db;

#[tokio::test(flavor = "current_thread")]
async fn actor_unavailable_after_capture_discards_checkpoint_and_attachments() {
    let _capture = EnvGuard::on();
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let runtime_home = temp_runtime_home("checkpoint-actor-unavailable");
    let state = build_checkpoint_state(&runtime_home);
    enable_image_prompts(&state);
    state
        .session_runtime
        .acp_manager_for_test()
        .insert_unavailable_session_for_test("target")
        .await;
    assert!(checkpoint_capture_enabled(), "capture flag must be active");
    assert!(!state
        .session_runtime
        .acp_manager_for_test()
        .get_handle("target")
        .await
        .expect("unavailable test handle remains registered")
        .is_busy());
    let outer_lease = state
        .workspace_operation_gate
        .acquire_shared("workspace-b", WorkspaceOperationKind::SessionPrompt)
        .await;
    let writer_gate = state.workspace_operation_gate.clone();
    let (writer_started_tx, writer_started_rx) = tokio::sync::oneshot::channel();
    let writer = tokio::spawn(async move {
        let _ = writer_started_tx.send(());
        writer_gate.acquire_exclusive("workspace-b").await
    });
    writer_started_rx.await.expect("writer task starts");
    tokio::task::yield_now().await;

    state
        .session_runtime
        .send_prompt_under_workspace_lease(
            "other-workspace",
            "target",
            vec![PromptInputBlock::Text {
                text: "mismatched lease key".into(),
            }],
            Some("prompt-wrong-workspace".into()),
        )
        .await
        .expect_err("an under-lease call must bind the session to that lease key");

    assert!(checkpoint_capture_enabled(), "capture flag remains active");
    assert!(!state
        .session_runtime
        .acp_manager_for_test()
        .get_handle("target")
        .await
        .expect("unavailable handle remains registered after key rejection")
        .is_busy());

    let error = state
        .session_runtime
        .send_prompt_under_workspace_lease(
            "workspace-b",
            "target",
            vec![
                PromptInputBlock::Text {
                    text: "definitive non-acceptance".into(),
                },
                PromptInputBlock::Image {
                    data: Some(BASE64.encode([0u8, 1, 2, 3])),
                    attachment_id: None,
                    mime_type: "image/png".into(),
                    name: Some("proof.png".into()),
                    uri: None,
                    source: None,
                },
            ],
            Some("prompt-unavailable".into()),
        )
        .await
        .expect_err("closed actor mailbox rejects the dispatch");
    assert!(
        matches!(
            &error,
            super::SendPromptError::Internal(error)
                if error.to_string() == "session actor channel closed"
        ),
        "expected the unavailable actor failure after checkpoint capture, got {error:?}"
    );
    let checkpoint_before_writer = only_checkpoint(&state);
    drop(outer_lease);
    let writer_lease = tokio::time::timeout(Duration::from_secs(1), writer)
        .await
        .expect("writer proceeds after the outer lease drops")
        .expect("writer task joins");
    drop(writer_lease);

    let (checkpoint_id, expired_at) = checkpoint_before_writer;
    assert!(
        expired_at.is_some(),
        "definitive rejection expires metadata"
    );
    assert!(
        refs::list_for_workspace(&runtime_home.join("workspace-b"), "workspace-b")
            .expect("list checkpoint refs")
            .is_empty(),
        "definitive rejection deletes checkpoint refs"
    );
    assert!(
        state
            .session_service
            .store()
            .list_prompt_attachments("target")
            .expect("list prompt attachments")
            .is_empty(),
        "definitive rejection deletes attachment rows"
    );
    assert!(
        files_under(&runtime_home.join("attachments/sessions/target")).is_empty(),
        "definitive rejection deletes stored attachment bytes"
    );
    assert!(state
        .workspace_checkpoint_service
        .store_for_tests()
        .find_checkpoint(&checkpoint_id)
        .expect("find checkpoint")
        .is_some());
    cleanup(state, runtime_home);
}

#[tokio::test(flavor = "current_thread")]
async fn response_dropped_after_capture_retains_an_unresolved_checkpoint() {
    let _capture = EnvGuard::on();
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let runtime_home = temp_runtime_home("checkpoint-response-dropped");
    let state = build_checkpoint_state(&runtime_home);
    let mut observed = state
        .session_runtime
        .acp_manager_for_test()
        .insert_prompt_response_dropper_for_test("target")
        .await;

    let error = state
        .session_runtime
        .send_text_prompt_with_id(
            "target",
            "ambiguous acknowledgement".into(),
            "prompt-response-dropped".into(),
        )
        .await
        .expect_err("the actor drops its acknowledgement");
    assert!(matches!(
        error,
        TextPromptDispatchError::AcknowledgementLost
    ));
    tokio::time::timeout(Duration::from_secs(1), observed.recv())
        .await
        .expect("prompt observation timeout")
        .expect("the command entered the actor mailbox");

    let (checkpoint_id, expired_at, turn_id, prompt_id): (
        String,
        Option<String>,
        Option<String>,
        Option<String>,
    ) = state
        .db
        .with_conn(|conn| {
            conn.query_row(
                "SELECT id, expired_at, turn_id, prompt_id FROM workspace_checkpoints",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
        })
        .expect("read unresolved checkpoint");
    assert_eq!(expired_at, None, "ambiguous acknowledgement retains bytes");
    assert_eq!(turn_id, None, "an unresolved boundary is never fabricated");
    assert_eq!(prompt_id.as_deref(), Some("prompt-response-dropped"));
    let entries = refs::list_for_workspace(&runtime_home.join("workspace-b"), "workspace-b")
        .expect("list checkpoint refs");
    assert_eq!(entries.len(), 3, "all checkpoint ref families remain live");
    assert!(entries
        .iter()
        .all(|entry| entry.checkpoint_id == checkpoint_id));
    assert_eq!(
        state
            .workspace_checkpoint_service
            .find_checkpoint_id_for_boundary("target", "invented-turn"),
        None,
        "prompt provenance is never used as a boundary join"
    );
    cleanup(state, runtime_home);
}

#[tokio::test(flavor = "current_thread")]
async fn started_after_capture_binds_the_real_turn_boundary() {
    let _capture = EnvGuard::on();
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let runtime_home = temp_runtime_home("checkpoint-started");
    let state = build_checkpoint_state(&runtime_home);
    let mut observed = state
        .session_runtime
        .acp_manager_for_test()
        .insert_prompt_observer_with_phase_for_test(
            "target",
            anyharness_contract::v1::SessionExecutionPhase::Idle,
        )
        .await;

    let outcome = state
        .session_runtime
        .send_text_prompt_with_id(
            "target",
            "accepted boundary".into(),
            "prompt-started".into(),
        )
        .await
        .expect("actor starts the prompt");
    assert!(matches!(
        outcome,
        super::SendPromptOutcome::Running { ref turn_id, .. } if turn_id == "observed-turn"
    ));
    tokio::time::timeout(Duration::from_secs(1), observed.recv())
        .await
        .expect("prompt observation timeout")
        .expect("actor observed the prompt");

    let checkpoint_id = state
        .workspace_checkpoint_service
        .find_checkpoint_id_for_boundary("target", "observed-turn")
        .expect("started boundary resolves to its checkpoint");
    let checkpoint = state
        .workspace_checkpoint_service
        .store_for_tests()
        .find_checkpoint(&checkpoint_id)
        .expect("find checkpoint")
        .expect("checkpoint row remains");
    assert_eq!(checkpoint.prompt_id.as_deref(), Some("prompt-started"));
    assert!(checkpoint.expired_at.is_none());
    assert_eq!(
        refs::list_for_workspace(&runtime_home.join("workspace-b"), "workspace-b")
            .expect("list checkpoint refs")
            .len(),
        3
    );
    cleanup(state, runtime_home);
}

#[tokio::test(flavor = "current_thread")]
async fn rejected_after_capture_discards_the_provenance_checkpoint() {
    let _capture = EnvGuard::on();
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let runtime_home = temp_runtime_home("checkpoint-rejected");
    let state = build_checkpoint_state(&runtime_home);
    state
        .session_runtime
        .acp_manager_for_test()
        .insert_prompt_rejecter_for_test("target")
        .await;

    state
        .session_runtime
        .send_text_prompt_with_provenance(
            "target",
            "system-owned prompt".into(),
            PromptProvenance::System {
                label: Some("checkpoint-settlement-test".into()),
            },
        )
        .await
        .expect_err("actor explicitly rejects the prompt");

    let (_checkpoint_id, expired_at) = only_checkpoint(&state);
    assert!(expired_at.is_some(), "explicit rejection expires metadata");
    assert!(
        refs::list_for_workspace(&runtime_home.join("workspace-b"), "workspace-b")
            .expect("list checkpoint refs")
            .is_empty(),
        "explicit rejection deletes checkpoint refs"
    );
    assert!(
        state
            .session_service
            .store()
            .list_pending_prompts("target")
            .expect("list pending prompts")
            .is_empty(),
        "rejection never creates a durable queue boundary"
    );
    assert!(!state
        .session_service
        .store()
        .has_turn_started_event("target")
        .expect("check turn-start events"));
    cleanup(state, runtime_home);
}

#[tokio::test(flavor = "current_thread")]
async fn flag_off_dispatch_never_touches_checkpoint_storage_or_git() {
    let _capture = EnvGuard::off();
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let runtime_home = temp_runtime_home("checkpoint-flag-off");
    let state = build_state(
        &runtime_home,
        Db::open_in_memory().expect("in-memory db"),
        true,
    );
    let mut observed = state
        .session_runtime
        .acp_manager_for_test()
        .insert_prompt_observer_with_phase_for_test(
            "target",
            anyharness_contract::v1::SessionExecutionPhase::Idle,
        )
        .await;

    state
        .session_runtime
        .send_text_prompt_with_id("target", "flag-off prompt".into(), "flag-off".into())
        .await
        .expect("flag-off dispatch succeeds without a Git repository");
    observed
        .recv()
        .await
        .expect("actor receives flag-off prompt");
    let row_count: i64 = state
        .db
        .with_conn(|conn| {
            conn.query_row("SELECT COUNT(*) FROM workspace_checkpoints", [], |row| {
                row.get(0)
            })
        })
        .expect("count checkpoints");

    assert_eq!(row_count, 0, "flag off performs no checkpoint store write");
    assert!(
        !runtime_home.join("workspace-b/.git").exists(),
        "success on a plain directory proves the capture Git path was not entered"
    );
    cleanup(state, runtime_home);
}

#[tokio::test(flavor = "current_thread")]
async fn live_busy_sibling_keeps_writing_while_capture_records_one_complete_version() {
    let _capture = EnvGuard::on();
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let runtime_home = temp_runtime_home("checkpoint-busy-sibling");
    let state = build_checkpoint_state(&runtime_home);
    let workspace = runtime_home.join("workspace-b");
    let mut sibling = session("busy-sibling", "workspace-b", "idle", "Busy sibling");
    sibling.last_prompt_at = Some("2026-08-19T00:00:00Z".into());
    state
        .session_service
        .store()
        .insert(&sibling)
        .expect("insert sibling session");
    state
        .acp_manager
        .insert_busy_session_for_test("busy-sibling")
        .await;
    let sibling_handle = state
        .acp_manager
        .get_handle("busy-sibling")
        .await
        .expect("busy sibling handle");
    let mut observed = state
        .acp_manager
        .insert_prompt_observer_with_phase_for_test(
            "target",
            anyharness_contract::v1::SessionExecutionPhase::Idle,
        )
        .await;

    let version_a = vec![b'a'; 64 * 1024];
    let version_b = vec![b'b'; 64 * 1024];
    std::fs::write(workspace.join("racy.txt"), &version_a).expect("seed racy file");
    let stop = Arc::new(AtomicBool::new(false));
    let writes = Arc::new(AtomicUsize::new(0));
    let writer_stop = stop.clone();
    let writer_writes = writes.clone();
    let writer_workspace = workspace.clone();
    let writer_a = version_a.clone();
    let writer_b = version_b.clone();
    let (started_tx, started_rx) = std::sync::mpsc::channel();
    let writer = tokio::task::spawn_blocking(move || {
        let mut iteration = 0usize;
        while !writer_stop.load(Ordering::Acquire) {
            let staged = writer_workspace.with_file_name("checkpoint-writer-staged");
            let bytes = if iteration.is_multiple_of(2) {
                &writer_a
            } else {
                &writer_b
            };
            std::fs::write(&staged, bytes).expect("stage sibling write");
            std::fs::rename(&staged, writer_workspace.join("racy.txt"))
                .expect("atomically publish sibling write");
            iteration += 1;
            writer_writes.store(iteration, Ordering::Release);
            if iteration == 1 {
                started_tx.send(()).expect("signal first sibling write");
            }
        }
    });
    started_rx.recv().expect("sibling writer starts");
    let writes_before = writes.load(Ordering::Acquire);

    state
        .session_runtime
        .send_text_prompt_with_id(
            "target",
            "capture amid sibling writes".into(),
            "racy".into(),
        )
        .await
        .expect("idle target starts while sibling stays busy");
    observed.recv().await.expect("target actor receives prompt");
    stop.store(true, Ordering::Release);
    writer.await.expect("sibling writer joins");
    let writes_after = writes.load(Ordering::Acquire);
    let checkpoint_id = state
        .workspace_checkpoint_service
        .find_checkpoint_id_for_boundary("target", "observed-turn")
        .expect("captured boundary checkpoint");
    let checkpoint = state
        .workspace_checkpoint_service
        .store_for_tests()
        .find_checkpoint(&checkpoint_id)
        .expect("read checkpoint")
        .expect("checkpoint remains live");
    let captured = Command::new("git")
        .args(["show", &format!("{}:racy.txt", checkpoint.work_tree_oid)])
        .current_dir(&workspace)
        .output()
        .expect("read captured tree");
    let current_sibling = state
        .acp_manager
        .get_handle("busy-sibling")
        .await
        .expect("busy sibling remains live");

    assert!(captured.status.success(), "captured tree contains racy.txt");
    assert!(
        captured.stdout == version_a || captured.stdout == version_b,
        "capture records one complete atomically published file version"
    );
    assert!(
        writes_after > writes_before,
        "sibling writer made progress during capture"
    );
    assert!(Arc::ptr_eq(&sibling_handle, &current_sibling));
    assert!(
        current_sibling.is_busy(),
        "capture never quiesces the sibling"
    );
    cleanup(state, runtime_home);
}

pub(super) fn build_checkpoint_state(runtime_home: &Path) -> AppState {
    let state = build_state(
        runtime_home,
        Db::open_in_memory().expect("in-memory db"),
        true,
    );
    init_repo(&runtime_home.join("workspace-b"));
    state
}

fn enable_image_prompts(state: &AppState) {
    state
        .session_service
        .store()
        .upsert_live_config_snapshot(&SessionLiveConfigSnapshotRecord {
            session_id: "target".into(),
            source_seq: 0,
            raw_config_options_json: "[]".into(),
            normalized_controls_json: serde_json::to_string(&NormalizedSessionControls::default())
                .expect("serialize normalized controls"),
            prompt_capabilities_json: Some(
                serde_json::to_string(&PromptCapabilities {
                    image: true,
                    ..PromptCapabilities::default()
                })
                .expect("serialize prompt capabilities"),
            ),
            full_snapshot_json: None,
            updated_at: "2026-08-19T00:00:00Z".into(),
        })
        .expect("enable image prompts");
}

fn only_checkpoint(state: &AppState) -> (String, Option<String>) {
    state
        .db
        .with_conn(|conn| {
            conn.query_row(
                "SELECT id, expired_at FROM workspace_checkpoints",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
        })
        .expect("read checkpoint")
}

fn init_repo(path: &Path) {
    git(path, &["init", "-b", "main"]);
    git(path, &["config", "user.email", "test@example.com"]);
    git(path, &["config", "user.name", "Test"]);
    git(path, &["config", "commit.gpgsign", "false"]);
    std::fs::write(path.join("README.md"), "seed\n").expect("write seed file");
    git(path, &["add", "README.md"]);
    git(path, &["commit", "-m", "initial"]);
}

fn git(cwd: &Path, args: &[&str]) {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("spawn git");
    assert!(
        output.status.success(),
        "git {args:?} in {} failed: {}",
        cwd.display(),
        String::from_utf8_lossy(&output.stderr)
    );
}

fn files_under(dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let mut pending = vec![dir.to_path_buf()];
    while let Some(path) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(path) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                pending.push(path);
            } else {
                files.push(path);
            }
        }
    }
    files
}

fn cleanup(state: AppState, runtime_home: PathBuf) {
    drop(state);
    let _ = std::fs::remove_dir_all(runtime_home);
}
