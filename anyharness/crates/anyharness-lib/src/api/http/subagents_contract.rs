use anyharness_contract::v1::{
    AgentOperationsAgent, AgentOperationsCapability, AgentOperationsConfiguration,
    AgentOperationsExecutionStatus, AgentOperationsIdentity, AgentOperationsPresentationStatus,
    AgentOperationsRole, AgentOperationsStatus, AgentOperationsWorkspaceIdentity,
    SessionSubagentsResponse, SubagentLatestCompletion, SubagentLifecycleResponse,
    SubagentParentRoster as ContractSubagentParentRoster, SubagentRelationship,
    SubagentRosterEntry as ContractSubagentRosterEntry, SubagentTurnOutcome,
    WorkspaceSubagentsResponse,
};

use crate::domains::agent_operations::model::{
    AgentCapability, AgentExecutionStatus, AgentPresentationStatus, AgentRole, AgentView,
    SubagentLatestCompletionView, SubagentLifecycleView, SubagentParentRoster,
    SubagentRelationshipView, SubagentRosterEntry, WorkspaceSubagentRoster,
};
use crate::domains::sessions::extensions::SessionTurnOutcome;

pub(super) fn workspace_roster_response(
    roster: WorkspaceSubagentRoster,
) -> WorkspaceSubagentsResponse {
    WorkspaceSubagentsResponse {
        workspace_id: roster.workspace_id,
        parents: roster
            .parents
            .into_iter()
            .map(parent_roster_to_contract)
            .collect(),
    }
}

pub(super) fn session_roster_response(roster: SubagentParentRoster) -> SessionSubagentsResponse {
    SessionSubagentsResponse {
        parent: agent_to_contract(roster.parent),
        children: roster
            .children
            .into_iter()
            .map(roster_entry_to_contract)
            .collect(),
    }
}

pub(super) fn lifecycle_response(result: SubagentLifecycleView) -> SubagentLifecycleResponse {
    SubagentLifecycleResponse {
        agent: agent_to_contract(result.agent),
        relationship: result.relationship.map(relationship_to_contract),
    }
}

fn parent_roster_to_contract(roster: SubagentParentRoster) -> ContractSubagentParentRoster {
    ContractSubagentParentRoster {
        parent: agent_to_contract(roster.parent),
        children: roster
            .children
            .into_iter()
            .map(roster_entry_to_contract)
            .collect(),
    }
}

fn roster_entry_to_contract(entry: SubagentRosterEntry) -> ContractSubagentRosterEntry {
    ContractSubagentRosterEntry {
        agent: agent_to_contract(entry.agent),
        relationship: relationship_to_contract(entry.relationship),
        latest_completion: entry.latest_completion.map(completion_to_contract),
    }
}

fn relationship_to_contract(relationship: SubagentRelationshipView) -> SubagentRelationship {
    SubagentRelationship {
        subagent_id: relationship.subagent_id,
        session_link_id: relationship.session_link_id,
        parent_session_id: relationship.parent_session_id,
        child_session_id: relationship.child_session_id,
        label: relationship.label,
        created_at: relationship.created_at,
        subagent_closed_at: relationship.subagent_closed_at,
    }
}

fn completion_to_contract(completion: SubagentLatestCompletionView) -> SubagentLatestCompletion {
    SubagentLatestCompletion {
        completion_id: completion.completion_id,
        child_turn_id: completion.child_turn_id,
        outcome: match completion.outcome {
            SessionTurnOutcome::Completed => SubagentTurnOutcome::Completed,
            SessionTurnOutcome::Failed => SubagentTurnOutcome::Failed,
            SessionTurnOutcome::Cancelled => SubagentTurnOutcome::Cancelled,
        },
        child_last_event_seq: completion.child_last_event_seq,
        created_at: completion.created_at,
    }
}

