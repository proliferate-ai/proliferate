#[tokio::test]
async fn renderer_ingest_forced_write_failure_preserves_the_stopped_error() {
    let root = std::env::temp_dir().join(format!(
        "renderer-ingest-fallback-failure-{}",
        uuid::Uuid::new_v4()
    ));
    let fallback = FallbackDiagnosticsWriter::open_for_test(root.join("desktop-native.log"))
        .expect("fallback");
    fallback.set_active(false);
    fallback.inject_write_failure();
    let producer =
        TauriDiagnosticsProducer::new(fallback.clone(), "test".to_string(), "test".to_string());
    let supervisor = DiagnosticsCollectorSupervisor::new(
        producer,
        fallback.clone(),
        "test".to_string(),
        "test".to_string(),
        None,
    );

    assert_eq!(
        supervisor.ingest_renderer(renderer_batch()).await,
        Err(SupervisorUnavailable::Stopped)
    );
    assert_eq!(
        fallback.health(),
        FallbackHealthV1 {
            state: FallbackStateV1::Degraded,
            bytes: 0,
            dropped_records: 1,
        }
    );
    drop(supervisor);
    fallback.close().expect("close fallback");
    std::fs::remove_dir_all(root).expect("cleanup");
}

#[tokio::test]
async fn renderer_ingest_post_dispatch_unavailable_never_writes_fallback() {
    let root = std::env::temp_dir().join(format!(
        "renderer-ingest-post-dispatch-{}",
        uuid::Uuid::new_v4()
    ));
    let fallback = FallbackDiagnosticsWriter::open_for_test(root.join("desktop-native.log"))
        .expect("fallback");
    fallback.set_active(false);
    let producer =
        TauriDiagnosticsProducer::new(fallback.clone(), "test".to_string(), "test".to_string());
    let supervisor = DiagnosticsCollectorSupervisor::new(
        producer,
        fallback.clone(),
        "test".to_string(),
        "test".to_string(),
        None,
    );
    let generation = 7;
    let collector_boot_id = uuid::Uuid::new_v4().to_string();
    set_renderer_ingest_ready_state(&supervisor, generation, &collector_boot_id);
    let unavailable = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind unavailable endpoint");
    let unavailable_address = unavailable
        .local_addr()
        .expect("unavailable endpoint address");
    drop(unavailable);
    let ready = renderer_ingest_ready_generation(
        &format!("http://{unavailable_address}/"),
        generation,
        collector_boot_id,
    );

    assert_eq!(
        supervisor
            .dispatch_renderer_batch(&renderer_batch(), ready)
            .await,
        Err(SupervisorUnavailable::Degraded)
    );
    assert_eq!(fallback.health().bytes, 0);
    assert_eq!(fallback.health().state, FallbackStateV1::Inactive);
    drop(supervisor);
    fallback.close().expect("close fallback");
    std::fs::remove_dir_all(root).expect("cleanup");
}

#[tokio::test]
async fn renderer_ingest_ready_coherent_success_writes_no_fallback() {
    let root = std::env::temp_dir().join(format!(
        "renderer-ingest-ready-success-{}",
        uuid::Uuid::new_v4()
    ));
    let fallback = FallbackDiagnosticsWriter::open_for_test(root.join("desktop-native.log"))
        .expect("fallback");
    fallback.set_active(false);
    let producer =
        TauriDiagnosticsProducer::new(fallback.clone(), "test".to_string(), "test".to_string());
    let supervisor = DiagnosticsCollectorSupervisor::new(
        producer,
        fallback.clone(),
        "test".to_string(),
        "test".to_string(),
        None,
    );
    let collector_boot_id = uuid::Uuid::new_v4().to_string();
    let generation = 9;
    set_renderer_ingest_ready_state(&supervisor, generation, &collector_boot_id);
    let coherent_receipt = IngestReceiptV1 {
        schema_version: CURRENT_SCHEMA_VERSION,
        collector_boot_id: collector_boot_id.clone(),
        accepted_range: Some(
            proliferate_diagnostics_protocol::v1::types::AcceptedOrderRangeV1 { first: 1, last: 1 },
        ),
        accepted_count: 1,
        duplicate_count: 0,
        rejections: Vec::new(),
        pressure: PressureV1::Normal,
    };
    let (endpoint, server) = renderer_ingest_http_response(
        "200 OK",
        serde_json::to_string(&coherent_receipt).expect("serialize receipt"),
        Duration::ZERO,
    )
    .await;

    assert_eq!(
        supervisor
            .dispatch_renderer_batch(
                &renderer_batch(),
                renderer_ingest_ready_generation(&endpoint, generation, collector_boot_id),
            )
            .await,
        Ok(coherent_receipt)
    );
    server.await.expect("success server");
    assert_eq!(fallback.health().bytes, 0);
    assert_eq!(fallback.health().state, FallbackStateV1::Inactive);
    drop(supervisor);
    fallback.close().expect("close fallback");
    std::fs::remove_dir_all(root).expect("cleanup");
}

