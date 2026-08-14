use super::{
    authorization_policy, status_from_record_only, AgentOperations, AgentOperationsError,
    CallerFacts, ResolvedAgent, TargetFacts,
};
use crate::domains::agent_operations::model::{
    AgentCapability, AgentIdentity, AgentRole, CapabilityDenial,
};

impl AgentOperations {
    /// Resolve caller and target from durable state and apply the one dynamic
    /// target-authorization policy used by every AgentOperations target use
    /// case. MCP parsing deliberately has no policy of its own.
    pub(super) fn authorize_target(
        &self,
        caller: &crate::domains::agent_operations::model::AuthenticatedAgentCaller,
        target: &AgentIdentity,
        capability: AgentCapability,
    ) -> Result<(ResolvedAgent, ResolvedAgent), AgentOperationsError> {
        self.assert_same_runtime(target)?;
        let caller = self.resolve_caller_agent(caller)?;
        let target = self.resolve_agent(target)?;
        let owned_by_caller = target.parent_session_id() == Some(caller.record.id.as_str());

        // Terminal session state is not the reversible relationship-Closed
        // state. It is hidden consistently, including wrong-parent probes.
        if target.is_terminal_session()
            || (target.role() == AgentRole::Subagent && !owned_by_caller)
        {
            return Err(AgentOperationsError::AgentNotFound);
        }

        let decision = authorization_policy::target_capability(
            CallerFacts {
                role: caller.role(),
                status: status_from_record_only(&caller).presentation,
            },
            TargetFacts {
                role: target.role(),
                status: status_from_record_only(&target).presentation,
                owned_by_caller,
            },
            capability,
        );
        match decision.denial {
            None => Ok((caller, target)),
            Some(CapabilityDenial::ParentOnly) => Err(AgentOperationsError::AgentNotFound),
            Some(CapabilityDenial::TargetMustBeSubagent) => {
                Err(AgentOperationsError::AgentNotFound)
            }
            Some(CapabilityDenial::SubagentOpenRequired) => {
                Err(AgentOperationsError::SubagentOpenRequired)
            }
            Some(CapabilityDenial::CallerClosed) => Err(AgentOperationsError::CallerClosed),
            Some(denial) => Err(AgentOperationsError::CapabilityDenied { capability, denial }),
        }
    }
}
