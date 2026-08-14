use super::{no_evidence_skeleton, set_manifest_source, TS};

use crate::diagnostics::support_snapshot::schema::enums::{
    SupportChildComponentV1, SupportEndpointStateV1, SupportLossReasonV1,
    SupportSessionSelectionV1, SupportSourceManifestSourceV1, SupportSourceStateV1,
};
use crate::diagnostics::support_snapshot::schema::model::common::SupportJsonValueV1;
use crate::diagnostics::support_snapshot::schema::model::evidence::SupportSessionLedgerV1;
use crate::diagnostics::support_snapshot::schema::model::health::{
    SupportChildProducerStatusV1, SupportLossCountsV1,
};
use crate::diagnostics::support_snapshot::schema::model::manifest::SupportSessionCollectionManifestV1;
use crate::diagnostics::support_snapshot::schema::validate::{
    stabilize_serialized_bytes, validate_collector_coverage, validate_snapshot, SupportSchemaError,
};

#[test]
fn projected_json_rejects_negative_ieee_zero_from_direct_and_wire_values() {
    assert_eq!(
        crate::diagnostics::support_snapshot::schema::validate::validate_support_json_value(
            &SupportJsonValueV1::Number(-0.0),
        ),
        Err(SupportSchemaError::UnsafeInteger)
    );
    let negative_zero: serde_json::Value = serde_json::from_str("-0.0").expect("JSON number");
    assert_eq!(
        SupportJsonValueV1::try_from_json(&negative_zero),
        Err(SupportSchemaError::UnsafeInteger)
    );
    assert!(SupportJsonValueV1::try_from_json(&serde_json::json!(-0.5)).is_ok());
}

#[test]
fn returned_cursor_prefix_must_fit_inside_the_health_fence() {
    let mut below = super::evidence_tests::populated_coverage(1, false);
    below.cursor_start = Some(9);
    below.cursor_end = Some(10);
    below.health_oldest_cursor = Some(10);
    below.health_newest_cursor = Some(20);
    assert_eq!(
        validate_collector_coverage(&below),
        Err(SupportSchemaError::InvariantViolation(
            "coverage cursors outside health fence"
        ))
    );

    let mut above = super::evidence_tests::populated_coverage(1, false);
    above.cursor_start = Some(19);
    above.cursor_end = Some(21);
    above.health_oldest_cursor = Some(10);
    above.health_newest_cursor = Some(20);
    assert_eq!(
        validate_collector_coverage(&above),
        Err(SupportSchemaError::InvariantViolation(
            "coverage cursors outside health fence"
        ))
    );

    let mut inside = super::evidence_tests::populated_coverage(1, false);
    inside.cursor_start = Some(10);
    inside.cursor_end = Some(20);
    inside.health_oldest_cursor = Some(10);
    inside.health_newest_cursor = Some(20);
    validate_collector_coverage(&inside).expect("inclusive fence bounds");

    let mut no_health = super::evidence_tests::populated_coverage(1, false);
    no_health.health_oldest_cursor = None;
    no_health.health_newest_cursor = None;
    validate_collector_coverage(&no_health).expect("null health pair remains honest");
}

#[test]
fn returned_prefix_fence_is_independent_of_final_record_selection() {
    let mut empty_final = super::protocol_tests::completed_snapshot();
    empty_final.records.clear();
    let source = empty_final
        .manifest
        .sources
        .iter_mut()
        .find(|source| source.source == SupportSourceManifestSourceV1::Collector)
        .expect("collector source");
    source.included_bytes = 0;
    source.included_items = 0;
    empty_final.collector.coverage.cursor_start = Some(10);
    empty_final.collector.coverage.cursor_end = Some(41);
    empty_final.manifest.collector = empty_final.collector.coverage.clone();
    let export_manifest = empty_final
        .collector
        .export_manifest
        .as_mut()
        .expect("export manifest");
    export_manifest.cursor_start = Some(10);
    export_manifest.cursor_end = Some(41);
    stabilize_serialized_bytes(&mut empty_final).expect("stabilize");
    assert_eq!(
        validate_snapshot(&empty_final),
        Err(SupportSchemaError::InvariantViolation(
            "coverage cursors outside health fence"
        ))
    );

    let mut selected_outside = super::protocol_tests::completed_snapshot();
    selected_outside.collector.coverage.cursor_start = Some(42);
    selected_outside.collector.coverage.cursor_end = Some(42);
    selected_outside.collector.coverage.health_oldest_cursor = None;
    selected_outside.collector.coverage.health_newest_cursor = None;
    selected_outside.manifest.collector = selected_outside.collector.coverage.clone();
    let export_manifest = selected_outside
        .collector
        .export_manifest
        .as_mut()
        .expect("export manifest");
    export_manifest.cursor_start = Some(42);
    export_manifest.cursor_end = Some(42);
    let export_health = selected_outside
        .collector
        .export_health
        .as_mut()
        .expect("export health");
    export_health.oldest_cursor = None;
    export_health.newest_cursor = None;
    stabilize_serialized_bytes(&mut selected_outside).expect("stabilize");
    assert_eq!(
        validate_snapshot(&selected_outside),
        Err(SupportSchemaError::InvariantViolation(
            "record outside collector cursor fence"
        ))
    );
}