#[tokio::test]
async fn renderer_ingest_post_dispatch_rejected_protocol_boot_and_replaced_write_no_fallback() {
    let root = std::env::temp_dir().join(format!(
        "renderer-ingest-post-dispatch-outcomes-{}",
        uuid::Uuid::new_v4()
    ));
    let fallback = FallbackDiagnosticsWriter::open_for_test(root.join("desktop-native.log"))
        .expect("fallback");
    fallback.set_active(false);
    let producer =
        TauriDiagnosticsProducer::new(fallback.clone(), "test".to_string(), "test".to_string());
    let supervisor = DiagnosticsCollectorSupervisor::new(
        producer,
        fallback.clone(),
        "test".to_string(),
        "test".to_string(),
        None,
    );

    let collector_boot_id = uuid::Uuid::new_v4().to_string();
    let generation = 11;
    set_renderer_ingest_ready_state(&supervisor, generation, &collector_boot_id);

    let (endpoint, server) =
        renderer_ingest_http_response("400 Bad Request", "{}".to_string(), Duration::ZERO).await;
    assert_eq!(
        supervisor
            .dispatch_renderer_batch(
                &renderer_batch(),
                renderer_ingest_ready_generation(&endpoint, generation, collector_boot_id.clone(),),
            )
            .await,
        Err(SupervisorUnavailable::CollectorRejected)
    );
    server.await.expect("rejection server");

    let (endpoint, server) = renderer_ingest_http_response(
        "200 OK",
        r#"{"malformed":true}"#.to_string(),
        Duration::ZERO,
    )
    .await;
    assert_eq!(
        supervisor
            .dispatch_renderer_batch(
                &renderer_batch(),
                renderer_ingest_ready_generation(&endpoint, generation, collector_boot_id.clone(),),
            )
            .await,
        Err(SupervisorUnavailable::Protocol)
    );
    server.await.expect("protocol server");

    let wrong_boot_receipt = IngestReceiptV1 {
        schema_version: CURRENT_SCHEMA_VERSION,
        collector_boot_id: uuid::Uuid::new_v4().to_string(),
        accepted_range: Some(
            proliferate_diagnostics_protocol::v1::types::AcceptedOrderRangeV1 { first: 1, last: 1 },
        ),
        accepted_count: 1,
        duplicate_count: 0,
        rejections: Vec::new(),
        pressure: PressureV1::Normal,
    };
    let (endpoint, server) = renderer_ingest_http_response(
        "200 OK",
        serde_json::to_string(&wrong_boot_receipt).expect("serialize receipt"),
        Duration::ZERO,
    )
    .await;
    assert_eq!(
        supervisor
            .dispatch_renderer_batch(
                &renderer_batch(),
                renderer_ingest_ready_generation(&endpoint, generation, collector_boot_id.clone(),),
            )
            .await,
        Err(SupervisorUnavailable::Protocol)
    );
    server.await.expect("boot server");

    let coherent_receipt = IngestReceiptV1 {
        collector_boot_id: collector_boot_id.clone(),
        ..wrong_boot_receipt
    };
    let (endpoint, server) = renderer_ingest_http_response(
        "200 OK",
        serde_json::to_string(&coherent_receipt).expect("serialize receipt"),
        Duration::from_millis(25),
    )
    .await;
    let ready = renderer_ingest_ready_generation(&endpoint, generation, collector_boot_id.clone());
    let dispatch_supervisor = supervisor.clone();
    let dispatch = tokio::spawn(async move {
        dispatch_supervisor
            .dispatch_renderer_batch(&renderer_batch(), ready)
            .await
    });
    tokio::time::sleep(Duration::from_millis(5)).await;
    supervisor
        .inner
        .lock()
        .expect("supervisor state")
        .generation = generation + 1;
    assert_eq!(
        dispatch.await.expect("dispatch task"),
        Err(SupervisorUnavailable::Replaced)
    );
    server.await.expect("replacement server");

    assert_eq!(fallback.health().bytes, 0);
    assert_eq!(fallback.health().state, FallbackStateV1::Inactive);
    drop(supervisor);
    fallback.close().expect("close fallback");
    std::fs::remove_dir_all(root).expect("cleanup");
}

