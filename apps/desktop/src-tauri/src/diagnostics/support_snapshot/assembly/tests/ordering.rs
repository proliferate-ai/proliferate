use chrono::{DateTime, Utc};
use proliferate_diagnostics_protocol::v1::types::ComponentV1;

use super::super::super::schema::enums::{
    SupportEvidenceSourceV1, SupportLegacySourceKindV1, SupportSourceManifestSourceV1,
};
use super::super::super::schema::model::common::SupportJsonValueV1;
use super::super::accounting::AssemblyAccounting;
use super::super::candidate::{collector_atom, fallback_atom, normalize_correlations, AtomValue};
use super::super::ranking::{
    group_atoms, priority_cmp, CandidateAtom, CandidateRank, ContainerKey,
};
use super::super::{
    assemble_support_snapshot, SupportCorrelationSelectionV1, SupportFallbackCandidateValueV1,
};
use super::{
    candidate, input_from_fixture, lifecycle_records, with_collector_records, SCHEMA_POPULATED,
};

#[test]
fn reversed_capture_and_completion_vectors_are_byte_identical() {
    let forward = input_from_fixture(SCHEMA_POPULATED);
    let mut reversed = forward.clone();
    reversed.file_sources.reverse();
    reversed.collector_records.reverse();
    reversed.fallback.reverse();
    reversed.legacy.reverse();
    reversed.correlations.operation_ids.reverse();
    if let super::super::SupportSessionAssemblyV1::Included { sessions, .. } =
        &mut reversed.sessions
    {
        sessions.reverse();
        for session in sessions {
            session.normalized_events.reverse();
            session.raw_notifications.reverse();
        }
    }
    let forward = assemble_support_snapshot(forward).expect("forward");
    let reversed = assemble_support_snapshot(reversed).expect("reversed");
    assert_eq!(forward.compact_json, reversed.compact_json);
    assert_eq!(forward.sha256, reversed.sha256);
}

#[test]
fn collector_selection_ranks_newest_but_presents_accepted_order_ascending() {
    let base = input_from_fixture(SCHEMA_POPULATED);
    let prototype = base.collector_records[0]
        .scrubbed
        .value
        .clone()
        .expect("record");
    let mut records = Vec::new();
    for (accepted_order, producer_sequence) in [(39, 3), (40, 2), (41, 1)] {
        let mut record = prototype.clone();
        record.accepted_order = accepted_order;
        record.retention_cursor = accepted_order;
        record.record.producer_sequence = producer_sequence;
        records.push(record);
    }
    let mut input = with_collector_records(base, records);
    input.collector_records.reverse();
    let output = assemble_support_snapshot(input).expect("ordered output");
    assert_eq!(
        output
            .snapshot
            .records
            .iter()
            .map(|record| record.accepted_order)
            .collect::<Vec<_>>(),
        vec![39, 40, 41]
    );
}

#[test]
fn exact_lifecycle_pair_is_one_group_and_lone_or_duplicate_phases_are_not() {
    let input = input_from_fixture(SCHEMA_POPULATED);
    let correlations =
        normalize_correlations(SupportCorrelationSelectionV1::default()).expect("correlations");
    let (started, terminal) = lifecycle_records();
    let collector = lifecycle_collector(&input.mandatory.collector);
    let mut accounting = AssemblyAccounting::default();
    let start_atom = collector_atom(
        candidate(Some(started.clone()), 1, 0),
        &collector,
        &input.mandatory.selection,
        &correlations,
        &mut accounting,
    )
    .expect("start")
    .expect("start atom");
    let terminal_atom = collector_atom(
        candidate(Some(terminal.clone()), 1, 1),
        &collector,
        &input.mandatory.selection,
        &correlations,
        &mut accounting,
    )
    .expect("terminal")
    .expect("terminal atom");
    let paired = group_atoms(vec![terminal_atom.clone(), start_atom.clone()]);
    assert_eq!(paired.groups.len(), 1);
    assert_eq!(paired.groups[0].atoms.len(), 2);
    assert!(paired.lone_lifecycle_sources.is_empty());

    let lone = group_atoms(vec![start_atom.clone()]);
    assert_eq!(lone.groups.len(), 1);
    assert_eq!(lone.lone_lifecycle_sources.len(), 1);

    let duplicate = group_atoms(vec![start_atom.clone(), start_atom, terminal_atom]);
    assert_eq!(duplicate.groups.len(), 3);
    assert!(duplicate.groups.iter().all(|group| group.atoms.len() == 1));
    assert!(duplicate.lone_lifecycle_sources.is_empty());
}

