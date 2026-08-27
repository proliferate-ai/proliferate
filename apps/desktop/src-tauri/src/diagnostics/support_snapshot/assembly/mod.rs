//! Pure deterministic schema-3 support snapshot assembly.
//!
//! This subtree owns no clocks, I/O, process state, consent UI, staging,
//! archive, queue, or upload behavior.

use std::collections::{BTreeMap, BTreeSet};

use sha2::{Digest, Sha256};

use super::schema::enums::{
    SupportEvidenceSourceV1, SupportFallbackRecordComponentV1, SupportLegacySourceKindV1,
    SupportOmissionReasonV1, SupportSourceManifestSourceV1, SupportSourceStateV1,
    SupportTruncationReasonV1,
};
use super::schema::limits::{
    EVENT_RESPONSE_BYTES, MANIFEST_BYTES, PACKAGE_BYTES, RAW_NOTIFICATION_RESPONSE_BYTES,
    SESSION_BYTES, SESSION_EVIDENCE_BYTES, SESSION_LIST_RESPONSE_BYTES,
};
use super::schema::validate::{
    serialized_snapshot_bytes, stabilize_serialized_bytes, validate_snapshot,
};

mod accounting;
mod candidate;
mod input;
mod prepare;
mod presentation;
mod ranking;

pub use input::{
    SupportAssemblyCandidateV1, SupportAssemblyError, SupportAssemblyInputV1,
    SupportAssemblyMandatoryV1, SupportAssemblyOutputV1, SupportCorrelationSelectionV1,
    SupportFallbackCandidateValueV1, SupportLegacyCandidateValueV1, SupportSessionAssemblyV1,
    SupportSessionCandidateV1, SupportSourceCaptureV1,
};

use accounting::{AssemblyAccounting, SourceLedger};
use candidate::{collector_atom, fallback_atom, legacy_atom, normalize_correlations, AtomValue};
use prepare::{
    add_mandatory_omissions, collector_source_state, normalize_file_sources, prepare_sessions,
};
use presentation::{materialize, SessionPlan};
use ranking::{cap_truncation_reason, container_limit, group_atoms, CandidateGroup, ContainerKey};

/// Assemble, validate, compact-serialize, size, and hash one captured input.
pub fn assemble_support_snapshot(
    input: SupportAssemblyInputV1,
) -> Result<SupportAssemblyOutputV1, SupportAssemblyError> {
    assemble_with_caps(input, PACKAGE_BYTES, MANIFEST_BYTES)
}

fn assemble_with_caps(
    input: SupportAssemblyInputV1,
    package_cap: u64,
    skeleton_cap: u64,
) -> Result<SupportAssemblyOutputV1, SupportAssemblyError> {
    let SupportAssemblyInputV1 {
        mandatory,
        file_sources,
        collector_records,
        fallback,
        legacy,
        sessions,
        correlations,
        accounting: base_accounting,
    } = input;
    let correlations = normalize_correlations(correlations)?;
    let mut accounting = AssemblyAccounting::default();
    accounting.absorb_scrub(&base_accounting)?;
    add_mandatory_omissions(&mandatory, &mut accounting)?;

    let file_sources =
        normalize_file_sources(file_sources, &mandatory.generated_at, &mut accounting)?;
    let (session_plan, session_source, session_candidates) =
        prepare_sessions(sessions, &mandatory, &mut accounting)?;
    let collector_source = SupportSourceCaptureV1 {
        source: SupportSourceManifestSourceV1::Collector,
        state: collector_source_state(mandatory.collector.coverage.status),
        captured_at: mandatory.collector.captured_at.clone(),
        read_bytes: mandatory.collector.coverage.returned_record_bytes,
    };
    let mut captures = Vec::with_capacity(file_sources.len() + 2);
    captures.push(collector_source);
    captures.extend(file_sources);
    captures.push(session_source);
    let sources = SourceLedger::new(captures)?;

    let mut atoms = Vec::new();
    for candidate in collector_records {
        if let Some(atom) = collector_atom(
            candidate,
            &mandatory.collector,
            &mandatory.selection,
            &correlations,
            &mut accounting,
        )? {
            atoms.push(atom);
        }
    }
    for candidate in fallback {
        if let Some(atom) = fallback_atom(
            candidate,
            &mandatory.selection,
            &correlations,
            &mut accounting,
        )? {
            atoms.push(atom);
        }
    }
    for candidate in legacy {
        if let Some(atom) = legacy_atom(candidate, &mut accounting)? {
            atoms.push(atom);
        }
    }
    atoms.extend(session_candidates);

    let grouped = group_atoms(atoms);
    for source in grouped.lone_lifecycle_sources {
        accounting.add_omission(source, SupportOmissionReasonV1::RecordLimit, 1, None)?;
    }
    let selected = apply_pre_package_caps(
        grouped.groups,
        &sources,
        mandatory.collector.coverage.returned_records,
        &mut accounting,
    )?;
    let selected = apply_session_serialized_caps(
        selected,
        &mandatory,
        &sources,
        &session_plan,
        &mut accounting,
    )?;

    let mut skeleton = materialize(&mandatory, &sources, &session_plan, &[], &accounting)?;
    stabilize_serialized_bytes(&mut skeleton)?;
    if serialized_snapshot_bytes(&skeleton)? > skeleton_cap {
        return Err(SupportAssemblyError::MandatorySkeletonTooLarge);
    }
    validate_snapshot(&skeleton)?;
    let selected = admit_package_prefix(
        selected,
        serialized_snapshot_bytes(&skeleton)?,
        package_cap,
        &mut accounting,
    )?;

    degrade_to_package_cap(
        mandatory,
        sources,
        session_plan,
        selected,
        accounting,
        package_cap,
    )
}

