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

#[derive(Clone)]
pub struct ProductMcpEndpointRegistration {
    handler: Arc<dyn ProductMcpEndpointHandler>,
    route_aliases: &'static [&'static str],
}

impl ProductMcpEndpointRegistration {
    pub fn new(handler: Arc<dyn ProductMcpEndpointHandler>) -> Self {
        Self {
            handler,
            route_aliases: &[],
        }
    }

    pub fn with_route_aliases(
        handler: Arc<dyn ProductMcpEndpointHandler>,
        route_aliases: &'static [&'static str],
    ) -> Self {
        Self {
            handler,
            route_aliases,
        }
    }
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
    by_product_id: HashMap<&'static str, Arc<dyn ProductMcpEndpointHandler>>,
    by_slug: HashMap<&'static str, Arc<dyn ProductMcpEndpointHandler>>,
}

impl ProductMcpEndpointRegistry {
    pub fn new(registrations: Vec<ProductMcpEndpointRegistration>) -> anyhow::Result<Self> {
        let mut by_product_id = HashMap::new();
        let mut by_slug = HashMap::new();

        for registration in registrations {
            let definition = registration.handler.definition();
            insert_unique(
                &mut by_product_id,
                definition.id,
                registration.handler.clone(),
                "product MCP id",
            )?;
            insert_unique(
                &mut by_slug,
                definition.route_slug,
                registration.handler.clone(),
                "product MCP route slug",
            )?;
            for alias in registration.route_aliases {
                insert_unique(
                    &mut by_slug,
                    alias,
                    registration.handler.clone(),
                    "product MCP route alias",
                )?;
            }
        }

        Ok(Self {
            by_product_id,
            by_slug,
        })
    }

    pub fn get_by_route_slug(&self, slug: &str) -> Option<&dyn ProductMcpEndpointHandler> {
        self.by_slug.get(slug).map(Arc::as_ref)
    }

    pub fn get_by_product_id(&self, product_id: &str) -> Option<&dyn ProductMcpEndpointHandler> {
        self.by_product_id.get(product_id).map(Arc::as_ref)
    }

    pub fn definitions(&self) -> Vec<&'static ProductMcpDefinition> {
        let mut definitions = self
            .by_product_id
            .values()
            .map(|handler| handler.definition())
            .collect::<Vec<_>>();
        definitions.sort_by_key(|definition| definition.id);
        definitions
    }
}

