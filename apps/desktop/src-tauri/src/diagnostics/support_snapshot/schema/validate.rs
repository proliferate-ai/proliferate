//! Validation and bounds helpers for the schema-3 support snapshot.
//!
//! Serde derives establish shape (closed enums, deny-unknown-fields); this
//! module enforces everything the type system cannot: JS-safe integers,
//! finite numbers, byte bounds, pinned literals, and the fixed manifest
//! collection caps.

use std::fmt;

use super::limits::{
    COLLECTOR_SCHEMA_MAJOR, CONTAINER_ITEMS, CONTENT_STRING_BYTES, COVERAGE_REQUEST_BYTE_LIMIT,
    COVERAGE_REQUEST_RECORD_LIMIT, DEGRADATION_POLICY_VERSION, GENERIC_STRING_BYTES,
    MANIFEST_SCHEMA_VERSION, MAX_GAP_ENTRIES, MAX_ID_BYTES, MAX_OMISSION_ENTRIES, MAX_SAFE_INTEGER,
    MAX_SOURCE_ENTRIES, MAX_TRUNCATION_ENTRIES, NESTING_DEPTH, SESSIONS, SNAPSHOT_SCHEMA_VERSION,
};
use super::model::evidence::{
    SupportCollectorCoverageV1, SupportCollectorEvidenceV1, SupportFallbackComponentV1,
    SupportFallbackRecordV1, SupportLegacySourceV1, SupportOpaqueFallbackLineV1,
    SupportSessionLedgerV1,
};
use super::model::health::{
    DesktopDiagnosticsHealthV1, DesktopDiagnosticsSupervisorStateV1, SupportChildProducerStatusV1,
    SupportTauriProducerHealthV1,
};
use super::model::manifest::{SupportSnapshotLimitsV1, SupportSnapshotManifestV1};
use super::model::snapshot::SupportSnapshotV3;

/// A concrete bounds or pinned-literal violation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SupportSchemaError {
    /// An integer exceeds the JS-safe range (2^53 - 1) or is negative.
    UnsafeInteger,
    /// A number is NaN or infinite.
    NonFiniteNumber,
    /// An ID, name, or timestamp is empty or exceeds 128 UTF-8 bytes.
    OversizedId,
    /// A generic string exceeds its byte bound.
    OversizedGenericString,
    /// A content string exceeds its byte bound.
    OversizedContentString,
    /// A timestamp is not RFC 3339 UTC (`YYYY-MM-DDTHH:MM:SS[.fff]Z`).
    InvalidTimestamp,
    /// A projected container exceeds the item cap.
    TooManyItems,
    /// A projected value exceeds the nesting depth cap.
    TooDeep,
    /// A bounded collection exceeds its fixed cap.
    CapExceeded(&'static str),
    /// A pinned literal field carries a value other than its literal.
    PinnedLiteralMismatch(&'static str),
}

impl fmt::Display for SupportSchemaError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnsafeInteger => write!(f, "integer outside the nonnegative JS-safe range"),
            Self::NonFiniteNumber => write!(f, "number is not finite"),
            Self::OversizedId => write!(f, "id/name/timestamp empty or over 128 UTF-8 bytes"),
            Self::OversizedGenericString => write!(f, "generic string over byte bound"),
            Self::OversizedContentString => write!(f, "content string over byte bound"),
            Self::InvalidTimestamp => write!(f, "timestamp is not RFC 3339 UTC"),
            Self::TooManyItems => write!(f, "container exceeds item cap"),
            Self::TooDeep => write!(f, "value exceeds nesting depth cap"),
            Self::CapExceeded(what) => write!(f, "collection cap exceeded: {what}"),
            Self::PinnedLiteralMismatch(what) => write!(f, "pinned literal mismatch: {what}"),
        }
    }
}

impl std::error::Error for SupportSchemaError {}

/// A nonnegative integer must fit the JS-safe range.
pub fn validate_safe_u64(value: u64) -> Result<(), SupportSchemaError> {
    if value > MAX_SAFE_INTEGER {
        return Err(SupportSchemaError::UnsafeInteger);
    }
    Ok(())
}

/// A signed integer must be JS-safe in magnitude.
pub fn validate_safe_i64(value: i64) -> Result<(), SupportSchemaError> {
    if value.unsigned_abs() > MAX_SAFE_INTEGER {
        return Err(SupportSchemaError::UnsafeInteger);
    }
    Ok(())
}

/// A float must be finite (never NaN or infinity).
pub fn validate_finite_f64(value: f64) -> Result<(), SupportSchemaError> {
    if !value.is_finite() {
        return Err(SupportSchemaError::NonFiniteNumber);
    }
    Ok(())
}

