use super::*;
use crate::diagnostics_collector::test_binary::built_collector_binary;
use proliferate_diagnostics_protocol::v1::types::{
    ExportPurposeV1, ExportRequestV1, ExportStreamFrameV1, RecordsFilterV1, RecordsQueryV1,
    TailFrameV1,
};
use std::os::unix::fs::PermissionsExt;
use tokio::io::AsyncWriteExt;

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

#[tokio::test]
async fn broker_rejects_zero_oversize_truncated_and_second_frames() {
    async fn parse(bytes: &[u8]) -> bool {
        let (mut writer, mut reader) = tokio::io::duplex(32);
        writer.write_all(bytes).await.expect("write");
        drop(writer);
        read_frame(&mut reader, 8).await.is_err()
    }
    assert!(parse(&0_u32.to_be_bytes()).await);
    assert!(parse(&9_u32.to_be_bytes()).await);
    let mut truncated = 3_u32.to_be_bytes().to_vec();
    truncated.push(b'{');
    assert!(parse(&truncated).await);

    // One parser consumes exactly one command. A second frame remains and
    // is never dispatched on the same connection.
    let (mut writer, mut reader) = tokio::io::duplex(64);
    writer.write_u32(2).await.expect("length");
    writer.write_all(b"{}").await.expect("body");
    writer.write_u32(2).await.expect("second length");
    writer.write_all(b"{}").await.expect("second body");
    assert_eq!(read_frame(&mut reader, 8).await.expect("first"), b"{}");
    let mut marker = [0_u8; 1];
    assert_eq!(
        reader
            .read_exact(&mut marker)
            .await
            .expect("second remains"),
        1
    );
}

#[test]
fn broker_caps_eight_finite_four_tail_and_one_export_leases() {
    assert_eq!(MAX_BROKER_FINITE_REQUESTS, 8);
    assert_eq!(MAX_BROKER_TAILS, 4);
    assert_eq!(MAX_BROKER_EXPORTS, 1);
    assert_eq!(MAX_BROKER_CONNECTIONS, 13);

    fn exhaust(limit: usize) {
        let semaphore = Arc::new(Semaphore::new(limit));
        let permits = (0..limit)
            .map(|_| {
                Arc::clone(&semaphore)
                    .try_acquire_owned()
                    .expect("lease inside cap")
            })
            .collect::<Vec<_>>();
        assert!(Arc::clone(&semaphore).try_acquire_owned().is_err());
        drop(permits);
        assert!(Arc::clone(&semaphore).try_acquire_owned().is_ok());
    }

    exhaust(MAX_BROKER_FINITE_REQUESTS);
    exhaust(MAX_BROKER_TAILS);
    exhaust(MAX_BROKER_EXPORTS);
    exhaust(MAX_BROKER_CONNECTIONS);
}

