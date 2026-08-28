use std::sync::Arc;

use tokio::sync::Barrier;
use tokio::time::Duration;

use crate::diagnostics_collector::support_export::{probe, SupportExportIssuanceError as Issuance};

use super::super::super::artifact_store::SupportArtifactStore;
use super::super::control::{PreparationControl, PreparationInterruption};
use super::super::fake_runtime::FakeRuntime;
use super::super::runtime::CoordinatorRuntime;
use super::super::state::ReadinessState;
use super::super::tests::test_coordinator;
use super::join_concurrently;
use super::{capture_native_support_evidence, CaptureError};

#[tokio::test]
async fn export_health_child_and_file_futures_reach_one_start_latch() {
    let latch = Arc::new(Barrier::new(5));
    let source = |name: &'static str| {
        let latch = Arc::clone(&latch);
        async move {
            latch.wait().await;
            name
        }
    };

    let joined = join_concurrently(
        source("export"),
        source("health"),
        source("child"),
        source("files"),
    );
    let released = async {
        latch.wait().await;
    };
    let ((export, health, child, files), ()) = tokio::join!(joined, released);
    assert_eq!(
        (export, health, child, files),
        ("export", "health", "child", "files")
    );
}

#[tokio::test]
async fn a_genuinely_noncanonical_window_is_refused_before_any_capture_task_starts() {
    // No FakeRuntime capture override here: this drives the real capture entry
    // point so the rejection comes from the real permit at the top of
    // capture_native_support_evidence, before the export, health, child, and
    // file work is spawned.
    let runtime = Arc::new(FakeRuntime::new());
    let coordinator = ready_coordinator(Arc::clone(&runtime)).await;
    let control = PreparationControl::new();
    probe::reset();

    for (name, from, to) in [
        // AutoSi omits the fraction on a whole second, which is exactly the
        // pre-fix producer spelling.
        ("bare Z", "2026-08-12T11:45:00Z", "2026-08-12T12:00:00Z"),
        (
            "microsecond fraction",
            "2026-08-12T11:45:00.123456Z",
            "2026-08-12T12:00:00.123456Z",
        ),
        (
            "non-UTC offset",
            "2026-08-12T11:45:00.123+00:00",
            "2026-08-12T12:00:00.123+00:00",
        ),
        (
            "wrong duration",
            "2026-08-12T11:45:00.123Z",
            "2026-08-12T12:00:01.123Z",
        ),
    ] {
        let outcome = capture_native_support_evidence(
            Arc::clone(&coordinator.supervisor),
            coordinator.sidecar.clone(),
            coordinator.worker.clone(),
            &uuid::Uuid::new_v4().to_string(),
            from,
            to,
            runtime.instant_now() + Duration::from_secs(25),
            Arc::clone(&control),
            Arc::clone(&runtime) as Arc<dyn CoordinatorRuntime>,
        )
        .await;

        let Err(error) = outcome else {
            panic!("{name}: a noncanonical window must be refused");
        };
        assert_eq!(
            error,
            CaptureError::Issuance(Issuance::NoncanonicalWindow),
            "{name}"
        );
        assert!(error.is_noncanonical_window(), "{name}");
        assert_eq!(
            control.active_work(),
            0,
            "{name}: no export, health, child, or file task started"
        );
        assert!(
            probe::observed().is_empty(),
            "{name}: nothing was ever issued or consumed"
        );
        assert_eq!(
            control.interruption(),
            PreparationInterruption::Running,
            "{name}: a window rejection is not an interruption"
        );
    }
}

async fn ready_coordinator(
    runtime: Arc<FakeRuntime>,
) -> Arc<super::super::SupportSnapshotCoordinator> {
    let root = std::env::temp_dir().join(format!("rel09b-capture-{}", uuid::Uuid::new_v4()));
    let store = Arc::new(SupportArtifactStore::for_test(
        &root,
        &root.join("attachments"),
    ));
    let coordinator = test_coordinator(Some(store), runtime);
    coordinator.state.lock().await.readiness = ReadinessState::Ready;
    coordinator
}
