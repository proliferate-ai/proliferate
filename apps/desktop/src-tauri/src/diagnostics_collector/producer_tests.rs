use super::*;

fn producer() -> TauriDiagnosticsProducer {
    TauriDiagnosticsProducer::new(
        FallbackDiagnosticsWriter::default(),
        "test".to_string(),
        "test".to_string(),
    )
}

#[test]
fn all_and_only_pr3_lifecycle_names_are_owned_here() {
    assert_eq!(PR3_LIFECYCLE_NAMES.len(), 8);
    assert!(PR3_LIFECYCLE_NAMES
        .iter()
        .all(|name| name.starts_with("desktop.")));
    assert!(!PR3_LIFECYCLE_NAMES.contains(&"desktop_worker.boot"));
    assert!(!PR3_LIFECYCLE_NAMES.contains(&"anyharness.runtime.boot"));
}

#[test]
fn lifecycle_terminal_is_exactly_once_even_when_dropped() {
    let producer = producer();
    let operation = producer.begin_lifecycle("desktop.collector.start");
    operation.terminal(TerminalOutcomeV1::Succeeded, None);
    let (records, _, _, _) = producer.queue_snapshot();
    assert_eq!(records, 2);
}

#[test]
fn native_lifecycle_correlation_is_identical_on_start_and_terminal() {
    let producer = producer();
    let correlation = LifecycleCorrelation {
        parent_operation_id: Some("parent-operation".to_string()),
        trace_id: Some("trace".to_string()),
        target_id: Some("target".to_string()),
        ..LifecycleCorrelation::default()
    };
    producer
        .begin_lifecycle_with_correlation("desktop.worker_process.start", correlation.clone())
        .terminal(TerminalOutcomeV1::Succeeded, None);

    let state = producer.inner.state.lock().expect("producer state");
    assert_eq!(state.queued.len(), 2);
    for item in &state.queued {
        assert_eq!(
            item.record.parent_operation_id,
            correlation.parent_operation_id
        );
        assert_eq!(item.record.trace_id, correlation.trace_id);
        assert_eq!(item.record.target_id, correlation.target_id);
    }
    assert_eq!(
        state.queued[0].record.operation_id,
        state.queued[1].record.operation_id
    );
}

#[test]
fn all_eight_names_and_every_terminal_outcome_use_one_pair() {
    let producer = producer();
    let outcomes = [
        TerminalOutcomeV1::Succeeded,
        TerminalOutcomeV1::Failed,
        TerminalOutcomeV1::TimedOut,
        TerminalOutcomeV1::Rejected,
        TerminalOutcomeV1::Skipped,
        TerminalOutcomeV1::Cancelled,
        TerminalOutcomeV1::Succeeded,
    ];
    for (name, outcome) in PR3_LIFECYCLE_NAMES[..7].iter().zip(outcomes) {
        producer.begin_lifecycle(name).terminal(
            outcome,
            (outcome == TerminalOutcomeV1::Failed).then_some("spawn_failed"),
        );
    }
    drop(producer.begin_lifecycle(PR3_LIFECYCLE_NAMES[7]));

    let state = producer.inner.state.lock().expect("producer state");
    assert_eq!(state.queued.len(), PR3_LIFECYCLE_NAMES.len() * 2);
    for name in PR3_LIFECYCLE_NAMES {
        let records = state
            .queued
            .iter()
            .filter(|item| item.record.name == name)
            .collect::<Vec<_>>();
        assert_eq!(records.len(), 2, "{name}");
        assert_eq!(
            records[0]
                .record
                .lifecycle
                .as_ref()
                .map(|value| value.phase),
            Some(LifecyclePhaseV1::Started)
        );
        assert_eq!(
            records[1]
                .record
                .lifecycle
                .as_ref()
                .map(|value| value.phase),
            Some(LifecyclePhaseV1::Terminal)
        );
        assert_eq!(
            records[0].record.operation_id,
            records[1].record.operation_id
        );
    }
    assert_eq!(
        state.queued.back().and_then(|item| item
            .record
            .lifecycle
            .as_ref()
            .and_then(|value| value.outcome)),
        Some(TerminalOutcomeV1::Abandoned)
    );
}

#[test]
fn stable_classification_catalog_is_exact() {
    assert_eq!(
        PR3_CLASSIFICATIONS,
        [
            "unsupported_target",
            "binary_missing",
            "binary_invalid",
            "spawn_failed",
            "endpoint_unavailable",
            "readiness_timeout",
            "authentication_failed",
            "schema_incompatible",
            "boot_id_mismatch",
            "health_unavailable",
            "child_exited",
            "child_inspection_failed",
            "restart_exhausted",
            "shutdown_armed",
            "shutdown_timeout",
            "shutdown_failed",
        ]
    );

    let producer = producer();
    producer
        .begin_lifecycle("desktop.collector.start")
        .terminal(TerminalOutcomeV1::Failed, Some("raw_error_prose"));
    let state = producer.inner.state.lock().expect("producer state");
    assert_eq!(state.queued.len(), 2);
    assert_eq!(state.queued[1].record.error_classification, None);
    assert_eq!(
        state.queued[1]
            .record
            .lifecycle
            .as_ref()
            .and_then(|lifecycle| lifecycle.outcome),
        Some(TerminalOutcomeV1::Abandoned)
    );
}

