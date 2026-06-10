pub mod auth;
pub mod calls;
mod calls_helpers;
pub mod context;
pub mod definition;
pub mod tools;

use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;

use self::auth::SubagentMcpAuth;
use self::context::SubagentMcpContext;
use crate::domains::sessions::runtime::SessionRuntime;
use crate::domains::sessions::subagents::service::SubagentService;
use crate::domains::workspaces::runtime::WorkspaceRuntime;
use crate::integrations::mcp::product_server::{
    ProductMcpAuthHeader, ProductMcpContextError, ProductMcpDefinition, ProductMcpRequestContext,
    ProductMcpServer, ProductMcpTokenValidation,
};

#[derive(Clone)]
pub struct SubagentProductMcpServer {
    service: Arc<SubagentService>,
    session_runtime: Arc<SessionRuntime>,
    workspace_runtime: Arc<WorkspaceRuntime>,
    auth: Arc<SubagentMcpAuth>,
}

impl SubagentProductMcpServer {
    pub fn new(
        service: Arc<SubagentService>,
        session_runtime: Arc<SessionRuntime>,
        workspace_runtime: Arc<WorkspaceRuntime>,
        auth: Arc<SubagentMcpAuth>,
    ) -> Self {
        Self {
            service,
            session_runtime,
            workspace_runtime,
            auth,
        }
    }
}

#[async_trait]
impl ProductMcpServer for SubagentProductMcpServer {
    type Context = SubagentMcpContext;

    fn definition(&self) -> &'static ProductMcpDefinition {
        &definition::DEFINITION
    }

    fn validate_capability_token(
        &self,
        header: ProductMcpAuthHeader<'_>,
        request: &ProductMcpRequestContext,
    ) -> anyhow::Result<ProductMcpTokenValidation> {
        self.auth.validate_capability_header(header, request)
    }

    fn resolve_context(
        &self,
        request: &ProductMcpRequestContext,
    ) -> Result<Self::Context, ProductMcpContextError> {
        context::resolve_context(&self.service, &self.workspace_runtime, request)
    }

    fn tools(&self, ctx: &Self::Context) -> Vec<Value> {
        tools::build_tool_list(ctx)
    }

    async fn call_tool(
        &self,
        ctx: &Self::Context,
        name: &str,
        arguments: Option<Value>,
    ) -> anyhow::Result<Value> {
        calls::call_tool(&self.service, &self.session_runtime, ctx, name, arguments).await
    }
}
