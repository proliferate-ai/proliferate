use proliferate_diagnostics_protocol::v1::types::SeverityV1;

use super::super::super::schema::enums::{
    SupportCollectorCompletenessV1, SupportCollectorStatusV1, SupportEndpointStateV1,
    SupportOmissionReasonV1, SupportSessionOmissionReasonV1, SupportSessionSelectionV1,
    SupportSourceManifestSourceV1, SupportTruncationReasonV1,
};
use super::super::super::schema::limits::{
    COLLECTOR_BYTES, MANIFEST_BYTES, PACKAGE_BYTES, SESSION_EVIDENCE_BYTES,
};
use super::super::super::schema::model::common::SupportJsonValueV1;
use super::super::{
    assemble_for_test, assemble_support_snapshot, SupportFallbackCandidateValueV1,
    SupportLegacyCandidateValueV1, SupportSessionAssemblyV1,
};
use super::{
    candidate, input_from_fixture, lifecycle_records, seq_value, set_session_list_state,
    with_collector_records, SCHEMA_POPULATED,
};

#[test]
fn each_of_the_exact_eight_tiers_is_the_accounted_last_group() {
    for tier in 1..=8 {
        let input = input_for_tier(tier);
        let included = assemble_for_test(input.clone(), PACKAGE_BYTES, MANIFEST_BYTES)
            .unwrap_or_else(|error| panic!("tier {tier} include: {error}"));
        assert!(optional_atoms(&included.snapshot) > 0, "tier {tier}");
        let cap = included.serialized_bytes - 1;
        let degraded = assemble_for_test(input, cap, MANIFEST_BYTES)
            .unwrap_or_else(|error| panic!("tier {tier} degrade: {error}"));
        assert_eq!(optional_atoms(&degraded.snapshot), 0, "tier {tier}");
        let mut expected = [0; 8];
        expected[tier - 1] = 1;
        assert_eq!(
            degraded.snapshot.manifest.degradation.removed_by_tier, expected,
            "tier {tier}"
        );
        assert!(degraded.snapshot.manifest.omissions.iter().any(|entry| {
            entry.reason == SupportOmissionReasonV1::PackageCap && entry.count == 1
        }));
        assert!(degraded.snapshot.manifest.truncations.iter().any(|entry| {
            entry.reason == SupportTruncationReasonV1::PackageBytes && entry.count == 1
        }));
    }
}

#[test]
fn tier_three_requires_an_exact_owned_correlation() {
    let exact = collector_input(3);
    assert_eq!(removed_tiers(exact), [0, 0, 1, 0, 0, 0, 0, 0]);

    for operation_ids in [Vec::new(), vec!["different-operation".to_owned()]] {
        let mut input = collector_input(3);
        input.correlations.operation_ids = operation_ids;
        assert_eq!(removed_tiers(input), [0, 0, 0, 1, 0, 0, 0, 0]);
    }
}

#[test]
fn a_real_input_over_twenty_five_mib_degrades_to_the_exact_production_cap() {
    let input = production_cap_input();
    let canonical_candidate_bytes =
        input
            .collector_records
            .iter()
            .map(|candidate| encoded_len(candidate.scrubbed.value.as_ref().expect("record")))
            .chain(input.legacy.iter().map(|candidate| {
                encoded_len(&candidate.scrubbed.value.as_ref().expect("legacy").line)
            }))
            .sum::<u64>();
    assert!(canonical_candidate_bytes > PACKAGE_BYTES - SESSION_EVIDENCE_BYTES);
    let output = assemble_support_snapshot(input).expect("bounded package");
    assert!(output.serialized_bytes <= PACKAGE_BYTES);
    assert!(output.snapshot.manifest.degradation.removed_by_tier[7] > 0);
    assert!(!output.snapshot.records.is_empty());
}

