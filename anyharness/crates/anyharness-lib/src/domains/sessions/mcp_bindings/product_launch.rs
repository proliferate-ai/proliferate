use std::sync::Arc;

use anyharness_contract::v1::SessionMcpBindingSummary;

use crate::domains::sessions::extensions::SessionLaunchExtras;
use crate::domains::sessions::model::SessionRecord;
use crate::domains::workspaces::model::WorkspaceRecord;
use crate::integrations::mcp::product_server::ProductMcpDefinition;

pub struct ProductMcpSelectionContext<'a> {
    pub workspace: &'a WorkspaceRecord,
    pub session: &'a SessionRecord,
}

pub trait ProductMcpLaunchSelector: Send + Sync {
    fn should_attach(&self, ctx: ProductMcpSelectionContext<'_>) -> anyhow::Result<bool>;
}

impl<F> ProductMcpLaunchSelector for F
where
    F: for<'a> Fn(ProductMcpSelectionContext<'a>) -> anyhow::Result<bool> + Send + Sync,
{
    fn should_attach(&self, ctx: ProductMcpSelectionContext<'_>) -> anyhow::Result<bool> {
        self(ctx)
    }
}

pub trait ProductMcpCapabilityTokenMinter: Send + Sync {
    fn mint_capability_token(&self, workspace_id: &str, session_id: &str)
        -> anyhow::Result<String>;
}

impl<F> ProductMcpCapabilityTokenMinter for F
where
    F: Fn(&str, &str) -> anyhow::Result<String> + Send + Sync,
{
    fn mint_capability_token(
        &self,
        workspace_id: &str,
        session_id: &str,
    ) -> anyhow::Result<String> {
        self(workspace_id, session_id)
    }
}

#[derive(Clone)]
pub struct ProductMcpLaunchRegistration {
    definition: &'static ProductMcpDefinition,
    selector: Arc<dyn ProductMcpLaunchSelector>,
    token_minter: Arc<dyn ProductMcpCapabilityTokenMinter>,
    launch_extras: SessionLaunchExtras,
}

impl ProductMcpLaunchRegistration {
    pub fn new(
        definition: &'static ProductMcpDefinition,
        selector: Arc<dyn ProductMcpLaunchSelector>,
        token_minter: Arc<dyn ProductMcpCapabilityTokenMinter>,
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

    pub fn should_attach(&self, ctx: ProductMcpSelectionContext<'_>) -> anyhow::Result<bool> {
        self.selector.should_attach(ctx)
    }

    pub fn mint_capability_token(
        &self,
        workspace_id: &str,
        session_id: &str,
    ) -> anyhow::Result<String> {
        self.token_minter
            .mint_capability_token(workspace_id, session_id)
    }
}
