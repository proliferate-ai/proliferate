use crate::domains::agent_operations::model::{
    AgentCapability, AgentCreationKind, AgentPresentationStatus, AgentRole, CapabilityDecision,
    CapabilityDenial,
};

#[derive(Debug, Clone, Copy)]
pub(super) struct CallerFacts {
    pub role: AgentRole,
    pub status: AgentPresentationStatus,
}

#[derive(Debug, Clone, Copy)]
pub(super) struct TargetFacts {
    pub role: AgentRole,
    pub status: AgentPresentationStatus,
    pub owned_by_caller: bool,
}

pub(super) fn effective_capabilities(facts: CallerFacts) -> Vec<AgentCapability> {
    AgentCapability::ALL
        .into_iter()
        .filter(|capability| caller_capability(facts, *capability).allowed)
        .collect()
}

pub(super) fn caller_capability(
    facts: CallerFacts,
    capability: AgentCapability,
) -> CapabilityDecision {
    if facts.status == AgentPresentationStatus::Closed && is_mutation(capability) {
        return denied(capability, CapabilityDenial::CallerClosed);
    }

    if facts.role == AgentRole::Subagent
        && matches!(
            capability,
            AgentCapability::CreateAgent
                | AgentCapability::CloseSubagent
                | AgentCapability::OpenSubagent
                | AgentCapability::PromoteSubagent
        )
    {
        return denied(
            capability,
            if capability == AgentCapability::CreateAgent {
                CapabilityDenial::SubagentCannotCreateAgent
            } else {
                CapabilityDenial::ParentOnly
            },
        );
    }

    allowed(capability)
}

pub(super) fn create_agent_decision(
    caller: CallerFacts,
    caller_workspace_id: &str,
    kind: AgentCreationKind,
    target_workspace_id: &str,
) -> CapabilityDecision {
    let base = caller_capability(caller, AgentCapability::CreateAgent);
    if !base.allowed {
        return base;
    }
    if kind == AgentCreationKind::Subagent && caller_workspace_id != target_workspace_id {
        return denied(
            AgentCapability::CreateAgent,
            CapabilityDenial::SubagentSameWorkspaceRequired,
        );
    }
    base
}

pub(super) fn target_capabilities(
    caller: CallerFacts,
    target: TargetFacts,
) -> Vec<AgentCapability> {
    const TARGET_CAPABILITIES: [AgentCapability; 9] = [
        AgentCapability::GetAgent,
        AgentCapability::ListAgentConfigOptions,
        AgentCapability::GetTaskOutput,
        AgentCapability::ConfigureAgent,
        AgentCapability::ResumeAgent,
        AgentCapability::SendMessage,
        AgentCapability::InterruptAgent,
        AgentCapability::CloseSubagent,
        AgentCapability::OpenSubagent,
    ];

    let mut capabilities = TARGET_CAPABILITIES
        .into_iter()
        .filter(|capability| target_capability(caller, target, *capability).allowed)
        .collect::<Vec<_>>();
    if target_capability(caller, target, AgentCapability::PromoteSubagent).allowed {
        capabilities.push(AgentCapability::PromoteSubagent);
    }
    capabilities
}

pub(super) fn target_capability(
    caller: CallerFacts,
    target: TargetFacts,
    capability: AgentCapability,
) -> CapabilityDecision {
    let caller_decision = caller_capability(caller, capability);
    if !caller_decision.allowed {
        return caller_decision;
    }

    if target.role == AgentRole::Subagent && !target.owned_by_caller {
        return denied(capability, CapabilityDenial::ParentOnly);
    }

    if matches!(
        capability,
        AgentCapability::CloseSubagent
            | AgentCapability::OpenSubagent
            | AgentCapability::PromoteSubagent
    ) && target.role != AgentRole::Subagent
    {
        return denied(capability, CapabilityDenial::TargetMustBeSubagent);
    }

    if target.status == AgentPresentationStatus::Closed {
        return if capability == AgentCapability::OpenSubagent
            || capability == AgentCapability::CloseSubagent
            || matches!(
                capability,
                AgentCapability::GetAgent | AgentCapability::GetTaskOutput
            ) {
            allowed(capability)
        } else {
            denied(capability, CapabilityDenial::SubagentOpenRequired)
        };
    }

    allowed(capability)
}

