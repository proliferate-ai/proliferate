//! Snapshot manifest model pieces: fixed limits, accounting entries, and
//! fixed-cardinality scrub counters.

use serde::{Deserialize, Serialize};

use proliferate_diagnostics_protocol::v1::types::GapV1;

use super::super::enums::{
    SupportSecretClassV1, SupportSessionOmissionReasonV1, SupportSourceManifestSourceV1,
    SupportSourceStateV1,
};
use super::super::limits;
use super::common::{SupportOmissionV1, SupportTruncationV1};
use super::evidence::SupportCollectorCoverageV1;

/// Fixed-cardinality scrub counter map: all fifteen secret classes are
/// always serialized, in `SupportSecretClassV1` declaration order,
/// including zeros.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct SupportSecretScrubCountsV1 {
    pub authorization: u64,
    pub cookie: u64,
    pub access_token: u64,
    pub refresh_token: u64,
    pub identity_token: u64,
    pub api_key: u64,
    pub client_secret: u64,
    pub password: u64,
    pub private_key: u64,
    pub credential_container: u64,
    pub environment_secret: u64,
    pub signed_url: u64,
    pub provider_credential: u64,
    pub opaque_credential: u64,
    pub url_userinfo: u64,
}

impl SupportSecretScrubCountsV1 {
    /// Read the counter for one secret class.
    pub fn get(&self, class: SupportSecretClassV1) -> u64 {
        match class {
            SupportSecretClassV1::Authorization => self.authorization,
            SupportSecretClassV1::Cookie => self.cookie,
            SupportSecretClassV1::AccessToken => self.access_token,
            SupportSecretClassV1::RefreshToken => self.refresh_token,
            SupportSecretClassV1::IdentityToken => self.identity_token,
            SupportSecretClassV1::ApiKey => self.api_key,
            SupportSecretClassV1::ClientSecret => self.client_secret,
            SupportSecretClassV1::Password => self.password,
            SupportSecretClassV1::PrivateKey => self.private_key,
            SupportSecretClassV1::CredentialContainer => self.credential_container,
            SupportSecretClassV1::EnvironmentSecret => self.environment_secret,
            SupportSecretClassV1::SignedUrl => self.signed_url,
            SupportSecretClassV1::ProviderCredential => self.provider_credential,
            SupportSecretClassV1::OpaqueCredential => self.opaque_credential,
            SupportSecretClassV1::UrlUserinfo => self.url_userinfo,
        }
    }
}

/// Manifest accounting for the session collection.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum SupportSessionCollectionManifestV1 {
    #[serde(rename_all = "camelCase")]
    Included {
        workspace_id: String,
        anyharness_workspace_id: String,
        selected_sessions: u64,
        session_included_bytes: u64,
        event_included_bytes: u64,
        raw_notification_included_bytes: u64,
        limit_uncertain_endpoints: u64,
    },
    #[serde(rename_all = "camelCase")]
    Omitted {
        reason: SupportSessionOmissionReasonV1,
    },
}

/// Per-source manifest accounting entry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SupportSourceManifestV1 {
    pub source: SupportSourceManifestSourceV1,
    pub state: SupportSourceStateV1,
    pub captured_at: String,
    pub read_bytes: u64,
    pub included_bytes: u64,
    pub included_items: u64,
}

/// The fixed limits object serialized into the manifest. Every field is a
/// pinned literal; construct with [`SupportSnapshotLimitsV1::fixed`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SupportSnapshotLimitsV1 {
    pub package_bytes: u64,
    pub manifest_bytes: u64,
    pub all_files_read_bytes: u64,
    pub component_files_read_bytes: u64,
    pub desktop_native_fallback_bytes: u64,
    pub anyharness_fallback_bytes: u64,
    pub desktop_worker_fallback_bytes: u64,
    pub source_line_bytes: u64,
    pub collector_records: u64,
    pub collector_bytes: u64,
    pub sessions: u64,
    pub session_list_response_bytes: u64,
    pub events_per_session: u64,
    pub event_response_bytes: u64,
    pub raw_notifications_per_session: u64,
    pub raw_notification_response_bytes: u64,
    pub session_evidence_bytes: u64,
    pub session_bytes: u64,
    pub generic_string_bytes: u64,
    pub content_string_bytes: u64,
    pub container_items: u64,
    pub nesting_depth: u64,
}

impl SupportSnapshotLimitsV1 {
    /// The one valid value: every field pinned to its spec literal.
    pub fn fixed() -> Self {
        Self {
            package_bytes: limits::PACKAGE_BYTES,
            manifest_bytes: limits::MANIFEST_BYTES,
            all_files_read_bytes: limits::ALL_FILES_READ_BYTES,
            component_files_read_bytes: limits::COMPONENT_FILES_READ_BYTES,
            desktop_native_fallback_bytes: limits::DESKTOP_NATIVE_FALLBACK_BYTES,
            anyharness_fallback_bytes: limits::ANYHARNESS_FALLBACK_BYTES,
            desktop_worker_fallback_bytes: limits::DESKTOP_WORKER_FALLBACK_BYTES,
            source_line_bytes: limits::SOURCE_LINE_BYTES,
            collector_records: limits::COLLECTOR_RECORDS,
            collector_bytes: limits::COLLECTOR_BYTES,
            sessions: limits::SESSIONS,
            session_list_response_bytes: limits::SESSION_LIST_RESPONSE_BYTES,
            events_per_session: limits::EVENTS_PER_SESSION,
            event_response_bytes: limits::EVENT_RESPONSE_BYTES,
            raw_notifications_per_session: limits::RAW_NOTIFICATIONS_PER_SESSION,
            raw_notification_response_bytes: limits::RAW_NOTIFICATION_RESPONSE_BYTES,
            session_evidence_bytes: limits::SESSION_EVIDENCE_BYTES,
            session_bytes: limits::SESSION_BYTES,
            generic_string_bytes: limits::GENERIC_STRING_BYTES as u64,
            content_string_bytes: limits::CONTENT_STRING_BYTES as u64,
            container_items: limits::CONTAINER_ITEMS as u64,
            nesting_depth: limits::NESTING_DEPTH as u64,
        }
    }
}

/// Degradation accounting: fixed policy version and exactly eight tier
/// counters, serialized as an eight-element array.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SupportDegradationV1 {
    /// Pinned literal 1.
    pub policy_version: u64,
    pub removed_by_tier: [u64; 8],
}

/// Aggregated overflow beyond the fixed manifest collection caps.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SupportAdditionalEntriesV1 {
    pub gaps: u64,
    pub omissions: u64,
    pub truncations: u64,
}

/// The complete snapshot manifest.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SupportSnapshotManifestV1 {
    /// Pinned literal 1.
    pub schema_version: u64,
    pub generated_at: String,
    pub serialized_bytes: u64,
    pub limits: SupportSnapshotLimitsV1,
    pub collector: SupportCollectorCoverageV1,
    pub sources: Vec<SupportSourceManifestV1>,
    pub session_collection: SupportSessionCollectionManifestV1,
    pub gaps: Vec<GapV1>,
    pub omissions: Vec<SupportOmissionV1>,
    pub truncations: Vec<SupportTruncationV1>,
    pub scrubbed_by_class: SupportSecretScrubCountsV1,
    pub degradation: SupportDegradationV1,
    pub additional_entries: SupportAdditionalEntriesV1,
}
