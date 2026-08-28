//! Queue-edge checkpoint regressions. These use real SQLite + Git state and
//! the runtime's real prompt seam; only the post-capture race is settled
//! directly because an actor becoming busy between capture and command receipt
//! is intentionally not a runtime-controlled scheduling point.

use std::future::Future;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::app::test_support;
use crate::domains::sessions::prompt::PromptPayload;
use crate::domains::workspaces::checkpoints::{refs, test_support::EnvGuard};
use crate::domains::workspaces::operation_gate::WorkspaceOperationKind;
use crate::live::sessions::{LiveSessionCommandError, PromptAcceptError, PromptAcceptance};

use super::checkpoint_dispatch_tests::build_checkpoint_state;
use super::prompt_message_actor_tests::{
    install_scripted_agent_env, stop_target_actor, temp_runtime_home, wait_for_actor_idle,
    write_scripted_agent,
};

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn already_busy_target_queues_without_a_checkpoint_and_emits_skip_reason() {
    // Hold the crate-wide env lock from actor startup through cleanup. The
    // first turn starts with capture disabled so the second dispatch can prove
    // that an already-busy target creates zero checkpoint artifacts.
    let _capture = EnvGuard::off().await;
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let runtime_home = temp_runtime_home("checkpoint-busy-target");
    let script = write_scripted_agent(&runtime_home);
    let (_program, _args) = install_scripted_agent_env(&script);
    let state = build_checkpoint_state(&runtime_home);

    state
        .session_runtime
        .ensure_live_session("target", None)
        .await
        .expect("start real target actor");
    let first = state
        .session_runtime
        .send_text_prompt_with_id("target", "blocking turn".into(), "prompt-blocking".into())
        .await
        .expect("start blocking turn with capture disabled");
    let first_turn_id = match first {
        super::SendPromptOutcome::Running { turn_id, .. } => turn_id,
        super::SendPromptOutcome::Queued { .. } => panic!("first prompt must start"),
    };
    wait_for_path(&script.control_dir.join("turn-seen")).await;
    assert!(
        state
            .acp_manager
            .get_ready_handle("target")
            .await
            .expect("target handle")
            .is_busy(),
        "fixture must reach the already-busy capture check"
    );

    std::env::set_var("ANYHARNESS_CHECKPOINT_CAPTURE", "on");
    let (logged, queued) = capture_logs(state.session_runtime.send_text_prompt_with_id(
        "target",
        "queue while busy".into(),
        "prompt-queued".into(),
    ))
    .await;
    let queue_seq = match queued.expect("busy actor accepts a durable queued prompt") {
        super::SendPromptOutcome::Queued { seq, .. } => seq,
        super::SendPromptOutcome::Running { .. } => panic!("second prompt must queue"),
    };

    assert!(logged.contains("checkpoint.capture.skipped"), "{logged}");
    assert!(logged.contains("busy_will_queue"), "{logged}");
    let checkpoints: i64 = state
        .db
        .with_conn(|conn| {
            conn.query_row("SELECT COUNT(*) FROM workspace_checkpoints", [], |row| {
                row.get(0)
            })
        })
        .expect("count checkpoints");
    assert_eq!(checkpoints, 0, "busy-target skip creates no checkpoint row");
    assert!(
        refs::list_for_workspace(&runtime_home.join("workspace-b"), "workspace-b")
            .expect("list checkpoint refs")
            .is_empty(),
        "busy-target skip creates no checkpoint refs"
    );
    let pending = state
        .session_service
        .store()
        .find_pending_prompt("target", queue_seq)
        .expect("read queued prompt")
        .expect("queued prompt remains durable while the first turn is held");
    assert_eq!(pending.text, "queue while busy");
    assert_eq!(pending.prompt_id.as_deref(), Some("prompt-queued"));
    assert_eq!(
        state
            .workspace_checkpoint_service
            .find_checkpoint_id_for_boundary("target", &first_turn_id),
        None,
        "neither the flag-off running turn nor the busy queued prompt fabricates linkage"
    );

    std::fs::write(script.control_dir.join("release-turn"), b"").expect("release held turn");
    wait_for_actor_idle(&state).await;
    stop_target_actor(&state).await;
    cleanup(state, runtime_home);
}