#[test]
fn package_boundary_passes_exactly_and_removes_at_one_byte_less() {
    assert_eq!(PACKAGE_BYTES, 26_214_400);
    let input = input_for_tier(8);
    let included = assemble_for_test(input.clone(), PACKAGE_BYTES, MANIFEST_BYTES)
        .expect("included boundary source");
    let exact = assemble_for_test(input.clone(), included.serialized_bytes, MANIFEST_BYTES)
        .expect("exact boundary");
    assert_eq!(exact.serialized_bytes, included.serialized_bytes);
    assert_eq!(optional_atoms(&exact.snapshot), 1);
    let one_less = assemble_for_test(input, included.serialized_bytes - 1, MANIFEST_BYTES)
        .expect("one-byte-less degradation");
    assert_eq!(optional_atoms(&one_less.snapshot), 0);
    assert_eq!(one_less.snapshot.manifest.degradation.removed_by_tier[7], 1);
}

#[test]
fn lifecycle_pair_is_removed_atomically_and_lone_side_stays_honest() {
    let (started, terminal) = lifecycle_records();
    let pair_input = with_collector_records(non_session_input(), vec![started.clone(), terminal]);
    let included = assemble_support_snapshot(pair_input.clone()).expect("included pair");
    assert_eq!(included.snapshot.records.len(), 2);
    let degraded = assemble_for_test(pair_input, included.serialized_bytes - 1, MANIFEST_BYTES)
        .expect("degraded pair");
    assert!(degraded.snapshot.records.is_empty());
    assert_eq!(degraded.snapshot.manifest.degradation.removed_by_tier[1], 1);
    assert!(degraded
        .snapshot
        .manifest
        .omissions
        .iter()
        .any(|entry| { entry.reason == SupportOmissionReasonV1::PackageCap && entry.count == 2 }));

    let lone =
        assemble_support_snapshot(with_collector_records(non_session_input(), vec![started]))
            .expect("lone lifecycle");
    assert_eq!(lone.snapshot.records.len(), 1);
    assert!(lone.snapshot.manifest.omissions.iter().any(|entry| {
        entry.source == super::super::super::schema::enums::SupportEvidenceSourceV1::Collector
            && entry.reason == SupportOmissionReasonV1::RecordLimit
            && entry.count == 1
    }));
}

#[test]
fn degraded_collector_sibling_keeps_positive_measured_byte_accounting() {
    let mut input = non_session_input();
    let prototype = input_from_fixture(SCHEMA_POPULATED).collector_records[0]
        .scrubbed
        .value
        .clone()
        .expect("collector prototype");
    let mut low = prototype.clone();
    low.accepted_order = 1;
    low.retention_cursor = 1;
    low.record.producer_sequence = 1;
    low.record.operation_id = "low-priority-operation".to_string();
    low.record.severity = SeverityV1::Info;
    clear_incidental_correlations(&mut low.record);
    low.record.detailed.as_mut().expect("detail").message = Some("l".repeat(10_000));
    let mut high = prototype;
    high.accepted_order = 2;
    high.retention_cursor = 2;
    high.record.producer_sequence = 2;
    high.record.operation_id = "high-priority-operation".to_string();
    high.record.severity = SeverityV1::Warn;
    high.record.detailed.as_mut().expect("detail").message = Some("high".to_string());
    // Dropping the measured byte count below the limit-uncertainty threshold also
    // retires the uncertainty claim: the fixture inherits `limit_uncertain` from a
    // near-cap byte count, and `validate_collector_coverage` requires the
    // status/completeness/flag triple to be justified by the counts themselves.
    input.mandatory.collector.coverage.status = SupportCollectorStatusV1::Complete;
    input.mandatory.collector.coverage.completeness = SupportCollectorCompletenessV1::Complete;
    input.mandatory.collector.coverage.limit_uncertain = false;
    input.mandatory.collector.coverage.returned_record_bytes = 10;
    input
        .mandatory
        .collector
        .export_manifest
        .as_mut()
        .expect("manifest")
        .byte_count = 10;
    input = with_collector_records(input, vec![low, high]);
    input.collector_records[0].included_bytes = 5;
    input.collector_records[1].included_bytes = 5;

    let mut high_only = input.clone();
    high_only.collector_records.remove(0);
    let high_output = assemble_support_snapshot(high_only).expect("high record alone");
    let degraded = assemble_for_test(input, high_output.serialized_bytes + 1_000, MANIFEST_BYTES)
        .expect("collector degradation");
    assert_eq!(degraded.snapshot.records.len(), 1);
    assert_eq!(
        degraded.snapshot.records[0].record.severity,
        SeverityV1::Warn
    );
    let source = degraded
        .snapshot
        .manifest
        .sources
        .iter()
        .find(|source| source.source == SupportSourceManifestSourceV1::Collector)
        .expect("collector source");
    assert!((1..=10).contains(&source.included_bytes));
}