fn agent_to_contract(agent: AgentView) -> AgentOperationsAgent {
    AgentOperationsAgent {
        identity: identity_to_contract(agent.identity),
        workspace: AgentOperationsWorkspaceIdentity {
            runtime_id: agent.workspace.runtime_id.as_str().to_string(),
            workspace_id: agent.workspace.workspace_id,
        },
        role: match agent.role {
            AgentRole::Ordinary => AgentOperationsRole::Ordinary,
            AgentRole::Subagent => AgentOperationsRole::Subagent,
        },
        parent: agent.parent.map(identity_to_contract),
        title: agent.title,
        configuration: AgentOperationsConfiguration {
            agent_kind: agent.configuration.agent_kind,
            model_id: agent.configuration.model_id,
            mode_id: agent.configuration.mode_id,
        },
        status: AgentOperationsStatus {
            presentation: match agent.status.presentation {
                AgentPresentationStatus::Running => AgentOperationsPresentationStatus::Running,
                AgentPresentationStatus::Available => AgentOperationsPresentationStatus::Available,
                AgentPresentationStatus::Closed => AgentOperationsPresentationStatus::Closed,
            },
            execution: match agent.status.execution {
                AgentExecutionStatus::Starting => AgentOperationsExecutionStatus::Starting,
                AgentExecutionStatus::Running => AgentOperationsExecutionStatus::Running,
                AgentExecutionStatus::AwaitingInteraction => {
                    AgentOperationsExecutionStatus::AwaitingInteraction
                }
                AgentExecutionStatus::Idle => AgentOperationsExecutionStatus::Idle,
                AgentExecutionStatus::Errored => AgentOperationsExecutionStatus::Errored,
                AgentExecutionStatus::Closed => AgentOperationsExecutionStatus::Closed,
            },
            has_live_actor: agent.status.has_live_actor,
        },
        capabilities: agent
            .capabilities
            .into_iter()
            .map(capability_to_contract)
            .collect(),
        created_at: agent.created_at,
        updated_at: agent.updated_at,
    }
}

fn identity_to_contract(
    identity: crate::domains::agent_operations::model::AgentIdentity,
) -> AgentOperationsIdentity {
    AgentOperationsIdentity {
        runtime_id: identity.runtime_id.as_str().to_string(),
        session_id: identity.session_id,
    }
}

fn capability_to_contract(capability: AgentCapability) -> AgentOperationsCapability {
    match capability {
        AgentCapability::Whoami => AgentOperationsCapability::Whoami,
        AgentCapability::ListWorkspaces => AgentOperationsCapability::ListWorkspaces,
        AgentCapability::ListWorkspaceOptions => AgentOperationsCapability::ListWorkspaceOptions,
        AgentCapability::CreateWorkspace => AgentOperationsCapability::CreateWorkspace,
        AgentCapability::ListAgents => AgentOperationsCapability::ListAgents,
        AgentCapability::GetAgent => AgentOperationsCapability::GetAgent,
        AgentCapability::ListSubagents => AgentOperationsCapability::ListSubagents,
        AgentCapability::ListAgentLaunchOptions => {
            AgentOperationsCapability::ListAgentLaunchOptions
        }
        AgentCapability::ListAgentConfigOptions => {
            AgentOperationsCapability::ListAgentConfigOptions
        }
        AgentCapability::GetTaskOutput => AgentOperationsCapability::GetTaskOutput,
        AgentCapability::CreateAgent => AgentOperationsCapability::CreateAgent,
        AgentCapability::ConfigureAgent => AgentOperationsCapability::ConfigureAgent,
        AgentCapability::ResumeAgent => AgentOperationsCapability::ResumeAgent,
        AgentCapability::SendMessage => AgentOperationsCapability::SendMessage,
        AgentCapability::InterruptAgent => AgentOperationsCapability::InterruptAgent,
        AgentCapability::CloseSubagent => AgentOperationsCapability::CloseSubagent,
        AgentCapability::OpenSubagent => AgentOperationsCapability::OpenSubagent,
        AgentCapability::PromoteSubagent => AgentOperationsCapability::PromoteSubagent,
    }
}