#[test]
fn mismatched_operation_ids_never_form_a_lifecycle_group() {
    let input = input_from_fixture(SCHEMA_POPULATED);
    let correlations =
        normalize_correlations(SupportCorrelationSelectionV1::default()).expect("correlations");
    let (started, mut terminal) = lifecycle_records();
    terminal.record.operation_id = "different-operation".to_owned();
    let collector = lifecycle_collector(&input.mandatory.collector);
    let mut accounting = AssemblyAccounting::default();
    let atoms = [started, terminal]
        .into_iter()
        .enumerate()
        .map(|(index, record)| {
            collector_atom(
                candidate(Some(record), 1, index as u64),
                &collector,
                &input.mandatory.selection,
                &correlations,
                &mut accounting,
            )
            .expect("candidate")
            .expect("atom")
        })
        .collect();
    let grouped = group_atoms(atoms);
    assert_eq!(grouped.groups.len(), 2);
    assert_eq!(grouped.lone_lifecycle_sources.len(), 2);
}

fn lifecycle_collector(
    collector: &super::super::super::schema::model::evidence::SupportCollectorEvidenceV1,
) -> super::super::super::schema::model::evidence::SupportCollectorEvidenceV1 {
    let mut collector = collector.clone();
    collector.coverage.cursor_start = Some(39);
    collector.coverage.cursor_end = Some(40);
    collector.coverage.health_oldest_cursor = Some(39);
    collector.coverage.health_newest_cursor = Some(40);
    collector
}

#[test]
fn every_rank_field_and_owned_tie_break_is_total() {
    let time = DateTime::<Utc>::from_timestamp(1_786_488_000, 0).expect("time");
    let ranks = vec![
        CandidateRank::Collector {
            accepted_order: 9,
            component: ComponentV1::DesktopTauri,
            producer_boot_id: "boot-b".to_owned(),
            producer_sequence: 2,
        },
        CandidateRank::Fallback {
            semantic_group: 0,
            source_time: Some(time),
            sequence: Some(9),
            component: 1,
            segment: 0,
            line: 2,
        },
        CandidateRank::Session {
            source_time: Some(time),
            sequence: Some(9),
            selection_index: 1,
        },
        CandidateRank::Legacy {
            source: SupportLegacySourceKindV1::RendererDiagnostics,
            segment: 0,
            line: 9,
        },
    ];
    for (variant, rank) in ranks.into_iter().enumerate() {
        let mut left = ranked_atom(variant as u8 + 1, rank.clone(), b"a", 1);
        let mut right = ranked_atom(variant as u8 + 1, rank, b"b", 0);
        assert!(
            priority_cmp(&left, &right).is_lt(),
            "canonical bytes break ties"
        );
        right.canonical_bytes = left.canonical_bytes.clone();
        assert!(
            priority_cmp(&left, &right).is_gt(),
            "owned index is final tie"
        );
        left.original_index = 0;
        assert!(priority_cmp(&left, &right).is_eq());
    }
}

