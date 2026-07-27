use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// The runtime's active agent catalog version and its provenance. Read-only:
/// the runtime binary is the only catalog transport, so there is no apply
/// response shape to report.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogVersionResponse {
    /// The `catalogVersion` string from the active document.
    pub catalog_version: String,
    /// Where the active catalog came from. Always `"bundled"`.
    pub source: String,
}