fn admit_package_prefix(
    selected: Vec<CandidateGroup>,
    skeleton_bytes: u64,
    package_cap: u64,
    accounting: &mut AssemblyAccounting,
) -> Result<Vec<CandidateGroup>, SupportAssemblyError> {
    let budget = package_cap.saturating_sub(skeleton_bytes);
    let mut used = 0_u64;
    let mut admitted = Vec::new();
    let mut suffix = selected.into_iter();
    while let Some(group) = suffix.next() {
        // This is only a fast lower bound. A session summary replaces `null`,
        // while every other atom is inserted into an empty or populated
        // container. Underestimating by four bytes per atom guarantees an
        // exact-fit group is never rejected here; the fixed-point pass below
        // accounts for separators and manifest-counter growth exactly.
        let estimate = group
            .canonical_len()?
            .saturating_sub(group.item_count()?.saturating_mul(4));
        if used
            .checked_add(estimate)
            .is_some_and(|total| total <= budget)
        {
            used += estimate;
            admitted.push(group);
            continue;
        }
        accounting.note_package_removal(
            group.tier(),
            group.item_count()?,
            group.canonical_len()?,
        )?;
        for group in suffix {
            accounting.note_package_removal(
                group.tier(),
                group.item_count()?,
                group.canonical_len()?,
            )?;
        }
        break;
    }
    Ok(admitted)
}

fn degrade_to_package_cap(
    mandatory: SupportAssemblyMandatoryV1,
    sources: SourceLedger,
    session_plan: SessionPlan,
    mut selected: Vec<CandidateGroup>,
    mut accounting: AssemblyAccounting,
    package_cap: u64,
) -> Result<SupportAssemblyOutputV1, SupportAssemblyError> {
    let loop_bound = selected.len();
    for _ in 0..=loop_bound {
        let mut snapshot =
            materialize(&mandatory, &sources, &session_plan, &selected, &accounting)?;
        let serialized_bytes = stabilize_serialized_bytes(&mut snapshot)?;
        if serialized_bytes <= package_cap {
            validate_snapshot(&snapshot)?;
            let compact_json = serde_json::to_vec(&snapshot)
                .map_err(|_| SupportAssemblyError::SerializationFailed)?;
            let exact = u64::try_from(compact_json.len())
                .map_err(|_| SupportAssemblyError::AccountingOverflow)?;
            if exact != serialized_bytes {
                return Err(SupportAssemblyError::SerializationFailed);
            }
            let digest = Sha256::digest(&compact_json);
            let sha256 = digest.iter().map(|byte| format!("{byte:02x}")).collect();
            return Ok(SupportAssemblyOutputV1 {
                snapshot,
                compact_json,
                serialized_bytes,
                sha256,
            });
        }
        let removed = selected
            .pop()
            .ok_or(SupportAssemblyError::MandatorySkeletonTooLarge)?;
        accounting.note_package_removal(
            removed.tier(),
            removed.item_count()?,
            removed.canonical_len()?,
        )?;
    }
    Err(SupportAssemblyError::CandidateLoopExceeded)
}

#[cfg(test)]
pub(super) fn assemble_for_test(
    input: SupportAssemblyInputV1,
    package_cap: u64,
    skeleton_cap: u64,
) -> Result<SupportAssemblyOutputV1, SupportAssemblyError> {
    assemble_with_caps(input, package_cap, skeleton_cap)
}

