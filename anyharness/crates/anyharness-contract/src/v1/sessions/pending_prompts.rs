use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::PromptInputBlock;
use crate::v1::{ContentPart, PromptProvenance};

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PendingPromptSummary {
    /// Immutable runtime-owned queue-entry identity. This is monotonic within
    /// a session and is independent from this summary's position in the array.
    pub seq: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_id: Option<String>,
    pub text: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub content_parts: Vec<ContentPart>,
    pub queued_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_provenance: Option<PromptProvenance>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EditPendingPromptRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blocks: Option<Vec<PromptInputBlock>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReorderPendingPromptsRequest {
    /// Queue order the caller last observed. The mutation is rejected with a
    /// conflict if this no longer matches durable state.
    pub expected_seqs: Vec<i64>,
    /// Exact permutation to commit when `expected_seqs` still matches.
    pub desired_seqs: Vec<i64>,
}
