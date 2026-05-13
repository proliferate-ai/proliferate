pub mod auth;
pub mod calls;
pub mod context;
pub mod definition;
pub mod tools;

use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;

use self::auth::{ReviewMcpAuth, LEGACY_CAPABILITY_HEADER_NAME};
use self::context::ReviewMcpContext;
use crate::domains::reviews::runtime::ReviewRuntime;
use crate::integrations::mcp::product_server::{
    ProductMcpAuthHeader, ProductMcpContextError, ProductMcpDefinition, ProductMcpRequestContext,
    ProductMcpServer, ProductMcpTokenValidation,
};

#[derive(Clone)]
pub struct ReviewProductMcpServer {
    runtime: Arc<ReviewRuntime>,
    auth: Arc<ReviewMcpAuth>,
}

impl ReviewProductMcpServer {
    pub fn new(runtime: Arc<ReviewRuntime>, auth: Arc<ReviewMcpAuth>) -> Self {
        Self { runtime, auth }
    }
}

#[async_trait]
impl ProductMcpServer for ReviewProductMcpServer {
    type Context = ReviewMcpContext;

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
        context::resolve_context(&self.runtime, request)
    }

    fn tools(&self, ctx: &Self::Context) -> Vec<Value> {
        match ctx.role {
            context::ReviewMcpRole::Parent {
                can_signal_revision,
            } => tools::parent_tool_list(can_signal_revision),
            context::ReviewMcpRole::Reviewer => tools::reviewer_tool_list(),
            context::ReviewMcpRole::None => Vec::new(),
        }
    }

    async fn call_tool(
        &self,
        ctx: &Self::Context,
        name: &str,
        arguments: Option<Value>,
    ) -> anyhow::Result<Value> {
        calls::call_tool(&self.runtime, ctx, name, arguments).await
    }
}
