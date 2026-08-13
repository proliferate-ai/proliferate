use super::super::super::schema::enums::{
    SupportEndpointStateV1, SupportEvidenceSourceV1, SupportLegacySourceKindV1,
    SupportOmissionReasonV1, SupportSourceManifestSourceV1, SupportSourceStateV1,
    SupportTruncationReasonV1,
};
use super::super::super::schema::limits::{
    COMPONENT_FILES_READ_BYTES, CONTENT_STRING_BYTES, DESKTOP_NATIVE_FALLBACK_BYTES,
    EVENTS_PER_SESSION, EVENT_RESPONSE_BYTES, MANIFEST_BYTES, MAX_OMISSION_ENTRIES, PACKAGE_BYTES,
    RAW_NOTIFICATIONS_PER_SESSION, RAW_NOTIFICATION_RESPONSE_BYTES, SESSION_LIST_RESPONSE_BYTES,
};
use super::super::super::schema::model::common::SupportOmissionV1;
use super::super::super::scrub::SupportScrubAccounting;
use super::super::{
    assemble_for_test, assemble_support_snapshot, SupportAssemblyError, SupportSessionAssemblyV1,
    SupportSourceCaptureV1,
};
use super::{candidate, input_from_fixture, seq_value, SCHEMA_NO_EVIDENCE, SCHEMA_POPULATED};

#[test]
fn mandatory_skeleton_passes_at_its_exact_size_and_fails_one_byte_below() {
    assert_eq!(MANIFEST_BYTES, 262_144);
    let input = input_from_fixture(SCHEMA_NO_EVIDENCE);
    let baseline = assemble_support_snapshot(input.clone()).expect("baseline skeleton");
    let exact = assemble_for_test(input.clone(), PACKAGE_BYTES, baseline.serialized_bytes)
        .expect("exact skeleton boundary");
    assert_eq!(exact.serialized_bytes, baseline.serialized_bytes);
    assert_eq!(
        assemble_for_test(input, PACKAGE_BYTES, baseline.serialized_bytes - 1),
        Err(SupportAssemblyError::MandatorySkeletonTooLarge)
    );
}

#[test]
fn invalid_mandatory_or_untrustworthy_accounting_fails_closed() {
    let mut invalid_id = input_from_fixture(SCHEMA_NO_EVIDENCE);
    invalid_id.mandatory.snapshot_id = "x".repeat(129);
    assert!(matches!(
        assemble_support_snapshot(invalid_id),
        Err(SupportAssemblyError::InvalidMandatory(_))
    ));

    let mut invalid_accounting = input_from_fixture(SCHEMA_NO_EVIDENCE);
    invalid_accounting
        .accounting
        .omissions
        .push(SupportOmissionV1 {
            source: SupportEvidenceSourceV1::Package,
            reason: SupportOmissionReasonV1::SourceInvalid,
            count: u64::MAX,
            known_bytes: None,
        });
    assert!(matches!(
        assemble_support_snapshot(invalid_accounting),
        Err(SupportAssemblyError::InvalidMandatory(_))
    ));
}

#[test]
fn correlation_identity_and_container_bounds_fail_closed() {
    let mut oversized_id = input_from_fixture(SCHEMA_NO_EVIDENCE);
    oversized_id.correlations.operation_ids = vec!["x".repeat(129)];
    assert_eq!(
        assemble_support_snapshot(oversized_id),
        Err(SupportAssemblyError::InvalidCorrelationSelection)
    );

    let mut oversized_set = input_from_fixture(SCHEMA_NO_EVIDENCE);
    oversized_set.correlations.turn_ids = (0..257).map(|index| format!("turn-{index}")).collect();
    assert_eq!(
        assemble_support_snapshot(oversized_set),
        Err(SupportAssemblyError::InvalidCorrelationSelection)
    );
}

#[test]
fn file_family_read_cap_passes_at_boundary_and_accounts_one_byte_over() {
    let exact = file_source_input(0);
    let exact_output = assemble_support_snapshot(exact).expect("exact family cap");
    assert!(!exact_output
        .snapshot
        .manifest
        .omissions
        .iter()
        .any(|entry| {
            entry.source == SupportEvidenceSourceV1::Renderer
                && entry.reason == SupportOmissionReasonV1::SourceCap
        }));
    assert_eq!(
        source_read_bytes(
            &exact_output.snapshot,
            SupportSourceManifestSourceV1::RendererLegacy
        ),
        COMPONENT_FILES_READ_BYTES - DESKTOP_NATIVE_FALLBACK_BYTES
    );

    let over = assemble_support_snapshot(file_source_input(1)).expect("bounded family source");
    assert_eq!(
        source_read_bytes(
            &over.snapshot,
            SupportSourceManifestSourceV1::RendererLegacy
        ),
        COMPONENT_FILES_READ_BYTES - DESKTOP_NATIVE_FALLBACK_BYTES
    );
    assert!(over.snapshot.manifest.omissions.iter().any(|entry| {
        entry.source == SupportEvidenceSourceV1::Renderer
            && entry.reason == SupportOmissionReasonV1::SourceCap
            && entry.known_bytes == Some(1)
    }));
}

