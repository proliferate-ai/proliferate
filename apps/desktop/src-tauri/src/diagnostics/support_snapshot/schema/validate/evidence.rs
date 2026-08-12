//! Collector, fallback, legacy, and session evidence validation.

use std::collections::BTreeSet;

use proliferate_diagnostics_protocol::v1::limits::MAX_RECORD_BYTES;
use proliferate_diagnostics_protocol::v1::types::{
    ComponentV1, RedactionClassificationV1, SourceV1,
};

use super::super::enums::{
    SupportChildComponentV1, SupportCollectorCompletenessV1, SupportCollectorStatusV1,
    SupportEndpointStateV1, SupportFallbackDispositionV1, SupportFallbackRecordComponentV1,
    SupportPr5FallbackReasonV1, SupportSessionSelectionV1,
};
use super::super::limits::{
    COLLECTOR_BYTES, COLLECTOR_RECORDS, EVENTS_PER_SESSION, RAW_NOTIFICATIONS_PER_SESSION,
    SESSIONS, SESSION_BYTES, SESSION_EVIDENCE_BYTES,
};
use super::super::model::common::SupportJsonValueV1;
use super::super::model::evidence::{
    SupportCollectorCoverageV1, SupportCollectorEvidenceV1, SupportFallbackComponentV1,
    SupportFallbackRecordV1, SupportLegacySourceV1, SupportOpaqueFallbackLineV1,
    SupportSessionLedgerV1, SupportSessionV1,
};
use super::{health, json_value, ordering, protocol};
use super::{
    validate_content_string, validate_id, validate_optional_safe_u64, validate_safe_i64,
    validate_safe_u64, validate_timestamp, SupportSchemaError,
};

pub(super) fn validate_collector_coverage(
    coverage: &SupportCollectorCoverageV1,
) -> Result<(), SupportSchemaError> {
    if coverage.request_record_limit != COLLECTOR_RECORDS {
        return Err(SupportSchemaError::PinnedLiteralMismatch(
            "coverage.requestRecordLimit",
        ));
    }
    if coverage.request_byte_limit != COLLECTOR_BYTES {
        return Err(SupportSchemaError::PinnedLiteralMismatch(
            "coverage.requestByteLimit",
        ));
    }
    if coverage.newest_edge_claimed {
        return Err(SupportSchemaError::PinnedLiteralMismatch(
            "coverage.newestEdgeClaimed",
        ));
    }
    validate_safe_u64(coverage.returned_records)?;
    validate_safe_u64(coverage.returned_record_bytes)?;
    for cursor in [
        coverage.cursor_start,
        coverage.cursor_end,
        coverage.health_oldest_cursor,
        coverage.health_newest_cursor,
    ] {
        validate_optional_safe_u64(cursor)?;
    }
    if coverage.returned_records > COLLECTOR_RECORDS {
        return Err(SupportSchemaError::CapExceeded("coverage.returnedRecords"));
    }
    if coverage.returned_record_bytes > COLLECTOR_BYTES {
        return Err(SupportSchemaError::CapExceeded(
            "coverage.returnedRecordBytes",
        ));
    }
    if (coverage.returned_records == 0) != (coverage.returned_record_bytes == 0) {
        return Err(SupportSchemaError::InvariantViolation(
            "coverage record/byte emptiness",
        ));
    }
    validate_cursor_pair(
        coverage.cursor_start,
        coverage.cursor_end,
        coverage.returned_records,
        "coverage cursor pair",
    )?;
    validate_optional_range(
        coverage.health_oldest_cursor,
        coverage.health_newest_cursor,
        "coverage health cursor pair",
    )?;

    let byte_threshold = COLLECTOR_BYTES - MAX_RECORD_BYTES as u64;
    let uncertain = coverage.returned_records >= COLLECTOR_RECORDS
        || coverage.returned_record_bytes >= byte_threshold;
    match coverage.status {
        SupportCollectorStatusV1::Complete
            if coverage.completeness == SupportCollectorCompletenessV1::Complete
                && !coverage.limit_uncertain
                && !uncertain => {}
        SupportCollectorStatusV1::LimitUncertain
            if coverage.completeness == SupportCollectorCompletenessV1::LimitUncertain
                && coverage.limit_uncertain
                && uncertain => {}
        SupportCollectorStatusV1::Unavailable
        | SupportCollectorStatusV1::Interrupted
        | SupportCollectorStatusV1::Invalid
            if coverage.completeness == SupportCollectorCompletenessV1::Unknown
                && !coverage.limit_uncertain
                && coverage.returned_records == 0
                && coverage.returned_record_bytes == 0
                && coverage.cursor_start.is_none()
                && coverage.cursor_end.is_none()
                && coverage.health_oldest_cursor.is_none()
                && coverage.health_newest_cursor.is_none() => {}
        _ => {
            return Err(SupportSchemaError::InvariantViolation(
                "collector coverage status/completeness",
            ));
        }
    }
    Ok(())
}

