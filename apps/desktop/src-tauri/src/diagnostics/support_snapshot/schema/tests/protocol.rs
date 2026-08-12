use super::{empty_coverage, no_evidence_skeleton, set_manifest_source, TS, WINDOW_START};

use proliferate_diagnostics_protocol::v1::types::{
    ArgumentValueV1, CollectorAcceptedRecordV1, ComponentV1, ExportManifestV1, HealthResponseV1,
    PrivacyClassificationV1, RecordClassV1, RecordsFilterV1, RedactionClassificationV1, SourceV1,
    TypedArgumentV1,
};

use crate::diagnostics::support_snapshot::schema::enums::{
    SupportChildComponentV1, SupportCollectorCompletenessV1, SupportCollectorStatusV1,
    SupportFallbackDispositionV1, SupportFallbackRecordComponentV1, SupportPr5FallbackReasonV1,
    SupportSourceManifestSourceV1, SupportSourceStateV1,
};
use crate::diagnostics::support_snapshot::schema::limits::MAX_SAFE_INTEGER;
use crate::diagnostics::support_snapshot::schema::model::evidence::{
    SupportFallbackComponentV1, SupportFallbackRecordV1,
};
use crate::diagnostics::support_snapshot::schema::model::health::{
    DesktopDiagnosticsHealthV1, DesktopDiagnosticsSupervisorStateV1, SupportChildCollectorStateV1,
    SupportChildProducerSnapshotV1, SupportChildProducerStatusV1, SupportLossCountsV1,
    SupportOmittedProducerStatusV1, SupportTauriProducerHealthV1,
};
use crate::diagnostics::support_snapshot::schema::model::snapshot::SupportSnapshotV3;
use crate::diagnostics::support_snapshot::schema::validate::{
    stabilize_serialized_bytes, validate_collector_evidence, validate_snapshot, SupportSchemaError,
};

fn contract_api() -> serde_json::Value {
    serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../fixtures/contracts/rust-observability-v1/valid/api.json"
    )))
    .expect("accepted protocol fixture")
}

pub(super) fn accepted_record() -> CollectorAcceptedRecordV1 {
    serde_json::from_value(contract_api()["collector_record"].clone()).expect("accepted record")
}

fn export_manifest() -> ExportManifestV1 {
    serde_json::from_value(contract_api()["export_manifest"].clone()).expect("export manifest")
}

fn export_health() -> HealthResponseV1 {
    serde_json::from_value(contract_api()["health"].clone()).expect("export health")
}