#[test]
fn rank_tuple_fields_follow_the_pinned_directions() {
    let early = DateTime::<Utc>::from_timestamp(1_786_488_000, 0).expect("early");
    let late = DateTime::<Utc>::from_timestamp(1_786_488_001, 0).expect("late");
    assert_ranked_before(
        CandidateRank::Collector {
            accepted_order: 10,
            component: ComponentV1::DesktopTauri,
            producer_boot_id: "boot-b".to_owned(),
            producer_sequence: 2,
        },
        CandidateRank::Collector {
            accepted_order: 9,
            component: ComponentV1::DesktopRenderer,
            producer_boot_id: "boot-a".to_owned(),
            producer_sequence: 1,
        },
        "collector accepted order desc",
    );
    assert_ranked_before(
        collector_rank(9, ComponentV1::DesktopRenderer, "boot-z", 9),
        collector_rank(9, ComponentV1::DesktopTauri, "boot-a", 1),
        "collector component",
    );
    assert_ranked_before(
        collector_rank(9, ComponentV1::DesktopTauri, "boot-a", 9),
        collector_rank(9, ComponentV1::DesktopTauri, "boot-b", 1),
        "collector boot id",
    );
    assert_ranked_before(
        collector_rank(9, ComponentV1::DesktopTauri, "boot-a", 1),
        collector_rank(9, ComponentV1::DesktopTauri, "boot-a", 2),
        "collector producer sequence",
    );
    for (left, right, field) in [
        (
            CandidateRank::Fallback {
                semantic_group: 0,
                source_time: Some(early),
                sequence: Some(1),
                component: 1,
                segment: 1,
                line: 1,
            },
            CandidateRank::Fallback {
                semantic_group: 1,
                source_time: Some(late),
                sequence: Some(2),
                component: 0,
                segment: 0,
                line: 2,
            },
            "fallback semantic group",
        ),
        (
            CandidateRank::Fallback {
                semantic_group: 0,
                source_time: Some(late),
                sequence: Some(1),
                component: 1,
                segment: 1,
                line: 1,
            },
            CandidateRank::Fallback {
                semantic_group: 0,
                source_time: Some(early),
                sequence: Some(9),
                component: 0,
                segment: 0,
                line: 9,
            },
            "fallback source time desc",
        ),
        (
            CandidateRank::Fallback {
                semantic_group: 0,
                source_time: Some(late),
                sequence: Some(9),
                component: 1,
                segment: 1,
                line: 1,
            },
            CandidateRank::Fallback {
                semantic_group: 0,
                source_time: Some(late),
                sequence: Some(8),
                component: 0,
                segment: 0,
                line: 9,
            },
            "fallback sequence desc",
        ),
        (
            CandidateRank::Fallback {
                semantic_group: 0,
                source_time: None,
                sequence: None,
                component: 0,
                segment: 0,
                line: 9,
            },
            CandidateRank::Fallback {
                semantic_group: 0,
                source_time: None,
                sequence: None,
                component: 1,
                segment: 0,
                line: 10,
            },
            "fallback component",
        ),
        (
            CandidateRank::Fallback {
                semantic_group: 0,
                source_time: None,
                sequence: None,
                component: 0,
                segment: 0,
                line: 1,
            },
            CandidateRank::Fallback {
                semantic_group: 0,
                source_time: None,
                sequence: None,
                component: 0,
                segment: 1,
                line: 9,
            },
            "fallback active segment",
        ),
        (
            CandidateRank::Fallback {
                semantic_group: 0,
                source_time: None,
                sequence: None,
                component: 0,
                segment: 0,
                line: 9,
            },
            CandidateRank::Fallback {
                semantic_group: 0,
                source_time: None,
                sequence: None,
                component: 0,
                segment: 0,
                line: 8,
            },
            "fallback line desc",
        ),
    ] {
        assert_ranked_before(left, right, field);
    }
    assert_ranked_before(
        CandidateRank::Session {
            source_time: Some(late),
            sequence: Some(1),
            selection_index: 1,
        },
        CandidateRank::Session {
            source_time: Some(early),
            sequence: Some(9),
            selection_index: 0,
        },
        "session source time desc",
    );
    assert_ranked_before(
        session_rank(Some(late), Some(9), 1),
        session_rank(Some(late), Some(8), 0),
        "session sequence desc",
    );
    assert_ranked_before(
        session_rank(None, None, 0),
        session_rank(None, None, 1),
        "session selection order",
    );
    assert_ranked_before(
        CandidateRank::Legacy {
            source: SupportLegacySourceKindV1::RendererDiagnostics,
            segment: 0,
            line: 9,
        },
        CandidateRank::Legacy {
            source: SupportLegacySourceKindV1::AnyharnessPrimary,
            segment: 1,
            line: 8,
        },
        "legacy source then recency",
    );
    assert_ranked_before(
        legacy_rank(SupportLegacySourceKindV1::RendererDiagnostics, 0, 1),
        legacy_rank(SupportLegacySourceKindV1::RendererDiagnostics, 1, 9),
        "legacy active segment",
    );
    assert_ranked_before(
        legacy_rank(SupportLegacySourceKindV1::RendererDiagnostics, 0, 9),
        legacy_rank(SupportLegacySourceKindV1::RendererDiagnostics, 0, 8),
        "legacy line desc",
    );
}