#[tokio::test]
async fn broker_client_round_trips_records_tail_and_injected_internal_export() {
    use crate::diagnostics_collector::broker::client::DiagnosticsBrokerClient;
    use crate::diagnostics_collector::broker::discovery::build_scope;
    use crate::diagnostics_collector::fallback::FallbackDiagnosticsWriter;
    use crate::diagnostics_collector::process::CollectorProcessLauncher;
    use crate::diagnostics_collector::producer::{
        TauriDiagnosticsProducer, PRODUCER_DRAIN_TIMEOUT,
    };
    use crate::diagnostics_collector::supervisor::{
        DiagnosticsCollectorSupervisor, StartupBarrierResult,
    };

    let root = std::env::temp_dir().join(format!("broker-cli-roundtrip-{}", uuid::Uuid::new_v4()));
    let app_dir = root.join(".proliferate");
    std::fs::create_dir_all(&app_dir).expect("app directory");
    std::fs::set_permissions(&app_dir, std::fs::Permissions::from_mode(0o700))
        .expect("app directory mode");
    let fallback =
        FallbackDiagnosticsWriter::open_for_test(app_dir.join("logs/desktop-native.log"))
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
    producer.detailed(
        proliferate_diagnostics_protocol::v1::types::SeverityV1::Info,
        "desktop.broker.fixture",
        "broker CLI round trip",
    );
    assert!(producer.drain(PRODUCER_DRAIN_TIMEOUT).await);

    let scope = build_scope(
        app_dir,
        "com.proliferate.app".to_string(),
        "production",
        None,
    )
    .expect("broker scope");
    let broker = DiagnosticsBrokerServer::start_for_test(
        Arc::clone(&supervisor),
        scope.clone(),
        DiagnosticsArtifactKind::InternalDogfood,
    )
    .await
    .expect("broker");
    let client = DiagnosticsBrokerClient::for_scope(scope.clone());

    let finite_permits = (0..MAX_BROKER_FINITE_REQUESTS)
        .map(|_| {
            Arc::clone(&broker.limits.finite)
                .try_acquire_owned()
                .expect("hold real finite admission")
        })
        .collect::<Vec<_>>();
    let busy = client
        .records(RecordsQueryV1 {
            schema_version: CURRENT_SCHEMA_VERSION,
            after_cursor: None,
            limit: 1,
            filters: empty_filters(),
        })
        .await
        .expect_err("ninth finite request is rejected");
    assert_eq!(busy.classification(), DiagnosticsBrokerErrorV1::BrokerBusy);
    drop(finite_permits);

    let tail_permits = (0..MAX_BROKER_TAILS)
        .map(|_| {
            Arc::clone(&broker.limits.tails)
                .try_acquire_owned()
                .expect("hold real tail admission")
        })
        .collect::<Vec<_>>();
    let busy = match client.tail(None).await {
        Err(error) => error,
        Ok(_) => panic!("fifth tail is rejected"),
    };
    assert_eq!(busy.classification(), DiagnosticsBrokerErrorV1::BrokerBusy);
    drop(tail_permits);

    let export_permit = Arc::clone(&broker.limits.exports)
        .try_acquire_owned()
        .expect("hold real export admission");
    let busy = match client
        .export(ExportRequestV1 {
            schema_version: CURRENT_SCHEMA_VERSION,
            purpose: ExportPurposeV1::InternalDogfood,
            support_authorization_id: None,
            filters: empty_filters(),
            record_limit: 1,
            byte_limit: 1_024,
            include_health: false,
        })
        .await
    {
        Err(error) => error,
        Ok(_) => panic!("second export is rejected"),
    };
    assert_eq!(busy.classification(), DiagnosticsBrokerErrorV1::BrokerBusy);
    drop(export_permit);

    let mut tail = client.tail(Some(0)).await.expect("CLI tail open");
    let tail_frame = tokio::time::timeout(Duration::from_secs(2), tail.next())
        .await
        .expect("CLI tail frame deadline")
        .expect("CLI tail frame")
        .expect("CLI tail payload");
    assert!(matches!(&tail_frame, TailFrameV1::Records { records, .. } if !records.is_empty()));
    let tail_json = serde_json::to_value(&tail_frame).expect("CLI tail JSONL payload");
    assert!(tail_json.get("frame").is_some());
    assert!(tail_json.get("payload").is_none());
    drop(tail);

    let mut export = client
        .export(ExportRequestV1 {
            schema_version: CURRENT_SCHEMA_VERSION,
            purpose: ExportPurposeV1::InternalDogfood,
            support_authorization_id: None,
            filters: empty_filters(),
            record_limit: 64,
            byte_limit: 1_048_576,
            include_health: true,
        })
        .await
        .expect("injected internal CLI export");
    let mut frames = Vec::new();
    loop {
        let frame = tokio::time::timeout(Duration::from_secs(2), export.next())
            .await
            .expect("CLI export frame deadline")
            .expect("CLI export frame");
        let Some(frame) = frame else { break };
        let value = serde_json::to_value(&frame).expect("CLI export JSONL payload");
        assert!(value.get("frame").is_some());
        assert!(value.get("payload").is_none());
        frames.push(frame);
    }
    assert!(matches!(
        frames.first(),
        Some(ExportStreamFrameV1::Manifest { .. })
    ));
    assert!(frames
        .iter()
        .any(|frame| matches!(frame, ExportStreamFrameV1::Record { .. })));
    assert!(frames
        .iter()
        .any(|frame| matches!(frame, ExportStreamFrameV1::Health { .. })));
    assert!(matches!(
        frames.last(),
        Some(ExportStreamFrameV1::End { .. })
    ));

    let health = client.health().await.expect("broker health");
    assert_eq!(health["supervisor"]["state"], "ready");
    assert_eq!(health["collector"]["status"], "ready");
    let encoded_health = health.to_string();
    assert!(!encoded_health.contains("endpoint"));
    assert!(!encoded_health.contains("capability"));
    assert!(!encoded_health.contains("token"));

    let mut records_filters = empty_filters();
    records_filters.names = vec!["desktop.broker.fixture".to_string()];
    let page = client
        .records(RecordsQueryV1 {
            schema_version: CURRENT_SCHEMA_VERSION,
            after_cursor: None,
            limit: 16,
            filters: records_filters,
        })
        .await
        .expect("broker records page");
    assert!(page
        .records
        .iter()
        .any(|record| record.record.name == "desktop.broker.fixture"));

    let mut rejected_support = client
        .export(ExportRequestV1 {
            schema_version: CURRENT_SCHEMA_VERSION,
            purpose: ExportPurposeV1::Support,
            support_authorization_id: Some("not-authorized-in-pr3".to_string()),
            filters: empty_filters(),
            record_limit: 64,
            byte_limit: 1_048_576,
            include_health: true,
        })
        .await
        .expect("support export accepted before collector authorization");
    let rejection = rejected_support
        .next()
        .await
        .expect_err("support export remains unauthorized in PR3");
    assert_eq!(
        rejection.classification(),
        DiagnosticsBrokerErrorV1::CollectorRejected
    );

    broker.stop_accepting();
    broker.wait_stopped().await.expect("broker stopped");
    broker.remove_locator_and_unlock().expect("broker cleanup");
    supervisor.arm_shutdown();
    supervisor
        .stop_collector()
        .await
        .expect("collector stopped");
    producer.close();
    fallback.close().expect("fallback close");
    std::fs::remove_dir_all(root).expect("fixture cleanup");
}