fn apply_pre_package_caps(
    groups: Vec<CandidateGroup>,
    sources: &SourceLedger,
    collector_records: u64,
    accounting: &mut AssemblyAccounting,
) -> Result<Vec<CandidateGroup>, SupportAssemblyError> {
    let mut container_counts: BTreeMap<ContainerKey, u64> = BTreeMap::new();
    let mut session_bytes: BTreeMap<SessionByteBucket, u64> = BTreeMap::new();
    let mut source_bytes: BTreeMap<SupportSourceManifestSourceV1, u64> = BTreeMap::new();
    let mut identities = BTreeSet::new();
    let mut selected = Vec::new();
    for group in groups {
        let count = group.item_count()?;
        let bytes = group.included_bytes()?;
        let source = group.source();
        let state = sources.state(source);
        let group_identities: Vec<_> = group
            .atoms
            .iter()
            .flat_map(presentation_identities)
            .collect();
        let group_unique: BTreeSet<_> = group_identities.iter().cloned().collect();
        let duplicate = group_unique.len() != group_identities.len()
            || group_identities
                .iter()
                .any(|identity| identities.contains(identity));
        if state != Some(SupportSourceStateV1::Included) || duplicate {
            accounting.add_omission(
                group.evidence_source(),
                SupportOmissionReasonV1::SourceInvalid,
                count,
                Some(bytes),
            )?;
            continue;
        }
        let used_items = container_counts
            .get(group.container())
            .copied()
            .unwrap_or(0);
        let item_limit = container_limit(group.container(), collector_records);
        if used_items
            .checked_add(count)
            .is_none_or(|total| total > item_limit)
        {
            if matches!(group.container(), ContainerKey::Collector) {
                accounting.add_omission(
                    SupportEvidenceSourceV1::Collector,
                    SupportOmissionReasonV1::RecordLimit,
                    count,
                    Some(bytes),
                )?;
                accounting.add_truncation(
                    SupportEvidenceSourceV1::Collector,
                    SupportTruncationReasonV1::ContainerItems,
                    count,
                    Some(bytes),
                )?;
            } else {
                accounting.note_source_cap(
                    group.evidence_source(),
                    count,
                    bytes,
                    cap_truncation_reason(group.container()),
                )?;
            }
            continue;
        }
        let used_bytes = source_bytes.get(&source).copied().unwrap_or(0);
        let byte_limit = sources
            .read_bytes(source)
            .ok_or(SupportAssemblyError::InvalidSourceAccounting)?;
        if used_bytes
            .checked_add(bytes)
            .is_none_or(|total| total > byte_limit)
        {
            accounting.add_omission(
                group.evidence_source(),
                SupportOmissionReasonV1::ByteLimit,
                count,
                Some(bytes),
            )?;
            accounting.add_truncation(
                group.evidence_source(),
                SupportTruncationReasonV1::ComponentBytes,
                count,
                Some(bytes),
            )?;
            continue;
        }
        if let Some((bucket, limit, reason)) = session_byte_bucket(group.container()) {
            let used = session_bytes.get(&bucket).copied().unwrap_or(0);
            if used.checked_add(bytes).is_none_or(|total| total > limit) {
                accounting.note_source_cap(
                    SupportEvidenceSourceV1::SessionLedger,
                    count,
                    bytes,
                    reason,
                )?;
                continue;
            }
            session_bytes.insert(bucket, used + bytes);
        }
        container_counts.insert(group.container().clone(), used_items + count);
        source_bytes.insert(source, used_bytes + bytes);
        identities.extend(group_identities);
        selected.push(group);
    }
    Ok(selected)
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum SessionByteBucket {
    Summaries,
    Events(u64),
    Raw(u64),
}

fn session_byte_bucket(
    container: &ContainerKey,
) -> Option<(SessionByteBucket, u64, SupportTruncationReasonV1)> {
    match container {
        ContainerKey::SessionSummary(_) => Some((
            SessionByteBucket::Summaries,
            SESSION_LIST_RESPONSE_BYTES,
            SupportTruncationReasonV1::ComponentBytes,
        )),
        ContainerKey::SessionEvents(index) => Some((
            SessionByteBucket::Events(*index),
            EVENT_RESPONSE_BYTES,
            SupportTruncationReasonV1::SessionEvents,
        )),
        ContainerKey::SessionRaw(index) => Some((
            SessionByteBucket::Raw(*index),
            RAW_NOTIFICATION_RESPONSE_BYTES,
            SupportTruncationReasonV1::RawNotifications,
        )),
        _ => None,
    }
}

fn apply_session_serialized_caps(
    mut selected: Vec<CandidateGroup>,
    mandatory: &SupportAssemblyMandatoryV1,
    sources: &SourceLedger,
    session_plan: &SessionPlan,
    accounting: &mut AssemblyAccounting,
) -> Result<Vec<CandidateGroup>, SupportAssemblyError> {
    for _ in 0..=selected.len() {
        let snapshot = materialize(mandatory, sources, session_plan, &selected, accounting)?;
        let oversized_session = snapshot.session_ledger.as_ref().and_then(|ledger| {
            ledger
                .sessions
                .iter()
                .enumerate()
                .find_map(|(index, session)| {
                    serde_json::to_vec(session)
                        .ok()
                        .filter(|bytes| bytes.len() as u64 > SESSION_BYTES)
                        .map(|_| index as u64)
                })
        });
        let ledger_oversized = snapshot
            .session_ledger
            .as_ref()
            .and_then(|ledger| serde_json::to_vec(ledger).ok())
            .is_some_and(|bytes| bytes.len() as u64 > SESSION_EVIDENCE_BYTES);
        if oversized_session.is_none() && !ledger_oversized {
            return Ok(selected);
        }
        let removal = selected.iter().rposition(|group| {
            group.atoms.iter().any(|atom| match &atom.value {
                AtomValue::SessionSummary {
                    selection_index, ..
                }
                | AtomValue::SessionEvent {
                    selection_index, ..
                }
                | AtomValue::SessionRaw {
                    selection_index, ..
                } => oversized_session.is_none_or(|index| *selection_index == index),
                _ => false,
            })
        });
        let removed = removal
            .map(|index| selected.remove(index))
            .ok_or(SupportAssemblyError::InvalidSessionSource)?;
        accounting.note_source_cap(
            SupportEvidenceSourceV1::SessionLedger,
            removed.item_count()?,
            removed.canonical_len()?,
            SupportTruncationReasonV1::ComponentBytes,
        )?;
    }
    Err(SupportAssemblyError::CandidateLoopExceeded)
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum PresentationIdentity {
    CollectorAccepted(u64),
    CollectorCursor(u64),
    Fallback {
        component: SupportFallbackRecordComponentV1,
        producer_boot_id: String,
        producer_sequence: u64,
        segment: u8,
        line: u64,
    },
    FallbackOpaque(u8, u64),
    Legacy(SupportLegacySourceKindV1, u8, u64),
    SessionSummary(u64),
    SessionEvent(u64, i64),
    SessionRaw(u64, i64),
}

fn presentation_identities(atom: &ranking::CandidateAtom) -> Vec<PresentationIdentity> {
    match &atom.value {
        AtomValue::Collector(record) => vec![
            PresentationIdentity::CollectorAccepted(record.accepted_order),
            PresentationIdentity::CollectorCursor(record.retention_cursor),
        ],
        AtomValue::FallbackRecord(record) => vec![PresentationIdentity::Fallback {
            component: record.component,
            producer_boot_id: record.record.producer_boot_id.clone(),
            producer_sequence: record.record.producer_sequence,
            segment: record.segment,
            line: record.line,
        }],
        AtomValue::FallbackOpaque(line) => {
            vec![PresentationIdentity::FallbackOpaque(
                line.segment,
                line.line,
            )]
        }
        AtomValue::Legacy { source, line } => vec![PresentationIdentity::Legacy(
            *source,
            line.segment,
            line.line,
        )],
        AtomValue::SessionSummary {
            selection_index, ..
        } => vec![PresentationIdentity::SessionSummary(*selection_index)],
        AtomValue::SessionEvent {
            selection_index,
            value,
        } => vec![PresentationIdentity::SessionEvent(
            *selection_index,
            session_sequence(value),
        )],
        AtomValue::SessionRaw {
            selection_index,
            value,
        } => vec![PresentationIdentity::SessionRaw(
            *selection_index,
            session_sequence(value),
        )],
    }
}

fn session_sequence(value: &super::schema::model::common::SupportJsonValueV1) -> i64 {
    let super::schema::model::common::SupportJsonValueV1::Object(entries) = value else {
        return -1;
    };
    match entries.iter().find(|(key, _)| key == "seq") {
        Some((_, super::schema::model::common::SupportJsonValueV1::Integer(value))) => *value,
        _ => -1,
    }
}

#[cfg(test)]
mod tests;