#[test]
fn individual_fallback_read_cap_accounts_the_first_excess_byte() {
    let mut input = input_from_fixture(SCHEMA_NO_EVIDENCE);
    input.file_sources = vec![SupportSourceCaptureV1 {
        source: SupportSourceManifestSourceV1::DesktopNativeFallback,
        state: SupportSourceStateV1::Included,
        captured_at: input.mandatory.generated_at.clone(),
        read_bytes: DESKTOP_NATIVE_FALLBACK_BYTES + 1,
    }];
    let output = assemble_support_snapshot(input).expect("bounded fallback source");
    assert_eq!(
        source_read_bytes(
            &output.snapshot,
            SupportSourceManifestSourceV1::DesktopNativeFallback
        ),
        DESKTOP_NATIVE_FALLBACK_BYTES
    );
    assert!(output.snapshot.manifest.omissions.iter().any(|entry| {
        entry.source == SupportEvidenceSourceV1::Tauri
            && entry.reason == SupportOmissionReasonV1::SourceCap
            && entry.known_bytes == Some(1)
    }));
}

#[test]
fn legacy_container_passes_at_256_and_accounts_item_257() {
    let exact = assemble_support_snapshot(legacy_count_input(256)).expect("256 lines");
    assert_eq!(renderer_lines(&exact.snapshot), 256);

    let over = assemble_support_snapshot(legacy_count_input(257)).expect("257 lines bounded");
    assert_eq!(renderer_lines(&over.snapshot), 256);
    assert!(over.snapshot.manifest.omissions.iter().any(|entry| {
        entry.source == SupportEvidenceSourceV1::Renderer
            && entry.reason == SupportOmissionReasonV1::SourceCap
            && entry.count == 1
    }));
    assert!(over.snapshot.manifest.truncations.iter().any(|entry| {
        entry.source == SupportEvidenceSourceV1::Renderer
            && entry.reason == SupportTruncationReasonV1::ContainerItems
            && entry.count == 1
    }));
}

#[test]
fn session_event_and_raw_item_boundaries_are_independent() {
    let exact = assemble_support_snapshot(session_item_input(200, 100)).expect("session limits");
    let exact_session = &exact
        .snapshot
        .session_ledger
        .as_ref()
        .expect("ledger")
        .sessions[0];
    assert_eq!(
        exact_session.normalized_events.len(),
        EVENTS_PER_SESSION as usize
    );
    assert_eq!(
        exact_session.raw_notifications.len(),
        RAW_NOTIFICATIONS_PER_SESSION as usize
    );

    let over = assemble_support_snapshot(session_item_input(201, 101)).expect("bounded session");
    let session = &over
        .snapshot
        .session_ledger
        .as_ref()
        .expect("ledger")
        .sessions[0];
    assert_eq!(session.normalized_events.len(), EVENTS_PER_SESSION as usize);
    assert_eq!(
        session.raw_notifications.len(),
        RAW_NOTIFICATIONS_PER_SESSION as usize
    );
    for reason in [
        SupportTruncationReasonV1::SessionEvents,
        SupportTruncationReasonV1::RawNotifications,
    ] {
        assert!(over.snapshot.manifest.truncations.iter().any(|entry| {
            entry.source == SupportEvidenceSourceV1::SessionLedger
                && entry.reason == reason
                && entry.count == 1
        }));
    }
}

#[test]
fn session_response_byte_caps_pass_at_boundary_and_drop_one_byte_over() {
    for (kind, cap, reason) in [
        (
            0,
            SESSION_LIST_RESPONSE_BYTES,
            SupportTruncationReasonV1::ComponentBytes,
        ),
        (
            1,
            EVENT_RESPONSE_BYTES,
            SupportTruncationReasonV1::SessionEvents,
        ),
        (
            2,
            RAW_NOTIFICATION_RESPONSE_BYTES,
            SupportTruncationReasonV1::RawNotifications,
        ),
    ] {
        let exact = assemble_support_snapshot(session_response_input(kind, cap))
            .unwrap_or_else(|error| panic!("kind {kind} exact: {error}"));
        assert_eq!(session_atom_count(&exact.snapshot, kind), 1, "kind {kind}");

        let over = assemble_support_snapshot(session_response_input(kind, cap + 1))
            .unwrap_or_else(|error| panic!("kind {kind} over: {error}"));
        assert_eq!(session_atom_count(&over.snapshot, kind), 0, "kind {kind}");
        assert!(over.snapshot.manifest.truncations.iter().any(|entry| {
            entry.source == SupportEvidenceSourceV1::SessionLedger
                && entry.reason == reason
                && entry.count == 1
        }));
    }
}

