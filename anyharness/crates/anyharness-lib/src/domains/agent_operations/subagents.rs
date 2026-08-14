use crate::domains::agent_operations::model::AgentView;
use crate::domains::sessions::extensions::SessionTurnOutcome;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubagentRelationshipView {
    pub subagent_id: Option<String>,
    pub session_link_id: String,
    pub parent_session_id: String,
    pub child_session_id: String,
    pub label: Option<String>,
    pub created_at: String,
    pub subagent_closed_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubagentLatestCompletionView {
    pub completion_id: String,
    pub child_turn_id: String,
    pub outcome: SessionTurnOutcome,
    pub child_last_event_seq: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubagentRosterEntry {
    pub agent: AgentView,
    pub relationship: SubagentRelationshipView,
    pub latest_completion: Option<SubagentLatestCompletionView>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubagentParentRoster {
    pub parent: AgentView,
    pub children: Vec<SubagentRosterEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceSubagentRoster {
    pub workspace_id: String,
    pub parents: Vec<SubagentParentRoster>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubagentLifecycleView {
    pub agent: AgentView,
    pub relationship: Option<SubagentRelationshipView>,
}
