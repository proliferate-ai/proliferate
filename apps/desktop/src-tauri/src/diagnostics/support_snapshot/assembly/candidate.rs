//! Optional atom validation, classification, total ordering, and grouping.

use proliferate_diagnostics_protocol::v1::types::{
    CollectorAcceptedRecordV1, ComponentV1, DetailedKindV1, ExportStreamFrameV1, ProducerRecordV1,
    RecordClassV1, RedactionClassificationV1, SeverityV1, SourceV1,
};
use proliferate_diagnostics_protocol::v1::validation::{
    validate_export_frame, validate_producer_record,
};
use serde::Serialize;

use super::super::schema::enums::{
    SupportEvidenceSourceV1, SupportFallbackDispositionV1, SupportFallbackRecordComponentV1,
    SupportLegacySourceKindV1, SupportOmissionReasonV1, SupportSourceManifestSourceV1,
};
use super::super::schema::limits::CONTAINER_ITEMS;
use super::super::schema::model::common::SupportJsonValueV1;
use super::super::schema::model::evidence::{
    SupportCollectorEvidenceV1, SupportFallbackRecordV1, SupportLegacyLineV1,
    SupportOpaqueFallbackLineV1,
};
use super::super::schema::model::snapshot::SupportSelectionV1;
use super::super::schema::validate::{
    parse_protocol_timestamp, validate_content_string, validate_id, validate_safe_i64,
    validate_safe_u64, validate_support_json_value, validate_timestamp,
};
use super::accounting::AssemblyAccounting;
use super::input::{
    SupportAssemblyCandidateV1, SupportAssemblyError, SupportCorrelationSelectionV1,
    SupportFallbackCandidateValueV1, SupportLegacyCandidateValueV1,
};
use super::ranking::{
    lifecycle_identity, CandidateAtom, CandidateRank, ContainerKey, LifecycleDomain,
};

#[derive(Debug, Clone)]
pub(super) enum AtomValue {
    Collector(CollectorAcceptedRecordV1),
    FallbackRecord(SupportFallbackRecordV1),
    FallbackOpaque(SupportOpaqueFallbackLineV1),
    Legacy {
        source: SupportLegacySourceKindV1,
        line: SupportLegacyLineV1,
    },
    SessionSummary {
        selection_index: u64,
        value: SupportJsonValueV1,
    },
    SessionEvent {
        selection_index: u64,
        value: SupportJsonValueV1,
    },
    SessionRaw {
        selection_index: u64,
        value: SupportJsonValueV1,
    },
}

pub(super) fn normalize_correlations(
    mut correlations: SupportCorrelationSelectionV1,
) -> Result<SupportCorrelationSelectionV1, SupportAssemblyError> {
    for values in [
        &mut correlations.operation_ids,
        &mut correlations.turn_ids,
        &mut correlations.item_ids,
        &mut correlations.prompt_ids,
        &mut correlations.request_ids,
        &mut correlations.target_ids,
        &mut correlations.workflow_ids,
    ] {
        if values.len() > CONTAINER_ITEMS {
            return Err(SupportAssemblyError::InvalidCorrelationSelection);
        }
        for value in values.iter() {
            validate_id(value).map_err(|_| SupportAssemblyError::InvalidCorrelationSelection)?;
        }
        values.sort();
        values.dedup();
    }
    Ok(correlations)
}

