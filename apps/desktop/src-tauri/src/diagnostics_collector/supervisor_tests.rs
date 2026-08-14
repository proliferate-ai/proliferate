use super::lifecycle::{
    classify_steady_health_error, classify_steady_health_response, SteadyHealthAssessment,
};
use super::*;
use proliferate_diagnostics_protocol::v1::types::{
    ComponentV1, DetailedDiagnosticV1, DetailedKindV1, PressureV1, PrivacyClassificationV1,
    ProducerRecordV1, RecordClassV1, RecordsFilterV1, RedactionClassificationV1, SeverityV1,
};
use std::io::Read;

fn built_collector_binary() -> std::path::PathBuf {
    std::env::current_exe()
        .expect("current test executable")
        .parent()
        .and_then(std::path::Path::parent)
        .expect("target profile directory")
        .join("proliferate-diagnostics-collector")
}

fn renderer_batch() -> IngestBatchV1 {
    IngestBatchV1 {
        schema_version: CURRENT_SCHEMA_VERSION,
        records: vec![ProducerRecordV1 {
            schema_version: CURRENT_SCHEMA_VERSION,
            source_timestamp: chrono::Utc::now().to_rfc3339(),
            producer_sequence: 1,
            producer_boot_id: uuid::Uuid::new_v4().to_string(),
            component: ComponentV1::DesktopRenderer,
            source: SourceV1::Renderer,
            release: "test".to_string(),
            environment: "test".to_string(),
            operation_id: uuid::Uuid::new_v4().to_string(),
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
            name: "desktop.renderer.detail".to_string(),
            severity: SeverityV1::Info,
            arguments: Vec::new(),
            error_classification: None,
            record_class: RecordClassV1::Detailed,
            privacy: PrivacyClassificationV1::CustomerContent,
            redaction: RedactionClassificationV1::Structural,
            detailed: Some(DetailedDiagnosticV1 {
                kind: DetailedKindV1::Log,
                message: Some("renderer detail".to_string()),
                stream: None,
                dropped_count: None,
                milestone: None,
            }),
            lifecycle: None,
        }],
    }
}

#[test]
fn frozen_restart_constants_and_retry_taxonomy_are_pinned() {
    assert_eq!(AUTOMATIC_RESTART_DELAYS[0], Duration::from_millis(250));
    assert_eq!(AUTOMATIC_RESTART_DELAYS[1], Duration::from_secs(1));
    assert_eq!(AUTOMATIC_RESTART_DELAYS[2], Duration::from_secs(4));
    assert_eq!(HEALTH_FAILURE_THRESHOLD, 3);
    assert!(retryable(CollectorLaunchErrorKind::SpawnFailed));
    assert!(retryable(CollectorLaunchErrorKind::EndpointUnavailable));
    assert!(retryable(CollectorLaunchErrorKind::ReadinessTimeout));
    assert!(retryable(CollectorLaunchErrorKind::ChildExited));
    assert!(!retryable(CollectorLaunchErrorKind::AuthenticationFailed));
    assert!(!retryable(CollectorLaunchErrorKind::SchemaIncompatible));
    assert!(!retryable(CollectorLaunchErrorKind::BootIdMismatch));
    assert!(!retryable(CollectorLaunchErrorKind::ChildInspectionFailed));
}

#[test]
fn steady_health_preserves_fatal_classification_before_transient_threshold() {
    let boot_id = uuid::Uuid::new_v4().to_string();
    assert_eq!(
        classify_steady_health_response(
            HealthStatusV1::Ready,
            CURRENT_SCHEMA_VERSION.major,
            &boot_id,
            &boot_id,
        ),
        SteadyHealthAssessment::Healthy
    );
    assert_eq!(
        classify_steady_health_response(
            HealthStatusV1::Degraded,
            CURRENT_SCHEMA_VERSION.major,
            &boot_id,
            &boot_id,
        ),
        SteadyHealthAssessment::TransientFailure
    );
    assert_eq!(
        classify_steady_health_response(
            HealthStatusV1::Ready,
            CURRENT_SCHEMA_VERSION.major + 1,
            &boot_id,
            &boot_id,
        ),
        SteadyHealthAssessment::LatchedFailure("schema_incompatible")
    );
    assert_eq!(
        classify_steady_health_response(
            HealthStatusV1::Ready,
            CURRENT_SCHEMA_VERSION.major,
            &uuid::Uuid::new_v4().to_string(),
            &boot_id,
        ),
        SteadyHealthAssessment::LatchedFailure("boot_id_mismatch")
    );
    assert_eq!(
        classify_steady_health_error(CollectorClientError::Authentication),
        SteadyHealthAssessment::LatchedFailure("authentication_failed")
    );
    assert_eq!(
        classify_steady_health_error(CollectorClientError::Protocol),
        SteadyHealthAssessment::LatchedFailure("schema_incompatible")
    );
    assert_eq!(
        classify_steady_health_error(CollectorClientError::Unavailable),
        SteadyHealthAssessment::TransientFailure
    );
}

