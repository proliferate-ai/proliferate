use proliferate_diagnostics_protocol::v1::types::{CollectorAcceptedRecordV1, SourceV1};

use super::super::super::schema::enums::{
    SupportEvidenceSourceV1, SupportFallbackRecordComponentV1, SupportOmissionReasonV1,
};
use super::super::{assemble_support_snapshot, SupportFallbackCandidateValueV1};
use super::{input_from_fixture, with_collector_records, SCHEMA_POPULATED};

#[test]
fn out_of_window_or_cursor_collector_candidates_are_omitted_not_fatal() {
    let mutations: [fn(&mut CollectorAcceptedRecordV1); 2] = [
        |record| {
            record.record.source_timestamp = "2026-08-11T23:44:59Z".to_owned();
        },
        |record| {
            record.retention_cursor = 42;
        },
    ];
    for mutate in mutations {
        let mut input = input_from_fixture(SCHEMA_POPULATED);
        mutate(
            input.collector_records[0]
                .scrubbed
                .value
                .as_mut()
                .expect("collector record"),
        );
        let output = assemble_support_snapshot(input).expect("invalid optional collector");
        assert!(output.snapshot.records.is_empty());
        assert!(output.snapshot.manifest.omissions.iter().any(|entry| {
            entry.source == SupportEvidenceSourceV1::Collector
                && entry.reason == SupportOmissionReasonV1::SourceInvalid
        }));
    }
}

#[test]
fn fallback_component_source_mismatch_is_omitted_not_fatal() {
    let mut input = input_from_fixture(SCHEMA_POPULATED);
    let record = input
        .fallback
        .iter_mut()
        .find_map(|candidate| match candidate.scrubbed.value.as_mut() {
            Some(SupportFallbackCandidateValueV1::Record(record))
                if record.component == SupportFallbackRecordComponentV1::DesktopTauri =>
            {
                Some(record)
            }
            _ => None,
        })
        .expect("desktop fallback record");
    record.record.source = SourceV1::Anyharness;
    input
        .fallback
        .iter_mut()
        .filter(|candidate| {
            matches!(
                candidate.scrubbed.value.as_ref(),
                Some(SupportFallbackCandidateValueV1::OpaqueLine(_))
            )
        })
        .for_each(|candidate| candidate.included_bytes = 1);
    let output = assemble_support_snapshot(input).expect("invalid optional fallback");
    let desktop = &output.snapshot.fallback_evidence[0];
    let super::super::super::schema::model::evidence::SupportFallbackComponentV1::Pr3DesktopNativeMixed {
        records, ..
    } = desktop
    else {
        panic!("desktop fallback section")
    };
    assert!(records.is_empty());
    assert!(output.snapshot.manifest.omissions.iter().any(|entry| {
        entry.source == SupportEvidenceSourceV1::Tauri
            && entry.reason == SupportOmissionReasonV1::SourceInvalid
    }));
}

#[test]
fn unsafe_optional_byte_counter_degrades_with_unknown_bytes() {
    let mut input = input_from_fixture(SCHEMA_POPULATED);
    input.collector_records[0].included_bytes = u64::MAX;
    let output = assemble_support_snapshot(input).expect("unsafe optional accounting degrades");
    assert!(output.snapshot.records.is_empty());
    assert!(output.snapshot.manifest.omissions.iter().any(|entry| {
        entry.source == SupportEvidenceSourceV1::Collector
            && entry.reason == SupportOmissionReasonV1::SourceInvalid
            && entry.known_bytes.is_none()
    }));
}

#[test]
fn duplicate_collector_presentation_identity_drops_only_the_duplicate() {
    let base = input_from_fixture(SCHEMA_POPULATED);
    let record = base.collector_records[0]
        .scrubbed
        .value
        .clone()
        .expect("collector record");
    let input = with_collector_records(base, vec![record.clone(), record]);
    let output = assemble_support_snapshot(input).expect("duplicate optional collector");
    assert_eq!(output.snapshot.records.len(), 1);
    assert!(output.snapshot.manifest.omissions.iter().any(|entry| {
        entry.source == SupportEvidenceSourceV1::Collector
            && entry.reason == SupportOmissionReasonV1::SourceInvalid
            && entry.count == 1
    }));
}
