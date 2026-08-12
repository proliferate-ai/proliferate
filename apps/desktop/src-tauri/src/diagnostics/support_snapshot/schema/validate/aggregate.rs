//! Cross-field truth, fixed-window, and exact serialized-byte validation.

use chrono::TimeDelta;
use proliferate_diagnostics_protocol::v1::types::{ComponentV1, RecordClassV1};

use super::super::enums::{
    SupportCollectorStatusV1, SupportEndpointStateV1, SupportEvidenceSourceV1,
    SupportOmissionReasonV1, SupportSessionOmissionReasonV1, SupportSessionSelectionV1,
};
use super::super::limits::PACKAGE_BYTES;
use super::super::model::health::SupportTauriProducerHealthV1;
use super::super::model::manifest::SupportSessionCollectionManifestV1;
use super::super::model::snapshot::SupportSnapshotV3;
use super::{parse_timestamp, SupportSchemaError};

pub(super) fn validate_snapshot_relationships(
    snapshot: &SupportSnapshotV3,
) -> Result<(), SupportSchemaError> {
    validate_window(snapshot)?;
    validate_collector_relationships(snapshot)?;
    validate_producer_relationships(snapshot)?;
    validate_session_relationships(snapshot)?;
    validate_collector_omission(snapshot)?;
    validate_serialized_bytes(snapshot)
}

fn validate_window(snapshot: &SupportSnapshotV3) -> Result<(), SupportSchemaError> {
    let from = parse_timestamp(&snapshot.selection.source_time_from)?;
    let to = parse_timestamp(&snapshot.selection.source_time_to)?;
    if to.signed_duration_since(from) != TimeDelta::minutes(15) {
        return Err(SupportSchemaError::InvariantViolation(
            "selection exact fifteen-minute window",
        ));
    }
    if snapshot.collector.captured_at != snapshot.selection.source_time_to {
        return Err(SupportSchemaError::InvariantViolation(
            "collector capture equals sourceTimeTo",
        ));
    }
    if snapshot.manifest.generated_at != snapshot.generated_at {
        return Err(SupportSchemaError::InvariantViolation(
            "manifest generatedAt equals snapshot generatedAt",
        ));
    }
    Ok(())
}

