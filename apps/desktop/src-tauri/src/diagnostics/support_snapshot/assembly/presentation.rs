//! Canonical final section presentation and manifest materialization.

use std::collections::BTreeMap;

use super::super::schema::enums::{
    SupportChildComponentV1, SupportEndpointStateV1, SupportLegacySourceKindV1,
    SupportSessionOmissionReasonV1, SupportSourceManifestSourceV1, SupportSourceStateV1,
};
use super::super::schema::limits::{
    DEGRADATION_POLICY_VERSION, MANIFEST_SCHEMA_VERSION, MAX_GAP_ENTRIES, SNAPSHOT_SCHEMA_VERSION,
};
use super::super::schema::model::evidence::{
    SupportFallbackComponentV1, SupportFallbackRecordV1, SupportLegacyLineV1,
    SupportLegacySourceV1, SupportOpaqueFallbackLineV1, SupportSessionEndpointStatesV1,
    SupportSessionLedgerV1, SupportSessionV1,
};
use super::super::schema::model::manifest::{
    SupportDegradationV1, SupportSessionCollectionManifestV1, SupportSnapshotLimitsV1,
    SupportSnapshotManifestV1,
};
use super::super::schema::model::snapshot::SupportSnapshotV3;
use super::accounting::{AssemblyAccounting, SourceLedger};
use super::candidate::AtomValue;
use super::input::{SupportAssemblyError, SupportAssemblyMandatoryV1};
use super::ranking::CandidateGroup;

#[derive(Debug, Clone)]
pub(super) struct SessionShell {
    pub(super) selection_index: u64,
    pub(super) session_id: String,
    pub(super) summary_captured_at: String,
    pub(super) endpoint_states: SupportSessionEndpointStatesV1,
}

#[derive(Debug, Clone)]
pub(super) enum SessionPlan {
    Included {
        workspace_id: String,
        anyharness_workspace_id: String,
        session_list_state: SupportEndpointStateV1,
        shells: Vec<SessionShell>,
    },
    Omitted {
        reason: SupportSessionOmissionReasonV1,
    },
}