#[test]
fn oversized_serialized_session_atom_is_removed_without_failure() {
    let mut input = session_response_input(0, 1);
    let SupportSessionAssemblyV1::Included { sessions, .. } = &mut input.sessions else {
        panic!("session fixture")
    };
    sessions[0].summary.scrubbed.value = Some(
        super::super::super::schema::model::common::SupportJsonValueV1::Array(vec![
            super::super::super::schema::model::common::SupportJsonValueV1::String(
                "x".repeat(CONTENT_STRING_BYTES),
            );
            256
        ]),
    );
    let output = assemble_support_snapshot(input).expect("oversized session atom degrades");
    assert_eq!(session_atom_count(&output.snapshot, 0), 0);
    assert!(output.snapshot.manifest.truncations.iter().any(|entry| {
        entry.source == SupportEvidenceSourceV1::SessionLedger
            && entry.reason == SupportTruncationReasonV1::ComponentBytes
    }));
}

#[test]
fn oversized_optional_line_is_omitted_without_failing_the_artifact() {
    let exact = assemble_support_snapshot(legacy_value_input(CONTENT_STRING_BYTES))
        .expect("exact content field");
    assert_eq!(renderer_lines(&exact.snapshot), 1);

    let over = assemble_support_snapshot(legacy_value_input(CONTENT_STRING_BYTES + 1))
        .expect("oversized optional line degrades");
    assert_eq!(renderer_lines(&over.snapshot), 0);
    assert!(over.snapshot.manifest.omissions.iter().any(|entry| {
        entry.source == SupportEvidenceSourceV1::Renderer
            && entry.reason == SupportOmissionReasonV1::SourceInvalid
    }));
}

#[test]
fn missing_unreadable_and_invalid_optional_sources_degrade_without_failure() {
    for (state, reason) in [
        (
            SupportSourceStateV1::Missing,
            SupportOmissionReasonV1::SourceMissing,
        ),
        (
            SupportSourceStateV1::Unreadable,
            SupportOmissionReasonV1::SourceUnreadable,
        ),
    ] {
        let mut input = input_from_fixture(SCHEMA_POPULATED);
        let capture = input
            .file_sources
            .iter_mut()
            .find(|capture| capture.source == SupportSourceManifestSourceV1::RendererLegacy)
            .expect("renderer source");
        capture.state = state;
        let output = assemble_support_snapshot(input).expect("optional source degrades");
        assert!(!output
            .snapshot
            .legacy_evidence
            .iter()
            .any(|source| { source.source == SupportLegacySourceKindV1::RendererDiagnostics }));
        assert!(output.snapshot.manifest.omissions.iter().any(|entry| {
            entry.source == SupportEvidenceSourceV1::Renderer && entry.reason == reason
        }));
    }

    let mut invalid_session = input_from_fixture(SCHEMA_POPULATED);
    let SupportSessionAssemblyV1::Included { captured_at, .. } = &mut invalid_session.sessions
    else {
        panic!("session fixture")
    };
    *captured_at = "not-a-timestamp".to_owned();
    let output = assemble_support_snapshot(invalid_session).expect("invalid session degrades");
    assert!(output.snapshot.session_ledger.is_none());
    assert!(output.snapshot.manifest.omissions.iter().any(|entry| {
        entry.source == SupportEvidenceSourceV1::SessionLedger
            && entry.reason == SupportOmissionReasonV1::SessionInvalid
    }));
}