pub(super) fn collector_atom(
    candidate: SupportAssemblyCandidateV1<CollectorAcceptedRecordV1>,
    collector: &SupportCollectorEvidenceV1,
    selection: &SupportSelectionV1,
    correlations: &SupportCorrelationSelectionV1,
    accounting: &mut AssemblyAccounting,
) -> Result<Option<CandidateAtom>, SupportAssemblyError> {
    accounting.absorb_scrub(&candidate.scrubbed.accounting)?;
    let Some(record) = candidate.scrubbed.value else {
        return Ok(None);
    };
    let valid = validate_safe_u64(candidate.included_bytes).is_ok()
        && validate_safe_u64(candidate.original_index).is_ok()
        && validate_export_frame(&ExportStreamFrameV1::Record {
            record: record.clone(),
        })
        .is_ok()
        && record.record.redaction == RedactionClassificationV1::SupportExport
        && record.record.component != ComponentV1::Server
        && collector_record_in_bounds(&record, collector, selection);
    if !valid {
        note_invalid(
            accounting,
            SupportEvidenceSourceV1::Collector,
            candidate.included_bytes,
        )?;
        return Ok(None);
    }
    let canonical_bytes = encode_optional(&record, accounting, SupportEvidenceSourceV1::Collector)?;
    let tier = if priority_record(&record.record) {
        2
    } else if correlated(&record.record, selection, correlations) {
        3
    } else {
        4
    };
    let lifecycle = lifecycle_identity(LifecycleDomain::Collector, &record.record);
    Ok(Some(CandidateAtom {
        rank: CandidateRank::Collector {
            accepted_order: record.accepted_order,
            component: record.record.component,
            producer_boot_id: record.record.producer_boot_id.clone(),
            producer_sequence: record.record.producer_sequence,
        },
        value: AtomValue::Collector(record),
        tier,
        canonical_bytes,
        included_bytes: candidate.included_bytes,
        original_index: candidate.original_index,
        manifest_source: SupportSourceManifestSourceV1::Collector,
        evidence_source: SupportEvidenceSourceV1::Collector,
        container: ContainerKey::Collector,
        lifecycle,
    }))
}

pub(super) fn fallback_atom(
    candidate: SupportAssemblyCandidateV1<SupportFallbackCandidateValueV1>,
    selection: &SupportSelectionV1,
    correlations: &SupportCorrelationSelectionV1,
    accounting: &mut AssemblyAccounting,
) -> Result<Option<CandidateAtom>, SupportAssemblyError> {
    accounting.absorb_scrub(&candidate.scrubbed.accounting)?;
    let Some(value) = candidate.scrubbed.value else {
        return Ok(None);
    };
    if validate_safe_u64(candidate.included_bytes).is_err()
        || validate_safe_u64(candidate.original_index).is_err()
    {
        note_invalid(accounting, SupportEvidenceSourceV1::Tauri, 0)?;
        return Ok(None);
    }
    let (rank, source, evidence_source, container, lifecycle) = match &value {
        SupportFallbackCandidateValueV1::Record(record) if valid_fallback_record(record) => {
            let source_time = parse_protocol_timestamp(&record.record.source_timestamp).ok();
            let semantic_group = if priority_record(&record.record) {
                0
            } else if correlated(&record.record, selection, correlations) {
                1
            } else {
                2
            };
            let source = fallback_source(record.component);
            (
                CandidateRank::Fallback {
                    semantic_group,
                    source_time,
                    sequence: Some(record.record.producer_sequence),
                    component: fallback_component_order(record.component),
                    segment: record.segment,
                    line: record.line,
                },
                source,
                evidence_source_for_manifest(source),
                ContainerKey::FallbackRecords(source),
                lifecycle_identity(LifecycleDomain::Fallback, &record.record),
            )
        }
        SupportFallbackCandidateValueV1::OpaqueLine(line)
            if line.segment <= 3
                && !line.semantic_claims
                && validate_safe_u64(line.line).is_ok()
                && validate_support_json_value(&line.value).is_ok() =>
        {
            (
                CandidateRank::Fallback {
                    semantic_group: 3,
                    source_time: None,
                    sequence: None,
                    component: 4,
                    segment: line.segment,
                    line: line.line,
                },
                SupportSourceManifestSourceV1::DesktopNativeFallback,
                SupportEvidenceSourceV1::Tauri,
                ContainerKey::FallbackOpaque,
                None,
            )
        }
        _ => {
            let evidence_source = match &value {
                SupportFallbackCandidateValueV1::Record(record) => {
                    evidence_source_for_manifest(fallback_source(record.component))
                }
                SupportFallbackCandidateValueV1::OpaqueLine(_) => SupportEvidenceSourceV1::Tauri,
            };
            note_invalid(accounting, evidence_source, candidate.included_bytes)?;
            return Ok(None);
        }
    };
    let canonical_bytes = match &value {
        SupportFallbackCandidateValueV1::Record(record) => {
            encode_optional(record, accounting, evidence_source)?
        }
        SupportFallbackCandidateValueV1::OpaqueLine(line) => {
            encode_optional(line, accounting, evidence_source)?
        }
    };
    let value = match value {
        SupportFallbackCandidateValueV1::Record(record) => AtomValue::FallbackRecord(record),
        SupportFallbackCandidateValueV1::OpaqueLine(line) => AtomValue::FallbackOpaque(line),
    };
    Ok(Some(CandidateAtom {
        value,
        tier: 5,
        rank,
        canonical_bytes,
        included_bytes: candidate.included_bytes,
        original_index: candidate.original_index,
        manifest_source: source,
        evidence_source,
        container,
        lifecycle,
    }))
}

