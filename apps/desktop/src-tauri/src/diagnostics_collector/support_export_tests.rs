/// Test-only observation of the real issuance seam. It exists so a coordinator
/// proof can assert that the real permit accepted and consumed the exact
/// request window bytes, and so the post-construction request-invariant branch
/// can be forced through the same production validation function. It cannot
/// exist in a release build and exposes no raw request constructor.
#[cfg(test)]
pub(crate) mod probe {
    use std::cell::Cell;
    use std::sync::{Mutex, OnceLock};

    use proliferate_diagnostics_protocol::v1::types::ExportRequestV1;

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub(crate) enum IssuanceStage {
        Issued,
        Consumed,
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    pub(crate) struct ObservedIssuance {
        pub(crate) stage: IssuanceStage,
        pub(crate) source_time_from: String,
        pub(crate) source_time_to: String,
    }

    thread_local! {
        static REQUEST_FAULT: Cell<bool> = const { Cell::new(false) };
    }

    fn observations() -> &'static Mutex<Vec<ObservedIssuance>> {
        static OBSERVATIONS: OnceLock<Mutex<Vec<ObservedIssuance>>> = OnceLock::new();
        OBSERVATIONS.get_or_init(|| Mutex::new(Vec::new()))
    }

    pub(crate) fn record(stage: IssuanceStage, source_time_from: &str, source_time_to: &str) {
        if let Ok(mut observations) = observations().lock() {
            observations.push(ObservedIssuance {
                stage,
                source_time_from: source_time_from.to_owned(),
                source_time_to: source_time_to.to_owned(),
            });
        }
    }

    pub(crate) fn reset() {
        if let Ok(mut observations) = observations().lock() {
            observations.clear();
        }
    }

    pub(crate) fn observed() -> Vec<ObservedIssuance> {
        observations()
            .lock()
            .map(|observations| observations.clone())
            .unwrap_or_default()
    }

    /// Arms a same-thread fault that corrupts the internally constructed
    /// request after `exact_request` returns, so the production
    /// `validate_support_request` call decides the outcome.
    pub(crate) fn arm_request_fault() {
        REQUEST_FAULT.with(|armed| armed.set(true));
    }

    pub(crate) fn disarm_request_fault() {
        REQUEST_FAULT.with(|armed| armed.set(false));
    }

    pub(crate) fn apply_request_fault(mut request: ExportRequestV1) -> ExportRequestV1 {
        if REQUEST_FAULT.with(|armed| armed.get()) {
            request.record_limit -= 1;
        }
        request
    }
}

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

fn issue_cause(
    preparation_id: &str,
    from: &str,
    to: &str,
    expires_at: Instant,
) -> SupportExportIssuanceError {
    SupportExportPermit::issue(preparation_id, from.to_string(), to.to_string(), expires_at)
        .err()
        .expect("issuance is refused")
}

fn live() -> Instant {
    Instant::now() + Duration::from_secs(25)
}

fn expired() -> Instant {
    Instant::now() - Duration::from_secs(1)
}

#[test]
fn issuer_names_the_exact_noncanonical_window_cause_for_every_negative_window() {
    let cases = [
        (
            "missing milliseconds",
            "2026-08-10T13:45:00Z",
            "2026-08-10T14:00:00Z",
        ),
        (
            "six fractional digits",
            "2026-08-10T13:45:00.000000Z",
            "2026-08-10T14:00:00.000000Z",
        ),
        (
            "nine fractional digits",
            "2026-08-10T13:45:00.000000000Z",
            "2026-08-10T14:00:00.000000000Z",
        ),
        (
            "non-UTC offset",
            "2026-08-10T06:45:00.000-07:00",
            "2026-08-10T07:00:00.000-07:00",
        ),
        ("malformed from", "not-a-timestamp", TO),
        ("malformed to", FROM, "2026-08-10T14:00:00"),
        ("inverted", TO, FROM),
        ("short by one millisecond", "2026-08-10T13:45:00.001Z", TO),
        ("long by one millisecond", "2026-08-10T13:44:59.999Z", TO),
        ("short by one second", "2026-08-10T13:45:01.000Z", TO),
        ("long by one second", "2026-08-10T13:44:59.000Z", TO),
        ("zero duration", FROM, FROM),
    ];
    for (name, from, to) in cases {
        assert_eq!(
            issue_cause(&uuid::Uuid::new_v4().to_string(), from, to, live()),
            SupportExportIssuanceError::NoncanonicalWindow,
            "{name}"
        );
    }
}