#[tokio::test]
async fn renderer_ingest_post_dispatch_deadline_writes_no_fallback() {
    let root = std::env::temp_dir().join(format!(
        "renderer-ingest-post-dispatch-deadline-{}",
        uuid::Uuid::new_v4()
    ));
    let fallback = FallbackDiagnosticsWriter::open_for_test(root.join("desktop-native.log"))
        .expect("fallback");
    fallback.set_active(false);
    let producer =
        TauriDiagnosticsProducer::new(fallback.clone(), "test".to_string(), "test".to_string());
    let supervisor = DiagnosticsCollectorSupervisor::new(
        producer,
        fallback.clone(),
        "test".to_string(),
        "test".to_string(),
        None,
    );
    let collector_boot_id = uuid::Uuid::new_v4().to_string();
    let generation = 13;
    set_renderer_ingest_ready_state(&supervisor, generation, &collector_boot_id);
    let (endpoint, server) =
        renderer_ingest_http_response("200 OK", "{}".to_string(), Duration::from_secs(10)).await;

    assert_eq!(
        supervisor
            .dispatch_renderer_batch(
                &renderer_batch(),
                renderer_ingest_ready_generation(&endpoint, generation, collector_boot_id),
            )
            .await,
        Err(SupervisorUnavailable::Deadline)
    );
    server.abort();
    assert_eq!(fallback.health().bytes, 0);
    assert_eq!(fallback.health().state, FallbackStateV1::Inactive);
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

#[test]
fn renderer_ingest_pins_the_exact_current_schema_at_the_native_boundary() {
    // `parse_ingest_batch_value` accepts the whole compatible producer-minor window, so a
    // renderer that claims 1.0 would otherwise pass the native check and contradict
    // `specs/systems/desktop-host/desktop-native.md`'s "Exact schema-v1.1 Desktop renderer batches". The renderer's
    // own check does not count here: `require_main_window` exists precisely to distrust it.
    let previous_minor = proliferate_diagnostics_protocol::v1::types::SchemaVersionV1 {
        major: CURRENT_SCHEMA_VERSION.major,
        minor: CURRENT_SCHEMA_VERSION.minor - 1,
    };

    assert_eq!(validate_renderer_ingest_batch(&renderer_batch()), Ok(()));

    let mut stale_envelope = renderer_batch();
    stale_envelope.schema_version = previous_minor;
    assert_eq!(
        validate_renderer_ingest_batch(&stale_envelope),
        Err(SupervisorUnavailable::CollectorRejected)
    );

    let mut stale_record = renderer_batch();
    stale_record.records[0].schema_version = previous_minor;
    assert_eq!(
        validate_renderer_ingest_batch(&stale_record),
        Err(SupervisorUnavailable::CollectorRejected)
    );
}