pub(super) fn legacy_atom(
    candidate: SupportAssemblyCandidateV1<SupportLegacyCandidateValueV1>,
    accounting: &mut AssemblyAccounting,
) -> Result<Option<CandidateAtom>, SupportAssemblyError> {
    accounting.absorb_scrub(&candidate.scrubbed.accounting)?;
    let Some(value) = candidate.scrubbed.value else {
        return Ok(None);
    };
    let max_segment = match value.source {
        SupportLegacySourceKindV1::RendererDiagnostics
        | SupportLegacySourceKindV1::AnyharnessPrimary => 5,
        SupportLegacySourceKindV1::WorkerPrimaryV2 | SupportLegacySourceKindV1::WorkerPrimaryV1 => {
            0
        }
    };
    let source = legacy_source(value.source);
    let evidence_source = evidence_source_for_manifest(source);
    if value.line.segment > max_segment
        || validate_safe_u64(value.line.line).is_err()
        || validate_content_string(&value.line.value).is_err()
        || validate_safe_u64(candidate.included_bytes).is_err()
        || validate_safe_u64(candidate.original_index).is_err()
    {
        note_invalid(accounting, evidence_source, candidate.included_bytes)?;
        return Ok(None);
    }
    let canonical_bytes = encode_optional(&value.line, accounting, evidence_source)?;
    Ok(Some(CandidateAtom {
        rank: CandidateRank::Legacy {
            source: value.source,
            segment: value.line.segment,
            line: value.line.line,
        },
        value: AtomValue::Legacy {
            source: value.source,
            line: value.line,
        },
        tier: 8,
        canonical_bytes,
        included_bytes: candidate.included_bytes,
        original_index: candidate.original_index,
        manifest_source: source,
        evidence_source,
        container: ContainerKey::Legacy(value.source),
        lifecycle: None,
    }))
}

pub(super) fn session_atom(
    candidate: SupportAssemblyCandidateV1<SupportJsonValueV1>,
    selection_index: u64,
    summary_captured_at: &str,
    kind: u8,
    tier: u8,
    accounting: &mut AssemblyAccounting,
) -> Result<Option<CandidateAtom>, SupportAssemblyError> {
    accounting.absorb_scrub(&candidate.scrubbed.accounting)?;
    let Some(value) = candidate.scrubbed.value else {
        return Ok(None);
    };
    let sequence = if kind == 0 {
        None
    } else {
        json_sequence(&value)
    };
    let valid = validate_support_json_value(&value).is_ok()
        && validate_safe_u64(candidate.included_bytes).is_ok()
        && validate_safe_u64(candidate.original_index).is_ok()
        && (kind == 0 || sequence.is_some());
    if !valid {
        note_invalid(
            accounting,
            SupportEvidenceSourceV1::SessionLedger,
            candidate.included_bytes,
        )?;
        return Ok(None);
    }
    let canonical_bytes =
        encode_optional(&value, accounting, SupportEvidenceSourceV1::SessionLedger)?;
    let source_time = if kind == 0 {
        if validate_timestamp(summary_captured_at).is_err() {
            note_invalid(
                accounting,
                SupportEvidenceSourceV1::SessionLedger,
                candidate.included_bytes,
            )?;
            return Ok(None);
        }
        parse_protocol_timestamp(summary_captured_at).ok()
    } else {
        None
    };
    let (atom_value, container) = match kind {
        0 => (
            AtomValue::SessionSummary {
                selection_index,
                value,
            },
            ContainerKey::SessionSummary(selection_index),
        ),
        1 => (
            AtomValue::SessionEvent {
                selection_index,
                value,
            },
            ContainerKey::SessionEvents(selection_index),
        ),
        _ => (
            AtomValue::SessionRaw {
                selection_index,
                value,
            },
            ContainerKey::SessionRaw(selection_index),
        ),
    };
    Ok(Some(CandidateAtom {
        value: atom_value,
        tier,
        rank: CandidateRank::Session {
            source_time,
            sequence,
            selection_index,
        },
        canonical_bytes,
        included_bytes: candidate.included_bytes,
        original_index: candidate.original_index,
        manifest_source: SupportSourceManifestSourceV1::SessionLedger,
        evidence_source: SupportEvidenceSourceV1::SessionLedger,
        container,
        lifecycle: None,
    }))
}