pub(super) fn materialize(
    mandatory: &SupportAssemblyMandatoryV1,
    base_sources: &SourceLedger,
    sessions: &SessionPlan,
    selected: &[CandidateGroup],
    accounting: &AssemblyAccounting,
) -> Result<SupportSnapshotV3, SupportAssemblyError> {
    let mut sources = base_sources.clone();
    let mut records = Vec::new();
    let mut desktop_records = Vec::new();
    let mut desktop_opaque = Vec::new();
    let mut anyharness_records = Vec::new();
    let mut worker_records = Vec::new();
    let mut legacy: BTreeMap<SupportLegacySourceKindV1, Vec<SupportLegacyLineV1>> = BTreeMap::new();
    let mut session_values: BTreeMap<u64, SessionValues> = BTreeMap::new();
    let mut included: BTreeMap<SupportSourceManifestSourceV1, (u64, u64)> = BTreeMap::new();

    for group in selected {
        for atom in &group.atoms {
            add_source_count(&mut included, atom.manifest_source, atom.included_bytes)?;
            match &atom.value {
                AtomValue::Collector(record) => records.push(record.clone()),
                AtomValue::FallbackRecord(record) => match atom.manifest_source {
                    SupportSourceManifestSourceV1::DesktopNativeFallback => {
                        desktop_records.push(record.clone())
                    }
                    SupportSourceManifestSourceV1::AnyharnessFallback => {
                        anyharness_records.push(record.clone())
                    }
                    SupportSourceManifestSourceV1::DesktopWorkerFallback => {
                        worker_records.push(record.clone())
                    }
                    _ => return Err(SupportAssemblyError::InvalidSourceAccounting),
                },
                AtomValue::FallbackOpaque(line) => desktop_opaque.push(line.clone()),
                AtomValue::Legacy { source, line } => {
                    legacy.entry(*source).or_default().push(line.clone());
                }
                AtomValue::SessionSummary {
                    selection_index,
                    value,
                } => {
                    session_values.entry(*selection_index).or_default().summary =
                        Some((value.clone(), atom.included_bytes));
                }
                AtomValue::SessionEvent {
                    selection_index,
                    value,
                } => session_values
                    .entry(*selection_index)
                    .or_default()
                    .events
                    .push((value.clone(), atom.included_bytes)),
                AtomValue::SessionRaw {
                    selection_index,
                    value,
                } => session_values
                    .entry(*selection_index)
                    .or_default()
                    .raw
                    .push((value.clone(), atom.included_bytes)),
            }
        }
    }

    records.sort_by_key(|record| record.accepted_order);
    sort_fallback_records(&mut desktop_records);
    sort_fallback_records(&mut anyharness_records);
    sort_fallback_records(&mut worker_records);
    desktop_opaque.sort_by(|left, right| {
        right
            .segment
            .cmp(&left.segment)
            .then_with(|| left.line.cmp(&right.line))
    });

    let fallback_evidence = fallback_sections(
        &sources,
        desktop_records,
        desktop_opaque,
        anyharness_records,
        worker_records,
    );
    let legacy_evidence = legacy_sections(&sources, legacy);
    let (session_ledger, session_collection, session_bytes) =
        session_sections(mandatory, sessions, session_values)?;

    for source in source_order() {
        let (bytes, items) = included.get(&source).copied().unwrap_or_default();
        if sources.state(source) == Some(SupportSourceStateV1::Included) {
            let (bytes, items) = match source {
                SupportSourceManifestSourceV1::Collector
                    if items == mandatory.collector.coverage.returned_records =>
                {
                    (mandatory.collector.coverage.returned_record_bytes, items)
                }
                SupportSourceManifestSourceV1::SessionLedger => session_bytes,
                _ => (bytes, items),
            };
            sources.set_included(source, bytes, items)?;
        }
    }

    let gap_count = mandatory.collector.gaps.len().min(MAX_GAP_ENTRIES);
    let additional_gaps = u64::try_from(mandatory.collector.gaps.len() - gap_count)
        .map_err(|_| SupportAssemblyError::AccountingOverflow)?;
    let (scrubbed, omissions, truncations, additional_entries) =
        accounting.materialize(additional_gaps);
    let manifest = SupportSnapshotManifestV1 {
        schema_version: MANIFEST_SCHEMA_VERSION,
        generated_at: mandatory.generated_at.clone(),
        serialized_bytes: 0,
        limits: SupportSnapshotLimitsV1::fixed(),
        collector: mandatory.collector.coverage.clone(),
        sources: sources.materialize(),
        session_collection,
        gaps: mandatory.collector.gaps[..gap_count].to_vec(),
        omissions,
        truncations,
        scrubbed_by_class: scrubbed,
        degradation: SupportDegradationV1 {
            policy_version: DEGRADATION_POLICY_VERSION,
            removed_by_tier: accounting.removed_by_tier,
        },
        additional_entries,
    };
    Ok(SupportSnapshotV3 {
        schema_version: SNAPSHOT_SCHEMA_VERSION,
        snapshot_id: mandatory.snapshot_id.clone(),
        generated_at: mandatory.generated_at.clone(),
        app: mandatory.app.clone(),
        consent: mandatory.consent.clone(),
        selection: mandatory.selection.clone(),
        collector: mandatory.collector.clone(),
        producer_health: mandatory.producer_health.clone(),
        records,
        fallback_evidence,
        legacy_evidence,
        session_ledger,
        manifest,
    })
}

#[derive(Debug, Clone, Default)]
struct SessionValues {
    summary: Option<(super::super::schema::model::common::SupportJsonValueV1, u64)>,
    events: Vec<(super::super::schema::model::common::SupportJsonValueV1, u64)>,
    raw: Vec<(super::super::schema::model::common::SupportJsonValueV1, u64)>,
}

fn session_sections(
    mandatory: &SupportAssemblyMandatoryV1,
    plan: &SessionPlan,
    mut values: BTreeMap<u64, SessionValues>,
) -> Result<
    (
        Option<SupportSessionLedgerV1>,
        SupportSessionCollectionManifestV1,
        (u64, u64),
    ),
    SupportAssemblyError,
