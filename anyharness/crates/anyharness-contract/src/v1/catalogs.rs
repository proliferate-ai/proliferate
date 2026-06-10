use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Outcome of pushing an agent catalog document into the runtime.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ApplyAgentCatalogResponse {
    /// True when the document replaced the active catalog (its version
    /// differed); false when the runtime was already on that version.
    pub applied: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to_version: Option<String>,
}
