use proliferate_diagnostics_protocol::v1::limits::{CURRENT_SCHEMA_VERSION, MAX_EXPORT_RECORDS};
use proliferate_diagnostics_protocol::v1::types::{
    CollectorAcceptedRecordV1, ComponentV1, ExportManifestV1, ExportPurposeV1, ExportStreamFrameV1,
    GapV1, HealthResponseV1, RecordClassV1, RedactionClassificationV1, VersionCountV1,
};
use serde_json::Value;
use tokio::time::{Duration, Instant};

use super::validation::SupportExportAccumulator;
use super::*;

pub(super) const FROM: &str = "2026-08-10T13:45:00.000Z";
pub(super) const TO: &str = "2026-08-10T14:00:00.000Z";

fn fixture() -> Value {
    serde_json::from_str(include_str!(
        "../../../../../fixtures/contracts/rust-observability-v1/valid/api.json"
    ))
    .expect("contract fixture")
}

fn record() -> CollectorAcceptedRecordV1 {
    serde_json::from_value(fixture()["collector_record"].clone()).expect("accepted record")
}

fn health() -> HealthResponseV1 {
    serde_json::from_value(fixture()["health"].clone()).expect("health")
}

fn issued() -> (SupportExportRequest, SupportExportPermit) {
    SupportExportPermit::issue(
        &uuid::Uuid::new_v4().to_string(),
        FROM.to_string(),
        TO.to_string(),
        Instant::now() + Duration::from_secs(25),
    )
    .expect("support authority")
}

pub(super) fn frames(
    request: &ExportRequestV1,
) -> (
    ExportStreamFrameV1,
    ExportStreamFrameV1,
    ExportStreamFrameV1,
    ExportStreamFrameV1,
) {
    let record = record();
    let bytes = serde_json::to_vec(&record).expect("record JSON").len() as u64;
    let manifest = ExportManifestV1 {
        schema_version: CURRENT_SCHEMA_VERSION,
        snapshot_id: format!("snapshot-{}", uuid::Uuid::new_v4()),
        generated_at: TO.to_string(),
        record_count: 1,
        byte_count: bytes,
        cursor_start: Some(record.retention_cursor),
        cursor_end: Some(record.retention_cursor),
        gaps: Vec::new(),
        versions_present: vec![VersionCountV1 {
            version: record.record.schema_version,
            records: 1,
        }],
        filters: request.filters.clone(),
        redaction: RedactionClassificationV1::SupportExport,
        includes_health: true,
    };
    (
        ExportStreamFrameV1::Manifest { manifest },
        ExportStreamFrameV1::Record { record },
        ExportStreamFrameV1::Health { health: health() },
        ExportStreamFrameV1::End { records: 1, bytes },
    )
}

#[test]
fn issuer_pins_the_exact_support_request_without_exposing_a_raw_constructor() {
    let (request, permit) = issued();
    let collector = &request.collector;
    assert_eq!(collector.schema_version, CURRENT_SCHEMA_VERSION);
    assert_eq!(collector.purpose, ExportPurposeV1::Support);
    assert!(collector
        .support_authorization_id
        .as_deref()
        .is_some_and(|id| uuid::Uuid::parse_str(id).is_ok_and(|parsed| parsed.to_string() == id)));
    assert_eq!(
        collector.filters.components,
        [
            ComponentV1::DesktopRenderer,
            ComponentV1::DesktopTauri,
            ComponentV1::DiagnosticsCollector,
            ComponentV1::Anyharness,
            ComponentV1::DesktopWorker,
        ]
    );
    assert_eq!(
        collector.filters.record_classes,
        [RecordClassV1::Detailed, RecordClassV1::Lifecycle]
    );
    assert!(collector.filters.session_id.is_none());
    assert_eq!(collector.record_limit, MAX_EXPORT_RECORDS);
    assert_eq!(collector.byte_limit, 16_777_216);
    assert!(collector.include_health);
    assert!(permit.consume(&request).is_ok());
}

