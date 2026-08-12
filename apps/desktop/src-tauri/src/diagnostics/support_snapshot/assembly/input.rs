//! Public, I/O-free input and output seam for support snapshot assembly.

use std::fmt;

use proliferate_diagnostics_protocol::v1::types::CollectorAcceptedRecordV1;

use super::super::schema::enums::{
    SupportLegacySourceKindV1, SupportSessionOmissionReasonV1, SupportSourceManifestSourceV1,
    SupportSourceStateV1,
};
use super::super::schema::model::common::SupportJsonValueV1;
use super::super::schema::model::evidence::{
    SupportCollectorEvidenceV1, SupportFallbackRecordV1, SupportLegacyLineV1,
    SupportOpaqueFallbackLineV1, SupportSessionEndpointStatesV1,
};
use super::super::schema::model::health::SupportProducerHealthV1;
use super::super::schema::model::snapshot::{
    SupportAppV1, SupportConsentV1, SupportSelectionV1, SupportSnapshotV3,
};
use super::super::schema::validate::SupportSchemaError;
use super::super::scrub::{SupportOptionalScrubbed, SupportScrubAccounting};

/// Mandatory support-owned and accepted-protocol DTOs.
#[derive(Debug, Clone, PartialEq)]
pub struct SupportAssemblyMandatoryV1 {
    pub snapshot_id: String,
    pub generated_at: String,
    pub app: SupportAppV1,
    pub consent: SupportConsentV1,
    pub selection: SupportSelectionV1,
    pub collector: SupportCollectorEvidenceV1,
    pub producer_health: SupportProducerHealthV1,
}

/// Capture accounting for one fixed file-evidence source.
///
/// `read_bytes` is capture-layer accounting. The assembler never replaces it
/// with serialized JSON size.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SupportSourceCaptureV1 {
    pub source: SupportSourceManifestSourceV1,
    pub state: SupportSourceStateV1,
    pub captured_at: String,
    pub read_bytes: u64,
}

/// One already-scrubbed optional atom and its source/response byte accounting.
#[derive(Debug, Clone, PartialEq)]
pub struct SupportAssemblyCandidateV1<T> {
    pub scrubbed: SupportOptionalScrubbed<T>,
    pub included_bytes: u64,
    /// Stable capture-owned index; vector insertion order is not identity.
    pub original_index: u64,
}

/// A structured or opaque active-fallback atom.
#[derive(Debug, Clone, PartialEq)]
pub enum SupportFallbackCandidateValueV1 {
    Record(SupportFallbackRecordV1),
    OpaqueLine(SupportOpaqueFallbackLineV1),
}

/// A retired legacy line with its fixed source identity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SupportLegacyCandidateValueV1 {
    pub source: SupportLegacySourceKindV1,
    pub line: SupportLegacyLineV1,
}

/// One selected session shell plus independently degradable evidence atoms.
#[derive(Debug, Clone, PartialEq)]
pub struct SupportSessionCandidateV1 {
    /// Stable explicit selection order, beginning at zero.
    pub selection_index: u64,
    pub session_id: String,
    pub summary_captured_at: String,
    pub endpoint_states: SupportSessionEndpointStatesV1,
    pub summary: SupportAssemblyCandidateV1<SupportJsonValueV1>,
    pub normalized_events: Vec<SupportAssemblyCandidateV1<SupportJsonValueV1>>,
    pub raw_notifications: Vec<SupportAssemblyCandidateV1<SupportJsonValueV1>>,
}

/// Session collection input. Included shells survive package degradation even
/// when every optional summary/event/raw atom is removed.
#[derive(Debug, Clone, PartialEq)]
pub enum SupportSessionAssemblyV1 {
    Included {
        captured_at: String,
        read_bytes: u64,
        workspace_id: String,
        anyharness_workspace_id: String,
        sessions: Vec<SupportSessionCandidateV1>,
    },
    Omitted {
        captured_at: String,
        read_bytes: u64,
        reason: SupportSessionOmissionReasonV1,
    },
}

/// Bounded correlation identities used only for tier-three classification.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SupportCorrelationSelectionV1 {
    pub operation_ids: Vec<String>,
    pub turn_ids: Vec<String>,
    pub item_ids: Vec<String>,
    pub prompt_ids: Vec<String>,
    pub request_ids: Vec<String>,
    pub target_ids: Vec<String>,
    pub workflow_ids: Vec<String>,
}

/// Complete pure assembly input. All candidates have already passed P1B.
#[derive(Debug, Clone, PartialEq)]
pub struct SupportAssemblyInputV1 {
    pub mandatory: SupportAssemblyMandatoryV1,
    /// Fixed file sources only; collector and session entries are derived.
    pub file_sources: Vec<SupportSourceCaptureV1>,
    pub collector_records: Vec<SupportAssemblyCandidateV1<CollectorAcceptedRecordV1>>,
    pub fallback: Vec<SupportAssemblyCandidateV1<SupportFallbackCandidateValueV1>>,
    pub legacy: Vec<SupportAssemblyCandidateV1<SupportLegacyCandidateValueV1>>,
    pub sessions: SupportSessionAssemblyV1,
    pub correlations: SupportCorrelationSelectionV1,
    /// Capture-wide P1B accounting not already attached to an atom.
    pub accounting: SupportScrubAccounting,
}

/// Validated deterministic output, ready for the later file/store owner.
#[derive(Debug, Clone, PartialEq)]
pub struct SupportAssemblyOutputV1 {
    pub snapshot: SupportSnapshotV3,
    pub compact_json: Vec<u8>,
    pub serialized_bytes: u64,
    pub sha256: String,
}

/// Secret-free deterministic assembly failure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SupportAssemblyError {
    InvalidMandatory(SupportSchemaError),
    InvalidSourceAccounting,
    InvalidSessionSource,
    InvalidCorrelationSelection,
    AccountingOverflow,
    SerializationFailed,
    MandatorySkeletonTooLarge,
    CandidateLoopExceeded,
}

impl fmt::Display for SupportAssemblyError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::InvalidMandatory(_) => "mandatory support snapshot data is invalid",
            Self::InvalidSourceAccounting => "support source accounting is invalid",
            Self::InvalidSessionSource => "support session source is invalid",
            Self::InvalidCorrelationSelection => "support correlation selection is invalid",
            Self::AccountingOverflow => "support assembly accounting overflow",
            Self::SerializationFailed => "support snapshot serialization failed",
            Self::MandatorySkeletonTooLarge => {
                "mandatory support snapshot skeleton exceeds its cap"
            }
            Self::CandidateLoopExceeded => "support candidate degradation did not converge",
        };
        formatter.write_str(message)
    }
}

impl std::error::Error for SupportAssemblyError {}

impl From<SupportSchemaError> for SupportAssemblyError {
    fn from(error: SupportSchemaError) -> Self {
        Self::InvalidMandatory(error)
    }
}
