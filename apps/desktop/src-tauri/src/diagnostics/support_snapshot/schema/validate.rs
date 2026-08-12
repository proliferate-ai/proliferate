//! Validation for the schema-3 support snapshot.
//!
//! Serde establishes the closed wire shape. These validators additionally
//! prove bounds, embedded protocol validity, deterministic ordering, and the
//! aggregate relationships that make the manifest truthful.

use std::fmt;

use chrono::{DateTime, Utc};

use super::limits::{
    CONTAINER_ITEMS, CONTENT_STRING_BYTES, GENERIC_STRING_BYTES, MAX_ID_BYTES, MAX_SAFE_INTEGER,
    NESTING_DEPTH, SNAPSHOT_SCHEMA_VERSION,
};
use super::model::common::SupportJsonValueV1;
use super::model::evidence::{SupportCollectorCoverageV1, SupportCollectorEvidenceV1};
use super::model::manifest::SupportSnapshotManifestV1;
use super::model::snapshot::SupportSnapshotV3;

mod aggregate;
mod evidence;
mod health;
mod json_value;
mod manifest;
mod ordering;
mod protocol;

/// A concrete schema, bound, protocol, or aggregate-truth violation.
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
    /// A timestamp is not a real RFC 3339 UTC instant.
    InvalidTimestamp,
    /// A projected container exceeds the item cap.
    TooManyItems,
    /// A projected value exceeds the nesting depth cap.
    TooDeep,
    /// A bounded collection exceeds its fixed cap.
    CapExceeded(&'static str),
    /// A pinned literal field carries a value other than its literal.
    PinnedLiteralMismatch(&'static str),
    /// An accepted diagnostics-protocol value fails its public validator.
    InvalidProtocolValue(&'static str),
    /// Two individually valid fields make an untruthful aggregate claim.
    InvariantViolation(&'static str),
    /// The complete artifact could not be encoded as JSON for byte proof.
    SerializationFailed,
}

impl fmt::Display for SupportSchemaError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnsafeInteger => write!(f, "integer outside the nonnegative JS-safe range"),
            Self::NonFiniteNumber => write!(f, "number is not finite"),
            Self::OversizedId => write!(f, "id/name/timestamp empty or over 128 UTF-8 bytes"),
            Self::OversizedGenericString => write!(f, "generic string over byte bound"),
            Self::OversizedContentString => write!(f, "content string over byte bound"),
            Self::InvalidTimestamp => write!(f, "timestamp is not a real RFC 3339 UTC instant"),
            Self::TooManyItems => write!(f, "container exceeds item cap"),
            Self::TooDeep => write!(f, "value exceeds nesting depth cap"),
            Self::CapExceeded(what) => write!(f, "collection cap exceeded: {what}"),
            Self::PinnedLiteralMismatch(what) => write!(f, "pinned literal mismatch: {what}"),
            Self::InvalidProtocolValue(what) => {
                write!(f, "embedded diagnostics protocol value is invalid: {what}")
            }
            Self::InvariantViolation(what) => write!(f, "schema invariant violated: {what}"),
            Self::SerializationFailed => write!(f, "snapshot JSON serialization failed"),
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

/// A signed schema integer must be nonnegative and JS-safe.
pub fn validate_safe_i64(value: i64) -> Result<(), SupportSchemaError> {
    if value < 0 || value as u64 > MAX_SAFE_INTEGER {
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

/// A projected JSON number is finite; integral values, including signed
/// negative zero, additionally obey the nonnegative JavaScript-safe boundary.
pub fn validate_support_number(value: f64) -> Result<(), SupportSchemaError> {
    validate_finite_f64(value)?;
    if value.fract() == 0.0 && (value.is_sign_negative() || value > MAX_SAFE_INTEGER as f64) {
        return Err(SupportSchemaError::UnsafeInteger);
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

/// Projected values may have sixteen container edges below the root.
pub fn validate_nesting_depth(depth: usize) -> Result<(), SupportSchemaError> {
    if depth > NESTING_DEPTH {
        return Err(SupportSchemaError::TooDeep);
    }
    Ok(())
}

/// Validate a directly-constructed projected value recursively.
pub fn validate_support_json_value(value: &SupportJsonValueV1) -> Result<(), SupportSchemaError> {
    json_value::validate_support_json_value_at(value, 0)
}

/// Timestamps are real RFC 3339 UTC instants and use the canonical `Z` zone.
pub fn validate_timestamp(value: &str) -> Result<(), SupportSchemaError> {
    parse_timestamp(value).map(|_| ())
}

pub(super) fn parse_timestamp(value: &str) -> Result<DateTime<Utc>, SupportSchemaError> {
    validate_id(value)?;
    let bytes = value.as_bytes();
    let digits = [0, 1, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15, 17, 18];
    let canonical_shape = if bytes.len() < 20 {
        false
    } else {
        let fraction = &bytes[19..bytes.len() - 1];
        bytes.get(4) == Some(&b'-')
            && bytes.get(7) == Some(&b'-')
            && bytes.get(10) == Some(&b'T')
            && bytes.get(13) == Some(&b':')
            && bytes.get(16) == Some(&b':')
            && bytes.last() == Some(&b'Z')
            && digits
                .iter()
                .all(|index| bytes.get(*index).is_some_and(u8::is_ascii_digit))
            && (fraction.is_empty()
                || (fraction.first() == Some(&b'.')
                    && fraction.len() > 1
                    && fraction[1..].iter().all(u8::is_ascii_digit)))
            && bytes.get(17..19) != Some(&b"60"[..])
    };
    if !canonical_shape {
        return Err(SupportSchemaError::InvalidTimestamp);
    }
    let parsed =
        DateTime::parse_from_rfc3339(value).map_err(|_| SupportSchemaError::InvalidTimestamp)?;
    if parsed.offset().local_minus_utc() != 0 {
        return Err(SupportSchemaError::InvalidTimestamp);
    }
    Ok(parsed.with_timezone(&Utc))
}

/// Validate the collector coverage literals, caps, and honesty matrix.
pub fn validate_collector_coverage(
    coverage: &SupportCollectorCoverageV1,
) -> Result<(), SupportSchemaError> {
    evidence::validate_collector_coverage(coverage)
}

/// Validate collector evidence including every embedded protocol value.
pub fn validate_collector_evidence(
    evidence: &SupportCollectorEvidenceV1,
) -> Result<(), SupportSchemaError> {
    evidence::validate_collector_evidence(evidence)
}

/// Validate the standalone manifest fields and bounded collections.
pub fn validate_manifest(manifest: &SupportSnapshotManifestV1) -> Result<(), SupportSchemaError> {
    manifest::validate_manifest(manifest)
}

/// Encode the complete snapshot once and return the exact UTF-8 JSON bytes.
/// This helper performs no candidate selection or degradation.
pub fn serialized_snapshot_bytes(snapshot: &SupportSnapshotV3) -> Result<u64, SupportSchemaError> {
    serde_json::to_vec(snapshot)
        .map(|bytes| bytes.len() as u64)
        .map_err(|_| SupportSchemaError::SerializationFailed)
}

/// Set `manifest.serializedBytes` to its stable self-referential fixed point.
/// The only possible changes after the first pass are decimal digit-width
/// transitions, so the loop is bounded by the 20 digits in a `u64`.
pub fn stabilize_serialized_bytes(
    snapshot: &mut SupportSnapshotV3,
) -> Result<u64, SupportSchemaError> {
    const MAX_DIGIT_TRANSITIONS: usize = 20;
    for _ in 0..=MAX_DIGIT_TRANSITIONS {
        let bytes = serialized_snapshot_bytes(snapshot)?;
        if snapshot.manifest.serialized_bytes == bytes {
            return Ok(bytes);
        }
        snapshot.manifest.serialized_bytes = bytes;
    }
    Err(SupportSchemaError::InvariantViolation(
        "manifest.serializedBytes did not stabilize",
    ))
}

/// Validate a complete snapshot against all owned and aggregate invariants.
pub fn validate_snapshot(snapshot: &SupportSnapshotV3) -> Result<(), SupportSchemaError> {
    if snapshot.schema_version != SNAPSHOT_SCHEMA_VERSION {
        return Err(SupportSchemaError::PinnedLiteralMismatch(
            "snapshot.schemaVersion",
        ));
    }
    validate_id(&snapshot.snapshot_id)?;
    validate_timestamp(&snapshot.generated_at)?;
    for value in [
        &snapshot.app.version,
        &snapshot.app.release,
        &snapshot.app.platform,
    ] {
        validate_generic_string(value)?;
    }
    for value in [
        snapshot.app.runtime_version.as_deref(),
        snapshot.app.runtime_status.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        validate_generic_string(value)?;
    }
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

    evidence::validate_collector_evidence(&snapshot.collector)?;
    health::validate_producer_health(&snapshot.producer_health)?;
    evidence::validate_records(&snapshot.records)?;
    evidence::validate_fallback_evidence(&snapshot.fallback_evidence)?;
    evidence::validate_legacy_evidence(&snapshot.legacy_evidence)?;
    if let Some(ledger) = &snapshot.session_ledger {
        evidence::validate_session_ledger(ledger)?;
    }
    manifest::validate_manifest(&snapshot.manifest)?;
    aggregate::validate_snapshot_relationships(snapshot)
}
