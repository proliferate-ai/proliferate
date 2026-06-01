pub mod auth;
pub mod calls;
pub mod context;
pub mod definition;
pub mod tools;

use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;

use self::auth::{WorkspaceNamingMcpAuth, LEGACY_CAPABILITY_HEADER_NAME};
use self::context::WorkspaceNamingMcpContext;
use crate::domains::sessions::store::SessionStore;
use crate::domains::workspaces::access_gate::WorkspaceAccessGate;
use crate::domains::workspaces::runtime::WorkspaceRuntime;
use crate::integrations::mcp::product_server::{
    ProductMcpAuthHeader, ProductMcpContextError, ProductMcpDefinition, ProductMcpRequestContext,
    ProductMcpServer, ProductMcpTokenValidation,
};

#[derive(Clone)]
pub struct WorkspaceNamingProductMcpServer {
    workspace_runtime: Arc<WorkspaceRuntime>,
    workspace_access_gate: Arc<WorkspaceAccessGate>,
    session_store: SessionStore,
    auth: Arc<WorkspaceNamingMcpAuth>,
}

impl WorkspaceNamingProductMcpServer {
    pub fn new(
        workspace_runtime: Arc<WorkspaceRuntime>,
        workspace_access_gate: Arc<WorkspaceAccessGate>,
        session_store: SessionStore,
        auth: Arc<WorkspaceNamingMcpAuth>,
    ) -> Self {
        Self {
            workspace_runtime,
            workspace_access_gate,
            session_store,
            auth,
        }
    }
}

#[async_trait]
impl ProductMcpServer for WorkspaceNamingProductMcpServer {
    type Context = WorkspaceNamingMcpContext;

    fn definition(&self) -> &'static ProductMcpDefinition {
        &definition::DEFINITION
    }

    fn legacy_header_names(&self) -> &'static [&'static str] {
        &[LEGACY_CAPABILITY_HEADER_NAME]
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
        context::resolve_context(
            &self.workspace_runtime,
            &self.workspace_access_gate,
            &self.session_store,
            request,
        )
    }

    fn tools(&self, ctx: &Self::Context) -> Vec<Value> {
        if ctx.available {
            tools::build_tool_list()
        } else {
            Vec::new()
        }
    }

    async fn call_tool(
        &self,
        ctx: &Self::Context,
        name: &str,
        arguments: Option<Value>,
    ) -> anyhow::Result<Value> {
        calls::call_tool(
            &self.workspace_runtime,
            &self.workspace_access_gate,
            &self.session_store,
            ctx,
            name,
            arguments,
        )
        .await
    }
}
