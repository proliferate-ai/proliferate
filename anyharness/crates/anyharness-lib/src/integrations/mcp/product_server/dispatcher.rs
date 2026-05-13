use async_trait::async_trait;
use serde_json::{json, Value};

use super::definition::ProductMcpDefinition;
use super::errors::{
    ProductMcpContextError, ProductMcpDispatchError, JSON_RPC_INVALID_PARAMS,
    JSON_RPC_INVALID_REQUEST, JSON_RPC_METHOD_NOT_FOUND, JSON_RPC_PARSE_ERROR,
};
use super::request::{ProductMcpAuthHeader, ProductMcpRequestContext, ProductMcpTokenValidation};
use super::response::initialize_response;
use crate::integrations::mcp::json_rpc::{
    jsonrpc_error, jsonrpc_result, CallToolParams, InitializeParams, JsonRpcRequest,
};
use crate::integrations::mcp::tools::jsonrpc_tool_result;

#[async_trait]
pub trait ProductMcpServer: Send + Sync {
    type Context: Send + Sync;

    fn definition(&self) -> &'static ProductMcpDefinition;

    fn legacy_header_names(&self) -> &'static [&'static str] {
        &[]
    }

    fn validate_capability_token(
        &self,
        header: ProductMcpAuthHeader<'_>,
        request: &ProductMcpRequestContext,
    ) -> anyhow::Result<ProductMcpTokenValidation>;

    fn resolve_context(
        &self,
        request: &ProductMcpRequestContext,
    ) -> Result<Self::Context, ProductMcpContextError>;

    fn tools(&self, ctx: &Self::Context) -> Vec<Value>;

    async fn call_tool(
        &self,
        ctx: &Self::Context,
        name: &str,
        arguments: Option<Value>,
    ) -> anyhow::Result<Value>;
}