fn validate_cursor_pair(
    start: Option<u64>,
    end: Option<u64>,
    records: u64,
    name: &'static str,
) -> Result<(), SupportSchemaError> {
    match (start, end, records) {
        (None, None, 0) => Ok(()),
        (Some(start), Some(end), records) if records > 0 && start <= end => Ok(()),
        _ => Err(SupportSchemaError::InvariantViolation(name)),
    }
}

fn validate_optional_range(
    start: Option<u64>,
    end: Option<u64>,
    name: &'static str,
) -> Result<(), SupportSchemaError> {
    match (start, end) {
        (None, None) => Ok(()),
        (Some(start), Some(end)) if start <= end => Ok(()),
        _ => Err(SupportSchemaError::InvariantViolation(name)),
    }
}

pub(super) fn validate_collector_evidence(
    evidence: &SupportCollectorEvidenceV1,
) -> Result<(), SupportSchemaError> {
    validate_timestamp(&evidence.captured_at)?;
    if let Some(desktop_health) = &evidence.desktop_health {
        health::validate_desktop_health(desktop_health)?;
    }
    validate_collector_coverage(&evidence.coverage)?;
    if let Some(manifest) = &evidence.export_manifest {
        protocol::export_manifest(manifest, "collector.exportManifest")?;
    }
    if let Some(export_health) = &evidence.export_health {
        protocol::health(export_health, "collector.exportHealth")?;
    }
    for gap in &evidence.gaps {
        protocol::gap(gap, "collector.gaps")?;
    }

    match evidence.coverage.status {
        SupportCollectorStatusV1::Complete | SupportCollectorStatusV1::LimitUncertain => {
            let manifest =
                evidence
                    .export_manifest
                    .as_ref()
                    .ok_or(SupportSchemaError::InvariantViolation(
                        "successful collector manifest",
                    ))?;
            let export_health =
                evidence
                    .export_health
                    .as_ref()
                    .ok_or(SupportSchemaError::InvariantViolation(
                        "successful collector health",
                    ))?;
            if u64::from(manifest.record_count) != evidence.coverage.returned_records
                || manifest.byte_count != evidence.coverage.returned_record_bytes
                || manifest.cursor_start != evidence.coverage.cursor_start
                || manifest.cursor_end != evidence.coverage.cursor_end
                || manifest.gaps != evidence.gaps
                || !manifest.includes_health
                || manifest.redaction != RedactionClassificationV1::SupportExport
                || export_health.oldest_cursor != evidence.coverage.health_oldest_cursor
                || export_health.newest_cursor != evidence.coverage.health_newest_cursor
            {
                return Err(SupportSchemaError::InvariantViolation(
                    "collector export coverage preservation",
                ));
            }
            let mut prior_version = None;
            let version_records =
                manifest
                    .versions_present
                    .iter()
                    .try_fold(0_u64, |total, version| {
                        if version.records == 0
                            || prior_version.is_some_and(|prior| version.version <= prior)
                        {
                            return None;
                        }
                        prior_version = Some(version.version);
                        total.checked_add(version.records)
                    });
            if version_records != Some(u64::from(manifest.record_count)) {
                return Err(SupportSchemaError::InvariantViolation(
                    "collector export version counts/order",
                ));
            }
        }
        SupportCollectorStatusV1::Unavailable
        | SupportCollectorStatusV1::Interrupted
        | SupportCollectorStatusV1::Invalid => {
            if evidence.export_manifest.is_some()
                || evidence.export_health.is_some()
                || !evidence.gaps.is_empty()
            {
                return Err(SupportSchemaError::InvariantViolation(
                    "discarded partial collector export",
                ));
            }
        }
    }
    Ok(())
}

