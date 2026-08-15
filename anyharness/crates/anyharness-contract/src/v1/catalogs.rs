use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// The runtime's active agent catalog version and its provenance. Read-only:
/// there is no apply/push endpoint. Since rung 5 (FR-1) the runtime binary
/// is the FLOOR transport, not the only one — a signed, versioned artifact
/// may also be fetched once at boot, so `source` can now report either
/// provenance.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogVersionResponse {
    /// The `catalogVersion` string from the active document.
    pub catalog_version: String,
    /// Where the active catalog came from: `"bundled"` (the compiled-in
    /// floor) or `"staged"` (a signed artifact fetched at boot and activated
    /// because it validated and was strictly newer than the floor).
    pub source: String,
}
