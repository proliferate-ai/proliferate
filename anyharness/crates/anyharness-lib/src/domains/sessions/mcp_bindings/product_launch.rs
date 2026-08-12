use std::sync::Arc;

use anyharness_contract::v1::{
    SessionMcpBindingOutcome, SessionMcpBindingSummary, SessionMcpTransport,
};

use crate::domains::sessions::extensions::SessionLaunchExtras;
use crate::domains::sessions::model::SessionRecord;
use crate::domains::workspaces::model::WorkspaceRecord;
use crate::integrations::mcp::product_server::ProductMcpDefinition;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProductMcpLaunchPhase {
    Selection,
    TokenMint,
}

impl std::fmt::Display for ProductMcpLaunchPhase {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Selection => f.write_str("selection"),
            Self::TokenMint => f.write_str("token mint"),
        }
    }
}

#[derive(Debug, thiserror::Error)]
#[error("product MCP {phase} failed for '{product_mcp_id}'")]
pub struct ProductMcpLaunchError {
    product_mcp_id: &'static str,
    phase: ProductMcpLaunchPhase,
    #[source]
    source: anyhow::Error,
}

impl ProductMcpLaunchError {
    pub fn selection(product_mcp_id: &'static str, source: anyhow::Error) -> Self {
        Self {
            product_mcp_id,
            phase: ProductMcpLaunchPhase::Selection,
            source,
        }
    }

    pub fn token_mint(product_mcp_id: &'static str, source: anyhow::Error) -> Self {
        Self {
            product_mcp_id,
            phase: ProductMcpLaunchPhase::TokenMint,
            source,
        }
    }

    pub fn product_mcp_id(&self) -> &'static str {
        self.product_mcp_id
    }

    pub fn phase(&self) -> ProductMcpLaunchPhase {
        self.phase
    }
}

pub struct ProductMcpSelectionContext<'a> {
    pub workspace: &'a WorkspaceRecord,
    pub session: &'a SessionRecord,
}

#[derive(Clone)]
pub struct ProductMcpLaunchRegistration {
    definition: &'static ProductMcpDefinition,
    selector:
        Arc<dyn for<'a> Fn(ProductMcpSelectionContext<'a>) -> anyhow::Result<bool> + Send + Sync>,
    token_minter: Arc<dyn Fn(&str, &str) -> anyhow::Result<String> + Send + Sync>,
    launch_extras: SessionLaunchExtras,
}

impl ProductMcpLaunchRegistration {
    pub fn new(
        definition: &'static ProductMcpDefinition,
        selector: Arc<
            dyn for<'a> Fn(ProductMcpSelectionContext<'a>) -> anyhow::Result<bool> + Send + Sync,
        >,
        token_minter: Arc<dyn Fn(&str, &str) -> anyhow::Result<String> + Send + Sync>,
    ) -> Self {
        Self {
            definition,
            selector,
            token_minter,
            launch_extras: SessionLaunchExtras::default(),
        }
    }

    pub fn with_binding_summary(mut self, summary: SessionMcpBindingSummary) -> Self {
        self.launch_extras.mcp_binding_summaries.push(summary);
        self
    }

    pub fn with_applied_http_binding_summary(mut self) -> Self {
        self.launch_extras
            .mcp_binding_summaries
            .push(SessionMcpBindingSummary {
                id: format!("internal:{}", self.definition.id),
                server_name: self.definition.acp_server_name.to_string(),
                display_name: Some(self.definition.display_name.to_string()),
                transport: SessionMcpTransport::Http,
                outcome: SessionMcpBindingOutcome::Applied,
                reason: None,
            });
        self
    }

    pub fn with_system_prompt_append(mut self, prompt: Vec<String>) -> Self {
        self.launch_extras.system_prompt_append.extend(prompt);
        self
    }

    pub fn with_first_prompt_system_prompt_append(mut self, prompt: Vec<String>) -> Self {
        self.launch_extras
            .first_prompt_system_prompt_append
            .extend(prompt);
        self
    }

    pub fn definition(&self) -> &'static ProductMcpDefinition {
        self.definition
    }

    pub fn launch_extras(&self) -> &SessionLaunchExtras {
        &self.launch_extras
    }

    pub fn should_attach(
        &self,
        ctx: ProductMcpSelectionContext<'_>,
    ) -> Result<bool, ProductMcpLaunchError> {
        (self.selector)(ctx)
            .map_err(|error| ProductMcpLaunchError::selection(self.definition.id, error))
    }

    pub fn mint_capability_token(
        &self,
        workspace_id: &str,
        session_id: &str,
    ) -> Result<String, ProductMcpLaunchError> {
        (self.token_minter)(workspace_id, session_id)
            .map_err(|error| ProductMcpLaunchError::token_mint(self.definition.id, error))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::integrations::mcp::product_server::{ProductMcpPromptPolicy, ProductMcpVisibility};

    static DEFINITION: ProductMcpDefinition = ProductMcpDefinition {
        id: "workspace",
        route_slug: "workspace",
        acp_server_name: "workspace",
        server_info_name: "proliferate-workspace",
        display_name: "Workspace",
        description: "Workspace",
        visibility: ProductMcpVisibility::Internal,
        instructions: "Workspace",
        unauthorized_code: "WORKSPACE_MCP_UNAUTHORIZED",
        request_invalid_code: "WORKSPACE_MCP_REQUEST_INVALID",
        prompt_policy: ProductMcpPromptPolicy::System,
    };

    #[test]
    fn applied_http_summary_is_derived_from_the_registered_definition() {
        let registration = ProductMcpLaunchRegistration::new(
            &DEFINITION,
            Arc::new(|_| Ok(true)),
            Arc::new(|_, _| Ok("token".to_string())),
        )
        .with_applied_http_binding_summary();
        let [summary] = registration
            .launch_extras()
            .mcp_binding_summaries
            .as_slice()
        else {
            panic!("one applied binding summary");
        };

        assert_eq!(summary.id, "internal:workspace");
        assert_eq!(summary.server_name, DEFINITION.acp_server_name);
        assert_eq!(
            summary.display_name.as_deref(),
            Some(DEFINITION.display_name)
        );
        assert_eq!(summary.transport, SessionMcpTransport::Http);
        assert_eq!(summary.outcome, SessionMcpBindingOutcome::Applied);
        assert!(summary.reason.is_none());
    }
}
