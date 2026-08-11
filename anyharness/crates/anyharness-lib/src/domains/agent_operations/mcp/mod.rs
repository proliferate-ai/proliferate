pub mod auth;
mod calls;
pub mod context;
pub mod definition;
pub mod tools;

#[cfg(test)]
mod tests;

use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;

use self::auth::WorkspaceMcpAuth;
use self::context::WorkspaceMcpContext;
use crate::domains::agent_operations::runtime::AgentOperations;
use crate::integrations::mcp::product_server::{
    ProductMcpAuthHeader, ProductMcpContextError, ProductMcpDefinition, ProductMcpRequestContext,
    ProductMcpServer, ProductMcpTokenValidation,
};
use crate::integrations::mcp::tools::McpToolOutput;

pub struct WorkspaceProductMcpServer {
    operations: Arc<AgentOperations>,
    auth: Arc<WorkspaceMcpAuth>,
}

impl WorkspaceProductMcpServer {
    pub fn new(operations: Arc<AgentOperations>, auth: Arc<WorkspaceMcpAuth>) -> Self {
        Self { operations, auth }
    }
}

#[async_trait]
impl ProductMcpServer for WorkspaceProductMcpServer {
    type Context = WorkspaceMcpContext;

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
        context::resolve_context(&self.operations, request)
    }

    fn tools(&self, _ctx: &Self::Context) -> Vec<Value> {
        tools::build_tool_list()
    }

    async fn call_tool(
        &self,
        ctx: &Self::Context,
        name: &str,
        arguments: Option<Value>,
    ) -> anyhow::Result<Value> {
        calls::call_tool(&self.operations, ctx, name, arguments).await
    }

    async fn call_tool_output(
        &self,
        ctx: &Self::Context,
        name: &str,
        arguments: Option<Value>,
    ) -> anyhow::Result<McpToolOutput> {
        calls::call_tool_output(&self.operations, ctx, name, arguments).await
    }
}
