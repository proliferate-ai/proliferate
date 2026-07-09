use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProblemDetails {
    #[serde(rename = "type")]
    pub type_url: String,
    pub title: String,
    pub status: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instance: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    /// RFC 7807 extension member: the auth-context ids that would unlock a
    /// gated selection (the model's `availability.anyOf`). Only set on
    /// `SESSION_MODEL_GATED` (decisions ledger 16); absent on every other
    /// error, so unrelated responses stay byte-identical.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub required_contexts: Option<Vec<String>>,
}