fn insert_unique(
    map: &mut HashMap<&'static str, Arc<dyn ProductMcpEndpointHandler>>,
    key: &'static str,
    handler: Arc<dyn ProductMcpEndpointHandler>,
    label: &str,
) -> anyhow::Result<()> {
    if map.contains_key(key) {
        anyhow::bail!("duplicate {label}: {key}");
    }
    map.insert(key, handler);
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::integrations::mcp::product_server::{ProductMcpPromptPolicy, ProductMcpVisibility};

    use super::*;

    static TEST_DEFINITION_A: ProductMcpDefinition = ProductMcpDefinition {
        id: "test_a",
        route_slug: "test-a",
        acp_server_name: "test_a",
        server_info_name: "proliferate-test-a",
        display_name: "Test A",
        description: "Test A",
        visibility: ProductMcpVisibility::Internal,
        instructions: "Test A",
        unauthorized_code: "TEST_A_UNAUTHORIZED",
        request_invalid_code: "TEST_A_INVALID",
        prompt_policy: ProductMcpPromptPolicy::System,
    };

    static TEST_DEFINITION_DUPLICATE_ID: ProductMcpDefinition = ProductMcpDefinition {
        id: "test_a",
        route_slug: "test-b",
        acp_server_name: "test_b",
        server_info_name: "proliferate-test-b",
        display_name: "Test B",
        description: "Test B",
        visibility: ProductMcpVisibility::Internal,
        instructions: "Test B",
        unauthorized_code: "TEST_B_UNAUTHORIZED",
        request_invalid_code: "TEST_B_INVALID",
        prompt_policy: ProductMcpPromptPolicy::System,
    };

    static TEST_DEFINITION_B: ProductMcpDefinition = ProductMcpDefinition {
        id: "test_b",
        route_slug: "test-b",
        acp_server_name: "test_b",
        server_info_name: "proliferate-test-b",
        display_name: "Test B",
        description: "Test B",
        visibility: ProductMcpVisibility::Internal,
        instructions: "Test B",
        unauthorized_code: "TEST_B_UNAUTHORIZED",
        request_invalid_code: "TEST_B_INVALID",
        prompt_policy: ProductMcpPromptPolicy::System,
    };

    static TEST_DEFINITION_DUPLICATE_SLUG: ProductMcpDefinition = ProductMcpDefinition {
        id: "test_c",
        route_slug: "test-a",
        acp_server_name: "test_c",
        server_info_name: "proliferate-test-c",
        display_name: "Test C",
        description: "Test C",
        visibility: ProductMcpVisibility::Internal,
        instructions: "Test C",
        unauthorized_code: "TEST_C_UNAUTHORIZED",
        request_invalid_code: "TEST_C_INVALID",
        prompt_policy: ProductMcpPromptPolicy::System,
    };

    struct TestEndpointHandler(&'static ProductMcpDefinition);

    #[async_trait]
    impl ProductMcpEndpointHandler for TestEndpointHandler {
        fn definition(&self) -> &'static ProductMcpDefinition {
            self.0
        }

        fn endpoint_operation_kind(
            &self,
            _operation: ProductMcpEndpointOperation,
        ) -> Option<WorkspaceOperationKind> {
            None
        }

        fn legacy_header_names(&self) -> &'static [&'static str] {
            &[]
        }

        fn validate_capability_token(
            &self,
            _header: ProductMcpAuthHeader<'_>,
            _request: &ProductMcpRequestContext,
        ) -> anyhow::Result<ProductMcpTokenValidation> {
            Ok(ProductMcpTokenValidation::Valid)
        }

        async fn dispatch(
            &self,
            _request: ProductMcpRequestContext,
            _body: Value,
        ) -> Result<Option<Value>, ProductMcpDispatchError> {
            Ok(None)
        }
    }

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

    #[test]
    fn registry_indexes_by_product_id_and_route_slug() {
        let handler = Arc::new(TestEndpointHandler(&TEST_DEFINITION_A));
        let registry =
            ProductMcpEndpointRegistry::new(vec![ProductMcpEndpointRegistration::new(handler)])
                .expect("registry");

        assert!(registry.get_by_product_id("test_a").is_some());
        assert!(registry.get_by_route_slug("test-a").is_some());
        assert_eq!(registry.definitions()[0].id, "test_a");
    }

    #[test]
    fn registry_rejects_duplicate_product_ids() {
        let error = ProductMcpEndpointRegistry::new(vec![
            ProductMcpEndpointRegistration::new(Arc::new(TestEndpointHandler(&TEST_DEFINITION_A))),
            ProductMcpEndpointRegistration::new(Arc::new(TestEndpointHandler(
                &TEST_DEFINITION_DUPLICATE_ID,
            ))),
        ])
        .err()
        .expect("duplicate product id should fail");

        assert!(error.to_string().contains("duplicate product MCP id"));
    }

    #[test]
    fn registry_rejects_duplicate_route_slugs() {
        let error = ProductMcpEndpointRegistry::new(vec![
            ProductMcpEndpointRegistration::new(Arc::new(TestEndpointHandler(&TEST_DEFINITION_A))),
            ProductMcpEndpointRegistration::new(Arc::new(TestEndpointHandler(
                &TEST_DEFINITION_DUPLICATE_SLUG,
            ))),
        ])
        .err()
        .expect("duplicate route slug should fail");

        assert!(error
            .to_string()
            .contains("duplicate product MCP route slug"));
    }

    #[test]
    fn registry_rejects_route_alias_collisions() {
        let error = ProductMcpEndpointRegistry::new(vec![
            ProductMcpEndpointRegistration::with_route_aliases(
                Arc::new(TestEndpointHandler(&TEST_DEFINITION_A)),
                &["alias"],
            ),
            ProductMcpEndpointRegistration::with_route_aliases(
                Arc::new(TestEndpointHandler(&TEST_DEFINITION_B)),
                &["alias"],
            ),
        ])
        .err()
        .expect("duplicate route alias should fail");

        assert!(error
            .to_string()
            .contains("duplicate product MCP route alias"));
    }
}
