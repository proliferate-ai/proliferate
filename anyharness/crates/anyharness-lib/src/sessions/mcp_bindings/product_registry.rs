use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;

use crate::integrations::mcp::product_server::{
    dispatch_product_mcp_request, ProductMcpAuthHeader, ProductMcpDefinition,
    ProductMcpDispatchError, ProductMcpRequestContext, ProductMcpServer, ProductMcpTokenValidation,
};
use crate::workspaces::operation_gate::WorkspaceOperationKind;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProductMcpEndpointOperation {
    Initialize,
    InitializedNotification,
    ToolsList,
    ToolsCall { tool_name: Option<String> },
    Other,
}

impl ProductMcpEndpointOperation {
    pub fn from_request_body(body: &Value) -> Self {
        match body.get("method").and_then(Value::as_str) {
            Some("initialize") => Self::Initialize,
            Some("notifications/initialized") => Self::InitializedNotification,
            Some("tools/list") => Self::ToolsList,
            Some("tools/call") => Self::ToolsCall {
                tool_name: body
                    .get("params")
                    .and_then(|params| params.get("name"))
                    .and_then(Value::as_str)
                    .map(str::to_owned),
            },
            _ => Self::Other,
        }
    }
}

#[async_trait]
pub trait ProductMcpEndpointHandler: Send + Sync {
    fn definition(&self) -> &'static ProductMcpDefinition;

    fn endpoint_operation_kind(
        &self,
        operation: ProductMcpEndpointOperation,
    ) -> Option<WorkspaceOperationKind>;

    fn legacy_header_names(&self) -> &'static [&'static str];

    fn validate_capability_token(
        &self,
        header: ProductMcpAuthHeader<'_>,
        request: &ProductMcpRequestContext,
    ) -> anyhow::Result<ProductMcpTokenValidation>;

    async fn dispatch(
        &self,
        request: ProductMcpRequestContext,
        body: Value,
    ) -> Result<Option<Value>, ProductMcpDispatchError>;
}

pub struct ProductMcpEndpointHandlerAdapter<S> {
    server: Arc<S>,
    write_operation_kind: Option<WorkspaceOperationKind>,
    mutating_tools: &'static [&'static str],
}

impl<S> ProductMcpEndpointHandlerAdapter<S> {
    pub fn new(
        server: Arc<S>,
        write_operation_kind: Option<WorkspaceOperationKind>,
        mutating_tools: &'static [&'static str],
    ) -> Self {
        Self {
            server,
            write_operation_kind,
            mutating_tools,
        }
    }
}

#[async_trait]
impl<S> ProductMcpEndpointHandler for ProductMcpEndpointHandlerAdapter<S>
where
    S: ProductMcpServer + 'static,
{
    fn definition(&self) -> &'static ProductMcpDefinition {
        self.server.definition()
    }

    fn endpoint_operation_kind(
        &self,
        operation: ProductMcpEndpointOperation,
    ) -> Option<WorkspaceOperationKind> {
        let ProductMcpEndpointOperation::ToolsCall { tool_name } = operation else {
            return None;
        };
        let Some(tool_name) = tool_name.as_deref() else {
            return None;
        };
        if self.mutating_tools.contains(&tool_name) {
            self.write_operation_kind
        } else {
            None
        }
    }

    fn legacy_header_names(&self) -> &'static [&'static str] {
        self.server.legacy_header_names()
    }

    fn validate_capability_token(
        &self,
        header: ProductMcpAuthHeader<'_>,
        request: &ProductMcpRequestContext,
    ) -> anyhow::Result<ProductMcpTokenValidation> {
        self.server.validate_capability_token(header, request)
    }

    async fn dispatch(
        &self,
        request: ProductMcpRequestContext,
        body: Value,
    ) -> Result<Option<Value>, ProductMcpDispatchError> {
        dispatch_product_mcp_request(self.server.as_ref(), request, body).await
    }
}

#[derive(Clone, Default)]
pub struct ProductMcpEndpointRegistry {
    by_slug: HashMap<&'static str, Arc<dyn ProductMcpEndpointHandler>>,
}

impl ProductMcpEndpointRegistry {
    pub fn new(servers: Vec<Arc<dyn ProductMcpEndpointHandler>>) -> Self {
        let by_slug = servers
            .into_iter()
            .map(|server| (server.definition().route_slug, server))
            .collect();
        Self { by_slug }
    }

    pub fn get_by_route_slug(&self, slug: &str) -> Option<&dyn ProductMcpEndpointHandler> {
        self.by_slug.get(slug).map(Arc::as_ref)
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn endpoint_operation_parses_tools_call_name() {
        let operation = ProductMcpEndpointOperation::from_request_body(&json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": { "name": "create_subagent" }
        }));

        assert_eq!(
            operation,
            ProductMcpEndpointOperation::ToolsCall {
                tool_name: Some("create_subagent".to_string())
            }
        );
    }

    #[test]
    fn endpoint_operation_treats_protocol_methods_as_non_tool_operations() {
        assert_eq!(
            ProductMcpEndpointOperation::from_request_body(&json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize"
            })),
            ProductMcpEndpointOperation::Initialize
        );
        assert_eq!(
            ProductMcpEndpointOperation::from_request_body(&json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/list"
            })),
            ProductMcpEndpointOperation::ToolsList
        );
    }
}