#[tokio::test]
async fn unavailable_queries_preserve_the_actual_supervisor_state() {
    use crate::diagnostics_collector::broker::client::DiagnosticsBrokerClient;
    use crate::diagnostics_collector::broker::discovery::build_scope;
    use crate::diagnostics_collector::fallback::FallbackDiagnosticsWriter;
    use crate::diagnostics_collector::process::{CollectorLaunchError, CollectorLaunchErrorKind};
    use crate::diagnostics_collector::producer::TauriDiagnosticsProducer;
    use crate::diagnostics_collector::supervisor::{
        CollectorLaunchKindV1, DesktopDiagnosticsSupervisorStateV1, DiagnosticsCollectorSupervisor,
        StartupBarrierResult,
    };

    let root = std::env::temp_dir().join(format!("broker-state-fixture-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).expect("app directory");
    std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700))
        .expect("app directory mode");
    let fallback = FallbackDiagnosticsWriter::open_for_test(root.join("logs/desktop-native.log"))
        .expect("fallback");
    let producer = TauriDiagnosticsProducer::new(fallback.clone(), "test".into(), "test".into());
    let supervisor = DiagnosticsCollectorSupervisor::with_fake_launch_error(
        producer.clone(),
        fallback.clone(),
        CollectorLaunchError::new(
            CollectorLaunchErrorKind::UnsupportedTarget,
            "injected unsupported target",
        ),
    );
    assert_eq!(supervisor.start().await, StartupBarrierResult::Degraded);
    let unsupported = DesktopDiagnosticsSupervisorStateV1::Unsupported {
        classification: "unsupported_target".to_string(),
    };
    assert_eq!(supervisor.state(), unsupported);

    let scope = build_scope(
        root.clone(),
        "com.proliferate.app.local.broker-state-fixture".to_string(),
        "development",
        Some("broker_state_fixture".to_string()),
    )
    .expect("broker scope");
    let broker = DiagnosticsBrokerServer::start_for_test(
        Arc::clone(&supervisor),
        scope.clone(),
        DiagnosticsArtifactKind::InternalDogfood,
    )
    .await
    .expect("broker");
    let client = DiagnosticsBrokerClient::for_scope(scope.clone());

    for expected in [
        DesktopDiagnosticsSupervisorStateV1::Starting {
            launch_kind: CollectorLaunchKindV1::Initial,
            attempt: 1,
            restart_count: 0,
        },
        unsupported,
        DesktopDiagnosticsSupervisorStateV1::Degraded {
            classification: "binary_missing".to_string(),
            restart_count: 0,
            retry_exhausted: false,
        },
        DesktopDiagnosticsSupervisorStateV1::Stopped { orderly: false },
    ] {
        supervisor.set_state_for_test(expected.clone());
        let records_error = client
            .records(RecordsQueryV1 {
                schema_version: CURRENT_SCHEMA_VERSION,
                after_cursor: None,
                limit: 1,
                filters: empty_filters(),
            })
            .await
            .expect_err("records must be unavailable");
        assert_eq!(
            records_error.classification(),
            DiagnosticsBrokerErrorV1::CollectorUnavailable
        );
        assert_eq!(records_error.supervisor_state(), Some(&expected));

        let mut tail = client.tail(None).await.expect("tail accepted frame");
        let tail_error = tail
            .next()
            .await
            .expect_err("tail must be unavailable after acceptance");
        assert_eq!(tail_error.supervisor_state(), Some(&expected));

        let mut export = client
            .export(ExportRequestV1 {
                schema_version: CURRENT_SCHEMA_VERSION,
                purpose: ExportPurposeV1::InternalDogfood,
                support_authorization_id: None,
                filters: empty_filters(),
                record_limit: 1,
                byte_limit: 1_024,
                include_health: false,
            })
            .await
            .expect("export accepted frame");
        let export_error = export
            .next()
            .await
            .expect_err("export must be unavailable after acceptance");
        assert_eq!(export_error.supervisor_state(), Some(&expected));
    }

    let mut raw = tokio::net::UnixStream::connect(&scope.socket_path)
        .await
        .expect("raw broker connection");
    for request_id in [uuid::Uuid::new_v4(), uuid::Uuid::new_v4()] {
        let request = DiagnosticsBrokerRequestV1::Health {
            protocol_version: BROKER_PROTOCOL_VERSION,
            app_boot_id: broker.app_boot_id().to_string(),
            request_id: request_id.to_string(),
        };
        let bytes = serde_json::to_vec(&request).expect("serialize raw request");
        raw.write_u32(bytes.len() as u32)
            .await
            .expect("raw request length");
        raw.write_all(&bytes).await.expect("raw request body");
    }
    raw.flush().await.expect("raw request flush");
    let mut frames = Vec::new();
    for _ in 0..3 {
        let bytes = read_frame(&mut raw, MAX_BROKER_RESPONSE_FRAME_BYTES)
            .await
            .expect("first command response frame");
        frames.push(
            serde_json::from_slice::<DiagnosticsBrokerResponseV1>(&bytes)
                .expect("typed broker response"),
        );
    }
    assert!(matches!(
        frames.first(),
        Some(DiagnosticsBrokerResponseV1::Accepted { .. })
    ));
    assert!(matches!(
        frames.get(1),
        Some(DiagnosticsBrokerResponseV1::Payload {
            value: DiagnosticsBrokerPayloadV1::Health(_),
            ..
        })
    ));
    assert!(matches!(
        frames.get(2),
        Some(DiagnosticsBrokerResponseV1::End { .. })
    ));
    assert!(
        tokio::time::timeout(
            Duration::from_secs(1),
            read_frame(&mut raw, MAX_BROKER_RESPONSE_FRAME_BYTES),
        )
        .await
        .expect("server closes one-command connection")
        .is_err(),
        "a second broker frame must never be dispatched"
    );

    broker.stop_accepting();
    broker.wait_stopped().await.expect("broker stopped");
    broker.remove_locator_and_unlock().expect("broker cleanup");
    producer.close();
    fallback.close().expect("fallback close");
    std::fs::remove_dir_all(root).expect("fixture cleanup");
}

