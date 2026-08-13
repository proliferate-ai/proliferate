use crate::domains::agent_operations::product_context::DurableAgentProductContextResolver;
use crate::live::sessions::product_context::{
    AgentProductContext, AgentProductContextResolutionError, AgentProductContextResolver,
};

impl AgentProductContextResolver for DurableAgentProductContextResolver {
    fn resolve(
        &self,
        session_id: &str,
    ) -> Result<AgentProductContext, AgentProductContextResolutionError> {
        self.resolve_current_instruction(session_id)
            .map(AgentProductContext::new)
            .map_err(|error| {
                let class = error.class().as_str();
                AgentProductContextResolutionError::classified(class, error)
            })
    }
}
