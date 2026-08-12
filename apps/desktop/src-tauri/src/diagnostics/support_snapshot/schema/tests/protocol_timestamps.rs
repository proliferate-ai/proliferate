use super::protocol_tests::{accepted_record, completed_snapshot};
use super::{no_evidence_skeleton, set_manifest_source};

use proliferate_diagnostics_protocol::v1::types::RedactionClassificationV1;

use crate::diagnostics::support_snapshot::schema::enums::{
    SupportFallbackDispositionV1, SupportFallbackRecordComponentV1, SupportSourceManifestSourceV1,
    SupportSourceStateV1,
};
use crate::diagnostics::support_snapshot::schema::model::evidence::{
    SupportFallbackComponentV1, SupportFallbackRecordV1,
};
use crate::diagnostics::support_snapshot::schema::validate::{
    stabilize_serialized_bytes, validate_collector_evidence, validate_snapshot, SupportSchemaError,
};

const OFFSET_FROM: &str = "2026-08-12T05:15:00+05:30";
const OFFSET_RECORD: &str = "2026-08-12T05:20:00+05:30";
const OFFSET_TO: &str = "2026-08-12T05:30:00+05:30";
const INVALID_DATE: &str = "2026-02-30T05:20:00+05:30";

#[test]
fn accepted_record_protocol_timestamps_accept_offsets_but_reject_invalid_dates() {
    let mut snapshot = completed_snapshot();
    snapshot.records[0].record.source_timestamp = OFFSET_RECORD.to_owned();
    snapshot.records[0].accepted_timestamp = OFFSET_RECORD.to_owned();
    stabilize_serialized_bytes(&mut snapshot).expect("stabilize offset record");
    validate_snapshot(&snapshot).expect("real offset protocol timestamps");

    snapshot.records[0].record.source_timestamp = INVALID_DATE.to_owned();
    stabilize_serialized_bytes(&mut snapshot).expect("stabilize invalid source timestamp");
    assert_eq!(
        validate_snapshot(&snapshot),
        Err(SupportSchemaError::InvalidTimestamp)
    );

    snapshot.records[0].record.source_timestamp = OFFSET_RECORD.to_owned();
    snapshot.records[0].accepted_timestamp = INVALID_DATE.to_owned();
    stabilize_serialized_bytes(&mut snapshot).expect("stabilize invalid accepted timestamp");
    assert_eq!(
        validate_snapshot(&snapshot),
        Err(SupportSchemaError::InvalidTimestamp)
    );
}

#[test]
fn fallback_record_protocol_timestamps_accept_offsets_but_reject_invalid_dates() {
    let mut snapshot = no_evidence_skeleton();
    let mut record = accepted_record().record;
    record.source_timestamp = OFFSET_RECORD.to_owned();
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
    stabilize_serialized_bytes(&mut snapshot).expect("stabilize offset fallback");
    validate_snapshot(&snapshot).expect("real offset fallback timestamp");

    let SupportFallbackComponentV1::Pr3DesktopNativeMixed { records, .. } =
        &mut snapshot.fallback_evidence[0]
    else {
        unreachable!()
    };
    records[0].record.source_timestamp = INVALID_DATE.to_owned();
    stabilize_serialized_bytes(&mut snapshot).expect("stabilize invalid fallback timestamp");
    assert_eq!(
        validate_snapshot(&snapshot),
        Err(SupportSchemaError::InvalidTimestamp)
    );
}

#[test]
fn export_manifest_protocol_timestamps_accept_offsets_but_reject_invalid_dates() {
    let mut evidence = completed_snapshot().collector;
    let manifest = evidence.export_manifest.as_mut().expect("export manifest");
    manifest.generated_at = OFFSET_TO.to_owned();
    manifest.filters.source_time_from = Some(OFFSET_FROM.to_owned());
    manifest.filters.source_time_to = Some(OFFSET_TO.to_owned());
    validate_collector_evidence(&evidence).expect("real offset export timestamps");

    evidence
        .export_manifest
        .as_mut()
        .expect("export manifest")
        .generated_at = INVALID_DATE.to_owned();
    assert_eq!(
        validate_collector_evidence(&evidence),
        Err(SupportSchemaError::InvalidTimestamp)
    );

    let manifest = evidence.export_manifest.as_mut().expect("export manifest");
    manifest.generated_at = OFFSET_TO.to_owned();
    manifest.filters.source_time_from = Some(INVALID_DATE.to_owned());
    assert_eq!(
        validate_collector_evidence(&evidence),
        Err(SupportSchemaError::InvalidTimestamp)
    );
}

#[test]
fn support_owned_timestamps_still_require_canonical_z() {
    let mut snapshot = no_evidence_skeleton();
    snapshot.generated_at = OFFSET_TO.to_owned();
    snapshot.manifest.generated_at = OFFSET_TO.to_owned();
    assert_eq!(
        validate_snapshot(&snapshot),
        Err(SupportSchemaError::InvalidTimestamp)
    );
}