fn is_mutation(capability: AgentCapability) -> bool {
    matches!(
        capability,
        AgentCapability::CreateWorkspace
            | AgentCapability::CreateAgent
            | AgentCapability::ConfigureAgent
            | AgentCapability::ResumeAgent
            | AgentCapability::SendMessage
            | AgentCapability::InterruptAgent
            | AgentCapability::CloseSubagent
            | AgentCapability::OpenSubagent
            | AgentCapability::PromoteSubagent
    )
}

fn allowed(capability: AgentCapability) -> CapabilityDecision {
    CapabilityDecision {
        capability,
        allowed: true,
        denial: None,
    }
}

fn denied(capability: AgentCapability, denial: CapabilityDenial) -> CapabilityDecision {
    CapabilityDecision {
        capability,
        allowed: false,
        denial: Some(denial),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subagent_creation_is_denied_for_both_agent_kinds() {
        let caller = CallerFacts {
            role: AgentRole::Subagent,
            status: AgentPresentationStatus::Available,
        };
        for kind in [AgentCreationKind::Ordinary, AgentCreationKind::Subagent] {
            let decision = create_agent_decision(caller, "workspace-a", kind, "workspace-a");
            assert_eq!(
                decision.denial,
                Some(CapabilityDenial::SubagentCannotCreateAgent)
            );
        }
    }

    #[test]
    fn ordinary_subagent_creation_is_same_workspace_only() {
        let caller = CallerFacts {
            role: AgentRole::Ordinary,
            status: AgentPresentationStatus::Available,
        };
        assert!(
            create_agent_decision(
                caller,
                "workspace-a",
                AgentCreationKind::Ordinary,
                "workspace-b"
            )
            .allowed
        );
        assert_eq!(
            create_agent_decision(
                caller,
                "workspace-a",
                AgentCreationKind::Subagent,
                "workspace-b"
            )
            .denial,
            Some(CapabilityDenial::SubagentSameWorkspaceRequired)
        );
    }

    #[test]
    fn target_matrix_is_parent_only_for_subagents_and_runtime_wide_for_ordinary_agents() {
        for caller_role in [AgentRole::Ordinary, AgentRole::Subagent] {
            let caller = CallerFacts {
                role: caller_role,
                status: AgentPresentationStatus::Available,
            };
            assert!(
                target_capability(
                    caller,
                    TargetFacts {
                        role: AgentRole::Ordinary,
                        status: AgentPresentationStatus::Available,
                        owned_by_caller: false,
                    },
                    AgentCapability::SendMessage
                )
                .allowed
            );
            assert_eq!(
                target_capability(
                    caller,
                    TargetFacts {
                        role: AgentRole::Subagent,
                        status: AgentPresentationStatus::Available,
                        owned_by_caller: false,
                    },
                    AgentCapability::GetAgent
                )
                .denial,
                Some(CapabilityDenial::ParentOnly)
            );
        }
    }

    #[test]
    fn owned_closed_subagent_is_readable_and_openable_but_not_mutable() {
        let caller = CallerFacts {
            role: AgentRole::Ordinary,
            status: AgentPresentationStatus::Available,
        };
        let target = TargetFacts {
            role: AgentRole::Subagent,
            status: AgentPresentationStatus::Closed,
            owned_by_caller: true,
        };
        for capability in [
            AgentCapability::GetAgent,
            AgentCapability::GetTaskOutput,
            AgentCapability::OpenSubagent,
        ] {
            assert!(target_capability(caller, target, capability).allowed);
        }
        for capability in [
            AgentCapability::SendMessage,
            AgentCapability::ConfigureAgent,
            AgentCapability::PromoteSubagent,
        ] {
            assert_eq!(
                target_capability(caller, target, capability).denial,
                Some(CapabilityDenial::SubagentOpenRequired)
            );
        }
    }
}
