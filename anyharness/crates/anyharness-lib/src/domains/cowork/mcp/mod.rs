pub mod auth;
pub mod calls;
pub mod context;
pub mod definition;
pub mod tools;

use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;

use self::auth::{CoworkMcpAuth, LEGACY_CAPABILITY_HEADER_NAME};
use self::context::CoworkMcpContext;
use crate::domains::cowork::artifacts::CoworkArtifactRuntime;
use crate::domains::cowork::runtime::CoworkRuntime;
use crate::integrations::mcp::product_server::{
    ProductMcpAuthHeader, ProductMcpContextError, ProductMcpDefinition, ProductMcpRequestContext,
    ProductMcpServer, ProductMcpTokenValidation,
};

#[derive(Clone)]
pub struct CoworkProductMcpServer {
    artifact_runtime: Arc<CoworkArtifactRuntime>,
    cowork_runtime: Arc<CoworkRuntime>,
    auth: Arc<CoworkMcpAuth>,
}

impl CoworkProductMcpServer {
    pub fn new(
        artifact_runtime: Arc<CoworkArtifactRuntime>,
        cowork_runtime: Arc<CoworkRuntime>,
        auth: Arc<CoworkMcpAuth>,
    ) -> Self {
        Self {
            artifact_runtime,
            cowork_runtime,
            auth,
        }
    }
}

#[async_trait]
impl ProductMcpServer for CoworkProductMcpServer {
    type Context = CoworkMcpContext;

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
        context::resolve_context(&self.cowork_runtime, request)
    }

    fn tools(&self, ctx: &Self::Context) -> Vec<Value> {
        tools::build_tool_list(ctx.workspace_delegation_enabled)
    }

    async fn call_tool(
        &self,
        ctx: &Self::Context,
        name: &str,
        arguments: Option<Value>,
    ) -> anyhow::Result<Value> {
        calls::call_tool(
            &self.artifact_runtime,
            &self.cowork_runtime,
            ctx,
            name,
            arguments,
        )
        .await
    }
}
