use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::{ContentPart, PromptProvenance};
use crate::v1::sessions::PendingPromptSummary;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PendingPromptAddedPayload {
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
pub struct PendingPromptUpdatedPayload {
    pub seq: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_id: Option<String>,
    pub text: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub content_parts: Vec<ContentPart>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_provenance: Option<PromptProvenance>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PendingPromptRemovedPayload {
    pub seq: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_id: Option<String>,
    pub reason: PendingPromptRemovalReason,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PendingPromptRemovalReason {
    Executed,
    Deleted,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PendingPromptsReorderedPayload {
    /// Complete authoritative queue in committed order. Entry `seq` values
    /// retain their immutable identities across the reorder.
    pub pending_prompts: Vec<PendingPromptSummary>,
}