#[test]
fn degraded_session_event_and_raw_siblings_keep_positive_response_bytes() {
    for raw in [false, true] {
        let mut input = input_from_fixture(SCHEMA_POPULATED);
        input.collector_records.clear();
        input.fallback.clear();
        input.legacy.clear();
        let SupportSessionAssemblyV1::Included {
            read_bytes,
            sessions,
            ..
        } = &mut input.sessions
        else {
            panic!("session fixture")
        };
        let session = &mut sessions[0];
        session.summary = candidate(None, 0, 0);
        session.normalized_events.clear();
        session.raw_notifications.clear();
        session.endpoint_states.events = SupportEndpointStateV1::Omitted;
        session.endpoint_states.raw_notifications = SupportEndpointStateV1::Omitted;
        let candidates = vec![
            candidate(Some(seq_value(1, &"l".repeat(10_000))), 5, 0),
            candidate(Some(seq_value(2, "high")), 5, 1),
        ];
        if raw {
            session.raw_notifications = candidates;
            session.endpoint_states.raw_notifications = SupportEndpointStateV1::Included;
        } else {
            session.normalized_events = candidates;
            session.endpoint_states.events = SupportEndpointStateV1::Included;
        }
        *read_bytes = 10;
        set_session_list_state(&mut input, SupportEndpointStateV1::Omitted);

        let mut high_only = input.clone();
        let SupportSessionAssemblyV1::Included { sessions, .. } = &mut high_only.sessions else {
            panic!("session fixture")
        };
        if raw {
            sessions[0].raw_notifications.remove(0);
        } else {
            sessions[0].normalized_events.remove(0);
        }
        let high_output = assemble_support_snapshot(high_only).expect("high session atom alone");
        let degraded =
            assemble_for_test(input, high_output.serialized_bytes + 1_000, MANIFEST_BYTES)
                .expect("session degradation");
        let collection = &degraded.snapshot.manifest.session_collection;
        let bytes = match collection {
            super::super::super::schema::model::manifest::SupportSessionCollectionManifestV1::Included {
                event_included_bytes,
                raw_notification_included_bytes,
                ..
            } => if raw { *raw_notification_included_bytes } else { *event_included_bytes },
            _ => panic!("included session collection"),
        };
        assert!((1..=10).contains(&bytes));
    }
}

fn input_for_tier(tier: usize) -> super::super::SupportAssemblyInputV1 {
    match tier {
        1 => session_input(false, false),
        2..=4 => collector_input(tier),
        5 => fallback_input(),
        6 => session_input(true, false),
        7 => session_input(false, true),
        8 => legacy_input(),
        _ => unreachable!(),
    }
}

fn non_session_input() -> super::super::SupportAssemblyInputV1 {
    let mut input = input_from_fixture(SCHEMA_POPULATED);
    input.collector_records.clear();
    input.fallback.clear();
    input.legacy.clear();
    input.sessions = SupportSessionAssemblyV1::Omitted {
        captured_at: input.mandatory.generated_at.clone(),
        read_bytes: 0,
        reason: SupportSessionOmissionReasonV1::SessionUnavailable,
    };
    input
}

