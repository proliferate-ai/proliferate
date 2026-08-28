use super::*;
use crate::diagnostics_collector::test_binary::built_collector_binary;
use fs2::FileExt;
use proliferate_diagnostics_protocol::v1::types::{
    ExportPurposeV1, ExportRequestV1, ExportStreamFrameV1, LifecyclePhaseV1, ProducerRecordV1,
    RecordsFilterV1,
};
use std::fs::{self, OpenOptions};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::process::{Child, Command};

const CHILD_LOCK_ENV: &str = "PROLIFERATE_PR3_SHUTDOWN_CHILD_LOCK";
const CHILD_FIXTURE: &str =
    "diagnostics_collector::shutdown::integration_tests::shutdown_live_child_fixture";

fn empty_filters() -> RecordsFilterV1 {
    RecordsFilterV1 {
        source_time_from: None,
        source_time_to: None,
        components: Vec::new(),
        record_classes: Vec::new(),
        severities: Vec::new(),
        names: Vec::new(),
        outcomes: Vec::new(),
        operation_id: None,
        parent_operation_id: None,
        trace_id: None,
        workspace_id: None,
        session_id: None,
        turn_id: None,
        item_id: None,
        request_id: None,
        target_id: None,
        prompt_id: None,
        workflow_id: None,
        error_classification: None,
    }
}