#[test]
fn fixed_omission_collection_caps_and_counts_the_suffix() {
    let mut input = input_from_fixture(SCHEMA_NO_EVIDENCE);
    input.accounting = SupportScrubAccounting::default();
    let sources = [
        SupportEvidenceSourceV1::Renderer,
        SupportEvidenceSourceV1::Tauri,
        SupportEvidenceSourceV1::Anyharness,
        SupportEvidenceSourceV1::DesktopWorker,
        SupportEvidenceSourceV1::SessionLedger,
        SupportEvidenceSourceV1::Package,
    ];
    let reasons = [
        SupportOmissionReasonV1::ProducerStatusUnavailable,
        SupportOmissionReasonV1::ChildMissing,
        SupportOmissionReasonV1::SourceMissing,
        SupportOmissionReasonV1::SourceUnreadable,
        SupportOmissionReasonV1::SourceUnsafeMetadata,
        SupportOmissionReasonV1::SourceInvalid,
        SupportOmissionReasonV1::SourceCap,
        SupportOmissionReasonV1::SessionUnavailable,
        SupportOmissionReasonV1::SessionTimeout,
        SupportOmissionReasonV1::SessionInvalid,
        SupportOmissionReasonV1::RecordLimit,
        SupportOmissionReasonV1::ByteLimit,
    ];
    for source in sources {
        for reason in reasons {
            input.accounting.omissions.push(SupportOmissionV1 {
                source,
                reason,
                count: 1,
                known_bytes: Some(1),
            });
        }
    }
    let output = assemble_support_snapshot(input).expect("fixed omission cap");
    assert_eq!(
        output.snapshot.manifest.omissions.len(),
        MAX_OMISSION_ENTRIES
    );
    assert!(output.snapshot.manifest.additional_entries.omissions > 0);
}

#[test]
fn protocol_offset_filters_and_records_compare_as_equal_instants() {
    let mut input = input_from_fixture(SCHEMA_POPULATED);
    let manifest = input
        .mandatory
        .collector
        .export_manifest
        .as_mut()
        .expect("export manifest");
    manifest.generated_at = "2026-08-12T01:00:00+01:00".to_owned();
    manifest.filters.source_time_from = Some("2026-08-12T00:45:00+01:00".to_owned());
    manifest.filters.source_time_to = Some("2026-08-12T01:00:00+01:00".to_owned());
    let record = input.collector_records[0]
        .scrubbed
        .value
        .as_mut()
        .expect("collector record");
    record.record.source_timestamp = "2026-08-12T00:50:00+01:00".to_owned();
    record.accepted_timestamp = "2026-08-12T00:50:01+01:00".to_owned();
    let output = assemble_support_snapshot(input).expect("equal offset instants");
    assert_eq!(
        output.snapshot.records[0].record.source_timestamp,
        "2026-08-12T00:50:00+01:00"
    );
}

fn file_source_input(renderer_overage: u64) -> super::super::SupportAssemblyInputV1 {
    let mut input = input_from_fixture(SCHEMA_NO_EVIDENCE);
    let captured_at = input.mandatory.generated_at.clone();
    input.file_sources = vec![
        SupportSourceCaptureV1 {
            source: SupportSourceManifestSourceV1::DesktopNativeFallback,
            state: SupportSourceStateV1::Included,
            captured_at: captured_at.clone(),
            read_bytes: DESKTOP_NATIVE_FALLBACK_BYTES,
        },
        SupportSourceCaptureV1 {
            source: SupportSourceManifestSourceV1::RendererLegacy,
            state: SupportSourceStateV1::Included,
            captured_at,
            read_bytes: COMPONENT_FILES_READ_BYTES - DESKTOP_NATIVE_FALLBACK_BYTES
                + renderer_overage,
        },
    ];
    input
}

fn source_read_bytes(
    snapshot: &super::super::super::schema::model::snapshot::SupportSnapshotV3,
    source: SupportSourceManifestSourceV1,
) -> u64 {
    snapshot
        .manifest
        .sources
        .iter()
        .find(|entry| entry.source == source)
        .expect("source entry")
        .read_bytes
}

fn legacy_count_input(count: usize) -> super::super::SupportAssemblyInputV1 {
    let populated = input_from_fixture(SCHEMA_POPULATED);
    let prototype =
        populated
            .legacy
            .iter()
            .find(|candidate| {
                candidate.scrubbed.value.as_ref().is_some_and(|value| {
                    value.source == SupportLegacySourceKindV1::RendererDiagnostics
                })
            })
            .expect("renderer legacy")
            .scrubbed
            .value
            .clone()
            .expect("legacy value");
    let mut input = empty_optional_input();
    input.legacy = (0..count)
        .map(|index| {
            let mut value = prototype.clone();
            value.line.segment = 0;
            value.line.line = index as u64;
            value.line.value = format!("line-{index}");
            let included_bytes = value.line.value.len() as u64 + 1;
            candidate(Some(value), included_bytes, index as u64)
        })
        .collect();
    let source_bytes = input
        .legacy
        .iter()
        .map(|candidate| candidate.included_bytes)
        .sum();
    set_source_read_bytes(
        &mut input,
        SupportSourceManifestSourceV1::RendererLegacy,
        source_bytes,
    );
    input
}