fn production_cap_input() -> super::super::SupportAssemblyInputV1 {
    let mut input = input_from_fixture(SCHEMA_POPULATED);
    input.fallback.clear();

    let prototype = input.collector_records[0]
        .scrubbed
        .value
        .clone()
        .expect("record");
    let mut records = Vec::new();
    let mut record_bytes = Vec::new();
    let mut collector_bytes = 0_u64;
    for index in 0..10_000_u64 {
        let mut record = prototype.clone();
        record.accepted_order = index + 1;
        record.retention_cursor = index + 1;
        record.record.producer_sequence = index + 1;
        if let Some(detailed) = &mut record.record.detailed {
            detailed.message = Some("c".repeat(2_000));
        }
        let bytes = encoded_len(&record);
        if collector_bytes
            .checked_add(bytes)
            .is_none_or(|total| total > COLLECTOR_BYTES)
        {
            break;
        }
        collector_bytes += bytes;
        record_bytes.push(bytes);
        records.push(record);
    }
    input = with_collector_records(input, records);
    input.mandatory.collector.coverage.returned_record_bytes = collector_bytes;
    input
        .mandatory
        .collector
        .export_manifest
        .as_mut()
        .expect("export manifest")
        .byte_count = collector_bytes;
    for (candidate, bytes) in input.collector_records.iter_mut().zip(record_bytes) {
        candidate.included_bytes = bytes;
    }

    input.mandatory.consent.selection = SupportSessionSelectionV1::RecentActivity;
    input.mandatory.selection.ui_session_id = None;
    input.mandatory.selection.materialized_session_id = None;
    let SupportSessionAssemblyV1::Included {
        read_bytes,
        sessions,
        ..
    } = &mut input.sessions
    else {
        panic!("session fixture")
    };
    let shell = sessions[0].clone();
    let mut event_bytes = 0_u64;
    *sessions = (0..3)
        .map(|selection_index| {
            let mut session = shell.clone();
            session.selection_index = selection_index;
            session.session_id = format!("recent-session-{selection_index}");
            session.summary = candidate(None, 0, 0);
            session.raw_notifications.clear();
            session.endpoint_states.events = SupportEndpointStateV1::Included;
            session.endpoint_states.raw_notifications = SupportEndpointStateV1::Omitted;
            session.normalized_events = (0..200)
                .map(|sequence| {
                    let value = seq_value(sequence, &"e".repeat(13_500));
                    let bytes = encoded_len(&value);
                    event_bytes += bytes;
                    candidate(Some(value), bytes, sequence as u64)
                })
                .collect();
            session
        })
        .collect();
    assert!(event_bytes <= SESSION_EVIDENCE_BYTES);
    *read_bytes = event_bytes;
    set_session_list_state(&mut input, SupportEndpointStateV1::Omitted);

    let legacy_prototypes: Vec<_> = input
        .legacy
        .iter()
        .filter_map(|candidate| candidate.scrubbed.value.clone())
        .collect();
    input.legacy.clear();
    for prototype in legacy_prototypes {
        let source = prototype.source;
        let manifest_source = super::super::candidate::legacy_source(source);
        let mut source_bytes = 0_u64;
        for line_index in 0..128_u64 {
            let mut line = prototype.line.clone();
            line.segment = 0;
            line.line = line_index;
            line.value = "l".repeat(8_192);
            let bytes = encoded_len(&line);
            source_bytes += bytes;
            input.legacy.push(candidate(
                Some(SupportLegacyCandidateValueV1 { source, line }),
                bytes,
                line_index,
            ));
        }
        input
            .file_sources
            .iter_mut()
            .find(|capture| capture.source == manifest_source)
            .expect("legacy source")
            .read_bytes = source_bytes;
    }
    input
}

fn encoded_len<T: serde::Serialize>(value: &T) -> u64 {
    serde_json::to_vec(value)
        .expect("canonical candidate")
        .len() as u64
}

fn collector_input(tier: usize) -> super::super::SupportAssemblyInputV1 {
    let mut input = non_session_input();
    let mut record = input_from_fixture(SCHEMA_POPULATED).collector_records[0]
        .scrubbed
        .value
        .clone()
        .expect("record");
    if let Some(detailed) = &mut record.record.detailed {
        detailed.message = Some("collector detail ".repeat(180));
    }
    match tier {
        2 => record.record.severity = SeverityV1::Warn,
        3 => {
            record.record.severity = SeverityV1::Info;
            clear_incidental_correlations(&mut record.record);
            input.correlations.operation_ids = vec![record.record.operation_id.clone()];
        }
        4 => {
            record.record.severity = SeverityV1::Info;
            clear_incidental_correlations(&mut record.record);
        }
        _ => unreachable!(),
    }
    with_collector_records(input, vec![record])
}

