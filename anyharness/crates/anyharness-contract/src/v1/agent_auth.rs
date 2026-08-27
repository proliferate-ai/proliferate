use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Outcome of pushing an agent-auth state document into the runtime.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ApplyAgentAuthStateResponse {
    /// True when the document was persisted to the runtime's state file.
    pub applied: bool,
    /// The persisted document's revision.
    pub revision: i64,
}

/// The native-migration bridge (agent_auth spec, delta row "Zero rows =
/// unconfigured, with a migration for today's native users"): which harnesses
/// on this machine still carry the legacy flag that keeps their launches on
/// the harness's own login until the one-time prompt is acted on.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NativeBridgeResponse {
    /// True once the one-time seed pass (the runtime-side migration) has run
    /// on this runtime home. False on a runtime that has not started with
    /// bridge-aware code yet.
    pub seeded: bool,
    /// Harness kinds whose legacy flag is still pending, sorted.
    pub harnesses: Vec<String>,
}