pub(super) fn validate_records(
    records: &[proliferate_diagnostics_protocol::v1::types::CollectorAcceptedRecordV1],
) -> Result<(), SupportSchemaError> {
    if records.len() > COLLECTOR_RECORDS as usize {
        return Err(SupportSchemaError::CapExceeded("snapshot.records"));
    }
    let mut prior = None;
    for record in records {
        protocol::accepted_record(record, "snapshot.records")?;
        if record.record.redaction != RedactionClassificationV1::SupportExport {
            return Err(SupportSchemaError::InvariantViolation(
                "accepted record support redaction",
            ));
        }
        if prior.is_some_and(|(order, cursor)| {
            record.accepted_order <= order || record.retention_cursor <= cursor
        }) {
            return Err(SupportSchemaError::InvariantViolation(
                "accepted record ordering",
            ));
        }
        prior = Some((record.accepted_order, record.retention_cursor));
    }
    Ok(())
}

fn validate_fallback_record(record: &SupportFallbackRecordV1) -> Result<(), SupportSchemaError> {
    if record.segment > 3 {
        return Err(SupportSchemaError::CapExceeded("fallback segment"));
    }
    validate_safe_u64(record.line)?;
    protocol::producer_record(&record.record, "fallback record")?;
    if record.record.redaction != RedactionClassificationV1::SupportExport {
        return Err(SupportSchemaError::InvariantViolation(
            "fallback record support redaction",
        ));
    }
    let expected = match record.component {
        SupportFallbackRecordComponentV1::DesktopRenderer => {
            (ComponentV1::DesktopRenderer, SourceV1::Renderer)
        }
        SupportFallbackRecordComponentV1::DesktopTauri => {
            (ComponentV1::DesktopTauri, SourceV1::Tauri)
        }
        SupportFallbackRecordComponentV1::Anyharness => {
            (ComponentV1::Anyharness, SourceV1::Anyharness)
        }
        SupportFallbackRecordComponentV1::DesktopWorker => {
            (ComponentV1::DesktopWorker, SourceV1::Worker)
        }
    };
    if (record.record.component, record.record.source) != expected {
        return Err(SupportSchemaError::InvariantViolation(
            "fallback record component identity",
        ));
    }
    let expected_disposition =
        if record.fallback_reason == Some(SupportPr5FallbackReasonV1::DeliveryUnknown) {
            SupportFallbackDispositionV1::DeliveryUnknown
        } else {
            SupportFallbackDispositionV1::NotCollectorAccepted
        };
    if record.disposition != expected_disposition {
        return Err(SupportSchemaError::InvariantViolation(
            "fallback record disposition",
        ));
    }
    Ok(())
}

fn validate_opaque_line(line: &SupportOpaqueFallbackLineV1) -> Result<(), SupportSchemaError> {
    if line.segment > 3 {
        return Err(SupportSchemaError::CapExceeded("opaque fallback segment"));
    }
    validate_safe_u64(line.line)?;
    json_value::validate_support_json_value_at(&line.value, 0)?;
    if line.semantic_claims {
        return Err(SupportSchemaError::PinnedLiteralMismatch(
            "opaqueLine.semanticClaims",
        ));
    }
    Ok(())
}