/// An optional nonnegative cursor/byte count must be JS-safe when present.
pub fn validate_optional_safe_u64(value: Option<u64>) -> Result<(), SupportSchemaError> {
    match value {
        Some(inner) => validate_safe_u64(inner),
        None => Ok(()),
    }
}

/// IDs and names are nonempty and at most 128 UTF-8 bytes.
pub fn validate_id(value: &str) -> Result<(), SupportSchemaError> {
    if value.is_empty() || value.len() > MAX_ID_BYTES {
        return Err(SupportSchemaError::OversizedId);
    }
    Ok(())
}

/// Generic strings are bounded at 4096 UTF-8 bytes.
pub fn validate_generic_string(value: &str) -> Result<(), SupportSchemaError> {
    if value.len() > GENERIC_STRING_BYTES {
        return Err(SupportSchemaError::OversizedGenericString);
    }
    Ok(())
}

/// Content strings are bounded at 16384 UTF-8 bytes.
pub fn validate_content_string(value: &str) -> Result<(), SupportSchemaError> {
    if value.len() > CONTENT_STRING_BYTES {
        return Err(SupportSchemaError::OversizedContentString);
    }
    Ok(())
}

/// Projected containers hold at most 256 items or keys.
pub fn validate_container_items(count: usize) -> Result<(), SupportSchemaError> {
    if count > CONTAINER_ITEMS {
        return Err(SupportSchemaError::TooManyItems);
    }
    Ok(())
}

/// Projected values nest at most 16 levels deep.
pub fn validate_nesting_depth(depth: usize) -> Result<(), SupportSchemaError> {
    if depth >= NESTING_DEPTH {
        return Err(SupportSchemaError::TooDeep);
    }
    Ok(())
}

/// Timestamps are RFC 3339 UTC: `YYYY-MM-DDTHH:MM:SS[.fractional]Z`.
pub fn validate_timestamp(value: &str) -> Result<(), SupportSchemaError> {
    validate_id(value)?;
    let bytes = value.as_bytes();
    if bytes.len() < 20 || *bytes.last().unwrap() != b'Z' {
        return Err(SupportSchemaError::InvalidTimestamp);
    }
    let digit_positions = [0, 1, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15, 17, 18];
    let separator_positions: [(usize, u8); 5] =
        [(4, b'-'), (7, b'-'), (10, b'T'), (13, b':'), (16, b':')];
    for position in digit_positions {
        if !bytes[position].is_ascii_digit() {
            return Err(SupportSchemaError::InvalidTimestamp);
        }
    }
    for (position, expected) in separator_positions {
        if bytes[position] != expected {
            return Err(SupportSchemaError::InvalidTimestamp);
        }
    }
    let tail = &bytes[19..bytes.len() - 1];
    if !tail.is_empty() {
        if tail[0] != b'.' || tail.len() < 2 || !tail[1..].iter().all(u8::is_ascii_digit) {
            return Err(SupportSchemaError::InvalidTimestamp);
        }
    }
    Ok(())
}

fn validate_segment(segment: u8, max: u8) -> Result<(), SupportSchemaError> {
    if segment > max {
        return Err(SupportSchemaError::CapExceeded("rotation segment index"));
    }
    Ok(())
}

/// The limits object must equal its fixed value exactly.
pub fn validate_limits(limits: &SupportSnapshotLimitsV1) -> Result<(), SupportSchemaError> {
    if *limits != SupportSnapshotLimitsV1::fixed() {
        return Err(SupportSchemaError::PinnedLiteralMismatch("manifest.limits"));
    }
    Ok(())
}

