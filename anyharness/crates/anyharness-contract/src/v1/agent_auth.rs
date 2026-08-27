use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Outcome of pushing an agent-auth state document into the runtime.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ApplyAgentAuthStateResponse {
    /// True when the document was persisted to the runtime's state file.
    pub applied: bool,
    /// The persisted document's sequence (monotonic per surface; the server
    /// bumps it on every content-changing render).
    pub sequence: i64,
}
