use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::SubagentTurnOutcome;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentOperationsIdentity {
    pub runtime_id: String,
    pub session_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentOperationsWorkspaceIdentity {
    pub runtime_id: String,
    pub workspace_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentOperationsRole {
    Ordinary,
    Subagent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentOperationsPresentationStatus {
    Running,
    Available,
    Closed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentOperationsExecutionStatus {
    Starting,
    Running,
    AwaitingInteraction,
    Idle,
    Errored,
    Closed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentOperationsStatus {
    pub presentation: AgentOperationsPresentationStatus,
    pub execution: AgentOperationsExecutionStatus,
    pub has_live_actor: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentOperationsCapability {
    Whoami,
    ListWorkspaces,
    ListWorkspaceOptions,
    CreateWorkspace,
    ListAgents,
    GetAgent,
    ListSubagents,
    ListAgentLaunchOptions,
    ListAgentConfigOptions,
    GetTaskOutput,
    CreateAgent,
    ConfigureAgent,
    ResumeAgent,
    SendMessage,
    InterruptAgent,
    CloseSubagent,
    OpenSubagent,
    PromoteSubagent,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentOperationsConfiguration {
    pub agent_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentOperationsAgent {
    pub identity: AgentOperationsIdentity,
    pub workspace: AgentOperationsWorkspaceIdentity,
    pub role: AgentOperationsRole,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<AgentOperationsIdentity>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub configuration: AgentOperationsConfiguration,
    pub status: AgentOperationsStatus,
    pub capabilities: Vec<AgentOperationsCapability>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SubagentRelationship {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subagent_id: Option<String>,
    pub session_link_id: String,
    pub parent_session_id: String,
    pub child_session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subagent_closed_at: Option<String>,
}

/// Outcome metadata for the child's latest committed terminal turn.
///
/// This is not proof that the attributed parent notification was delivered.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SubagentLatestCompletion {
    pub completion_id: String,
    pub child_turn_id: String,
    pub outcome: SubagentTurnOutcome,
    pub child_last_event_seq: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SubagentRosterEntry {
    pub agent: AgentOperationsAgent,
    pub relationship: SubagentRelationship,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_completion: Option<SubagentLatestCompletion>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SubagentParentRoster {
    pub parent: AgentOperationsAgent,
    pub children: Vec<SubagentRosterEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionSubagentsResponse {
    pub parent: AgentOperationsAgent,
    pub children: Vec<SubagentRosterEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSubagentsResponse {
    pub workspace_id: String,
    pub parents: Vec<SubagentParentRoster>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SubagentLifecycleResponse {
    pub agent: AgentOperationsAgent,
    /// The current reversible subagent relationship after the mutation.
    /// Promotion returns this field explicitly as `null`.
    #[schema(required, nullable)]
    pub relationship: Option<SubagentRelationship>,
}