#[test]
fn deterministic_restart_budget_caps_three_in_sixty_seconds_and_resets_after_health() {
    let start = Instant::now();
    let mut inner = SupervisorInner {
        process: None,
        retained_launch: None,
        state: DesktopDiagnosticsSupervisorStateV1::Stopped { orderly: false },
        generation: 0,
        restart_count: 0,
        restart_attempts: VecDeque::new(),
        ready_since: Some(start),
    };
    assert!(accept_restart_budget_at(&mut inner, start));
    assert!(accept_restart_budget_at(
        &mut inner,
        start + Duration::from_secs(1)
    ));
    assert!(accept_restart_budget_at(
        &mut inner,
        start + Duration::from_secs(2)
    ));
    assert!(!accept_restart_budget_at(
        &mut inner,
        start + Duration::from_secs(59)
    ));
    reset_restart_budget_after_health(&mut inner, start + HEALTHY_BUDGET_RESET_AFTER);
    assert!(inner.restart_attempts.is_empty());
    assert!(accept_restart_budget_at(
        &mut inner,
        start + HEALTHY_BUDGET_RESET_AFTER
    ));
    assert_eq!(inner.restart_count, 4);
}

#[tokio::test]
async fn fake_launcher_concurrent_start_accepts_one_start_and_one_terminal_transition() {
    let root =
        std::env::temp_dir().join(format!("collector-singleton-fake-{}", uuid::Uuid::new_v4()));
    let path = root.join("desktop-native.log");
    let fallback = FallbackDiagnosticsWriter::open_for_test(path.clone()).expect("fallback");
    let producer = TauriDiagnosticsProducer::new(fallback.clone(), "test".into(), "test".into());
    let supervisor = DiagnosticsCollectorSupervisor::with_fake_launch_error(
        producer,
        fallback.clone(),
        CollectorLaunchError::new(
            CollectorLaunchErrorKind::UnsupportedTarget,
            "fake unsupported launcher",
        ),
    );
    let (a, b, c, d, e, f, g, h) = tokio::join!(
        supervisor.start(),
        supervisor.start(),
        supervisor.start(),
        supervisor.start(),
        supervisor.start(),
        supervisor.start(),
        supervisor.start(),
        supervisor.start(),
    );
    assert!([a, b, c, d, e, f, g, h]
        .into_iter()
        .all(|result| result == StartupBarrierResult::Degraded));
    assert!(matches!(
        supervisor.state(),
        DesktopDiagnosticsSupervisorStateV1::Unsupported { .. }
    ));
    let state = supervisor.subscribe_state();
    assert!(matches!(
        &*state.borrow(),
        DesktopDiagnosticsSupervisorStateV1::Unsupported { .. }
    ));
    assert_eq!(
        supervisor.wait_startup_barrier().await,
        StartupBarrierResult::Degraded
    );

    let records = std::fs::read_to_string(&path)
        .expect("fallback records")
        .lines()
        .map(|line| serde_json::from_str::<ProducerRecordV1>(line).expect("record"))
        .filter(|record| record.name == "desktop.collector.start")
        .collect::<Vec<_>>();
    assert_eq!(records.len(), 2);
    assert_eq!(
        records[0].lifecycle.as_ref().map(|value| value.phase),
        Some(proliferate_diagnostics_protocol::v1::types::LifecyclePhaseV1::Started)
    );
    assert_eq!(
        records[1].lifecycle.as_ref().map(|value| value.phase),
        Some(proliferate_diagnostics_protocol::v1::types::LifecyclePhaseV1::Terminal)
    );
    assert_eq!(records[0].operation_id, records[1].operation_id);

    fallback.close().expect("close fallback");
    std::fs::remove_dir_all(root).expect("cleanup");
}