#[test]
fn permit_is_exact_request_preparation_and_deadline_bound() {
    let (mut request, permit) = issued();
    request.collector.record_limit -= 1;
    assert!(matches!(
        permit.consume(&request),
        Err(SupportExportError::InvalidAuthority)
    ));

    let (mut request, permit) = issued();
    request.preparation_id = uuid::Uuid::new_v4().to_string();
    assert!(matches!(
        permit.consume(&request),
        Err(SupportExportError::InvalidAuthority)
    ));

    let (mut request, permit) = issued();
    request.expires_at += Duration::from_secs(1);
    assert!(matches!(
        permit.consume(&request),
        Err(SupportExportError::InvalidAuthority)
    ));
}

#[test]
fn issuer_rejects_noncanonical_preparation_and_nonexact_window() {
    assert!(SupportExportPermit::issue(
        "not-a-uuid",
        FROM.to_string(),
        TO.to_string(),
        Instant::now() + Duration::from_secs(25),
    )
    .is_err());
    assert!(SupportExportPermit::issue(
        &uuid::Uuid::new_v4().to_string(),
        "2026-08-10T13:44:59.000Z".to_string(),
        TO.to_string(),
        Instant::now() + Duration::from_secs(25),
    )
    .is_err());
    assert!(SupportExportPermit::issue(
        &uuid::Uuid::new_v4().to_string(),
        "2026-08-10T06:45:00.000-07:00".to_string(),
        "2026-08-10T07:00:00.000-07:00".to_string(),
        Instant::now() + Duration::from_secs(25),
    )
    .is_err());
    assert!(SupportExportPermit::issue(
        &uuid::Uuid::new_v4().to_string(),
        "2026-08-10T13:45:00Z".to_string(),
        "2026-08-10T14:00:00Z".to_string(),
        Instant::now() + Duration::from_secs(25),
    )
    .is_err());
}

#[test]
fn complete_stream_requires_manifest_records_health_end_and_eof() {
    let (request, _) = issued();
    let mut accumulator = SupportExportAccumulator::new(request.collector.clone()).unwrap();
    let (manifest, record, health, end) = frames(&request.collector);
    accumulator.push(manifest).unwrap();
    accumulator.push(record).unwrap();
    accumulator.push(health).unwrap();
    accumulator.push(end).unwrap();
    let validated = accumulator.finish().expect("validated complete stream");
    assert_eq!(validated.records.len(), 1);
    assert!(validated.gaps.is_empty());
    assert_eq!(validated.manifest.record_count, 1);
    assert_eq!(validated.health.newest_cursor, Some(41));
}

#[test]
fn empty_stream_preserves_null_cursors_and_valid_health() {
    let (request, _) = issued();
    let manifest = ExportManifestV1 {
        schema_version: CURRENT_SCHEMA_VERSION,
        snapshot_id: format!("snapshot-{}", uuid::Uuid::new_v4()),
        generated_at: TO.to_string(),
        record_count: 0,
        byte_count: 0,
        cursor_start: None,
        cursor_end: None,
        gaps: Vec::new(),
        versions_present: Vec::new(),
        filters: request.collector.filters.clone(),
        redaction: RedactionClassificationV1::SupportExport,
        includes_health: true,
    };
    let mut accumulator = SupportExportAccumulator::new(request.collector).unwrap();
    accumulator
        .push(ExportStreamFrameV1::Manifest { manifest })
        .unwrap();
    accumulator
        .push(ExportStreamFrameV1::Health { health: health() })
        .unwrap();
    accumulator
        .push(ExportStreamFrameV1::End {
            records: 0,
            bytes: 0,
        })
        .unwrap();
    let validated = accumulator.finish().expect("empty export is valid");
    assert!(validated.records.is_empty());
    assert_eq!(validated.manifest.cursor_start, None);
    assert_eq!(validated.manifest.cursor_end, None);
}

#[test]
fn partial_reordered_and_post_end_streams_fail_closed() {
    let (request, _) = issued();
    let (manifest, record, health, end) = frames(&request.collector);
    let mut partial = SupportExportAccumulator::new(request.collector.clone()).unwrap();
    partial.push(manifest.clone()).unwrap();
    partial.push(record.clone()).unwrap();
    assert!(matches!(
        partial.finish(),
        Err(SupportExportError::InvalidStream)
    ));

    let mut reordered = SupportExportAccumulator::new(request.collector.clone()).unwrap();
    assert!(reordered.push(record).is_err());

    let mut post_end = SupportExportAccumulator::new(request.collector.clone()).unwrap();
    post_end.push(manifest).unwrap();
    post_end.push(health).unwrap();
    post_end.push(end).unwrap();
    assert!(post_end
        .push(ExportStreamFrameV1::Health { health: health() })
        .is_err());
}