#[test]
fn issuer_names_the_exact_identifier_deadline_and_invariant_causes() {
    for identifier in [
        "not-a-uuid",
        "",
        "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
        "  6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    ] {
        assert_eq!(
            issue_cause(identifier, FROM, TO, live()),
            SupportExportIssuanceError::InvalidPreparationId,
            "{identifier}"
        );
    }
    assert_eq!(
        issue_cause(&uuid::Uuid::new_v4().to_string(), FROM, TO, expired()),
        SupportExportIssuanceError::ExpiredDeadline
    );

    // The private test-only fault corrupts the internally constructed request
    // after `exact_request` returns, so the production validation function
    // decides the outcome. No raw request constructor is exposed.
    probe::arm_request_fault();
    let cause = issue_cause(&uuid::Uuid::new_v4().to_string(), FROM, TO, live());
    probe::disarm_request_fault();
    assert_eq!(cause, SupportExportIssuanceError::RequestInvariant);
    assert!(SupportExportPermit::issue(
        &uuid::Uuid::new_v4().to_string(),
        FROM.to_string(),
        TO.to_string(),
        live(),
    )
    .is_ok());
}

#[test]
fn mixed_invalid_inputs_pin_the_frozen_evaluation_order() {
    // Identifier beats deadline, window, and invariant.
    probe::arm_request_fault();
    assert_eq!(
        issue_cause("not-a-uuid", "not-a-timestamp", "also-not", expired()),
        SupportExportIssuanceError::InvalidPreparationId
    );
    // Deadline beats window and invariant.
    assert_eq!(
        issue_cause(
            &uuid::Uuid::new_v4().to_string(),
            "not-a-timestamp",
            "also-not",
            expired()
        ),
        SupportExportIssuanceError::ExpiredDeadline
    );
    // Window beats invariant.
    assert_eq!(
        issue_cause(
            &uuid::Uuid::new_v4().to_string(),
            "not-a-timestamp",
            "also-not",
            live()
        ),
        SupportExportIssuanceError::NoncanonicalWindow
    );
    // Only the invariant remains.
    let cause = issue_cause(&uuid::Uuid::new_v4().to_string(), FROM, TO, live());
    probe::disarm_request_fault();
    assert_eq!(cause, SupportExportIssuanceError::RequestInvariant);
}

#[test]
fn the_coordinator_entrypoint_carries_the_same_typed_cause() {
    assert_eq!(
        issue_support_export_for_coordinator(
            "not-a-uuid",
            FROM.to_string(),
            TO.to_string(),
            live(),
        )
        .err(),
        Some(SupportExportIssuanceError::InvalidPreparationId)
    );
    assert_eq!(
        issue_support_export_for_coordinator(
            &uuid::Uuid::new_v4().to_string(),
            "2026-08-10T13:45:00Z".to_string(),
            "2026-08-10T14:00:00Z".to_string(),
            live(),
        )
        .err(),
        Some(SupportExportIssuanceError::NoncanonicalWindow)
    );
}

#[test]
fn the_strict_window_validator_still_accepts_only_fixed_millisecond_utc() {
    assert!(is_exact_support_window(FROM, TO));
    assert!(is_exact_support_window(
        "2026-08-10T13:45:00.123Z",
        "2026-08-10T14:00:00.123Z"
    ));
    assert!(!is_exact_support_window(
        "2026-08-10T13:45:00Z",
        "2026-08-10T14:00:00Z"
    ));
    assert!(!is_exact_support_window(
        "2026-08-10T13:45:00.123456Z",
        "2026-08-10T14:00:00.123456Z"
    ));
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
    // `health` names the moved frame here, so reach past it to the fixture fn.
    assert!(post_end
        .push(ExportStreamFrameV1::Health {
            health: self::health()
        })
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