pub(super) fn validate_fallback_evidence(
    components: &[SupportFallbackComponentV1],
) -> Result<(), SupportSchemaError> {
    if components.len() > 3 {
        return Err(SupportSchemaError::CapExceeded("fallbackEvidence"));
    }
    let mut prior_key = None;
    for component in components {
        let key = match component {
            SupportFallbackComponentV1::Pr3DesktopNativeMixed {
                records,
                opaque_lines,
            } => {
                for record in records {
                    validate_fallback_record(record)?;
                    if !matches!(
                        record.component,
                        SupportFallbackRecordComponentV1::DesktopRenderer
                            | SupportFallbackRecordComponentV1::DesktopTauri
                    ) || record.fallback_reason.is_some()
                    {
                        return Err(SupportSchemaError::InvariantViolation(
                            "pr3 fallback family identity",
                        ));
                    }
                }
                ordering::fallback_records(records)?;
                for line in opaque_lines {
                    validate_opaque_line(line)?;
                }
                ordering::opaque_lines(opaque_lines)?;
                0
            }
            SupportFallbackComponentV1::Pr5Wrapped {
                component,
                records,
                opaque_lines,
            } => {
                if !opaque_lines.is_empty() {
                    return Err(SupportSchemaError::PinnedLiteralMismatch(
                        "pr5Wrapped.opaqueLines",
                    ));
                }
                for record in records {
                    validate_fallback_record(record)?;
                    let expected = match component {
                        SupportChildComponentV1::Anyharness => {
                            SupportFallbackRecordComponentV1::Anyharness
                        }
                        SupportChildComponentV1::DesktopWorker => {
                            SupportFallbackRecordComponentV1::DesktopWorker
                        }
                    };
                    if record.component != expected || record.fallback_reason.is_none() {
                        return Err(SupportSchemaError::InvariantViolation(
                            "pr5 fallback family identity",
                        ));
                    }
                }
                ordering::fallback_records(records)?;
                match component {
                    SupportChildComponentV1::Anyharness => 1,
                    SupportChildComponentV1::DesktopWorker => 2,
                }
            }
        };
        if prior_key.is_some_and(|prior| key <= prior) {
            return Err(SupportSchemaError::InvariantViolation(
                "fallback evidence order/uniqueness",
            ));
        }
        prior_key = Some(key);
    }
    Ok(())
}

pub(super) fn validate_legacy_evidence(
    sources: &[SupportLegacySourceV1],
) -> Result<(), SupportSchemaError> {
    if sources.len() > 4 {
        return Err(SupportSchemaError::CapExceeded("legacyEvidence"));
    }
    let mut prior_source = None;
    for source in sources {
        if prior_source.is_some_and(|prior| source.source <= prior) {
            return Err(SupportSchemaError::InvariantViolation(
                "legacy evidence order/uniqueness",
            ));
        }
        prior_source = Some(source.source);
        if source.semantic_claims {
            return Err(SupportSchemaError::PinnedLiteralMismatch(
                "legacy.semanticClaims",
            ));
        }
        let mut prior_line = None;
        for line in &source.lines {
            if line.segment > 5 {
                return Err(SupportSchemaError::CapExceeded("legacy segment"));
            }
            validate_safe_u64(line.line)?;
            validate_content_string(&line.value)?;
            let key = (u8::MAX - line.segment, line.line);
            if prior_line.is_some_and(|prior| key <= prior) {
                return Err(SupportSchemaError::InvariantViolation("legacy line order"));
            }
            prior_line = Some(key);
        }
    }
    Ok(())
}

fn sequence(value: &SupportJsonValueV1) -> Result<u64, SupportSchemaError> {
    let SupportJsonValueV1::Object(entries) = value else {
        return Err(SupportSchemaError::InvariantViolation(
            "session ledger item sequence",
        ));
    };
    let Some((_, SupportJsonValueV1::Integer(sequence))) =
        entries.iter().find(|(key, _)| key == "seq")
    else {
        return Err(SupportSchemaError::InvariantViolation(
            "session ledger item sequence",
        ));
    };
    validate_safe_i64(*sequence)?;
    Ok(*sequence as u64)
}

fn validate_sequence_order(values: &[SupportJsonValueV1]) -> Result<(), SupportSchemaError> {
    let mut prior = None;
    for value in values {
        let current = sequence(value)?;
        if prior.is_some_and(|prior| current <= prior) {
            return Err(SupportSchemaError::InvariantViolation(
                "session ledger sequence order",
            ));
        }
        prior = Some(current);
    }
    Ok(())
}

