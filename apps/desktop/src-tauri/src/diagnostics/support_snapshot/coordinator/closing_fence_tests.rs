#![cfg(unix)]

use std::os::unix::fs::PermissionsExt;
use std::sync::Arc;

use proliferate_diagnostics_protocol::v1::types::TerminalOutcomeV1;
use tokio::time::Duration;

use super::super::artifact_store::SupportArtifactStore;
use super::lifecycle_tests::assert_lifecycle_pair;
use super::model::CancelSupportSnapshotInput;
use super::state::ClosingPreparation;
use super::tests::{begin_input, insert_awaiting_preparation, test_coordinator, FakeRuntime};
use super::SupportSnapshotCoordinator;

#[tokio::test]
async fn watchdog_closing_fence_blocks_every_shutdown_until_cleanup_and_terminal() {
    let (root, store) = ready_store("watchdog-closing");
    let runtime = Arc::new(FakeRuntime::new());
    let coordinator = test_coordinator(Some(Arc::clone(&store)), Arc::clone(&runtime));
    let (control, operation, preparation_id) =
        insert_awaiting_preparation(&coordinator, &runtime).await;
    let artifact_path = stage_fixture(&store, &preparation_id);
    let artifact_guard = coordinator.artifact_gate.lock().await;

    runtime.advance(Duration::from_secs(25));
    let closing = wait_for_closing(&coordinator).await;
    let first = spawn_shutdown(&coordinator);
    let second = spawn_shutdown(&coordinator);
    wait_for_shutdown_arm(&coordinator).await;
    assert!(!first.is_finished());
    assert!(!second.is_finished());
    assert!(artifact_path.exists());
    assert!(operation.lock().expect("operation").is_some());

    drop(artifact_guard);
    first.await.expect("first shutdown");
    second.await.expect("second shutdown");
    tokio::time::timeout(Duration::from_secs(1), closing.wait_completed())
        .await
        .expect("closing completion");

    assert_eq!(control.active_work(), 0);
    assert!(!artifact_path.exists());
    assert!(operation.lock().expect("operation").is_none());
    assert!(coordinator.state.lock().await.closing_preparation.is_none());
    assert_lifecycle_pair(
        &coordinator,
        "desktop.support_snapshot.prepare",
        &begin_input().client_job_id,
        None,
        TerminalOutcomeV1::TimedOut,
        Some("preparation_timeout"),
        None,
    );
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn explicit_cancel_closing_fence_blocks_every_shutdown_until_cleanup_and_terminal() {
    let (root, store) = ready_store("cancel-closing");
    let runtime = Arc::new(FakeRuntime::new());
    let coordinator = test_coordinator(Some(Arc::clone(&store)), Arc::clone(&runtime));
    let (control, operation, preparation_id) =
        insert_awaiting_preparation(&coordinator, &runtime).await;
    let artifact_path = stage_fixture(&store, &preparation_id);
    let artifact_guard = coordinator.artifact_gate.lock().await;

    let cancellation = tokio::spawn({
        let coordinator = Arc::clone(&coordinator);
        let preparation_id = preparation_id.clone();
        async move {
            coordinator
                .cancel_preparation(CancelSupportSnapshotInput {
                    client_job_id: begin_input().client_job_id,
                    consent_epoch: "epoch-1".to_string(),
                    preparation_id: Some(preparation_id),
                })
                .await
        }
    });
    let closing = wait_for_closing(&coordinator).await;
    let first = spawn_shutdown(&coordinator);
    let second = spawn_shutdown(&coordinator);
    wait_for_shutdown_arm(&coordinator).await;
    assert!(!cancellation.is_finished());
    assert!(!first.is_finished());
    assert!(!second.is_finished());
    assert!(artifact_path.exists());
    assert!(operation.lock().expect("operation").is_some());

    drop(artifact_guard);
    cancellation
        .await
        .expect("cancellation task")
        .expect("cancellation result");
    first.await.expect("first shutdown");
    second.await.expect("second shutdown");
    tokio::time::timeout(Duration::from_secs(1), closing.wait_completed())
        .await
        .expect("closing completion");

    assert_eq!(control.active_work(), 0);
    assert!(!artifact_path.exists());
    assert!(operation.lock().expect("operation").is_none());
    assert!(coordinator.state.lock().await.closing_preparation.is_none());
    assert_lifecycle_pair(
        &coordinator,
        "desktop.support_snapshot.prepare",
        &begin_input().client_job_id,
        None,
        TerminalOutcomeV1::Cancelled,
        None,
        None,
    );
    let _ = std::fs::remove_dir_all(root);
}

fn spawn_shutdown(coordinator: &Arc<SupportSnapshotCoordinator>) -> tokio::task::JoinHandle<()> {
    let coordinator = Arc::clone(coordinator);
    tokio::spawn(async move {
        coordinator.cancel_support().await;
    })
}

async fn wait_for_closing(
    coordinator: &Arc<SupportSnapshotCoordinator>,
) -> Arc<ClosingPreparation> {
    for _ in 0..128 {
        if let Some(closing) = coordinator.state.lock().await.closing_preparation.clone() {
            return closing;
        }
        tokio::task::yield_now().await;
    }
    panic!("preparation transferred to closing registry");
}

async fn wait_for_shutdown_arm(coordinator: &Arc<SupportSnapshotCoordinator>) {
    for _ in 0..128 {
        if coordinator.state.lock().await.shutdown_armed {
            return;
        }
        tokio::task::yield_now().await;
    }
    panic!("shutdown reached support cancellation");
}

fn ready_store(prefix: &str) -> (std::path::PathBuf, Arc<SupportArtifactStore>) {
    let root = std::env::temp_dir().join(format!("pr6-{prefix}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).expect("app root");
    std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700)).expect("app root mode");
    let store = Arc::new(SupportArtifactStore::for_test(
        &root,
        &root.join("attachments"),
    ));
    store
        .reconcile(
            &[],
            &[],
            std::time::Instant::now() + std::time::Duration::from_secs(1),
        )
        .expect("store ready");
    (root, store)
}

fn stage_fixture(store: &SupportArtifactStore, preparation_id: &str) -> std::path::PathBuf {
    let input = begin_input();
    let stored = store
        .stage(
            &input.client_job_id,
            &uuid::Uuid::from_u128(10).to_string(),
            preparation_id,
            b"staged-before-closing",
        )
        .expect("staged fixture");
    store.root().join(format!("{}.json", stored.artifact_id))
}
