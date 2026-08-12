//! Collector, fallback, legacy, and session evidence model pieces.

use serde::{Deserialize, Serialize};

use proliferate_diagnostics_protocol::v1::types::{
    ExportManifestV1, GapV1, HealthResponseV1, ProducerRecordV1,
};

use super::super::enums::{
    SupportChildComponentV1, SupportCollectorCompletenessV1, SupportCollectorStatusV1,
    SupportCoverageSelectionV1, SupportEndpointStateV1, SupportFallbackDispositionV1,
    SupportFallbackRecordComponentV1, SupportLegacySourceKindV1, SupportLiveConfigStateV1,
    SupportPr5FallbackReasonV1, SupportSessionSelectionV1, SupportUnknownDesktopNativeV1,
};
use super::common::SupportJsonValueV1;
use super::health::DesktopDiagnosticsHealthV1;

/// Honest collector coverage claim: only the oldest matching retained
/// prefix, never newest-edge coverage.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SupportCollectorCoverageV1 {
    pub status: SupportCollectorStatusV1,
    pub completeness: SupportCollectorCompletenessV1,
    pub limit_uncertain: bool,
    /// Pinned literal 10000.
    pub request_record_limit: u64,
    /// Pinned literal 16777216.
    pub request_byte_limit: u64,
    pub returned_records: u64,
    pub returned_record_bytes: u64,
    pub cursor_start: Option<u64>,
    pub cursor_end: Option<u64>,
    pub health_oldest_cursor: Option<u64>,
    pub health_newest_cursor: Option<u64>,
    pub selection: SupportCoverageSelectionV1,
    /// Pinned literal false.
    pub newest_edge_claimed: bool,
}

/// Collector evidence: coverage plus optional export manifest/health.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SupportCollectorEvidenceV1 {
    pub captured_at: String,
    pub desktop_health: Option<DesktopDiagnosticsHealthV1>,
    pub coverage: SupportCollectorCoverageV1,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub export_manifest: Option<ExportManifestV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub export_health: Option<HealthResponseV1>,
    pub gaps: Vec<GapV1>,
}

/// One structured fallback record with its file position.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SupportFallbackRecordV1 {
    pub component: SupportFallbackRecordComponentV1,
    pub disposition: SupportFallbackDispositionV1,
    /// `None` for PR 3 raw records; serializes `null`.
    pub fallback_reason: Option<SupportPr5FallbackReasonV1>,
    pub record: ProducerRecordV1,
    /// Rotation segment index, 0 (active) through 3 (oldest).
    pub segment: u8,
    pub line: u64,
}

/// One opaque fallback line: scrubbed evidence without semantics.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SupportOpaqueFallbackLineV1 {
    pub component: SupportUnknownDesktopNativeV1,
    pub value: SupportJsonValueV1,
    /// Rotation segment index, 0 (active) through 3 (oldest).
    pub segment: u8,
    pub line: u64,
    /// Pinned literal false.
    pub semantic_claims: bool,
}

/// Structured fallback evidence grouped by family.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "family", rename_all = "snake_case", deny_unknown_fields)]
pub enum SupportFallbackComponentV1 {
    #[serde(rename_all = "camelCase")]
    Pr3DesktopNativeMixed {
        records: Vec<SupportFallbackRecordV1>,
        opaque_lines: Vec<SupportOpaqueFallbackLineV1>,
    },
    #[serde(rename_all = "camelCase")]
    Pr5Wrapped {
        component: SupportChildComponentV1,
        records: Vec<SupportFallbackRecordV1>,
        /// Always empty for the PR 5 wrapped family; validation enforces it.
        opaque_lines: Vec<SupportOpaqueFallbackLineV1>,
    },
}

/// One legacy text line with its rotation position.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SupportLegacyLineV1 {
    /// Rotation segment index, 0 (active) through 5 (oldest).
    pub segment: u8,
    pub line: u64,
    pub value: String,
}

/// Legacy prose evidence: bounded text lines, never semantics.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SupportLegacySourceV1 {
    pub source: SupportLegacySourceKindV1,
    pub lines: Vec<SupportLegacyLineV1>,
    /// Pinned literal false.
    pub semantic_claims: bool,
}

/// Per-endpoint session collection states; live config is never collected.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SupportSessionEndpointStatesV1 {
    pub summary: SupportEndpointStateV1,
    pub events: SupportEndpointStateV1,
    pub raw_notifications: SupportEndpointStateV1,
    pub live_config: SupportLiveConfigStateV1,
}

/// One consented session with its bounded evidence ledgers.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SupportSessionV1 {
    pub session_id: String,
    pub summary_captured_at: String,
    pub summary: Option<SupportJsonValueV1>,
    pub normalized_events: Vec<SupportJsonValueV1>,
    pub raw_notifications: Vec<SupportJsonValueV1>,
    pub endpoint_states: SupportSessionEndpointStatesV1,
}

/// Session ledger: one active or at most three recent sessions.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SupportSessionLedgerV1 {
    pub workspace_id: String,
    pub anyharness_workspace_id: String,
    pub selection: SupportSessionSelectionV1,
    pub sessions: Vec<SupportSessionV1>,
}
