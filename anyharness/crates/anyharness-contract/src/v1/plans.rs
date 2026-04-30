use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::{ProposedPlanDecisionState, ProposedPlanNativeResolutionState, Session};

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProposedPlanSummary {
    pub id: String,
    pub workspace_id: String,
    pub session_id: String,
    pub item_id: String,
    pub title: String,
    pub snapshot_hash: String,
    pub decision_state: ProposedPlanDecisionState,
    pub native_resolution_state: ProposedPlanNativeResolutionState,
    pub decision_version: i64,
    pub source_agent_kind: String,
    pub source_session_id: String,
    pub source_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_turn_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_item_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_tool_call_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProposedPlanDetail {
    #[serde(flatten)]
    pub summary: ProposedPlanSummary,
    pub body_markdown: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListProposedPlansResponse {
    pub plans: Vec<ProposedPlanSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProposedPlanDocumentResponse {
    pub markdown: String,
    pub snapshot_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub projection_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub projection_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PlanDecisionRequest {
    pub expected_decision_version: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PlanDecisionResponse {
    pub plan: ProposedPlanDetail,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct HandoffPlanRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instruction: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PlanHandoffPromptStatus {
    Queued,
    Sent,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct HandoffPlanResponse {
    pub handoff_id: String,
    pub plan_id: String,
    pub source_session_id: String,
    pub target_session_id: String,
    pub prompt_status: PlanHandoffPromptStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session: Option<Session>,
}