pub async fn dispatch_product_mcp_request<S>(
    server: &S,
    request_context: ProductMcpRequestContext,
    request_body: Value,
) -> Result<Option<Value>, ProductMcpDispatchError>
where
    S: ProductMcpServer,
{
    let request = match serde_json::from_value::<JsonRpcRequest>(request_body) {
        Ok(request) => request,
        Err(error) => {
            return Ok(Some(jsonrpc_error(
                None,
                JSON_RPC_PARSE_ERROR,
                format!("parse JSON-RPC request: {error}"),
            )));
        }
    };

    if request.jsonrpc != "2.0" {
        return Ok(Some(jsonrpc_error(
            request.id,
            JSON_RPC_INVALID_REQUEST,
            "invalid jsonrpc version",
        )));
    }

    match request.method.as_str() {
        "initialize" => {
            let params = match request
                .params
                .map(serde_json::from_value::<InitializeParams>)
                .transpose()
            {
                Ok(params) => params,
                Err(error) => {
                    return Ok(Some(jsonrpc_error(
                        request.id,
                        JSON_RPC_INVALID_PARAMS,
                        format!("invalid initialize params: {error}"),
                    )));
                }
            };
            Ok(Some(initialize_response(
                request.id,
                params.and_then(|value| value.protocol_version),
                server.definition(),
            )))
        }
        "notifications/initialized" => Ok(None),
        "tools/list" => Ok(Some(jsonrpc_result(
            request.id,
            json!({ "tools": server.tools(&server.resolve_context(&request_context)?) }),
        ))),
        "tools/call" => {
            let ctx = server.resolve_context(&request_context)?;
            let params = match serde_json::from_value::<CallToolParams>(
                request.params.unwrap_or_else(|| json!({})),
            ) {
                Ok(params) => params,
                Err(error) => {
                    return Ok(Some(jsonrpc_error(
                        request.id,
                        JSON_RPC_INVALID_PARAMS,
                        format!("invalid tools/call params: {error}"),
                    )));
                }
            };
            let result = server
                .call_tool(&ctx, &params.name, params.arguments)
                .await
                .map_err(|error| error.to_string());
            Ok(Some(jsonrpc_tool_result(request.id, result)))
        }
        _ => Ok(Some(jsonrpc_error(
            request.id,
            JSON_RPC_METHOD_NOT_FOUND,
            format!("unsupported method: {}", request.method),
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::integrations::mcp::product_server::definition::{
        ProductMcpPromptPolicy, ProductMcpVisibility,
    };

    static TEST_DEFINITION: ProductMcpDefinition = ProductMcpDefinition {
        id: "test_product",
        route_slug: "test-product",
        acp_server_name: "test_product",
        server_info_name: "proliferate-test-product",
        display_name: "Test Product",
        description: "Test product MCP",
        visibility: ProductMcpVisibility::Internal,
        instructions: "Use test tools.",
        unauthorized_code: "test_unauthorized",
        request_invalid_code: "test_request_invalid",
        prompt_policy: ProductMcpPromptPolicy::System,
    };

    struct TestProductMcpServer;

    #[async_trait]
    impl ProductMcpServer for TestProductMcpServer {
        type Context = ();

        fn definition(&self) -> &'static ProductMcpDefinition {
            &TEST_DEFINITION
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
        ) -> Result<Self::Context, ProductMcpContextError> {
            Ok(())
        }

        fn tools(&self, _ctx: &Self::Context) -> Vec<Value> {
            vec![json!({
                "name": "known_tool",
                "description": "Known test tool",
                "inputSchema": { "type": "object", "properties": {} },
            })]
        }

        async fn call_tool(
            &self,
            _ctx: &Self::Context,
            name: &str,
            _arguments: Option<Value>,
        ) -> anyhow::Result<Value> {
            match name {
                "known_tool" => Ok(json!({ "ok": true })),
                _ => Err(anyhow::anyhow!("unknown test tool: {name}")),
            }
        }
    }

    fn request_context() -> ProductMcpRequestContext {
        ProductMcpRequestContext::new("workspace-1", "session-1", "test_product")
    }

    #[tokio::test]
    async fn initialized_notification_returns_no_response() {
        let response = dispatch_product_mcp_request(
            &TestProductMcpServer,
            request_context(),
            json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }),
        )
        .await
        .unwrap();

        assert_eq!(response, None);
    }

    struct ContextRejectingProductMcpServer;

    #[async_trait]
    impl ProductMcpServer for ContextRejectingProductMcpServer {
        type Context = ();

        fn definition(&self) -> &'static ProductMcpDefinition {
            &TEST_DEFINITION
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
        ) -> Result<Self::Context, ProductMcpContextError> {
            Err(ProductMcpContextError::not_found("context unavailable"))
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

    #[tokio::test]
    async fn initialize_does_not_resolve_product_context() {
        let response = dispatch_product_mcp_request(
            &ContextRejectingProductMcpServer,
            request_context(),
            json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize" }),
        )
        .await
        .unwrap()
        .unwrap();

        assert_eq!(response["id"], json!(1));
        assert_eq!(
            response["result"]["serverInfo"]["name"],
            json!("proliferate-test-product")
        );
    }

    #[tokio::test]
    async fn tools_list_returns_context_error_separately() {
        let error = dispatch_product_mcp_request(
            &ContextRejectingProductMcpServer,
            request_context(),
            json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }),
        )
        .await
        .expect_err("context error should escape protocol response");

        assert!(matches!(
            error,
            ProductMcpDispatchError::Context(ProductMcpContextError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn unknown_tool_is_mcp_tool_error_result() {
        let response = dispatch_product_mcp_request(
            &TestProductMcpServer,
            request_context(),
            json!({
                "jsonrpc": "2.0",
                "id": 7,
                "method": "tools/call",
                "params": { "name": "missing_tool" },
            }),
        )
        .await
        .unwrap()
        .unwrap();

        assert_eq!(response["id"], json!(7));
        assert_eq!(response["result"]["isError"], json!(true));
        assert_eq!(
            response["result"]["content"][0]["text"],
            json!("unknown test tool: missing_tool")
        );
    }

    #[tokio::test]
    async fn malformed_request_returns_parse_error() {
        let response = dispatch_product_mcp_request(
            &TestProductMcpServer,
            request_context(),
            json!("not-an-object"),
        )
        .await
        .unwrap()
        .unwrap();

        assert_eq!(response["id"], Value::Null);
        assert_eq!(response["error"]["code"], json!(JSON_RPC_PARSE_ERROR));
    }
}