#[test]
fn accepted_order_must_be_strictly_ascending() {
    let (request, _) = issued();
    let (manifest, first, _, _) = frames(&request.collector);
    let ExportStreamFrameV1::Record { mut record } = first.clone() else {
        unreachable!("record frame")
    };
    record.accepted_order -= 1;
    record.retention_cursor += 1;
    let mut accumulator = SupportExportAccumulator::new(request.collector).unwrap();
    accumulator.push(manifest).unwrap();
    accumulator.push(first).unwrap();
    assert!(accumulator
        .push(ExportStreamFrameV1::Record { record })
        .is_err());
}

#[test]
fn counts_bytes_snapshot_gaps_versions_and_cursor_fence_are_exact() {
    let (request, _) = issued();
    let (mut manifest, record, health_frame, end) = frames(&request.collector);
    if let ExportStreamFrameV1::Manifest { manifest } = &mut manifest {
        manifest.byte_count += 1;
    }
    let mut bad_bytes = SupportExportAccumulator::new(request.collector.clone()).unwrap();
    for frame in [manifest, record.clone(), health_frame.clone(), end.clone()] {
        bad_bytes.push(frame).unwrap();
    }
    assert!(bad_bytes.finish().is_err());

    let (mut manifest, record, health_frame, end) = frames(&request.collector);
    if let ExportStreamFrameV1::Manifest { manifest } = &mut manifest {
        manifest.record_count = 2;
    }
    let mut bad_count = SupportExportAccumulator::new(request.collector.clone()).unwrap();
    for frame in [manifest, record, health_frame, end] {
        bad_count.push(frame).unwrap();
    }
    assert!(bad_count.finish().is_err());

    let (mut manifest, record, health_frame, end) = frames(&request.collector);
    if let ExportStreamFrameV1::Manifest { manifest } = &mut manifest {
        manifest.versions_present[0].records = 2;
    }
    let mut bad_versions = SupportExportAccumulator::new(request.collector.clone()).unwrap();
    for frame in [manifest, record, health_frame, end] {
        bad_versions.push(frame).unwrap();
    }
    assert!(bad_versions.finish().is_err());

    let (mut manifest, _, _, _) = frames(&request.collector);
    if let ExportStreamFrameV1::Manifest { manifest } = &mut manifest {
        manifest.snapshot_id = "snapshot-not-canonical".to_string();
    }
    let mut bad_snapshot = SupportExportAccumulator::new(request.collector.clone()).unwrap();
    assert!(bad_snapshot.push(manifest).is_err());

    let (manifest, record, mut health_frame, end) = frames(&request.collector);
    if let ExportStreamFrameV1::Health { health } = &mut health_frame {
        health.newest_cursor = Some(40);
    }
    let mut bad_fence = SupportExportAccumulator::new(request.collector.clone()).unwrap();
    for frame in [manifest, record, health_frame, end] {
        bad_fence.push(frame).unwrap();
    }
    assert!(bad_fence.finish().is_err());
}

#[test]
fn manifest_and_stream_gap_lists_must_match_exactly() {
    let (request, _) = issued();
    let (mut manifest, record, health, end) = frames(&request.collector);
    let gap: GapV1 =
        serde_json::from_value(fixture()["export_frames"][2]["gap"].clone()).expect("gap fixture");
    if let ExportStreamFrameV1::Manifest { manifest } = &mut manifest {
        manifest.gaps.push(gap.clone());
    }
    let mut accumulator = SupportExportAccumulator::new(request.collector.clone()).unwrap();
    for frame in [
        manifest,
        record,
        ExportStreamFrameV1::Gap { gap },
        health,
        end,
    ] {
        accumulator.push(frame).unwrap();
    }
    assert!(accumulator.finish().is_ok());
}