#[test]
fn equal_instant_offset_fallback_uses_the_next_rank_field() {
    let input = input_from_fixture(SCHEMA_POPULATED);
    let correlations =
        normalize_correlations(SupportCorrelationSelectionV1::default()).expect("correlations");
    let prototype = input
        .fallback
        .iter()
        .find_map(|candidate| match candidate.scrubbed.value.as_ref() {
            Some(SupportFallbackCandidateValueV1::Record(record))
                if record.component
                    == super::super::super::schema::enums::SupportFallbackRecordComponentV1::DesktopTauri =>
            {
                Some(record.clone())
            }
            _ => None,
        })
        .expect("desktop fallback record");
    let mut earlier_sequence = prototype.clone();
    earlier_sequence.record.source_timestamp = "2026-08-11T23:50:00Z".to_owned();
    earlier_sequence.record.producer_sequence = 1;
    earlier_sequence.line = 1;
    let mut later_sequence = prototype;
    later_sequence.record.source_timestamp = "2026-08-12T00:50:00+01:00".to_owned();
    later_sequence.record.producer_sequence = 2;
    later_sequence.line = 2;
    let mut accounting = AssemblyAccounting::default();
    let earlier = fallback_atom(
        candidate(
            Some(SupportFallbackCandidateValueV1::Record(earlier_sequence)),
            1,
            0,
        ),
        &input.mandatory.selection,
        &correlations,
        &mut accounting,
    )
    .expect("earlier sequence")
    .expect("earlier atom");
    let later = fallback_atom(
        candidate(
            Some(SupportFallbackCandidateValueV1::Record(later_sequence)),
            1,
            1,
        ),
        &input.mandatory.selection,
        &correlations,
        &mut accounting,
    )
    .expect("later sequence")
    .expect("later atom");
    assert!(priority_cmp(&later, &earlier).is_lt());
}

fn assert_ranked_before(left: CandidateRank, right: CandidateRank, field: &str) {
    let left = ranked_atom(5, left, b"same", 0);
    let right = ranked_atom(5, right, b"same", 0);
    assert!(priority_cmp(&left, &right).is_lt(), "{field}");
}

fn collector_rank(
    accepted_order: u64,
    component: ComponentV1,
    producer_boot_id: &str,
    producer_sequence: u64,
) -> CandidateRank {
    CandidateRank::Collector {
        accepted_order,
        component,
        producer_boot_id: producer_boot_id.to_owned(),
        producer_sequence,
    }
}

fn session_rank(
    source_time: Option<DateTime<Utc>>,
    sequence: Option<u64>,
    selection_index: u64,
) -> CandidateRank {
    CandidateRank::Session {
        source_time,
        sequence,
        selection_index,
    }
}

fn legacy_rank(source: SupportLegacySourceKindV1, segment: u8, line: u64) -> CandidateRank {
    CandidateRank::Legacy {
        source,
        segment,
        line,
    }
}

fn ranked_atom(tier: u8, rank: CandidateRank, bytes: &[u8], original_index: u64) -> CandidateAtom {
    CandidateAtom {
        value: AtomValue::SessionSummary {
            selection_index: 0,
            value: SupportJsonValueV1::Null,
        },
        tier,
        rank,
        canonical_bytes: bytes.to_vec(),
        included_bytes: 0,
        original_index,
        manifest_source: SupportSourceManifestSourceV1::SessionLedger,
        evidence_source: SupportEvidenceSourceV1::SessionLedger,
        container: ContainerKey::SessionSummary(0),
        lifecycle: None,
    }
}