fn clear_incidental_correlations(
    record: &mut proliferate_diagnostics_protocol::v1::types::ProducerRecordV1,
) {
    record.parent_operation_id = None;
    record.trace_id = None;
    record.workspace_id = None;
    record.session_id = None;
    record.turn_id = None;
    record.item_id = None;
    record.request_id = None;
    record.target_id = None;
    record.prompt_id = None;
    record.workflow_id = None;
}

fn removed_tiers(input: super::super::SupportAssemblyInputV1) -> [u64; 8] {
    let included = assemble_for_test(input.clone(), PACKAGE_BYTES, MANIFEST_BYTES)
        .expect("included correlated record");
    assemble_for_test(input, included.serialized_bytes - 1, MANIFEST_BYTES)
        .expect("degraded correlated record")
        .snapshot
        .manifest
        .degradation
        .removed_by_tier
}

fn fallback_input() -> super::super::SupportAssemblyInputV1 {
    let populated = input_from_fixture(SCHEMA_POPULATED);
    let mut input = non_session_input();
    let mut fallback = populated.fallback.into_iter().next().expect("fallback");
    if let Some(SupportFallbackCandidateValueV1::Record(record)) = &mut fallback.scrubbed.value {
        if let Some(detailed) = &mut record.record.detailed {
            detailed.message = Some("fallback detail ".repeat(180));
        }
    }
    input.fallback = vec![fallback];
    input
}

fn legacy_input() -> super::super::SupportAssemblyInputV1 {
    let populated = input_from_fixture(SCHEMA_POPULATED);
    let mut input = non_session_input();
    let mut legacy = populated.legacy.into_iter().next().expect("legacy");
    legacy.scrubbed.value.as_mut().expect("line").line.value = "legacy detail ".repeat(300);
    input.legacy = vec![legacy];
    input
}

fn session_input(recent: bool, raw_only: bool) -> super::super::SupportAssemblyInputV1 {
    let mut input = input_from_fixture(SCHEMA_POPULATED);
    input.collector_records.clear();
    input.fallback.clear();
    input.legacy.clear();
    if recent {
        input.mandatory.consent.selection = SupportSessionSelectionV1::RecentActivity;
        input.mandatory.selection.ui_session_id = None;
        input.mandatory.selection.materialized_session_id = None;
    }
    let SupportSessionAssemblyV1::Included { sessions, .. } = &mut input.sessions else {
        panic!("session fixture")
    };
    let session = &mut sessions[0];
    session.summary = candidate(None, 0, 0);
    session.normalized_events.clear();
    session.raw_notifications.clear();
    session.endpoint_states.events = SupportEndpointStateV1::Omitted;
    session.endpoint_states.raw_notifications = SupportEndpointStateV1::Omitted;
    if raw_only {
        session.raw_notifications = vec![candidate(
            Some(seq_value(1, &"raw detail ".repeat(360))),
            3,
            0,
        )];
        session.endpoint_states.raw_notifications = SupportEndpointStateV1::Included;
    } else {
        session.summary = candidate(
            Some(SupportJsonValueV1::String("session detail ".repeat(300))),
            3,
            0,
        );
    }
    set_session_list_state(
        &mut input,
        if raw_only {
            SupportEndpointStateV1::Omitted
        } else {
            SupportEndpointStateV1::Included
        },
    );
    input
}

fn optional_atoms(
    snapshot: &super::super::super::schema::model::snapshot::SupportSnapshotV3,
) -> usize {
    snapshot.records.len()
        + snapshot
            .fallback_evidence
            .iter()
            .map(|component| match component {
                super::super::super::schema::model::evidence::SupportFallbackComponentV1::Pr3DesktopNativeMixed { records, opaque_lines } => records.len() + opaque_lines.len(),
                super::super::super::schema::model::evidence::SupportFallbackComponentV1::Pr5Wrapped { records, .. } => records.len(),
            })
            .sum::<usize>()
        + snapshot
            .legacy_evidence
            .iter()
            .map(|source| source.lines.len())
            .sum::<usize>()
        + snapshot.session_ledger.as_ref().map_or(0, |ledger| {
            ledger.sessions.iter().map(|session| {
                usize::from(session.summary.is_some())
                    + session.normalized_events.len()
                    + session.raw_notifications.len()
            }).sum()
        })
}