> {
    let SessionPlan::Included {
        workspace_id,
        anyharness_workspace_id,
        session_list_state,
        shells,
    } = plan
    else {
        let SessionPlan::Omitted { reason } = plan else {
            unreachable!()
        };
        return Ok((
            None,
            SupportSessionCollectionManifestV1::Omitted { reason: *reason },
            (0, 0),
        ));
    };
    let mut session_bytes = 0_u64;
    let mut event_bytes = 0_u64;
    let mut raw_bytes = 0_u64;
    let mut limit_uncertain =
        u64::from(*session_list_state == SupportEndpointStateV1::LimitUncertain);
    let mut sessions = Vec::with_capacity(shells.len());
    for shell in shells {
        let mut selected = values.remove(&shell.selection_index).unwrap_or_default();
        selected.events.sort_by_key(|(value, _)| sequence(value));
        selected.raw.sort_by_key(|(value, _)| sequence(value));
        if let Some((_, bytes)) = &selected.summary {
            session_bytes = checked_add(session_bytes, *bytes)?;
        }
        for (_, bytes) in &selected.events {
            event_bytes = checked_add(event_bytes, *bytes)?;
        }
        for (_, bytes) in &selected.raw {
            raw_bytes = checked_add(raw_bytes, *bytes)?;
        }
        limit_uncertain = checked_add(
            limit_uncertain,
            [
                shell.endpoint_states.events,
                shell.endpoint_states.raw_notifications,
            ]
            .into_iter()
            .filter(|state| *state == SupportEndpointStateV1::LimitUncertain)
            .count() as u64,
        )?;
        let mut endpoint_states = shell.endpoint_states.clone();
        if selected.summary.is_none() && endpoint_states.summary == SupportEndpointStateV1::Included
        {
            endpoint_states.summary = SupportEndpointStateV1::Omitted;
        }
        sessions.push(SupportSessionV1 {
            session_id: shell.session_id.clone(),
            summary_captured_at: shell.summary_captured_at.clone(),
            summary: selected.summary.map(|(value, _)| value),
            normalized_events: selected
                .events
                .into_iter()
                .map(|(value, _)| value)
                .collect(),
            raw_notifications: selected.raw.into_iter().map(|(value, _)| value).collect(),
            endpoint_states,
        });
    }
    let selected_sessions =
        u64::try_from(sessions.len()).map_err(|_| SupportAssemblyError::AccountingOverflow)?;
    let total_bytes = checked_add(checked_add(session_bytes, event_bytes)?, raw_bytes)?;
    Ok((
        Some(SupportSessionLedgerV1 {
            workspace_id: workspace_id.clone(),
            anyharness_workspace_id: anyharness_workspace_id.clone(),
            selection: mandatory.consent.selection,
            sessions,
        }),
        SupportSessionCollectionManifestV1::Included {
            workspace_id: workspace_id.clone(),
            anyharness_workspace_id: anyharness_workspace_id.clone(),
            selected_sessions,
            session_included_bytes: session_bytes,
            event_included_bytes: event_bytes,
            raw_notification_included_bytes: raw_bytes,
            limit_uncertain_endpoints: limit_uncertain,
        },
        (total_bytes, selected_sessions),
    ))
}

fn fallback_sections(
    sources: &SourceLedger,
    desktop_records: Vec<SupportFallbackRecordV1>,
    desktop_opaque: Vec<SupportOpaqueFallbackLineV1>,
    anyharness_records: Vec<SupportFallbackRecordV1>,
    worker_records: Vec<SupportFallbackRecordV1>,
) -> Vec<SupportFallbackComponentV1> {
    let mut sections = Vec::new();
    if sources.state(SupportSourceManifestSourceV1::DesktopNativeFallback)
        == Some(SupportSourceStateV1::Included)
    {
        sections.push(SupportFallbackComponentV1::Pr3DesktopNativeMixed {
            records: desktop_records,
            opaque_lines: desktop_opaque,
        });
    }
    if sources.state(SupportSourceManifestSourceV1::AnyharnessFallback)
        == Some(SupportSourceStateV1::Included)
    {
        sections.push(SupportFallbackComponentV1::Pr5Wrapped {
            component: SupportChildComponentV1::Anyharness,
            records: anyharness_records,
            opaque_lines: Vec::new(),
        });
    }
    if sources.state(SupportSourceManifestSourceV1::DesktopWorkerFallback)
        == Some(SupportSourceStateV1::Included)
    {
        sections.push(SupportFallbackComponentV1::Pr5Wrapped {
            component: SupportChildComponentV1::DesktopWorker,
            records: worker_records,
            opaque_lines: Vec::new(),
        });
    }
    sections
}