fn legacy_value_input(bytes: usize) -> super::super::SupportAssemblyInputV1 {
    let mut input = legacy_count_input(1);
    let value = input.legacy[0]
        .scrubbed
        .value
        .as_mut()
        .expect("legacy value");
    value.line.value = "x".repeat(bytes);
    input.legacy[0].included_bytes = bytes as u64;
    set_source_read_bytes(
        &mut input,
        SupportSourceManifestSourceV1::RendererLegacy,
        bytes as u64,
    );
    input
}

fn renderer_lines(
    snapshot: &super::super::super::schema::model::snapshot::SupportSnapshotV3,
) -> usize {
    snapshot
        .legacy_evidence
        .iter()
        .find(|source| source.source == SupportLegacySourceKindV1::RendererDiagnostics)
        .expect("renderer section")
        .lines
        .len()
}

fn session_item_input(events: usize, raw: usize) -> super::super::SupportAssemblyInputV1 {
    let mut input = empty_optional_input();
    let SupportSessionAssemblyV1::Included {
        read_bytes,
        sessions,
        ..
    } = &mut input.sessions
    else {
        panic!("session fixture")
    };
    *read_bytes = (events + raw) as u64;
    let session = &mut sessions[0];
    session.summary = candidate(None, 0, 0);
    session.endpoint_states.events = SupportEndpointStateV1::Included;
    session.endpoint_states.raw_notifications = SupportEndpointStateV1::Included;
    session.normalized_events = (0..events)
        .map(|index| candidate(Some(seq_value(index as i64, "event")), 1, index as u64))
        .collect();
    session.raw_notifications = (0..raw)
        .map(|index| candidate(Some(seq_value(index as i64, "raw")), 1, index as u64))
        .collect();
    super::set_session_list_state(&mut input, SupportEndpointStateV1::Omitted);
    input
}

fn session_response_input(kind: u8, included_bytes: u64) -> super::super::SupportAssemblyInputV1 {
    let mut input = empty_optional_input();
    let SupportSessionAssemblyV1::Included {
        read_bytes,
        sessions,
        ..
    } = &mut input.sessions
    else {
        panic!("session fixture")
    };
    *read_bytes = included_bytes;
    let session = &mut sessions[0];
    session.summary = candidate(None, 0, 0);
    session.normalized_events.clear();
    session.raw_notifications.clear();
    session.endpoint_states.events = SupportEndpointStateV1::Omitted;
    session.endpoint_states.raw_notifications = SupportEndpointStateV1::Omitted;
    match kind {
        0 => {
            session.summary = candidate(
                Some(
                    super::super::super::schema::model::common::SupportJsonValueV1::String(
                        "summary".to_owned(),
                    ),
                ),
                included_bytes,
                0,
            );
        }
        1 => {
            session.normalized_events =
                vec![candidate(Some(seq_value(1, "event")), included_bytes, 0)];
            session.endpoint_states.events = SupportEndpointStateV1::Included;
        }
        2 => {
            session.raw_notifications =
                vec![candidate(Some(seq_value(1, "raw")), included_bytes, 0)];
            session.endpoint_states.raw_notifications = SupportEndpointStateV1::Included;
        }
        _ => unreachable!(),
    }
    let state = match kind {
        0 => SupportEndpointStateV1::Included,
        _ => SupportEndpointStateV1::Omitted,
    };
    super::set_session_list_state(&mut input, state);
    input
}

fn session_atom_count(
    snapshot: &super::super::super::schema::model::snapshot::SupportSnapshotV3,
    kind: u8,
) -> usize {
    let session = &snapshot
        .session_ledger
        .as_ref()
        .expect("session ledger")
        .sessions[0];
    match kind {
        0 => usize::from(session.summary.is_some()),
        1 => session.normalized_events.len(),
        2 => session.raw_notifications.len(),
        _ => unreachable!(),
    }
}

fn empty_optional_input() -> super::super::SupportAssemblyInputV1 {
    let mut input = input_from_fixture(SCHEMA_POPULATED);
    input.collector_records.clear();
    input.fallback.clear();
    input.legacy.clear();
    // `add_truncation` accumulates per (source, reason), so the fixture's own
    // session-ledger entries would be read as this assembly's accounting.
    input
        .accounting
        .truncations
        .retain(|entry| entry.source != SupportEvidenceSourceV1::SessionLedger);
    input
}

fn set_source_read_bytes(
    input: &mut super::super::SupportAssemblyInputV1,
    source: SupportSourceManifestSourceV1,
    bytes: u64,
) {
    input
        .file_sources
        .iter_mut()
        .find(|capture| capture.source == source)
        .expect("file source")
        .read_bytes = bytes;
}