fn priority_record(record: &ProducerRecordV1) -> bool {
    record.record_class == RecordClassV1::Lifecycle
        || record
            .detailed
            .as_ref()
            .is_some_and(|detailed| detailed.kind == DetailedKindV1::LossSummary)
        || matches!(record.severity, SeverityV1::Warn | SeverityV1::Error)
}

fn correlated(
    record: &ProducerRecordV1,
    selection: &SupportSelectionV1,
    correlations: &SupportCorrelationSelectionV1,
) -> bool {
    option_matches(&record.workspace_id, selection.workspace_id.as_ref())
        || option_matches(&record.session_id, selection.ui_session_id.as_ref())
        || option_matches(
            &record.session_id,
            selection.materialized_session_id.as_ref(),
        )
        || correlations
            .operation_ids
            .binary_search(&record.operation_id)
            .is_ok()
        || in_set(&record.turn_id, &correlations.turn_ids)
        || in_set(&record.item_id, &correlations.item_ids)
        || in_set(&record.prompt_id, &correlations.prompt_ids)
        || in_set(&record.request_id, &correlations.request_ids)
        || in_set(&record.target_id, &correlations.target_ids)
        || in_set(&record.workflow_id, &correlations.workflow_ids)
}

fn valid_fallback_record(record: &SupportFallbackRecordV1) -> bool {
    if record.segment > 3
        || validate_safe_u64(record.line).is_err()
        || validate_producer_record(&record.record).is_err()
        || record.record.redaction != RedactionClassificationV1::SupportExport
    {
        return false;
    }
    let (expected_component, expected_source, pr5) = match record.component {
        SupportFallbackRecordComponentV1::DesktopRenderer => {
            (ComponentV1::DesktopRenderer, SourceV1::Renderer, false)
        }
        SupportFallbackRecordComponentV1::DesktopTauri => {
            (ComponentV1::DesktopTauri, SourceV1::Tauri, false)
        }
        SupportFallbackRecordComponentV1::Anyharness => {
            (ComponentV1::Anyharness, SourceV1::Anyharness, true)
        }
        SupportFallbackRecordComponentV1::DesktopWorker => {
            (ComponentV1::DesktopWorker, SourceV1::Worker, true)
        }
    };
    let delivery_unknown = record.fallback_reason
        == Some(super::super::schema::enums::SupportPr5FallbackReasonV1::DeliveryUnknown);
    record.record.component == expected_component
        && record.record.source == expected_source
        && record.fallback_reason.is_some() == pr5
        && (record.disposition == SupportFallbackDispositionV1::DeliveryUnknown) == delivery_unknown
}

fn collector_record_in_bounds(
    record: &CollectorAcceptedRecordV1,
    collector: &SupportCollectorEvidenceV1,
    selection: &SupportSelectionV1,
) -> bool {
    let Ok(source_time) = parse_protocol_timestamp(&record.record.source_timestamp) else {
        return false;
    };
    let (Ok(from), Ok(to)) = (
        parse_protocol_timestamp(&selection.source_time_from),
        parse_protocol_timestamp(&selection.source_time_to),
    ) else {
        return false;
    };
    if source_time < from || source_time > to {
        return false;
    }
    [
        collector
            .coverage
            .cursor_start
            .zip(collector.coverage.cursor_end),
        collector
            .coverage
            .health_oldest_cursor
            .zip(collector.coverage.health_newest_cursor),
    ]
    .into_iter()
    .flatten()
    .all(|(start, end)| record.retention_cursor >= start && record.retention_cursor <= end)
}

