use super::*;
use crate::diagnostics_collector::test_binary::built_collector_binary;
use proliferate_diagnostics_protocol::v1::types::{
    ComponentV1, LifecyclePhaseV1, ProducerRecordV1, RecordClassV1, RecordsFilterV1,
};
use std::io::Read;
use std::path::PathBuf;

fn lifecycle_query(name: &str) -> RecordsQueryV1 {
    RecordsQueryV1 {
        schema_version: CURRENT_SCHEMA_VERSION,
        after_cursor: None,
        limit: 16,
        filters: RecordsFilterV1 {
            source_time_from: None,
            source_time_to: None,
            components: vec![ComponentV1::DesktopTauri],
            record_classes: vec![RecordClassV1::Lifecycle],
            severities: Vec::new(),
            names: vec![name.to_string()],
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
        },
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
    let fallback = FallbackDiagnosticsWriter::open_for_test(root.join("desktop-native.log"))
        .expect("fallback");
    let producer = TauriDiagnosticsProducer::new(fallback.clone(), "test".into(), "test".into());
    producer.start_pump();
    let launcher = CollectorProcessLauncher::for_test(
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
    assert_eq!(supervisor.start().await, StartupBarrierResult::Ready);
    assert!(producer.drain(PRODUCER_DRAIN_TIMEOUT).await);
    (root, fallback, producer, supervisor)
}

async fn stop_fixture(
    root: PathBuf,
    fallback: FallbackDiagnosticsWriter,
    producer: TauriDiagnosticsProducer,
    supervisor: Arc<DiagnosticsCollectorSupervisor>,
) {
    supervisor.arm_shutdown();
    supervisor.stop_collector().await.expect("collector stop");
    producer.close();
    fallback.close().expect("fallback close");
    std::fs::remove_dir_all(root).expect("fixture cleanup");
}

#[tokio::test]
async fn killed_collector_restarts_with_new_generation_capability_and_query() {
    let (root, fallback, producer, supervisor) = running_supervisor("collector-kill-restart").await;
    let mut old_handoff = supervisor
        .protected_child_handoff()
        .expect("old protected handoff");
    let old_boot = old_handoff.descriptor.collector_boot_id.clone();
    let old_generation = old_handoff.generation;
    let mut old_capability = String::new();
    old_handoff
        .inherited_channel
        .read_to_string(&mut old_capability)
        .expect("old capability");
    let cursor = supervisor
        .health()
        .await
        .collector
        .as_ref()
        .and_then(|value| value.newest_cursor)
        .unwrap_or(0);
    let mut old_lease = supervisor.tail(Some(cursor)).await.expect("old tail lease");

    supervisor
        .kill_current_process_for_test()
        .expect("kill owned collector");
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if matches!(
                supervisor.state(),
                DesktopDiagnosticsSupervisorStateV1::Ready {
                    ref collector_boot_id,
                    restart_count: 1,
                    ..
                } if collector_boot_id != &old_boot
            ) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .expect("bounded automatic restart");
    tokio::time::timeout(
        Duration::from_secs(1),
        old_lease.generation_changed.changed(),
    )
    .await
    .expect("old lease invalidated")
    .expect("generation channel remains open");
    assert_ne!(*old_lease.generation_changed.borrow(), old_generation);

    let mut new_handoff = supervisor
        .protected_child_handoff()
        .expect("replacement protected handoff");
    assert_ne!(new_handoff.generation, old_generation);
    assert_ne!(new_handoff.descriptor.collector_boot_id, old_boot);
    let mut new_capability = String::new();
    new_handoff
        .inherited_channel
        .read_to_string(&mut new_capability)
        .expect("new capability");
    assert_ne!(new_capability, old_capability);

    assert!(producer.drain(PRODUCER_DRAIN_TIMEOUT).await);
    let page = supervisor
        .records(&lifecycle_query("desktop.collector.restart"))
        .await
        .expect("query replacement collector");
    assert_eq!(page.records.len(), 2);
    assert_eq!(
        page.records[0].record.operation_id,
        page.records[1].record.operation_id
    );

    stop_fixture(root, fallback, producer, supervisor).await;
}

#[tokio::test]
async fn injected_inspection_and_kill_failures_retain_the_owned_handle() {
    use crate::diagnostics_collector::process::CollectorProcessTestFault;

    let (root, fallback, producer, supervisor) =
        running_supervisor("collector-retained-handle").await;
    supervisor.arm_shutdown();
    supervisor
        .inject_process_fault_for_test(CollectorProcessTestFault::TryWait)
        .expect("inject inspection fault");
    assert_eq!(
        supervisor.stop_collector().await,
        Err(SupervisorUnavailable::Protocol)
    );
    assert!(supervisor.has_owned_process_for_test());

    supervisor
        .clear_process_faults_for_test()
        .expect("clear inspection fault");
    supervisor
        .inject_process_fault_for_test(CollectorProcessTestFault::ControlWrite)
        .expect("inject control fault");
    supervisor
        .inject_process_fault_for_test(CollectorProcessTestFault::Kill)
        .expect("inject kill fault");
    assert_eq!(
        supervisor.stop_collector().await,
        Err(SupervisorUnavailable::Protocol)
    );
    assert!(supervisor.has_owned_process_for_test());

    supervisor
        .clear_process_faults_for_test()
        .expect("clear kill fault");
    supervisor
        .stop_collector()
        .await
        .expect("retry through retained handle");
    assert!(!supervisor.has_owned_process_for_test());
    producer.close();
    fallback.close().expect("fallback close");
    std::fs::remove_dir_all(root).expect("fixture cleanup");
}

#[tokio::test]
async fn injected_graceful_deadline_is_timed_out_after_verified_reap() {
    use crate::diagnostics_collector::process::CollectorProcessTestFault;

    let (root, fallback, producer, supervisor) =
        running_supervisor("collector-stop-deadline").await;
    supervisor.arm_shutdown();
    supervisor
        .inject_process_fault_for_test(CollectorProcessTestFault::GracefulDeadline)
        .expect("inject graceful deadline");
    assert_eq!(
        supervisor.stop_collector().await,
        Err(SupervisorUnavailable::Deadline)
    );
    assert!(!supervisor.has_owned_process_for_test());
    assert!(matches!(
        supervisor.state(),
        DesktopDiagnosticsSupervisorStateV1::Stopped { orderly: false }
    ));

    let records = std::fs::read_to_string(root.join("desktop-native.log"))
        .expect("teardown fallback")
        .lines()
        .map(|line| serde_json::from_str::<ProducerRecordV1>(line).expect("fallback record"))
        .filter(|record| {
            record.name == "desktop.collector.stop"
                && record.lifecycle.as_ref().map(|value| value.phase)
                    == Some(LifecyclePhaseV1::Terminal)
        })
        .collect::<Vec<_>>();
    assert_eq!(records.len(), 1);
    assert_eq!(
        records[0]
            .lifecycle
            .as_ref()
            .and_then(|value| value.outcome),
        Some(TerminalOutcomeV1::TimedOut)
    );
    assert_eq!(
        records[0].error_classification.as_deref(),
        Some("shutdown_timeout")
    );

    producer.close();
    fallback.close().expect("fallback close");
    std::fs::remove_dir_all(root).expect("fixture cleanup");
}