fn validate_collector_relationships(
    snapshot: &SupportSnapshotV3,
) -> Result<(), SupportSchemaError> {
    let collector = &snapshot.collector;
    if collector.coverage != snapshot.manifest.collector || collector.gaps != snapshot.manifest.gaps
    {
        return Err(SupportSchemaError::InvariantViolation(
            "manifest collector/gap preservation",
        ));
    }
    if snapshot.records.len() as u64 > collector.coverage.returned_records {
        return Err(SupportSchemaError::InvariantViolation(
            "selected records exceed returned prefix",
        ));
    }
    if !matches!(
        collector.coverage.status,
        SupportCollectorStatusV1::Complete | SupportCollectorStatusV1::LimitUncertain
    ) && !snapshot.records.is_empty()
    {
        return Err(SupportSchemaError::InvariantViolation(
            "records require completed collector export",
        ));
    }

    if let Some(export_manifest) = &collector.export_manifest {
        if export_manifest.snapshot_id != snapshot.snapshot_id {
            return Err(SupportSchemaError::InvariantViolation(
                "collector export snapshot identity",
            ));
        }
        validate_export_filters(snapshot, export_manifest)?;
    }

    let from = parse_timestamp(&snapshot.selection.source_time_from)?;
    let to = parse_timestamp(&snapshot.selection.source_time_to)?;
    for record in &snapshot.records {
        let source_time = parse_timestamp(&record.record.source_timestamp)?;
        if source_time < from || source_time > to {
            return Err(SupportSchemaError::InvariantViolation(
                "record outside collector source window",
            ));
        }
        for fence in [
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
        {
            if record.retention_cursor < fence.0 || record.retention_cursor > fence.1 {
                return Err(SupportSchemaError::InvariantViolation(
                    "record outside collector cursor fence",
                ));
            }
        }
    }
    Ok(())
}

fn validate_export_filters(
    snapshot: &SupportSnapshotV3,
    manifest: &proliferate_diagnostics_protocol::v1::types::ExportManifestV1,
) -> Result<(), SupportSchemaError> {
    let filters = &manifest.filters;
    let exact_components = [
        ComponentV1::DesktopRenderer,
        ComponentV1::DesktopTauri,
        ComponentV1::DiagnosticsCollector,
        ComponentV1::Anyharness,
        ComponentV1::DesktopWorker,
    ];
    let exact_classes = [RecordClassV1::Detailed, RecordClassV1::Lifecycle];
    let singular_absent = [
        filters.operation_id.as_ref(),
        filters.parent_operation_id.as_ref(),
        filters.trace_id.as_ref(),
        filters.workspace_id.as_ref(),
        filters.session_id.as_ref(),
        filters.turn_id.as_ref(),
        filters.item_id.as_ref(),
        filters.request_id.as_ref(),
        filters.target_id.as_ref(),
        filters.prompt_id.as_ref(),
        filters.workflow_id.as_ref(),
        filters.error_classification.as_ref(),
    ]
    .into_iter()
    .all(|value| value.is_none());
    if filters.source_time_from.as_deref() != Some(snapshot.selection.source_time_from.as_str())
        || filters.source_time_to.as_deref() != Some(snapshot.selection.source_time_to.as_str())
        || filters.components.as_slice() != &exact_components[..]
        || filters.record_classes.as_slice() != &exact_classes[..]
        || !filters.severities.is_empty()
        || !filters.names.is_empty()
        || !filters.outcomes.is_empty()
        || !singular_absent
    {
        return Err(SupportSchemaError::InvariantViolation(
            "exact support collector filters",
        ));
    }
    Ok(())
}

fn validate_producer_relationships(snapshot: &SupportSnapshotV3) -> Result<(), SupportSchemaError> {
    match (
        &snapshot.collector.desktop_health,
        &snapshot.producer_health.tauri,
    ) {
        (
            Some(collector_health),
            SupportTauriProducerHealthV1::SupervisorOnly { desktop_health, .. },
        ) if collector_health == desktop_health => Ok(()),
        (None, SupportTauriProducerHealthV1::Omitted { .. }) => Ok(()),
        _ => Err(SupportSchemaError::InvariantViolation(
            "Tauri supervisor health preservation",
        )),
    }
}

fn validate_session_relationships(snapshot: &SupportSnapshotV3) -> Result<(), SupportSchemaError> {
    let selection = &snapshot.selection;
    if selection.workspace_id.is_some() != selection.anyharness_workspace_id.is_some() {
        return Err(SupportSchemaError::InvariantViolation(
            "selection workspace binding pair",
        ));
    }
    match snapshot.consent.selection {
        SupportSessionSelectionV1::ActiveSession => {
            if selection.workspace_id.is_none()
                || selection.ui_session_id.is_none()
                || selection.materialized_session_id.is_none()
            {
                return Err(SupportSchemaError::InvariantViolation(
                    "active-session selection binding",
                ));
            }
        }
        SupportSessionSelectionV1::RecentActivity => {
            if selection.ui_session_id.is_some() || selection.materialized_session_id.is_some() {
                return Err(SupportSchemaError::InvariantViolation(
                    "recent-activity session identifiers",
                ));
            }
        }
    }

    match (
        &snapshot.session_ledger,
        &snapshot.manifest.session_collection,
    ) {
        (
            Some(ledger),
            SupportSessionCollectionManifestV1::Included {
                workspace_id,
                anyharness_workspace_id,
                selected_sessions,
                limit_uncertain_endpoints,
                ..
            },
        ) => {
            if ledger.selection != snapshot.consent.selection
                || selection.workspace_id.as_ref() != Some(&ledger.workspace_id)
                || selection.anyharness_workspace_id.as_ref()
                    != Some(&ledger.anyharness_workspace_id)
                || workspace_id != &ledger.workspace_id
                || anyharness_workspace_id != &ledger.anyharness_workspace_id
                || *selected_sessions != ledger.sessions.len() as u64
                || *limit_uncertain_endpoints != count_limit_uncertain_endpoints(ledger)
            {
                return Err(SupportSchemaError::InvariantViolation(
                    "session ledger manifest preservation",
                ));
            }
            if ledger.selection == SupportSessionSelectionV1::ActiveSession
                && (ledger.sessions.len() != 1
                    || selection.materialized_session_id.as_ref()
                        != Some(&ledger.sessions[0].session_id))
            {
                return Err(SupportSchemaError::InvariantViolation(
                    "active-session ledger identity",
                ));
            }
        }
        (None, SupportSessionCollectionManifestV1::Omitted { reason }) => {
            let has_workspace = selection.workspace_id.is_some();
            if (*reason == SupportSessionOmissionReasonV1::NoSelectedBundledLocalWorkspace)
                != !has_workspace
            {
                return Err(SupportSchemaError::InvariantViolation(
                    "session omission reason and workspace binding",
                ));
            }
        }
        _ => {
            return Err(SupportSchemaError::InvariantViolation(
                "session ledger/sessionCollection state",
            ));
        }
    }
    Ok(())
}

fn count_limit_uncertain_endpoints(
    ledger: &super::super::model::evidence::SupportSessionLedgerV1,
) -> u64 {
    ledger
        .sessions
        .iter()
        .flat_map(|session| {
            [
                session.endpoint_states.summary,
                session.endpoint_states.events,
                session.endpoint_states.raw_notifications,
            ]
        })
        .filter(|state| *state == SupportEndpointStateV1::LimitUncertain)
        .count() as u64
}

fn validate_collector_omission(snapshot: &SupportSnapshotV3) -> Result<(), SupportSchemaError> {
    let expected = match snapshot.collector.coverage.status {
        SupportCollectorStatusV1::Complete => None,
        SupportCollectorStatusV1::LimitUncertain => {
            Some(SupportOmissionReasonV1::CollectorLimitUncertain)
        }
        SupportCollectorStatusV1::Unavailable => {
            Some(SupportOmissionReasonV1::CollectorUnavailable)
        }
        SupportCollectorStatusV1::Interrupted => {
            Some(SupportOmissionReasonV1::CollectorExportInterrupted)
        }
        SupportCollectorStatusV1::Invalid => Some(SupportOmissionReasonV1::CollectorExportInvalid),
    };
    let collector_entries: Vec<_> = snapshot
        .manifest
        .omissions
        .iter()
        .filter(|entry| {
            entry.source == SupportEvidenceSourceV1::Collector
                && matches!(
                    entry.reason,
                    SupportOmissionReasonV1::CollectorUnavailable
                        | SupportOmissionReasonV1::CollectorExportInterrupted
                        | SupportOmissionReasonV1::CollectorExportInvalid
                        | SupportOmissionReasonV1::CollectorLimitUncertain
                )
        })
        .collect();
    match expected {
        None if collector_entries.is_empty() => Ok(()),
        Some(reason)
            if collector_entries.len() == 1
                && collector_entries[0].reason == reason
                && collector_entries[0].count == 1 =>
        {
            Ok(())
        }
        _ => Err(SupportSchemaError::InvariantViolation(
            "collector coverage omission",
        )),
    }
}

fn validate_serialized_bytes(snapshot: &SupportSnapshotV3) -> Result<(), SupportSchemaError> {
    let bytes = super::serialized_snapshot_bytes(snapshot)?;
    if bytes > PACKAGE_BYTES {
        return Err(SupportSchemaError::CapExceeded("snapshot serialized bytes"));
    }
    if snapshot.manifest.serialized_bytes != bytes {
        return Err(SupportSchemaError::InvariantViolation(
            "manifest.serializedBytes fixed point",
        ));
    }
    Ok(())
}