fn fallback_source(component: SupportFallbackRecordComponentV1) -> SupportSourceManifestSourceV1 {
    match component {
        SupportFallbackRecordComponentV1::DesktopRenderer
        | SupportFallbackRecordComponentV1::DesktopTauri => {
            SupportSourceManifestSourceV1::DesktopNativeFallback
        }
        SupportFallbackRecordComponentV1::Anyharness => {
            SupportSourceManifestSourceV1::AnyharnessFallback
        }
        SupportFallbackRecordComponentV1::DesktopWorker => {
            SupportSourceManifestSourceV1::DesktopWorkerFallback
        }
    }
}

pub(super) fn legacy_source(source: SupportLegacySourceKindV1) -> SupportSourceManifestSourceV1 {
    match source {
        SupportLegacySourceKindV1::RendererDiagnostics => {
            SupportSourceManifestSourceV1::RendererLegacy
        }
        SupportLegacySourceKindV1::AnyharnessPrimary => {
            SupportSourceManifestSourceV1::AnyharnessLegacy
        }
        SupportLegacySourceKindV1::WorkerPrimaryV2 => SupportSourceManifestSourceV1::WorkerLegacyV2,
        SupportLegacySourceKindV1::WorkerPrimaryV1 => SupportSourceManifestSourceV1::WorkerLegacyV1,
    }
}

pub(super) fn evidence_source_for_manifest(
    source: SupportSourceManifestSourceV1,
) -> SupportEvidenceSourceV1 {
    match source {
        SupportSourceManifestSourceV1::Collector => SupportEvidenceSourceV1::Collector,
        SupportSourceManifestSourceV1::DesktopNativeFallback => SupportEvidenceSourceV1::Tauri,
        SupportSourceManifestSourceV1::AnyharnessFallback
        | SupportSourceManifestSourceV1::AnyharnessLegacy => SupportEvidenceSourceV1::Anyharness,
        SupportSourceManifestSourceV1::DesktopWorkerFallback
        | SupportSourceManifestSourceV1::WorkerLegacyV2
        | SupportSourceManifestSourceV1::WorkerLegacyV1 => SupportEvidenceSourceV1::DesktopWorker,
        SupportSourceManifestSourceV1::RendererLegacy => SupportEvidenceSourceV1::Renderer,
        SupportSourceManifestSourceV1::SessionLedger => SupportEvidenceSourceV1::SessionLedger,
    }
}

fn fallback_component_order(component: SupportFallbackRecordComponentV1) -> u8 {
    match component {
        SupportFallbackRecordComponentV1::DesktopRenderer => 0,
        SupportFallbackRecordComponentV1::DesktopTauri => 1,
        SupportFallbackRecordComponentV1::Anyharness => 2,
        SupportFallbackRecordComponentV1::DesktopWorker => 3,
    }
}

fn json_sequence(value: &SupportJsonValueV1) -> Option<u64> {
    let SupportJsonValueV1::Object(entries) = value else {
        return None;
    };
    let (_, SupportJsonValueV1::Integer(sequence)) =
        entries.iter().find(|(key, _)| key == "seq")?
    else {
        return None;
    };
    validate_safe_i64(*sequence).ok()?;
    Some(*sequence as u64)
}

fn encode_optional<T: Serialize>(
    value: &T,
    accounting: &mut AssemblyAccounting,
    source: SupportEvidenceSourceV1,
) -> Result<Vec<u8>, SupportAssemblyError> {
    match serde_json::to_vec(value) {
        Ok(bytes) => Ok(bytes),
        Err(_) => {
            note_invalid(accounting, source, 0)?;
            Err(SupportAssemblyError::SerializationFailed)
        }
    }
}

fn note_invalid(
    accounting: &mut AssemblyAccounting,
    source: SupportEvidenceSourceV1,
    known_bytes: u64,
) -> Result<(), SupportAssemblyError> {
    accounting.add_omission(
        source,
        SupportOmissionReasonV1::SourceInvalid,
        1,
        validate_safe_u64(known_bytes).ok().map(|()| known_bytes),
    )
}

fn option_matches(left: &Option<String>, right: Option<&String>) -> bool {
    left.as_ref()
        .zip(right)
        .is_some_and(|(left, right)| left == right)
}

fn in_set(value: &Option<String>, values: &[String]) -> bool {
    value
        .as_ref()
        .is_some_and(|value| values.binary_search(value).is_ok())
}
