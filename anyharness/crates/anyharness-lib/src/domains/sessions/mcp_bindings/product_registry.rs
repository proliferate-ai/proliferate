use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;

use crate::domains::workspaces::operation_gate::WorkspaceOperationKind;
use crate::integrations::mcp::product_server::{
    dispatch_product_mcp_request, ProductMcpAuthHeader, ProductMcpDefinition,
    ProductMcpDispatchError, ProductMcpEndpointOperation, ProductMcpRequestContext,
    ProductMcpServer, ProductMcpTokenValidation,
};

#[async_trait]
pub trait ProductMcpEndpointHandler: Send + Sync {
    fn definition(&self) -> &'static ProductMcpDefinition;

    fn endpoint_operation_kind(
        &self,
        operation: ProductMcpEndpointOperation,
    ) -> Option<WorkspaceOperationKind>;

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
}

impl ProductMcpEndpointRegistration {
    pub fn new(handler: Arc<dyn ProductMcpEndpointHandler>) -> Self {
        Self { handler }
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

    struct TestProductMcpServer;

    #[async_trait]
    impl ProductMcpServer for TestProductMcpServer {
        type Context = ();

        fn definition(&self) -> &'static ProductMcpDefinition {
            &TEST_DEFINITION_A
        }

        fn validate_capability_token(
            &self,
            _header: ProductMcpAuthHeader<'_>,
            _request: &ProductMcpRequestContext,
        ) -> anyhow::Result<ProductMcpTokenValidation> {
            Ok(ProductMcpTokenValidation::Valid)
        }

        fn resolve_context(
            &self,
            _request: &ProductMcpRequestContext,
        ) -> Result<Self::Context, crate::integrations::mcp::product_server::ProductMcpContextError>
        {
            Ok(())
        }

        fn tools(&self, _ctx: &Self::Context) -> Vec<Value> {
            Vec::new()
        }

        async fn call_tool(
            &self,
            _ctx: &Self::Context,
            _name: &str,
            _arguments: Option<Value>,
        ) -> anyhow::Result<Value> {
            Ok(json!({}))
        }
    }

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
    fn endpoint_handler_adapter_gates_only_mutating_tool_calls() {
        let adapter = ProductMcpEndpointHandlerAdapter::new(
            Arc::new(TestProductMcpServer),
            Some(WorkspaceOperationKind::ReviewWrite),
            &["mutating_tool"],
        );

        assert_eq!(
            adapter.endpoint_operation_kind(ProductMcpEndpointOperation::ToolsCall {
                tool_name: Some("mutating_tool".to_string())
            }),
            Some(WorkspaceOperationKind::ReviewWrite)
        );
        assert_eq!(
            adapter.endpoint_operation_kind(ProductMcpEndpointOperation::ToolsCall {
                tool_name: Some("read_only_tool".to_string())
            }),
            None
        );
        assert_eq!(
            adapter.endpoint_operation_kind(ProductMcpEndpointOperation::ToolsList),
            None
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
}