#[tokio::test]
async fn concurrent_real_start_owns_one_ready_child_capability_and_lifecycle_pair() {
    let root = std::env::temp_dir().join(format!("collector-singleton-{}", uuid::Uuid::new_v4()));
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
    assert!(
        built_collector_binary().is_file(),
        "collector binary must be built"
    );
    let supervisor = DiagnosticsCollectorSupervisor::with_launcher(
        producer.clone(),
        fallback.clone(),
        Ok(launcher),
    );

    let (a, b, c, d) = tokio::join!(
        supervisor.start(),
        supervisor.start(),
        supervisor.start(),
        supervisor.start(),
    );
    assert!([a, b, c, d]
        .into_iter()
        .all(|result| result == StartupBarrierResult::Ready));
    assert!(matches!(
        supervisor.state(),
        DesktopDiagnosticsSupervisorStateV1::Ready { .. }
    ));

    let mut first = supervisor
        .protected_child_handoff()
        .expect("first protected handoff");
    let mut second = supervisor
        .protected_child_handoff()
        .expect("second protected handoff");
    assert_eq!(first.generation, second.generation);
    let generation = supervisor.subscribe_generation();
    assert_eq!(*generation.borrow(), first.generation);
    assert_eq!(
        first.descriptor.collector_boot_id,
        second.descriptor.collector_boot_id
    );
    assert_ne!(
        first.inherited_channel.as_raw_fd(),
        second.inherited_channel.as_raw_fd()
    );
    let mut first_capability = String::new();
    let mut second_capability = String::new();
    first
        .inherited_channel
        .read_to_string(&mut first_capability)
        .expect("first capability channel");
    second
        .inherited_channel
        .read_to_string(&mut second_capability)
        .expect("second capability channel");
    assert!(
        first_capability == second_capability,
        "handoffs for one generation must carry the same private capability"
    );
    assert_eq!(first_capability.trim_end().len(), 43);

    assert!(producer.drain(PRODUCER_DRAIN_TIMEOUT).await);
    let page = supervisor
        .records(&RecordsQueryV1 {
            schema_version: CURRENT_SCHEMA_VERSION,
            after_cursor: None,
            limit: 16,
            filters: RecordsFilterV1 {
                source_time_from: None,
                source_time_to: None,
                components: vec![ComponentV1::DesktopTauri],
                record_classes: vec![RecordClassV1::Lifecycle],
                severities: Vec::new(),
                names: vec!["desktop.collector.start".to_string()],
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
        })
        .await
        .expect("query lifecycle pair");
    assert_eq!(page.records.len(), 2);
    assert_eq!(
        page.records[0].record.operation_id,
        page.records[1].record.operation_id
    );

    supervisor.arm_shutdown();
    let shutdown = supervisor.subscribe_shutdown();
    assert!(*shutdown.borrow());
    supervisor.stop_collector().await.expect("stop collector");
    producer.close();
    fallback.close().expect("close fallback");
    std::fs::remove_dir_all(root).expect("cleanup");
}

#[test]
fn health_wrapper_serialization_never_has_connection_data() {
    let value = serde_json::to_value(DesktopDiagnosticsHealthV1 {
        supervisor: DesktopDiagnosticsSupervisorStateV1::Degraded {
            classification: "binary_missing".to_string(),
            restart_count: 0,
            retry_exhausted: true,
        },
        fallback: FallbackHealthV1 {
            state: proliferate_diagnostics_protocol::v1::types::FallbackStateV1::Active,
            bytes: 1,
            dropped_records: 0,
        },
        collector: None,
    })
    .expect("health wrapper");
    let encoded = value.to_string();
    assert!(!encoded.contains("endpoint"));
    assert!(!encoded.contains("token"));
}

#[test]
fn rv_2_06_retry_window_remains_inside_sixty_four_trackers() {
    // A saturated 256-record queue is at most two 128-record batches. Each
    // batch gets one request plus three retries in a generation. The first
    // batch can consume four 5s deadlines plus three 50ms retry gaps before
    // the second starts; the last record is therefore terminally accepted
    // or counted lost within 40.3s in that ready generation. A batch can
    // contain at most 64 lifecycle pairs. PR2 caps the whole lifecycle
    // tracker map at 64 entries: a closed entry is evicted when the map is
    // full, while 64 simultaneously open entries reject another start.
    // This proof relies on sequential start/terminal pairs advancing that
    // bounded moving window; the pump never advances to the next batch
    // while an ambiguous retry of the current batch remains pending.
    let attempts = u32::from(super::super::producer::MAX_INGEST_RETRIES_PER_GENERATION) + 1;
    let batches = super::super::producer::PRODUCER_QUEUE_MAX_RECORDS
        .div_ceil(proliferate_diagnostics_protocol::v1::limits::MAX_BATCH_RECORDS);
    let request_ms = super::super::client::FINITE_REQUEST_TIMEOUT.as_millis();
    let retry_gap_ms = super::super::producer::INGEST_RETRY_DELAY.as_millis();
    let measured_worst_case_ms = batches as u128
        * (u128::from(attempts) * request_ms
            + u128::from(attempts.saturating_sub(1)) * retry_gap_ms);
    assert_eq!(measured_worst_case_ms, 40_300);
    assert_eq!(
        proliferate_diagnostics_protocol::v1::limits::MAX_BATCH_RECORDS / 2,
        64
    );
    assert_eq!(
        AUTOMATIC_RESTART_DELAYS.iter().sum::<Duration>(),
        Duration::from_millis(5_250)
    );
    assert!(1 + AUTOMATIC_RESTART_DELAYS.len() < 64);
}

#[tokio::test]
async fn renderer_ingest_seam_is_bounded_and_non_ready_batches_do_not_enter_tauri_fallback() {
    let root = std::env::temp_dir().join(format!("renderer-ingest-seam-{}", uuid::Uuid::new_v4()));
    let fallback =
        FallbackDiagnosticsWriter::open_for_test(root.join("logs").join("desktop-native.log"))
            .expect("fallback");
    let producer =
        TauriDiagnosticsProducer::new(fallback.clone(), "test".to_string(), "test".to_string());
    let supervisor = DiagnosticsCollectorSupervisor::new(
        producer,
        fallback.clone(),
        "test".to_string(),
        "test".to_string(),
    );
    let first = supervisor.ingest_renderer(renderer_batch());
    let second = supervisor.ingest_renderer(renderer_batch());
    let (first, second) = tokio::join!(first, second);
    assert_eq!(first, Err(SupervisorUnavailable::Stopped));
    assert_eq!(second, Err(SupervisorUnavailable::Stopped));
    assert_eq!(fallback.health().bytes, 0);

    let mut wrong_owner = renderer_batch();
    wrong_owner.records[0].component = ComponentV1::DesktopTauri;
    assert_eq!(
        validate_renderer_ingest_batch(&wrong_owner),
        Err(SupervisorUnavailable::CollectorRejected)
    );
    drop(supervisor);
    fallback.close().expect("close fallback");
    std::fs::remove_dir_all(root).expect("cleanup");
}

#[test]
fn renderer_ingest_receipt_is_bound_to_the_ready_collector_boot() {
    let expected_boot_id = uuid::Uuid::new_v4().to_string();
    let mut receipt = IngestReceiptV1 {
        schema_version: CURRENT_SCHEMA_VERSION,
        collector_boot_id: expected_boot_id.clone(),
        accepted_range: None,
        accepted_count: 1,
        duplicate_count: 0,
        rejections: Vec::new(),
        pressure: PressureV1::Normal,
    };
    assert_eq!(
        validate_renderer_ingest_receipt(&receipt, &expected_boot_id),
        Ok(())
    );

    receipt.collector_boot_id = uuid::Uuid::new_v4().to_string();
    assert_eq!(
        validate_renderer_ingest_receipt(&receipt, &expected_boot_id),
        Err(SupervisorUnavailable::Protocol)
    );
}
