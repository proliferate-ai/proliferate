//! Exact eight-tier ordering and lifecycle admission groups.

use std::cmp::Ordering;
use std::collections::BTreeMap;

use chrono::{DateTime, Utc};
use proliferate_diagnostics_protocol::v1::types::{
    ComponentV1, LifecyclePhaseV1, ProducerRecordV1, RecordClassV1,
};

use super::super::schema::enums::{
    SupportEvidenceSourceV1, SupportLegacySourceKindV1, SupportSourceManifestSourceV1,
    SupportTruncationReasonV1,
};
use super::super::schema::limits::{
    CONTAINER_ITEMS, EVENTS_PER_SESSION, RAW_NOTIFICATIONS_PER_SESSION,
};
use super::candidate::AtomValue;
use super::input::SupportAssemblyError;

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum LifecycleDomain {
    Collector,
    Fallback,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub(super) struct LifecycleKey {
    domain: LifecycleDomain,
    component: ComponentV1,
    producer_boot_id: String,
    operation_id: String,
}

#[derive(Debug, Clone)]
pub(super) enum CandidateRank {
    Collector {
        accepted_order: u64,
        component: ComponentV1,
        producer_boot_id: String,
        producer_sequence: u64,
    },
    Fallback {
        semantic_group: u8,
        source_time: Option<DateTime<Utc>>,
        sequence: Option<u64>,
        component: u8,
        segment: u8,
        line: u64,
    },
    Session {
        source_time: Option<DateTime<Utc>>,
        sequence: Option<u64>,
        selection_index: u64,
    },
    Legacy {
        source: SupportLegacySourceKindV1,
        segment: u8,
        line: u64,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum ContainerKey {
    Collector,
    FallbackRecords(SupportSourceManifestSourceV1),
    FallbackOpaque,
    Legacy(SupportLegacySourceKindV1),
    SessionSummary(u64),
    SessionEvents(u64),
    SessionRaw(u64),
}

#[derive(Debug, Clone)]
pub(super) struct CandidateAtom {
    pub(super) value: AtomValue,
    pub(super) tier: u8,
    pub(super) rank: CandidateRank,
    pub(super) canonical_bytes: Vec<u8>,
    pub(super) included_bytes: u64,
    pub(super) original_index: u64,
    pub(super) manifest_source: SupportSourceManifestSourceV1,
    pub(super) evidence_source: SupportEvidenceSourceV1,
    pub(super) container: ContainerKey,
    pub(super) lifecycle: Option<(LifecycleKey, LifecyclePhaseV1)>,
}

#[derive(Debug, Clone)]
pub(super) struct CandidateGroup {
    pub(super) atoms: Vec<CandidateAtom>,
}

pub(super) struct GroupingResult {
    pub(super) groups: Vec<CandidateGroup>,
    pub(super) lone_lifecycle_sources: Vec<SupportEvidenceSourceV1>,
}

impl CandidateGroup {
    pub(super) fn tier(&self) -> u8 {
        self.atoms[0].tier
    }

    pub(super) fn item_count(&self) -> Result<u64, SupportAssemblyError> {
        u64::try_from(self.atoms.len()).map_err(|_| SupportAssemblyError::AccountingOverflow)
    }

    pub(super) fn canonical_len(&self) -> Result<u64, SupportAssemblyError> {
        self.atoms.iter().try_fold(0_u64, |total, atom| {
            let bytes = u64::try_from(atom.canonical_bytes.len())
                .map_err(|_| SupportAssemblyError::AccountingOverflow)?;
            total
                .checked_add(bytes)
                .ok_or(SupportAssemblyError::AccountingOverflow)
        })
    }

    pub(super) fn included_bytes(&self) -> Result<u64, SupportAssemblyError> {
        self.atoms.iter().try_fold(0_u64, |total, atom| {
            total
                .checked_add(atom.included_bytes)
                .ok_or(SupportAssemblyError::AccountingOverflow)
        })
    }

    pub(super) fn source(&self) -> SupportSourceManifestSourceV1 {
        self.atoms[0].manifest_source
    }

    pub(super) fn evidence_source(&self) -> SupportEvidenceSourceV1 {
        self.atoms[0].evidence_source
    }

    pub(super) fn container(&self) -> &ContainerKey {
        &self.atoms[0].container
    }
}

pub(super) fn lifecycle_identity(
    domain: LifecycleDomain,
    record: &ProducerRecordV1,
) -> Option<(LifecycleKey, LifecyclePhaseV1)> {
    let lifecycle = record.lifecycle.as_ref()?;
    if record.record_class != RecordClassV1::Lifecycle {
        return None;
    }
    Some((
        LifecycleKey {
            domain,
            component: record.component,
            producer_boot_id: record.producer_boot_id.clone(),
            operation_id: record.operation_id.clone(),
        },
        lifecycle.phase,
    ))
}

pub(super) fn group_atoms(mut atoms: Vec<CandidateAtom>) -> GroupingResult {
    atoms.sort_by(priority_cmp);
    let mut phases: BTreeMap<LifecycleKey, (Vec<usize>, Vec<usize>)> = BTreeMap::new();
    for (index, atom) in atoms.iter().enumerate() {
        if let Some((key, phase)) = &atom.lifecycle {
            let entry = phases.entry(key.clone()).or_default();
            match phase {
                LifecyclePhaseV1::Started => entry.0.push(index),
                LifecyclePhaseV1::Terminal => entry.1.push(index),
            }
        }
    }
    let mut pair_for = BTreeMap::new();
    let mut lone_lifecycle_sources = Vec::new();
    for (_, (starts, terminals)) in phases {
        if starts.len() == 1 && terminals.len() == 1 {
            pair_for.insert(starts[0], terminals[0]);
            pair_for.insert(terminals[0], starts[0]);
        } else if starts.len() + terminals.len() == 1 {
            let index = starts.first().or_else(|| terminals.first()).copied();
            if let Some(index) = index {
                lone_lifecycle_sources.push(atoms[index].evidence_source);
            }
        }
    }
    let mut slots: Vec<Option<CandidateAtom>> = atoms.into_iter().map(Some).collect();
    let mut groups = Vec::new();
    for index in 0..slots.len() {
        let Some(first) = slots[index].take() else {
            continue;
        };
        let mut group = vec![first];
        if let Some(pair) = pair_for.get(&index).copied() {
            if let Some(second) = slots[pair].take() {
                group.push(second);
                group.sort_by(priority_cmp);
            }
        }
        groups.push(CandidateGroup { atoms: group });
    }
    groups.sort_by(|left, right| priority_cmp(&left.atoms[0], &right.atoms[0]));
    GroupingResult {
        groups,
        lone_lifecycle_sources,
    }
}

pub(super) fn container_limit(key: &ContainerKey, collector_records: u64) -> u64 {
    match key {
        ContainerKey::Collector => collector_records,
        ContainerKey::SessionSummary(_) => 1,
        ContainerKey::SessionEvents(_) => EVENTS_PER_SESSION,
        ContainerKey::SessionRaw(_) => RAW_NOTIFICATIONS_PER_SESSION,
        ContainerKey::FallbackRecords(_)
        | ContainerKey::FallbackOpaque
        | ContainerKey::Legacy(_) => CONTAINER_ITEMS as u64,
    }
}

pub(super) fn priority_cmp(left: &CandidateAtom, right: &CandidateAtom) -> Ordering {
    left.tier
        .cmp(&right.tier)
        .then_with(|| compare_rank(&left.rank, &right.rank))
        .then_with(|| left.canonical_bytes.cmp(&right.canonical_bytes))
        .then_with(|| left.original_index.cmp(&right.original_index))
}

fn compare_rank(left: &CandidateRank, right: &CandidateRank) -> Ordering {
    match (left, right) {
        (
            CandidateRank::Collector {
                accepted_order: left_order,
                component: left_component,
                producer_boot_id: left_boot,
                producer_sequence: left_sequence,
            },
            CandidateRank::Collector {
                accepted_order: right_order,
                component: right_component,
                producer_boot_id: right_boot,
                producer_sequence: right_sequence,
            },
        ) => right_order
            .cmp(left_order)
            .then_with(|| left_component.cmp(right_component))
            .then_with(|| left_boot.cmp(right_boot))
            .then_with(|| left_sequence.cmp(right_sequence)),
        (
            CandidateRank::Fallback {
                semantic_group: left_group,
                source_time: left_time,
                sequence: left_sequence,
                component: left_component,
                segment: left_segment,
                line: left_line,
            },
            CandidateRank::Fallback {
                semantic_group: right_group,
                source_time: right_time,
                sequence: right_sequence,
                component: right_component,
                segment: right_segment,
                line: right_line,
            },
        ) => left_group
            .cmp(right_group)
            .then_with(|| cmp_option_desc(left_time, right_time))
            .then_with(|| cmp_option_desc(left_sequence, right_sequence))
            .then_with(|| left_component.cmp(right_component))
            .then_with(|| left_segment.cmp(right_segment))
            .then_with(|| right_line.cmp(left_line)),
        (
            CandidateRank::Session {
                source_time: left_time,
                sequence: left_sequence,
                selection_index: left_selection,
            },
            CandidateRank::Session {
                source_time: right_time,
                sequence: right_sequence,
                selection_index: right_selection,
            },
        ) => cmp_option_desc(left_time, right_time)
            .then_with(|| cmp_option_desc(left_sequence, right_sequence))
            .then_with(|| left_selection.cmp(right_selection)),
        (
            CandidateRank::Legacy {
                source: left_source,
                segment: left_segment,
                line: left_line,
            },
            CandidateRank::Legacy {
                source: right_source,
                segment: right_segment,
                line: right_line,
            },
        ) => left_source
            .cmp(right_source)
            .then_with(|| left_segment.cmp(right_segment))
            .then_with(|| right_line.cmp(left_line)),
        _ => rank_variant(left).cmp(&rank_variant(right)),
    }
}

fn cmp_option_desc<T: Ord>(left: &Option<T>, right: &Option<T>) -> Ordering {
    match (left, right) {
        (Some(left), Some(right)) => right.cmp(left),
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => Ordering::Equal,
    }
}

fn rank_variant(rank: &CandidateRank) -> u8 {
    match rank {
        CandidateRank::Collector { .. } => 0,
        CandidateRank::Fallback { .. } => 1,
        CandidateRank::Session { .. } => 2,
        CandidateRank::Legacy { .. } => 3,
    }
}

pub(super) fn cap_truncation_reason(key: &ContainerKey) -> SupportTruncationReasonV1 {
    match key {
        ContainerKey::SessionEvents(_) => SupportTruncationReasonV1::SessionEvents,
        ContainerKey::SessionRaw(_) => SupportTruncationReasonV1::RawNotifications,
        _ => SupportTruncationReasonV1::ContainerItems,
    }
}
