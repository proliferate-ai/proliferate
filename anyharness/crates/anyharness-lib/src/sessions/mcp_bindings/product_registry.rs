use std::collections::HashMap;
use std::sync::Arc;

use serde_json::Value;

use crate::domains::reviews::mcp::ReviewProductMcpServer;
use crate::integrations::mcp::product_server::{
    dispatch_product_mcp_request, ProductMcpAuthHeader, ProductMcpDefinition,
    ProductMcpDispatchError, ProductMcpRequestContext, ProductMcpServer, ProductMcpTokenValidation,
};
use crate::sessions::subagents::mcp::SubagentProductMcpServer;
use crate::sessions::workspace_naming::mcp::WorkspaceNamingProductMcpServer;
use crate::workspaces::operation_gate::WorkspaceOperationKind;

#[derive(Clone)]
pub enum ProductMcpEndpointServer {
    Reviews(Arc<ReviewProductMcpServer>),
    Subagents(Arc<SubagentProductMcpServer>),
    WorkspaceNaming(Arc<WorkspaceNamingProductMcpServer>),
}

impl ProductMcpEndpointServer {
    pub fn definition(&self) -> &'static ProductMcpDefinition {
        match self {
            Self::Reviews(server) => server.definition(),
            Self::Subagents(server) => server.definition(),
            Self::WorkspaceNaming(server) => server.definition(),
        }
    }

    pub fn endpoint_operation_kind(&self) -> Option<WorkspaceOperationKind> {
        match self {
            Self::Reviews(server) => Some(server.endpoint_operation_kind()),
            Self::Subagents(server) => Some(server.endpoint_operation_kind()),
            Self::WorkspaceNaming(_) => None,
        }
    }

    pub fn legacy_header_names(&self) -> &'static [&'static str] {
        match self {
            Self::Reviews(server) => server.legacy_header_names(),
            Self::Subagents(server) => server.legacy_header_names(),
            Self::WorkspaceNaming(server) => server.legacy_header_names(),
        }
    }

    pub fn validate_capability_token(
        &self,
        header: ProductMcpAuthHeader<'_>,
        request: &ProductMcpRequestContext,
    ) -> anyhow::Result<ProductMcpTokenValidation> {
        match self {
            Self::Reviews(server) => server.validate_capability_token(header, request),
            Self::Subagents(server) => server.validate_capability_token(header, request),
            Self::WorkspaceNaming(server) => server.validate_capability_token(header, request),
        }
    }

    pub async fn dispatch(
        &self,
        request: ProductMcpRequestContext,
        body: Value,
    ) -> Result<Option<Value>, ProductMcpDispatchError> {
        match self {
            Self::Reviews(server) => {
                dispatch_product_mcp_request(server.as_ref(), request, body).await
            }
            Self::Subagents(server) => {
                dispatch_product_mcp_request(server.as_ref(), request, body).await
            }
            Self::WorkspaceNaming(server) => {
                dispatch_product_mcp_request(server.as_ref(), request, body).await
            }
        }
    }
}

#[derive(Clone, Default)]
pub struct ProductMcpEndpointRegistry {
    by_slug: HashMap<&'static str, ProductMcpEndpointServer>,
}

impl ProductMcpEndpointRegistry {
    pub fn new(servers: Vec<ProductMcpEndpointServer>) -> Self {
        let by_slug = servers
            .into_iter()
            .map(|server| (server.definition().route_slug, server))
            .collect();
        Self { by_slug }
    }

    pub fn get_by_route_slug(&self, slug: &str) -> Option<&ProductMcpEndpointServer> {
        self.by_slug.get(slug)
    }
}
