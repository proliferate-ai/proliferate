use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::runtime::SafeStopState;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeCommandStatus {
    Accepted,
    Queued,
    Running,
    Rejected,
    Expired,
    Cancelled,
    Completed,
    Failed,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeActor {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actor_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actor_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCommandPreconditions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_session_event_seq: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_config_version: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_interaction_version: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_safe_stop_state: Option<SafeStopState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub require_live_session: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub not_after: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCommandMetadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub idempotency_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issued_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deadline_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actor: Option<RuntimeActor>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preconditions: Option<RuntimeCommandPreconditions>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCommandAcceptance {
    pub status: RuntimeCommandStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accepted_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub queued_seq: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub problem_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}