#[tokio::test(flavor = "current_thread")]
async fn queued_settlement_expires_capture_without_touching_the_pending_prompt() {
    let _capture = EnvGuard::on().await;
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let runtime_home = temp_runtime_home("checkpoint-post-capture-queued");
    let state = build_checkpoint_state(&runtime_home);
    let _observed = state
        .acp_manager
        .insert_prompt_observer_with_phase_for_test(
            "target",
            anyharness_contract::v1::SessionExecutionPhase::Idle,
        )
        .await;
    let handle = state
        .acp_manager
        .get_ready_handle("target")
        .await
        .expect("idle target handle");
    let _lease = state
        .workspace_operation_gate
        .acquire_shared("workspace-b", WorkspaceOperationKind::SessionPrompt)
        .await;

    let checkpoint_id = state
        .session_runtime
        .capture_turn_start_checkpoint(
            "workspace-b",
            "target",
            &handle,
            Some("prompt-raced-to-queue"),
        )
        .await
        .expect("capture succeeds")
        .expect("idle pre-dispatch handle captures a checkpoint");
    assert_eq!(
        refs::list_for_workspace(&runtime_home.join("workspace-b"), "workspace-b")
            .expect("list captured refs")
            .len(),
        3,
        "precondition: capture wrote all three refs"
    );
    let pending = state
        .session_service
        .store()
        .insert_pending_prompt_payload(
            "target",
            &PromptPayload::text("accepted after the actor became busy".into()),
            Some("prompt-raced-to-queue"),
        )
        .expect("persist the actor-accepted queue boundary");
    let command_outcome =
        Ok::<_, LiveSessionCommandError<PromptAcceptError>>(PromptAcceptance::Queued {
            seq: pending.seq,
        });

    state
        .session_runtime
        .settle_turn_start_checkpoint(Some(checkpoint_id.clone()), &command_outcome)
        .await;

    let checkpoint = state
        .workspace_checkpoint_service
        .store_for_tests()
        .find_checkpoint(&checkpoint_id)
        .expect("read checkpoint")
        .expect("settlement retains expired metadata");
    assert!(checkpoint.expired_at.is_some());
    assert_eq!(
        checkpoint.turn_id, None,
        "queued acceptance has no turn boundary"
    );
    assert!(
        refs::list_for_workspace(&runtime_home.join("workspace-b"), "workspace-b")
            .expect("list checkpoint refs after settlement")
            .is_empty(),
        "queued settlement deletes captured refs"
    );
    assert_eq!(
        state
            .session_service
            .store()
            .find_pending_prompt("target", pending.seq)
            .expect("read durable queue boundary")
            .expect("settlement must not delete the queued prompt")
            .prompt_id
            .as_deref(),
        Some("prompt-raced-to-queue")
    );
    assert_eq!(
        state
            .workspace_checkpoint_service
            .find_checkpoint_id_for_boundary("target", "invented-queued-turn"),
        None,
        "queued acceptance never creates boundary linkage"
    );
    drop(_lease);
    cleanup(state, runtime_home);
}

async fn capture_logs<F: Future>(future: F) -> (String, F::Output) {
    use tracing::instrument::WithSubscriber;

    #[derive(Clone)]
    struct SharedLogWriter(Arc<Mutex<Vec<u8>>>);

    impl std::io::Write for SharedLogWriter {
        fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
            self.0
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .extend_from_slice(buffer);
            Ok(buffer.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    let bytes = Arc::new(Mutex::new(Vec::new()));
    let writer = Arc::clone(&bytes);
    let subscriber = tracing_subscriber::fmt()
        .without_time()
        .with_ansi(false)
        .with_writer(move || SharedLogWriter(Arc::clone(&writer)))
        .finish();
    let output = future.with_subscriber(subscriber).await;
    let logged = String::from_utf8(
        bytes
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone(),
    )
    .expect("formatted log is UTF-8");
    (logged, output)
}

async fn wait_for_path(path: &std::path::Path) {
    tokio::time::timeout(Duration::from_secs(5), async {
        while !path.exists() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("script control path appears");
}

fn cleanup(state: crate::app::AppState, runtime_home: PathBuf) {
    drop(state);
    let _ = std::fs::remove_dir_all(runtime_home);
}