/// Collector coverage: pinned request limits/selection honesty plus JS-safe
/// counts and cursors.
pub fn validate_collector_coverage(
    coverage: &SupportCollectorCoverageV1,
) -> Result<(), SupportSchemaError> {
    if coverage.request_record_limit != COVERAGE_REQUEST_RECORD_LIMIT {
        return Err(SupportSchemaError::PinnedLiteralMismatch(
            "coverage.requestRecordLimit",
        ));
    }
    if coverage.request_byte_limit != COVERAGE_REQUEST_BYTE_LIMIT {
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
    validate_optional_safe_u64(coverage.cursor_start)?;
    validate_optional_safe_u64(coverage.cursor_end)?;
    validate_optional_safe_u64(coverage.health_oldest_cursor)?;
    validate_optional_safe_u64(coverage.health_newest_cursor)?;
    Ok(())
}

fn validate_desktop_health(health: &DesktopDiagnosticsHealthV1) -> Result<(), SupportSchemaError> {
    match &health.supervisor {
        DesktopDiagnosticsSupervisorStateV1::Ready {
            collector_boot_id,
            schema_major,
            restart_count,
        } => {
            validate_id(collector_boot_id)?;
            if *schema_major != COLLECTOR_SCHEMA_MAJOR {
                return Err(SupportSchemaError::PinnedLiteralMismatch(
                    "supervisor.schemaMajor",
                ));
            }
            validate_safe_u64(*restart_count)
        }
        DesktopDiagnosticsSupervisorStateV1::Starting {
            attempt,
            restart_count,
            ..
        } => {
            validate_safe_u64(*attempt)?;
            validate_safe_u64(*restart_count)
        }
        DesktopDiagnosticsSupervisorStateV1::Degraded { restart_count, .. } => {
            validate_safe_u64(*restart_count)
        }
        DesktopDiagnosticsSupervisorStateV1::Unsupported { .. }
        | DesktopDiagnosticsSupervisorStateV1::Stopped { .. } => Ok(()),
    }
}

/// Collector evidence: timestamp, embedded health, and coverage bounds.
pub fn validate_collector_evidence(
    evidence: &SupportCollectorEvidenceV1,
) -> Result<(), SupportSchemaError> {
    validate_timestamp(&evidence.captured_at)?;
    if let Some(desktop_health) = &evidence.desktop_health {
        validate_desktop_health(desktop_health)?;
    }
    validate_collector_coverage(&evidence.coverage)
}

fn validate_child_status(status: &SupportChildProducerStatusV1) -> Result<(), SupportSchemaError> {
    match status {
        SupportChildProducerStatusV1::Available {
            captured_at,
            snapshot,
        } => {
            validate_timestamp(captured_at)?;
            validate_id(&snapshot.producer_boot_id)?;
            validate_optional_safe_u64(snapshot.last_assigned_sequence)?;
            validate_optional_safe_u64(snapshot.next_sequence)?;
            validate_safe_u64(snapshot.resident_records)?;
            validate_safe_u64(snapshot.resident_bytes)?;
            validate_safe_u64(snapshot.fallback_bytes)?;
            validate_safe_u64(snapshot.fallback_write_failures)?;
            validate_safe_u64(snapshot.fallback_routed)?;
            Ok(())
        }
        SupportChildProducerStatusV1::Omitted { captured_at, .. } => {
            validate_timestamp(captured_at)
        }
    }
}

fn validate_fallback_record(record: &SupportFallbackRecordV1) -> Result<(), SupportSchemaError> {
    validate_segment(record.segment, 3)?;
    validate_safe_u64(record.line)
}

fn validate_opaque_line(line: &SupportOpaqueFallbackLineV1) -> Result<(), SupportSchemaError> {
    validate_segment(line.segment, 3)?;
    validate_safe_u64(line.line)?;
    if line.semantic_claims {
        return Err(SupportSchemaError::PinnedLiteralMismatch(
            "opaqueLine.semanticClaims",
        ));
    }
    Ok(())
}

fn validate_fallback_component(
    component: &SupportFallbackComponentV1,
) -> Result<(), SupportSchemaError> {
    match component {
        SupportFallbackComponentV1::Pr3DesktopNativeMixed {
            records,
            opaque_lines,
        } => {
            for record in records {
                validate_fallback_record(record)?;
            }
            for line in opaque_lines {
                validate_opaque_line(line)?;
            }
            Ok(())
        }
        SupportFallbackComponentV1::Pr5Wrapped {
            records,
            opaque_lines,
            ..
        } => {
            if !opaque_lines.is_empty() {
                return Err(SupportSchemaError::PinnedLiteralMismatch(
                    "pr5Wrapped.opaqueLines",
                ));
            }
            for record in records {
                validate_fallback_record(record)?;
            }
            Ok(())
        }
    }
}

fn validate_legacy_source(source: &SupportLegacySourceV1) -> Result<(), SupportSchemaError> {
    if source.semantic_claims {
        return Err(SupportSchemaError::PinnedLiteralMismatch(
            "legacy.semanticClaims",
        ));
    }
    for line in &source.lines {
        validate_segment(line.segment, 5)?;
        validate_safe_u64(line.line)?;
        validate_content_string(&line.value)?;
    }
    Ok(())
}

fn validate_session_ledger(ledger: &SupportSessionLedgerV1) -> Result<(), SupportSchemaError> {
    validate_id(&ledger.workspace_id)?;
    validate_id(&ledger.anyharness_workspace_id)?;
    if ledger.sessions.len() as u64 > SESSIONS {
        return Err(SupportSchemaError::CapExceeded("sessionLedger.sessions"));
    }
    for session in &ledger.sessions {
        validate_id(&session.session_id)?;
        validate_timestamp(&session.summary_captured_at)?;
    }
    Ok(())
}

/// Manifest: pinned schema/policy versions, fixed limits, and the fixed
/// collection caps (nine sources, 128 gaps, 64 omissions, 64 truncations,
/// exactly eight degradation tier counters via the array type).
pub fn validate_manifest(manifest: &SupportSnapshotManifestV1) -> Result<(), SupportSchemaError> {
    if manifest.schema_version != MANIFEST_SCHEMA_VERSION {
        return Err(SupportSchemaError::PinnedLiteralMismatch(
            "manifest.schemaVersion",
        ));
    }
    validate_timestamp(&manifest.generated_at)?;
    validate_safe_u64(manifest.serialized_bytes)?;
    validate_limits(&manifest.limits)?;
    validate_collector_coverage(&manifest.collector)?;
    if manifest.sources.len() > MAX_SOURCE_ENTRIES {
        return Err(SupportSchemaError::CapExceeded("manifest.sources"));
    }
    for source in &manifest.sources {
        validate_timestamp(&source.captured_at)?;
        validate_safe_u64(source.read_bytes)?;
        validate_safe_u64(source.included_bytes)?;
        validate_safe_u64(source.included_items)?;
    }
    if manifest.gaps.len() > MAX_GAP_ENTRIES {
        return Err(SupportSchemaError::CapExceeded("manifest.gaps"));
    }
    if manifest.omissions.len() > MAX_OMISSION_ENTRIES {
        return Err(SupportSchemaError::CapExceeded("manifest.omissions"));
    }
    for omission in &manifest.omissions {
        validate_safe_u64(omission.count)?;
        validate_optional_safe_u64(omission.known_bytes)?;
    }
    if manifest.truncations.len() > MAX_TRUNCATION_ENTRIES {
        return Err(SupportSchemaError::CapExceeded("manifest.truncations"));
    }
    for truncation in &manifest.truncations {
        validate_safe_u64(truncation.count)?;
        validate_optional_safe_u64(truncation.omitted_bytes)?;
    }
    if manifest.degradation.policy_version != DEGRADATION_POLICY_VERSION {
        return Err(SupportSchemaError::PinnedLiteralMismatch(
            "degradation.policyVersion",
        ));
    }
    for removed in manifest.degradation.removed_by_tier {
        validate_safe_u64(removed)?;
    }
    validate_safe_u64(manifest.additional_entries.gaps)?;
    validate_safe_u64(manifest.additional_entries.omissions)?;
    validate_safe_u64(manifest.additional_entries.truncations)?;
    Ok(())
}

/// Validate a complete snapshot against every support-owned bound and
/// pinned literal. Embedded accepted protocol values are trusted as already
/// validated by the protocol crate and are not re-validated here.
pub fn validate_snapshot(snapshot: &SupportSnapshotV3) -> Result<(), SupportSchemaError> {
    if snapshot.schema_version != SNAPSHOT_SCHEMA_VERSION {
        return Err(SupportSchemaError::PinnedLiteralMismatch(
            "snapshot.schemaVersion",
        ));
    }
    validate_id(&snapshot.snapshot_id)?;
    validate_timestamp(&snapshot.generated_at)?;
    validate_generic_string(&snapshot.app.version)?;
    validate_generic_string(&snapshot.app.release)?;
    validate_generic_string(&snapshot.app.platform)?;
    validate_timestamp(&snapshot.consent.granted_at)?;
    validate_timestamp(&snapshot.selection.report_opened_at)?;
    validate_timestamp(&snapshot.selection.source_time_from)?;
    validate_timestamp(&snapshot.selection.source_time_to)?;
    for id in [
        &snapshot.selection.workspace_id,
        &snapshot.selection.anyharness_workspace_id,
        &snapshot.selection.ui_session_id,
        &snapshot.selection.materialized_session_id,
    ]
    .into_iter()
    .flatten()
    {
        validate_id(id)?;
    }
    validate_collector_evidence(&snapshot.collector)?;
    if let SupportTauriProducerHealthV1::SupervisorOnly { desktop_health, .. } =
        &snapshot.producer_health.tauri
    {
        validate_desktop_health(desktop_health)?;
    }
    validate_child_status(&snapshot.producer_health.anyharness)?;
    validate_child_status(&snapshot.producer_health.desktop_worker)?;
    for component in &snapshot.fallback_evidence {
        validate_fallback_component(component)?;
    }
    for source in &snapshot.legacy_evidence {
        validate_legacy_source(source)?;
    }
    if let Some(ledger) = &snapshot.session_ledger {
        validate_session_ledger(ledger)?;
    }
    validate_manifest(&snapshot.manifest)
}
