use anyharness_contract::v1::{ProposedPlanDecisionState, ProposedPlanNativeResolutionState};

pub const MAX_PLAN_BODY_BYTES: usize = 256 * 1024;
pub const DEFAULT_IMPLEMENT_INSTRUCTION: &str = "Carry out this approved plan now.";

#[derive(Debug, Clone)]
pub struct PlanRecord {
    pub id: String,
    pub workspace_id: String,
    pub session_id: String,
    pub item_id: String,
    pub title: String,
    pub body_markdown: String,
    pub snapshot_hash: String,
    pub decision_state: ProposedPlanDecisionState,
    pub native_resolution_state: ProposedPlanNativeResolutionState,
    pub decision_version: i64,
    pub source_agent_kind: String,
    pub source_kind: String,
    pub source_session_id: String,
    pub source_turn_id: Option<String>,
    pub source_item_id: Option<String>,
    pub source_tool_call_id: Option<String>,
    pub superseded_by_plan_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct NewPlan {
    pub workspace_id: String,
    pub session_id: String,
    pub title: String,
    pub body_markdown: String,
    pub source_agent_kind: String,
    pub source_kind: String,
    pub source_turn_id: Option<String>,
    pub source_item_id: Option<String>,
    pub source_tool_call_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct PlanInteractionLinkRecord {
    pub plan_id: String,
    pub request_id: String,
    pub session_id: String,
    pub tool_call_id: String,
    pub resolution_state: String,
    pub option_mappings_json: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct PlanHandoffRecord {
    pub id: String,
    pub plan_id: String,
    pub source_session_id: String,
    pub target_session_id: String,
    pub instruction: String,
    pub prompt_status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlanCreateOutcome {
    Created,
    Existing,
}