fn loss_counts_with(reason: SupportLossReasonV1) -> SupportLossCountsV1 {
    let mut counts = SupportLossCountsV1::default();
    match reason {
        SupportLossReasonV1::QueueRecords => counts.queue_records = 1,
        SupportLossReasonV1::QueueBytes => counts.queue_bytes = 1,
        SupportLossReasonV1::ProtectedEviction => counts.protected_eviction = 1,
        SupportLossReasonV1::Pressure => counts.pressure = 1,
        SupportLossReasonV1::GenerationChanged => counts.generation_changed = 1,
        SupportLossReasonV1::TransportTimeout => counts.transport_timeout = 1,
        SupportLossReasonV1::TransportFailure => counts.transport_failure = 1,
        SupportLossReasonV1::ReceiptInvalid => counts.receipt_invalid = 1,
        SupportLossReasonV1::ReceiptRejected => counts.receipt_rejected = 1,
        SupportLossReasonV1::FallbackOverflow => counts.fallback_overflow = 1,
        SupportLossReasonV1::FallbackWriteFailed => counts.fallback_write_failed = 1,
        SupportLossReasonV1::ShutdownTimeout => counts.shutdown_timeout = 1,
        SupportLossReasonV1::FilterInvalid => counts.filter_invalid = 1,
        SupportLossReasonV1::SequenceExhausted => counts.sequence_exhausted = 1,
    }
    counts
}

#[test]
fn child_health_preserves_exact_pr5_failure_accounting() {
    for (fallback_write_failures, dropped_fallback_write_failures) in [(1, 0), (0, 1)] {
        let mut snapshot = no_evidence_skeleton();
        let mut child = super::protocol_tests::child_snapshot(SupportChildComponentV1::Anyharness);
        child.fallback_write_failures = fallback_write_failures;
        child.dropped_by_reason.fallback_write_failed = dropped_fallback_write_failures;
        snapshot.producer_health.anyharness = SupportChildProducerStatusV1::Available {
            captured_at: TS.to_string(),
            snapshot: child,
        };
        stabilize_serialized_bytes(&mut snapshot).expect("stabilize");
        assert_eq!(
            validate_snapshot(&snapshot),
            Err(SupportSchemaError::InvariantViolation(
                "child fallback-write failure accounting"
            ))
        );
    }

    let reasons = [
        SupportLossReasonV1::QueueRecords,
        SupportLossReasonV1::QueueBytes,
        SupportLossReasonV1::ProtectedEviction,
        SupportLossReasonV1::Pressure,
        SupportLossReasonV1::GenerationChanged,
        SupportLossReasonV1::TransportTimeout,
        SupportLossReasonV1::TransportFailure,
        SupportLossReasonV1::ReceiptInvalid,
        SupportLossReasonV1::ReceiptRejected,
        SupportLossReasonV1::FallbackOverflow,
        SupportLossReasonV1::FallbackWriteFailed,
        SupportLossReasonV1::ShutdownTimeout,
        SupportLossReasonV1::FilterInvalid,
        SupportLossReasonV1::SequenceExhausted,
    ];
    for reason in reasons {
        let mut missing_count = no_evidence_skeleton();
        let mut child = super::protocol_tests::child_snapshot(SupportChildComponentV1::Anyharness);
        child.last_failure = Some(reason);
        missing_count.producer_health.anyharness = SupportChildProducerStatusV1::Available {
            captured_at: TS.to_string(),
            snapshot: child,
        };
        stabilize_serialized_bytes(&mut missing_count).expect("stabilize");
        assert_eq!(
            validate_snapshot(&missing_count),
            Err(SupportSchemaError::InvariantViolation(
                "child last-failure accounting"
            )),
            "{reason:?}"
        );

        let mut accounted = no_evidence_skeleton();
        let mut child = super::protocol_tests::child_snapshot(SupportChildComponentV1::Anyharness);
        child.last_failure = Some(reason);
        child.dropped_by_reason = loss_counts_with(reason);
        child.fallback_write_failures = child.dropped_by_reason.fallback_write_failed;
        accounted.producer_health.anyharness = SupportChildProducerStatusV1::Available {
            captured_at: TS.to_string(),
            snapshot: child,
        };
        stabilize_serialized_bytes(&mut accounted).expect("stabilize");
        validate_snapshot(&accounted).unwrap_or_else(|error| panic!("{reason:?}: {error}"));
    }
}