async fn running_supervisor(
    name: &str,
) -> (
    PathBuf,
    FallbackDiagnosticsWriter,
    TauriDiagnosticsProducer,
    Arc<DiagnosticsCollectorSupervisor>,
) {
    let root = std::env::temp_dir().join(format!("{name}-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&root).expect("fixture root");
    fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).expect("fixture root mode");
    let fallback = FallbackDiagnosticsWriter::open_for_test(root.join("desktop-native.log"))
        .expect("fallback");
    let producer = TauriDiagnosticsProducer::new(fallback.clone(), "test".into(), "test".into());
    producer.start_pump();
    let launcher = crate::diagnostics_collector::process::CollectorProcessLauncher::for_test(
        built_collector_binary(),
        "desktop-test".to_string(),
        "test".to_string(),
        fallback.clone(),
    );
    let supervisor = DiagnosticsCollectorSupervisor::with_launcher(
        producer.clone(),
        fallback.clone(),
        Ok(launcher),
    );
    assert_eq!(
        supervisor.start().await,
        crate::diagnostics_collector::supervisor::StartupBarrierResult::Ready
    );
    assert!(producer.drain(PRODUCER_DRAIN_TIMEOUT).await);
    (root, fallback, producer, supervisor)
}

async fn spawn_locking_child(path: &Path) -> Child {
    let child = Command::new(std::env::current_exe().expect("test executable"))
        .arg("--exact")
        .arg(CHILD_FIXTURE)
        .arg("--ignored")
        .env(CHILD_LOCK_ENV, path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .expect("spawn live child fixture");
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        loop {
            let file = OpenOptions::new()
                .create(true)
                // Lock fixture: content unused, and the child holds it open —
                // truncation would be wrong on contention.
                .truncate(false)
                .read(true)
                .write(true)
                .open(path)
                .expect("open child lock");
            match file.try_lock_exclusive() {
                Ok(()) => {
                    FileExt::unlock(&file).expect("unlock probe");
                    tokio::time::sleep(std::time::Duration::from_millis(20)).await;
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => break,
                Err(error) => panic!("inspect child lock: {error}"),
            }
        }
    })
    .await
    .expect("child acquired lock");
    child
}

fn assert_child_reaped(path: &Path) {
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
        .expect("open reaped child lock");
    file.try_lock_exclusive().expect("child lock released");
    FileExt::unlock(&file).expect("unlock child proof");
}

#[test]
#[ignore]
fn shutdown_live_child_fixture() {
    let path = std::env::var_os(CHILD_LOCK_ENV).expect("child lock path");
    let file = OpenOptions::new()
        .create(true)
        // Lock fixture: content unused; see the guarded loop above.
        .truncate(false)
        .read(true)
        .write(true)
        .open(path)
        .expect("open fixture lock");
    file.lock_exclusive().expect("lock fixture");
    loop {
        std::thread::park_timeout(std::time::Duration::from_secs(1));
    }
}

#[tokio::test]
async fn ordered_shutdown_reaps_live_children_cancels_tail_and_is_idempotent() {
    use crate::diagnostics_collector::artifact::DiagnosticsArtifactKind;
    use crate::diagnostics_collector::broker::client::DiagnosticsBrokerClient;
    use crate::diagnostics_collector::broker::discovery::build_scope;

    let (root, fallback, producer, supervisor) = running_supervisor("ordered-shutdown").await;
    let worker_lock = root.join("worker.lock");
    let anyharness_lock = root.join("anyharness.lock");
    let worker_child = spawn_locking_child(&worker_lock).await;
    let anyharness_child = spawn_locking_child(&anyharness_lock).await;
    let worker = cloud_worker::create_cloud_worker_state();
    cloud_worker::lifecycle::install_shutdown_test_child(&worker, worker_child).await;
    let anyharness = sidecar::create_sidecar(49_901);
    sidecar::install_shutdown_test_child(&anyharness, anyharness_child).await;

    let scope = build_scope(
        root.clone(),
        "com.proliferate.app.local.shutdown-fixture".to_string(),
        "development",
        Some("shutdown_fixture".to_string()),
    )
    .expect("broker scope");
    let broker_server = DiagnosticsBrokerServer::start_for_test(
        Arc::clone(&supervisor),
        scope.clone(),
        DiagnosticsArtifactKind::InternalDogfood,
    )
    .await
    .expect("broker server");
    let client = DiagnosticsBrokerClient::for_scope(scope.clone());
    let cursor = supervisor
        .health()
        .await
        .collector
        .as_ref()
        .and_then(|health| health.newest_cursor)
        .unwrap_or(0);
    let mut tail = client.tail(Some(cursor)).await.expect("active tail");
    let mut export = client
        .export(ExportRequestV1 {
            schema_version: proliferate_diagnostics_protocol::v1::limits::CURRENT_SCHEMA_VERSION,
            purpose: ExportPurposeV1::InternalDogfood,
            support_authorization_id: None,
            filters: empty_filters(),
            record_limit: 64,
            byte_limit: 1_048_576,
            include_health: true,
        })
        .await
        .expect("active export");
    assert!(matches!(
        export.next().await.expect("export manifest"),
        Some(ExportStreamFrameV1::Manifest { .. })
    ));

    let broker = create_broker_server_state();
    *broker.lock().await = Some(Arc::clone(&broker_server));
    let support =
        crate::diagnostics::support_snapshot::coordinator::SupportSnapshotCoordinator::new(
            Arc::clone(&supervisor),
            producer.clone(),
            worker.clone(),
            anyharness.clone(),
        );
    let coordinator = DiagnosticsShutdownCoordinator::new(
        Arc::clone(&supervisor),
        producer.clone(),
        fallback.clone(),
        broker,
        worker,
        anyharness,
        support,
    );
    let (first, repeated) = tokio::join!(coordinator.shutdown(), coordinator.shutdown());
    assert_eq!(first, Ok(()));
    assert_eq!(repeated, first);
    assert_eq!(coordinator.phase_trace(), SHUTDOWN_PHASE_ORDER);
    assert!(matches!(
        supervisor.state(),
        crate::diagnostics_collector::supervisor::DesktopDiagnosticsSupervisorStateV1::Stopped {
            orderly: true
        }
    ));

    let tail_error = tokio::time::timeout(std::time::Duration::from_secs(2), async {
        loop {
            match tail.next().await {
                Ok(Some(_)) => {}
                Ok(None) => panic!("tail ended without the shutdown cancellation receipt"),
                Err(error) => break error,
            }
        }
    })
    .await
    .expect("tail cancellation deadline");
    assert_eq!(
        tail_error.classification(),
        crate::diagnostics_collector::broker::protocol::DiagnosticsBrokerErrorV1::Cancelled
    );
    drop(export);
    assert_child_reaped(&worker_lock);
    assert_child_reaped(&anyharness_lock);
    assert!(!scope.locator_path.exists());
    assert!(!scope.socket_path.exists());

    let terminals = fs::read_to_string(root.join("desktop-native.log"))
        .expect("teardown fallback")
        .lines()
        .map(|line| serde_json::from_str::<ProducerRecordV1>(line).expect("fallback record"))
        .filter(|record| {
            record.name == "desktop.collector.stop"
                && record.lifecycle.as_ref().map(|value| value.phase)
                    == Some(LifecyclePhaseV1::Terminal)
        })
        .count();
    assert_eq!(terminals, 1);
    fs::remove_dir_all(root).expect("fixture cleanup");
}

#[tokio::test]
async fn ordered_shutdown_surfaces_injected_teardown_fallback_failure() {
    let (root, fallback, producer, supervisor) = running_supervisor("fallback-shutdown").await;
    let worker = cloud_worker::create_cloud_worker_state();
    let anyharness = sidecar::create_sidecar(49_902);
    sidecar::suppress_shutdown_test_persistence(&anyharness).await;
    fallback.inject_write_failure();
    let support =
        crate::diagnostics::support_snapshot::coordinator::SupportSnapshotCoordinator::new(
            Arc::clone(&supervisor),
            producer.clone(),
            worker.clone(),
            anyharness.clone(),
        );
    let coordinator = DiagnosticsShutdownCoordinator::new(
        Arc::clone(&supervisor),
        producer,
        fallback.clone(),
        create_broker_server_state(),
        worker,
        anyharness,
        support,
    );

    assert_eq!(coordinator.shutdown().await, Ok(()));
    assert_eq!(coordinator.phase_trace(), SHUTDOWN_PHASE_ORDER);
    let health = fallback.health();
    assert_eq!(
        health.state,
        proliferate_diagnostics_protocol::v1::types::FallbackStateV1::Degraded
    );
    assert!(health.dropped_records >= 1);
    assert!(!supervisor.has_owned_process_for_test());
    fs::remove_dir_all(root).expect("fixture cleanup");
}

#[tokio::test]
async fn ordered_shutdown_keeps_diagnostics_teardown_failures_off_the_product_result() {
    let (root, fallback, producer, supervisor) = running_supervisor("diagnostics-teardown").await;
    let worker = cloud_worker::create_cloud_worker_state();
    let anyharness = sidecar::create_sidecar(49_903);
    sidecar::suppress_shutdown_test_persistence(&anyharness).await;
    fallback.inject_close_failure();
    let support =
        crate::diagnostics::support_snapshot::coordinator::SupportSnapshotCoordinator::new(
            Arc::clone(&supervisor),
            producer.clone(),
            worker.clone(),
            anyharness.clone(),
        );
    let coordinator = DiagnosticsShutdownCoordinator::new(
        Arc::clone(&supervisor),
        producer,
        fallback.clone(),
        create_broker_server_state(),
        worker,
        anyharness,
        support,
    );

    // The Windows updater gates `install()` on this result. A fallback flush
    // failure is pure observability and must never be what blocks it.
    assert_eq!(coordinator.shutdown().await, Ok(()));
    assert!(coordinator.diagnostics_teardown_failed());
    assert_eq!(coordinator.phase_trace(), SHUTDOWN_PHASE_ORDER);

    // Diagnostics-only damage still leaves a finished teardown, so the repeat
    // caller short-circuits rather than tearing everything down twice.
    assert_eq!(coordinator.shutdown().await, Ok(()));
    assert_eq!(coordinator.phase_trace(), SHUTDOWN_PHASE_ORDER);
    fs::remove_dir_all(root).expect("fixture cleanup");
}

#[tokio::test]
async fn failed_product_teardown_is_reattempted_rather_than_replayed() {
    let (root, fallback, producer, supervisor) = running_supervisor("retry-shutdown").await;
    let worker_lock = root.join("worker.lock");
    let worker_child = spawn_locking_child(&worker_lock).await;
    let worker = cloud_worker::create_cloud_worker_state();
    cloud_worker::lifecycle::install_shutdown_test_child(&worker, worker_child).await;
    cloud_worker::lifecycle::inject_shutdown_test_stop_error(
        &worker,
        "Timed out stopping Proliferate Worker".to_string(),
    )
    .await;
    let anyharness = sidecar::create_sidecar(49_904);
    sidecar::suppress_shutdown_test_persistence(&anyharness).await;
    let support =
        crate::diagnostics::support_snapshot::coordinator::SupportSnapshotCoordinator::new(
            Arc::clone(&supervisor),
            producer.clone(),
            worker.clone(),
            anyharness.clone(),
        );
    let coordinator = DiagnosticsShutdownCoordinator::new(
        Arc::clone(&supervisor),
        producer,
        fallback.clone(),
        create_broker_server_state(),
        worker,
        anyharness,
        support,
    );

    // First try loses the reap race, so the Worker keeps its database lock.
    assert!(
        coordinator.shutdown().await.is_err(),
        "the injected reap failure must surface to the product caller"
    );
    assert_eq!(coordinator.phase_trace(), SHUTDOWN_PHASE_ORDER);

    // The retry must re-enter every phase instead of replaying a cached error
    // that stops nothing; this time the child is actually reaped.
    assert_eq!(coordinator.shutdown().await, Ok(()));
    assert_eq!(
        coordinator.phase_trace(),
        [SHUTDOWN_PHASE_ORDER, SHUTDOWN_PHASE_ORDER].concat()
    );
    assert_child_reaped(&worker_lock);
    fs::remove_dir_all(root).expect("fixture cleanup");
}