fn exact_filters() -> RecordsFilterV1 {
    RecordsFilterV1 {
        source_time_from: Some(WINDOW_START.to_string()),
        source_time_to: Some(TS.to_string()),
        components: vec![
            ComponentV1::DesktopRenderer,
            ComponentV1::DesktopTauri,
            ComponentV1::DiagnosticsCollector,
            ComponentV1::Anyharness,
            ComponentV1::DesktopWorker,
        ],
        record_classes: vec![RecordClassV1::Detailed, RecordClassV1::Lifecycle],
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

pub(super) fn completed_snapshot() -> SupportSnapshotV3 {
    let mut snapshot = no_evidence_skeleton();
    let mut record = accepted_record();
    record.record.source_timestamp = "2026-08-11T23:50:00Z".to_string();
    record.record.redaction = RedactionClassificationV1::SupportExport;
    record.accepted_timestamp = "2026-08-11T23:50:00.010Z".to_string();

    let mut manifest = export_manifest();
    manifest.snapshot_id = snapshot.snapshot_id.clone();
    manifest.generated_at = TS.to_string();
    manifest.record_count = 1;
    manifest.byte_count = 733;
    manifest.cursor_start = Some(41);
    manifest.cursor_end = Some(41);
    manifest.gaps.clear();
    manifest.filters = exact_filters();
    manifest.redaction = RedactionClassificationV1::SupportExport;
    manifest.includes_health = true;

    let mut health = export_health();
    health.oldest_cursor = Some(11);
    health.newest_cursor = Some(41);

    let mut coverage = empty_coverage();
    coverage.status = SupportCollectorStatusV1::Complete;
    coverage.completeness = SupportCollectorCompletenessV1::Complete;
    coverage.returned_records = 1;
    coverage.returned_record_bytes = 733;
    coverage.cursor_start = Some(41);
    coverage.cursor_end = Some(41);
    coverage.health_oldest_cursor = health.oldest_cursor;
    coverage.health_newest_cursor = health.newest_cursor;

    snapshot.collector.coverage = coverage.clone();
    snapshot.collector.export_manifest = Some(manifest);
    snapshot.collector.export_health = Some(health);
    snapshot.records = vec![record];
    snapshot.manifest.collector = coverage;
    snapshot.manifest.omissions.clear();
    set_manifest_source(
        &mut snapshot,
        SupportSourceManifestSourceV1::Collector,
        SupportSourceStateV1::Included,
        733,
        733,
        1,
    );
    stabilize_serialized_bytes(&mut snapshot).expect("completed byte fixed point");
    snapshot
}

#[test]
fn completed_collector_protocol_fixture_validates_end_to_end() {
    let snapshot = completed_snapshot();
    validate_snapshot(&snapshot).expect("accepted record, manifest, and health remain valid");
    let value = serde_json::to_value(&snapshot).expect("snapshot JSON");
    assert_eq!(value["records"][0]["accepted_order"], 41);
    assert_eq!(value["collector"]["coverage"]["cursorStart"], 41);
    assert_eq!(
        value["collector"]["exportManifest"]["filters"]["components"],
        serde_json::json!([
            "desktop_renderer",
            "desktop_tauri",
            "diagnostics_collector",
            "anyharness",
            "desktop_worker"
        ])
    );
}

#[test]
fn selected_collector_records_remain_strictly_accepted_order_ascending() {
    let mut over_cap = completed_snapshot();
    over_cap.records = vec![over_cap.records[0].clone(); 10_001];
    assert_eq!(
        validate_snapshot(&over_cap),
        Err(SupportSchemaError::CapExceeded("snapshot.records"))
    );

    let mut snapshot = completed_snapshot();
    let mut earlier = snapshot.records[0].clone();
    earlier.accepted_order -= 1;
    earlier.retention_cursor -= 1;
    snapshot.records.push(earlier);
    stabilize_serialized_bytes(&mut snapshot).expect("stabilize");
    assert_eq!(
        validate_snapshot(&snapshot),
        Err(SupportSchemaError::InvariantViolation(
            "accepted record ordering"
        ))
    );
}

#[test]
fn collector_version_presence_is_positive_unique_ordered_and_exact() {
    let mut snapshot = completed_snapshot();
    let mut duplicate = snapshot
        .collector
        .export_manifest
        .as_ref()
        .expect("manifest")
        .versions_present[0]
        .clone();
    duplicate.records = 0;
    snapshot
        .collector
        .export_manifest
        .as_mut()
        .expect("manifest")
        .versions_present
        .push(duplicate);
    stabilize_serialized_bytes(&mut snapshot).expect("stabilize");
    assert_eq!(
        validate_snapshot(&snapshot),
        Err(SupportSchemaError::InvariantViolation(
            "collector export version counts/order"
        ))
    );
}

#[test]
fn accepted_protocol_integer_must_also_be_nonnegative_for_support() {
    let mut snapshot = completed_snapshot();
    snapshot.records[0].record.arguments.push(TypedArgumentV1 {
        name: "attempt".to_string(),
        privacy: PrivacyClassificationV1::Operational,
        value: ArgumentValueV1::Integer(-1),
    });
    stabilize_serialized_bytes(&mut snapshot).expect("stabilize");
    assert_eq!(
        validate_snapshot(&snapshot),
        Err(SupportSchemaError::InvalidProtocolValue("snapshot.records"))
    );

    let mut snapshot = completed_snapshot();
    snapshot.records[0].record.operation_id.clear();
    stabilize_serialized_bytes(&mut snapshot).expect("stabilize");
    assert_eq!(
        validate_snapshot(&snapshot),
        Err(SupportSchemaError::InvalidProtocolValue("snapshot.records"))
    );
}

#[test]
fn support_overlay_rejects_shape_only_protocol_timestamps() {
    let mut snapshot = completed_snapshot();
    snapshot.records[0].accepted_timestamp = "2026-02-30T00:00:00Z".to_string();
    stabilize_serialized_bytes(&mut snapshot).expect("stabilize");
    assert_eq!(
        validate_snapshot(&snapshot),
        Err(SupportSchemaError::InvalidTimestamp)
    );

    let mut snapshot = completed_snapshot();
    snapshot
        .collector
        .export_manifest
        .as_mut()
        .expect("manifest")
        .generated_at = "2026-13-01T00:00:00Z".to_string();
    stabilize_serialized_bytes(&mut snapshot).expect("stabilize");
    assert_eq!(
        validate_snapshot(&snapshot),
        Err(SupportSchemaError::InvalidTimestamp)
    );

    let mut snapshot = completed_snapshot();
    snapshot
        .collector
        .export_manifest
        .as_mut()
        .expect("manifest")
        .snapshot_id
        .clear();
    stabilize_serialized_bytes(&mut snapshot).expect("stabilize");
    assert_eq!(
        validate_snapshot(&snapshot),
        Err(SupportSchemaError::InvalidProtocolValue(
            "collector.exportManifest"
        ))
    );
}

#[test]
fn nested_protocol_health_and_gap_values_are_revalidated() {
    let mut evidence = completed_snapshot().collector;
    evidence
        .export_health
        .as_mut()
        .expect("health")
        .exporter
        .dropped_records = MAX_SAFE_INTEGER + 1;
    assert_eq!(
        validate_collector_evidence(&evidence),
        Err(SupportSchemaError::InvalidProtocolValue(
            "collector.exportHealth"
        ))
    );

    let mut snapshot = completed_snapshot();
    let mut gap = super::manifest_gap();
    gap.producer_boot_id = Some(String::new());
    snapshot.collector.gaps.push(gap.clone());
    snapshot.manifest.gaps.push(gap);
    stabilize_serialized_bytes(&mut snapshot).expect("stabilize");
    assert_eq!(
        validate_snapshot(&snapshot),
        Err(SupportSchemaError::InvalidProtocolValue("collector.gaps"))
    );
}

#[test]
fn structured_fallback_records_validate_protocol_and_family_identity() {
    let mut snapshot = no_evidence_skeleton();
    let mut record = accepted_record().record;
    record.source_timestamp = "2026-08-11T23:50:00Z".to_string();
    record.redaction = RedactionClassificationV1::SupportExport;
    snapshot.fallback_evidence = vec![SupportFallbackComponentV1::Pr3DesktopNativeMixed {
        records: vec![SupportFallbackRecordV1 {
            component: SupportFallbackRecordComponentV1::DesktopTauri,
            disposition: SupportFallbackDispositionV1::NotCollectorAccepted,
            fallback_reason: None,
            record,
            segment: 3,
            line: 1,
        }],
        opaque_lines: Vec::new(),
    }];
    set_manifest_source(
        &mut snapshot,
        SupportSourceManifestSourceV1::DesktopNativeFallback,
        SupportSourceStateV1::Included,
        1,
        1,
        1,
    );
    stabilize_serialized_bytes(&mut snapshot).expect("stabilize");
    validate_snapshot(&snapshot).expect("valid PR3 structured fallback");

    if let SupportFallbackComponentV1::Pr3DesktopNativeMixed { records, .. } =
        &mut snapshot.fallback_evidence[0]
    {
        records[0].component = SupportFallbackRecordComponentV1::Anyharness;
    }
    stabilize_serialized_bytes(&mut snapshot).expect("stabilize");
    assert_eq!(
        validate_snapshot(&snapshot),
        Err(SupportSchemaError::InvariantViolation(
            "fallback record component identity"
        ))
    );

    if let SupportFallbackComponentV1::Pr3DesktopNativeMixed { records, .. } =
        &mut snapshot.fallback_evidence[0]
    {
        records[0].component = SupportFallbackRecordComponentV1::DesktopTauri;
        records[0].record.operation_id.clear();
    }
    stabilize_serialized_bytes(&mut snapshot).expect("stabilize");
    assert_eq!(
        validate_snapshot(&snapshot),
        Err(SupportSchemaError::InvalidProtocolValue("fallback record"))
    );
}

#[test]
fn structured_fallback_records_require_canonical_group_and_sequence_order() {
    let mut snapshot = no_evidence_skeleton();
    let mut record = accepted_record().record;
    record.source_timestamp = "2026-08-11T23:50:00Z".to_string();
    record.redaction = RedactionClassificationV1::SupportExport;
    let mut later = SupportFallbackRecordV1 {
        component: SupportFallbackRecordComponentV1::DesktopTauri,
        disposition: SupportFallbackDispositionV1::NotCollectorAccepted,
        fallback_reason: None,
        record: record.clone(),
        segment: 3,
        line: 2,
    };
    later.record.producer_sequence = 2;
    let mut earlier = later.clone();
    earlier.record.producer_sequence = 1;
    earlier.line = 1;
    snapshot.fallback_evidence = vec![SupportFallbackComponentV1::Pr3DesktopNativeMixed {
        records: vec![later, earlier],
        opaque_lines: Vec::new(),
    }];
    stabilize_serialized_bytes(&mut snapshot).expect("stabilize");
    assert_eq!(
        validate_snapshot(&snapshot),
        Err(SupportSchemaError::InvariantViolation(
            "fallback record order"
        ))
    );

    let SupportFallbackComponentV1::Pr3DesktopNativeMixed { records, .. } =
        &mut snapshot.fallback_evidence[0]
    else {
        unreachable!()
    };
    records.clear();
    record.component = ComponentV1::Anyharness;
    record.source = SourceV1::Anyharness;
    records.push(SupportFallbackRecordV1 {
        component: SupportFallbackRecordComponentV1::Anyharness,
        disposition: SupportFallbackDispositionV1::NotCollectorAccepted,
        fallback_reason: None,
        record,
        segment: 0,
        line: 1,
    });
    stabilize_serialized_bytes(&mut snapshot).expect("stabilize");
    assert_eq!(
        validate_snapshot(&snapshot),
        Err(SupportSchemaError::InvariantViolation(
            "pr3 fallback family identity"
        ))
    );
}

pub(super) fn child_snapshot(component: SupportChildComponentV1) -> SupportChildProducerSnapshotV1 {
    SupportChildProducerSnapshotV1 {
        component,
        producer_boot_id: "producer-boot-1".to_string(),
        last_assigned_sequence: None,
        next_sequence: Some(1),
        collector_state: SupportChildCollectorStateV1::Unavailable,
        resident_records: 0,
        resident_bytes: 0,
        in_flight: false,
        fallback_active: false,
        fallback_bytes: 0,
        fallback_write_failures: 0,
        dropped_by_reason: SupportLossCountsV1::default(),
        fallback_routed: 0,
        delivery_fence_eligible: true,
        last_failure: None,
    }
}

#[test]
fn child_health_validates_component_sequence_collector_and_all_counters() {
    let mut snapshot = no_evidence_skeleton();
    snapshot.producer_health.anyharness = SupportChildProducerStatusV1::Available {
        captured_at: TS.to_string(),
        snapshot: child_snapshot(SupportChildComponentV1::Anyharness),
    };
    stabilize_serialized_bytes(&mut snapshot).expect("stabilize");
    validate_snapshot(&snapshot).expect("valid child snapshot");

    if let SupportChildProducerStatusV1::Available {
        snapshot: child, ..
    } = &mut snapshot.producer_health.anyharness
    {
        child.dropped_by_reason.transport_failure = MAX_SAFE_INTEGER + 1;
    }
    stabilize_serialized_bytes(&mut snapshot).expect("stabilize");
    assert_eq!(
        validate_snapshot(&snapshot),
        Err(SupportSchemaError::UnsafeInteger)
    );

    if let SupportChildProducerStatusV1::Available {
        snapshot: child, ..
    } = &mut snapshot.producer_health.anyharness
    {
        child.dropped_by_reason.transport_failure = 0;
        child.component = SupportChildComponentV1::DesktopWorker;
    }
    stabilize_serialized_bytes(&mut snapshot).expect("stabilize");
    assert_eq!(
        validate_snapshot(&snapshot),
        Err(SupportSchemaError::InvariantViolation(
            "child producer component identity"
        ))
    );

    let mut snapshot = no_evidence_skeleton();
    let mut child = child_snapshot(SupportChildComponentV1::Anyharness);
    child.collector_state = SupportChildCollectorStateV1::Ready {
        collector_boot_id: String::new(),
        generation_number: 1,
    };
    snapshot.producer_health.anyharness = SupportChildProducerStatusV1::Available {
        captured_at: TS.to_string(),
        snapshot: child,
    };
    stabilize_serialized_bytes(&mut snapshot).expect("stabilize");
    assert_eq!(
        validate_snapshot(&snapshot),
        Err(SupportSchemaError::OversizedId)
    );

    if let SupportChildProducerStatusV1::Available {
        snapshot: child, ..
    } = &mut snapshot.producer_health.anyharness
    {
        child.collector_state = SupportChildCollectorStateV1::Ready {
            collector_boot_id: "collector-boot-1".to_string(),
            generation_number: MAX_SAFE_INTEGER + 1,
        };
    }
    stabilize_serialized_bytes(&mut snapshot).expect("stabilize");
    assert_eq!(
        validate_snapshot(&snapshot),
        Err(SupportSchemaError::UnsafeInteger)
    );
}

#[test]
fn native_health_requires_nested_boot_restart_and_fallback_identity() {
    let mut snapshot = completed_snapshot();
    let mut health = snapshot
        .collector
        .export_health
        .as_ref()
        .expect("health")
        .clone();
    health.status = proliferate_diagnostics_protocol::v1::types::HealthStatusV1::Ready;
    let desktop = DesktopDiagnosticsHealthV1 {
        supervisor: DesktopDiagnosticsSupervisorStateV1::Ready {
            collector_boot_id: health.collector_boot_id.clone(),
            schema_major: 1,
            restart_count: health.restart_count,
        },
        fallback: health.fallback.clone(),
        collector: Some(health),
    };
    snapshot.collector.desktop_health = Some(desktop.clone());
    snapshot.producer_health.tauri = SupportTauriProducerHealthV1::SupervisorOnly {
        desktop_health: desktop,
        producer_status: SupportOmittedProducerStatusV1::default(),
    };
    stabilize_serialized_bytes(&mut snapshot).expect("stabilize");
    validate_snapshot(&snapshot).expect("coherent native health");

    let mut unsafe_fallback = snapshot.clone();
    unsafe_fallback
        .collector
        .desktop_health
        .as_mut()
        .expect("desktop health")
        .fallback
        .bytes = MAX_SAFE_INTEGER + 1;
    stabilize_serialized_bytes(&mut unsafe_fallback).expect("stabilize");
    assert_eq!(
        validate_snapshot(&unsafe_fallback),
        Err(SupportSchemaError::UnsafeInteger)
    );

    let SupportTauriProducerHealthV1::SupervisorOnly { desktop_health, .. } =
        &mut snapshot.producer_health.tauri
    else {
        unreachable!()
    };
    let Some(collector) = &mut desktop_health.collector else {
        unreachable!()
    };
    collector.restart_count += 1;
    snapshot.collector.desktop_health = Some(desktop_health.clone());
    stabilize_serialized_bytes(&mut snapshot).expect("stabilize");
    assert_eq!(
        validate_snapshot(&snapshot),
        Err(SupportSchemaError::InvariantViolation(
            "desktopHealth ready collector identity"
        ))
    );
}

#[test]
fn pr5_fallback_requires_reason_and_exact_child_family() {
    let mut snapshot = no_evidence_skeleton();
    let mut record = accepted_record().record;
    record.source_timestamp = "2026-08-11T23:50:00Z".to_string();
    record.component = ComponentV1::Anyharness;
    record.source = SourceV1::Anyharness;
    record.redaction = RedactionClassificationV1::SupportExport;
    snapshot.fallback_evidence = vec![SupportFallbackComponentV1::Pr5Wrapped {
        component: SupportChildComponentV1::Anyharness,
        records: vec![SupportFallbackRecordV1 {
            component: SupportFallbackRecordComponentV1::Anyharness,
            disposition: SupportFallbackDispositionV1::NotCollectorAccepted,
            fallback_reason: Some(SupportPr5FallbackReasonV1::CollectorUnavailable),
            record,
            segment: 0,
            line: 1,
        }],
        opaque_lines: Vec::new(),
    }];
    set_manifest_source(
        &mut snapshot,
        SupportSourceManifestSourceV1::AnyharnessFallback,
        SupportSourceStateV1::Included,
        1,
        1,
        1,
    );
    stabilize_serialized_bytes(&mut snapshot).expect("stabilize");
    validate_snapshot(&snapshot).expect("valid PR5 fallback wrapper");

    let SupportFallbackComponentV1::Pr5Wrapped { records, .. } = &mut snapshot.fallback_evidence[0]
    else {
        unreachable!()
    };
    records[0].fallback_reason = None;
    stabilize_serialized_bytes(&mut snapshot).expect("stabilize");
    assert_eq!(
        validate_snapshot(&snapshot),
        Err(SupportSchemaError::InvariantViolation(
            "pr5 fallback family identity"
        ))
    );
}