fn legacy_sections(
    sources: &SourceLedger,
    mut selected: BTreeMap<SupportLegacySourceKindV1, Vec<SupportLegacyLineV1>>,
) -> Vec<SupportLegacySourceV1> {
    let mut sections = Vec::new();
    for source in legacy_order() {
        let manifest_source = super::candidate::legacy_source(source);
        if sources.state(manifest_source) != Some(SupportSourceStateV1::Included) {
            continue;
        }
        let mut lines = selected.remove(&source).unwrap_or_default();
        lines.sort_by(|left, right| {
            right
                .segment
                .cmp(&left.segment)
                .then_with(|| left.line.cmp(&right.line))
        });
        sections.push(SupportLegacySourceV1 {
            source,
            lines,
            semantic_claims: false,
        });
    }
    sections
}

fn sort_fallback_records(records: &mut [SupportFallbackRecordV1]) {
    records.sort_by(|left, right| {
        left.component
            .cmp(&right.component)
            .then_with(|| {
                left.record
                    .producer_boot_id
                    .cmp(&right.record.producer_boot_id)
            })
            .then_with(|| {
                left.record
                    .producer_sequence
                    .cmp(&right.record.producer_sequence)
            })
            .then_with(|| right.segment.cmp(&left.segment))
            .then_with(|| left.line.cmp(&right.line))
    });
}

fn sequence(value: &super::super::schema::model::common::SupportJsonValueV1) -> u64 {
    let super::super::schema::model::common::SupportJsonValueV1::Object(entries) = value else {
        return u64::MAX;
    };
    match entries.iter().find(|(key, _)| key == "seq") {
        Some((_, super::super::schema::model::common::SupportJsonValueV1::Integer(value))) => {
            *value as u64
        }
        _ => u64::MAX,
    }
}

fn add_source_count(
    included: &mut BTreeMap<SupportSourceManifestSourceV1, (u64, u64)>,
    source: SupportSourceManifestSourceV1,
    bytes: u64,
) -> Result<(), SupportAssemblyError> {
    let entry = included.entry(source).or_default();
    entry.0 = checked_add(entry.0, bytes)?;
    entry.1 = checked_add(entry.1, 1)?;
    Ok(())
}

fn checked_add(left: u64, right: u64) -> Result<u64, SupportAssemblyError> {
    left.checked_add(right)
        .ok_or(SupportAssemblyError::AccountingOverflow)
}

fn source_order() -> [SupportSourceManifestSourceV1; 9] {
    [
        SupportSourceManifestSourceV1::Collector,
        SupportSourceManifestSourceV1::DesktopNativeFallback,
        SupportSourceManifestSourceV1::AnyharnessFallback,
        SupportSourceManifestSourceV1::DesktopWorkerFallback,
        SupportSourceManifestSourceV1::RendererLegacy,
        SupportSourceManifestSourceV1::AnyharnessLegacy,
        SupportSourceManifestSourceV1::WorkerLegacyV2,
        SupportSourceManifestSourceV1::WorkerLegacyV1,
        SupportSourceManifestSourceV1::SessionLedger,
    ]
}

fn legacy_order() -> [SupportLegacySourceKindV1; 4] {
    [
        SupportLegacySourceKindV1::RendererDiagnostics,
        SupportLegacySourceKindV1::AnyharnessPrimary,
        SupportLegacySourceKindV1::WorkerPrimaryV2,
        SupportLegacySourceKindV1::WorkerPrimaryV1,
    ]
}