#[test]
fn session_summary_endpoint_states_match_optional_summary_presence() {
    let mut placeholder = super::evidence_tests::session("session-1");
    placeholder.endpoint_states.summary = SupportEndpointStateV1::LimitUncertain;
    placeholder.endpoint_states.events = SupportEndpointStateV1::Included;
    placeholder.normalized_events = vec![SupportJsonValueV1::Object(vec![(
        "seq".to_string(),
        SupportJsonValueV1::Integer(1),
    )])];
    let mut snapshot = no_evidence_skeleton();
    snapshot.consent.selection = SupportSessionSelectionV1::ActiveSession;
    snapshot.selection.workspace_id = Some("workspace-1".to_string());
    snapshot.selection.anyharness_workspace_id = Some("runtime-workspace-1".to_string());
    snapshot.selection.ui_session_id = Some("ui-session-1".to_string());
    snapshot.selection.materialized_session_id = Some("session-1".to_string());
    snapshot.session_ledger = Some(SupportSessionLedgerV1 {
        workspace_id: "workspace-1".to_string(),
        anyharness_workspace_id: "runtime-workspace-1".to_string(),
        selection: SupportSessionSelectionV1::ActiveSession,
        sessions: vec![placeholder],
    });
    snapshot.manifest.session_collection = SupportSessionCollectionManifestV1::Included {
        workspace_id: "workspace-1".to_string(),
        anyharness_workspace_id: "runtime-workspace-1".to_string(),
        selected_sessions: 1,
        session_included_bytes: 0,
        event_included_bytes: 1,
        raw_notification_included_bytes: 0,
        limit_uncertain_endpoints: 1,
    };
    set_manifest_source(
        &mut snapshot,
        SupportSourceManifestSourceV1::SessionLedger,
        SupportSourceStateV1::Included,
        1,
        1,
        1,
    );
    stabilize_serialized_bytes(&mut snapshot).expect("stabilize");
    validate_snapshot(&snapshot).expect("active placeholder retains collected events");

    for state in [
        SupportEndpointStateV1::Included,
        SupportEndpointStateV1::Omitted,
    ] {
        let mut summary = super::evidence_tests::session("session-1");
        summary.endpoint_states.summary = state;
        if state == SupportEndpointStateV1::Omitted {
            summary.summary = Some(SupportJsonValueV1::Null);
        }
        let mut snapshot = no_evidence_skeleton();
        super::evidence_tests::bind_recent_ledger(&mut snapshot, vec![summary]);
        stabilize_serialized_bytes(&mut snapshot).expect("stabilize");
        assert_eq!(
            validate_snapshot(&snapshot),
            Err(SupportSchemaError::InvariantViolation(
                "session summary endpoint state"
            ))
        );
    }

    let mut summary = super::evidence_tests::session("session-1");
    summary.summary = Some(SupportJsonValueV1::Null);
    summary.endpoint_states.summary = SupportEndpointStateV1::LimitUncertain;
    let mut snapshot = no_evidence_skeleton();
    super::evidence_tests::bind_recent_ledger(&mut snapshot, vec![summary]);
    let SupportSessionCollectionManifestV1::Included {
        session_included_bytes,
        limit_uncertain_endpoints,
        ..
    } = &mut snapshot.manifest.session_collection
    else {
        unreachable!()
    };
    *session_included_bytes = 1;
    *limit_uncertain_endpoints = 1;
    set_manifest_source(
        &mut snapshot,
        SupportSourceManifestSourceV1::SessionLedger,
        SupportSourceStateV1::Included,
        1,
        1,
        1,
    );
    stabilize_serialized_bytes(&mut snapshot).expect("stabilize");
    validate_snapshot(&snapshot).expect("limit-uncertain summary may be present");
}