#[tokio::test]
async fn broker_keeps_accepting_after_transient_accept_failures() {
    use crate::diagnostics_collector::broker::client::DiagnosticsBrokerClient;
    use crate::diagnostics_collector::broker::discovery::build_scope;
    use crate::diagnostics_collector::fallback::FallbackDiagnosticsWriter;
    use crate::diagnostics_collector::process::{CollectorLaunchError, CollectorLaunchErrorKind};
    use crate::diagnostics_collector::producer::TauriDiagnosticsProducer;
    use crate::diagnostics_collector::supervisor::DiagnosticsCollectorSupervisor;

    let root = std::env::temp_dir().join(format!("broker-accept-retry-{}", uuid::Uuid::new_v4()));
    let app_dir = root.join(".proliferate");
    std::fs::create_dir_all(&app_dir).expect("app directory");
    std::fs::set_permissions(&app_dir, std::fs::Permissions::from_mode(0o700))
        .expect("app directory mode");
    let fallback =
        FallbackDiagnosticsWriter::open_for_test(app_dir.join("logs/desktop-native.log"))
            .expect("fallback");
    let producer = TauriDiagnosticsProducer::new(fallback.clone(), "test".into(), "test".into());
    producer.start_pump();
    // Health answers from supervisor state alone, so no collector child is
    // needed to tell a live accept loop from a retired one.
    let supervisor = DiagnosticsCollectorSupervisor::with_fake_launch_error(
        producer.clone(),
        fallback.clone(),
        CollectorLaunchError::new(
            CollectorLaunchErrorKind::UnsupportedTarget,
            "accept retry fixture",
        ),
    );

    let scope = build_scope(
        app_dir,
        "com.proliferate.app.local.accept-retry".to_string(),
        "development",
        Some("accept_retry".to_string()),
    )
    .expect("broker scope");
    let broker = DiagnosticsBrokerServer::start_for_test_with_accept_failures(
        Arc::clone(&supervisor),
        scope.clone(),
        DiagnosticsArtifactKind::InternalDogfood,
        3,
    )
    .await
    .expect("broker");

    let client = DiagnosticsBrokerClient::for_scope(scope.clone());
    // Three seeded failures are consumed ahead of any connection. A broker that
    // retires on the first one drops its listener, and every later request
    // fails at connect instead of returning health.
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if client.health().await.is_ok() {
                return;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .expect("broker still serves health after transient accept failures");

    // Repeat requests keep working: the retry path did not leave the loop wedged.
    client.health().await.expect("second health after retries");
    assert!(scope.locator_path.exists());
    assert!(scope.socket_path.exists());

    broker.stop_accepting();
    broker.wait_stopped().await.expect("broker stopped");
    broker.remove_locator_and_unlock().expect("broker cleanup");
    producer.close();
    fallback.close().expect("fallback close");
    std::fs::remove_dir_all(root).expect("fixture cleanup");
}