#[test]
fn lifecycle_drop_after_producer_close_counts_loss_without_inventing_terminal() {
    let producer = producer();
    let operation = producer.begin_lifecycle("desktop.collector.stop");
    producer.close();
    drop(operation);
    let (records, _, _, _) = producer.queue_snapshot();
    assert_eq!(records, 1);
}

#[test]
fn lifecycle_records_are_operational_and_detail_is_customer_content() {
    let producer = producer();
    producer
        .begin_lifecycle("desktop.collector.start")
        .terminal(TerminalOutcomeV1::Succeeded, None);
    producer.detailed(SeverityV1::Info, "desktop.tauri.log", "detail");
    let state = producer.inner.state.lock().expect("producer state");
    assert_eq!(
        state.queued[0].record.privacy,
        PrivacyClassificationV1::Operational
    );
    assert_eq!(
        state.queued[1].record.privacy,
        PrivacyClassificationV1::Operational
    );
    assert_eq!(
        state.queued[2].record.privacy,
        PrivacyClassificationV1::CustomerContent
    );
}

#[test]
fn lifecycle_lane_evicts_detail_and_queue_stays_bounded() {
    let producer = producer();
    for index in 0..400 {
        producer.detailed(
            SeverityV1::Info,
            "desktop.tauri.log",
            &format!("{index}:{}", "x".repeat(8_000)),
        );
    }
    for _ in 0..16 {
        producer
            .begin_lifecycle("desktop.collector.restart")
            .terminal(TerminalOutcomeV1::Failed, Some("spawn_failed"));
    }
    let (records, bytes, dropped_detail, dropped_lifecycle) = producer.queue_snapshot();
    assert!(records <= PRODUCER_QUEUE_MAX_RECORDS);
    assert!(bytes <= PRODUCER_QUEUE_MAX_BYTES);
    assert!(dropped_detail > 0);
    assert_eq!(dropped_lifecycle, 0);
}

#[test]
fn failed_batch_requeue_remains_bounded_after_concurrent_enqueue() {
    let producer = producer();
    for index in 0..PRODUCER_QUEUE_MAX_RECORDS {
        producer.detailed(
            SeverityV1::Info,
            "desktop.tauri.log",
            &format!("detail-{index}"),
        );
    }
    let mut failed = {
        let mut state = producer.inner.state.lock().expect("producer state");
        let item = state.queued.pop_front().expect("failed item");
        state.queued_bytes = state.queued_bytes.saturating_sub(item.bytes);
        state.detail_bytes = state.detail_bytes.saturating_sub(item.bytes);
        item
    };
    failed.attempts = 1;
    producer.detailed(SeverityV1::Info, "desktop.tauri.log", "concurrent");

    let mut state = producer.inner.state.lock().expect("producer state");
    assert_eq!(requeue_front_bounded(&mut state, failed), 1);
    assert!(state.queued.len() <= PRODUCER_QUEUE_MAX_RECORDS);
    assert!(state.queued_bytes <= PRODUCER_QUEUE_MAX_BYTES);
    assert!(state.detail_bytes <= PRODUCER_QUEUE_MAX_BYTES - PRODUCER_LIFECYCLE_RESERVED_BYTES);
}

#[test]
fn ready_detail_does_not_duplicate_into_fallback_and_old_fallback_is_not_rewritten() {
    let root = std::env::temp_dir().join(format!(
        "producer-ready-no-fallback-{}",
        uuid::Uuid::new_v4()
    ));
    let fallback = FallbackDiagnosticsWriter::open_for_test(root.join("desktop-native.log"))
        .expect("fallback");
    let producer =
        TauriDiagnosticsProducer::new(fallback.clone(), "test".to_string(), "test".to_string());
    producer.detailed(SeverityV1::Info, "desktop.tauri.log", "bootstrap");
    let bootstrap_bytes = fallback.health().bytes;
    assert!(bootstrap_bytes > 0);

    let capability =
        Arc::new(super::super::client::SecretCapability::new("x".repeat(43)).expect("capability"));
    let client = super::super::client::CollectorHttpClient::new("http://127.0.0.1:1/", capability)
        .expect("typed client");
    producer.set_ready_client(1, Some(Arc::new(client)));
    producer.detailed(SeverityV1::Info, "desktop.tauri.log", "ready");
    assert_eq!(fallback.health().bytes, bootstrap_bytes);

    fallback.close().expect("close fallback");
    std::fs::remove_dir_all(root).expect("cleanup");
}
