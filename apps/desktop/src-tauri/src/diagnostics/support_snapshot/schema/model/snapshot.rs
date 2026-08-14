//! The top-level schema-3 snapshot artifact.
//!
//! Carries no report message, email, account name, tenant list,
//! install/device ID, hostname, username, collector endpoint/capability/
//! reference, support permit/authorization ID, staging path, presigned URL,
//! environment map, keychain data, or vendor telemetry payload.

use serde::{Deserialize, Serialize};

use proliferate_diagnostics_protocol::v1::types::CollectorAcceptedRecordV1;

use super::super::enums::{SupportConsentDisclosureVersionV1, SupportSessionSelectionV1};
use super::evidence::{
    SupportCollectorEvidenceV1, SupportFallbackComponentV1, SupportLegacySourceV1,
    SupportSessionLedgerV1,
};
use super::health::SupportProducerHealthV1;
use super::manifest::SupportSnapshotManifestV1;

/// App identity block. Carries no user, device, host, or install identity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SupportAppV1 {
    pub version: String,
    pub release: String,
    pub platform: String,
    pub runtime_version: Option<String>,
    pub runtime_status: Option<String>,
}

/// Consent evidence bound into the artifact.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SupportConsentV1 {
    pub disclosure_version: SupportConsentDisclosureVersionV1,
    pub granted_at: String,
    pub selection: SupportSessionSelectionV1,
}

/// Selection window and consented scope identifiers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SupportSelectionV1 {
    pub report_opened_at: String,
    pub source_time_from: String,
    pub source_time_to: String,
    pub workspace_id: Option<String>,
    pub anyharness_workspace_id: Option<String>,
    pub ui_session_id: Option<String>,
    pub materialized_session_id: Option<String>,
}

/// The complete schema-3 consented support snapshot artifact.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SupportSnapshotV3 {
    /// Pinned literal 3.
    pub schema_version: u64,
    pub snapshot_id: String,
    pub generated_at: String,
    pub app: SupportAppV1,
    pub consent: SupportConsentV1,
    pub selection: SupportSelectionV1,
    pub collector: SupportCollectorEvidenceV1,
    pub producer_health: SupportProducerHealthV1,
    pub records: Vec<CollectorAcceptedRecordV1>,
    pub fallback_evidence: Vec<SupportFallbackComponentV1>,
    pub legacy_evidence: Vec<SupportLegacySourceV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_ledger: Option<SupportSessionLedgerV1>,
    pub manifest: SupportSnapshotManifestV1,
}