fn validate_session(session: &SupportSessionV1) -> Result<(), SupportSchemaError> {
    validate_id(&session.session_id)?;
    validate_timestamp(&session.summary_captured_at)?;
    if let Some(summary) = &session.summary {
        json_value::validate_support_json_value_at(summary, 0)?;
    }
    if session.normalized_events.len() > EVENTS_PER_SESSION as usize {
        return Err(SupportSchemaError::CapExceeded("session.normalizedEvents"));
    }
    if session.raw_notifications.len() > RAW_NOTIFICATIONS_PER_SESSION as usize {
        return Err(SupportSchemaError::CapExceeded("session.rawNotifications"));
    }
    for value in session
        .normalized_events
        .iter()
        .chain(&session.raw_notifications)
    {
        json_value::validate_support_json_value_at(value, 0)?;
    }
    let copied_values = session
        .summary
        .as_ref()
        .map_or(0, json_value::count_json_values)
        .checked_add(
            session
                .normalized_events
                .iter()
                .map(json_value::count_json_values)
                .sum::<usize>(),
        )
        .and_then(|count| {
            count.checked_add(
                session
                    .raw_notifications
                    .iter()
                    .map(json_value::count_json_values)
                    .sum::<usize>(),
            )
        })
        .ok_or(SupportSchemaError::CapExceeded(
            "session copied projected values",
        ))?;
    if copied_values > 10_000 {
        return Err(SupportSchemaError::CapExceeded(
            "session copied projected values",
        ));
    }
    validate_sequence_order(&session.normalized_events)?;
    validate_sequence_order(&session.raw_notifications)?;
    validate_summary_endpoint_value(
        session.endpoint_states.summary,
        session.summary.is_some(),
        "session summary endpoint state",
    )?;
    validate_list_endpoint_value(
        session.endpoint_states.events,
        !session.normalized_events.is_empty(),
        "session events endpoint state",
    )?;
    validate_list_endpoint_value(
        session.endpoint_states.raw_notifications,
        !session.raw_notifications.is_empty(),
        "session raw-notification endpoint state",
    )?;
    let bytes = serde_json::to_vec(session)
        .map_err(|_| SupportSchemaError::SerializationFailed)?
        .len() as u64;
    if bytes > SESSION_BYTES {
        return Err(SupportSchemaError::CapExceeded("session serialized bytes"));
    }
    Ok(())
}

fn validate_summary_endpoint_value(
    state: SupportEndpointStateV1,
    has_value: bool,
    name: &'static str,
) -> Result<(), SupportSchemaError> {
    match (state, has_value) {
        (SupportEndpointStateV1::Included, true)
        | (SupportEndpointStateV1::LimitUncertain, true)
        | (SupportEndpointStateV1::Omitted, false) => Ok(()),
        _ => Err(SupportSchemaError::InvariantViolation(name)),
    }
}

fn validate_list_endpoint_value(
    state: SupportEndpointStateV1,
    has_value: bool,
    name: &'static str,
) -> Result<(), SupportSchemaError> {
    match (state, has_value) {
        (SupportEndpointStateV1::Included, _)
        | (SupportEndpointStateV1::LimitUncertain, _)
        | (SupportEndpointStateV1::Omitted, false) => Ok(()),
        _ => Err(SupportSchemaError::InvariantViolation(name)),
    }
}

pub(super) fn validate_session_ledger(
    ledger: &SupportSessionLedgerV1,
) -> Result<(), SupportSchemaError> {
    validate_id(&ledger.workspace_id)?;
    validate_id(&ledger.anyharness_workspace_id)?;
    let sessions_valid = match ledger.selection {
        SupportSessionSelectionV1::ActiveSession => ledger.sessions.len() == 1,
        SupportSessionSelectionV1::RecentActivity => ledger.sessions.len() <= SESSIONS as usize,
    };
    if !sessions_valid {
        return Err(SupportSchemaError::CapExceeded("sessionLedger.sessions"));
    }
    let mut ids = BTreeSet::new();
    for session in &ledger.sessions {
        validate_session(session)?;
        if !ids.insert(session.session_id.as_str()) {
            return Err(SupportSchemaError::InvariantViolation(
                "session ledger duplicate session",
            ));
        }
    }
    let bytes = serde_json::to_vec(ledger)
        .map_err(|_| SupportSchemaError::SerializationFailed)?
        .len() as u64;
    if bytes > SESSION_EVIDENCE_BYTES {
        return Err(SupportSchemaError::CapExceeded(
            "sessionLedger serialized bytes",
        ));
    }
    Ok(())
}
