use std::collections::HashSet;
use std::sync::Arc;

use serde_json::{json, Value};

use super::tools::{build_tool_list, MUTATING_TOOL_NAMES, READ_ONLY_TOOL_NAMES};
use crate::domains::sessions::mcp_bindings::product_registry::{
    ProductMcpEndpointHandler, ProductMcpEndpointHandlerAdapter,
};
use crate::domains::workspaces::operation_gate::WorkspaceOperationKind;
use crate::integrations::mcp::product_server::{
    ProductMcpAuthHeader, ProductMcpContextError, ProductMcpDefinition,
    ProductMcpEndpointOperation, ProductMcpRequestContext, ProductMcpServer,
    ProductMcpTokenValidation,
};

struct TestProductMcpServer;

#[async_trait::async_trait]
impl ProductMcpServer for TestProductMcpServer {
    type Context = ();

    fn definition(&self) -> &'static ProductMcpDefinition {
        &crate::domains::cowork::mcp::definition::DEFINITION
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

fn tool_names(tools: Vec<Value>) -> HashSet<String> {
    tools
        .into_iter()
        .filter_map(|tool| tool.get("name").and_then(Value::as_str).map(str::to_string))
        .collect()
}

fn assert_no_top_level_schema_combinators(tools: &[Value]) {
    for tool in tools {
        let name = tool
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("<unknown>");
        let schema = tool
            .get("inputSchema")
            .unwrap_or_else(|| panic!("tool {name} is missing inputSchema"));
        for keyword in ["oneOf", "anyOf", "allOf"] {
            assert!(
                schema.get(keyword).is_none(),
                "tool {name} inputSchema uses unsupported top-level {keyword}"
            );
        }
    }
}

#[test]
fn artifact_tools_are_always_available() {
    let names = tool_names(build_tool_list(false));

    assert!(names.contains("create_artifact"));
    assert!(names.contains("update_artifact"));
    assert!(names.contains("delete_artifact"));
    assert!(names.contains("list_artifacts"));
    assert!(names.contains("get_artifact"));
    assert!(!names.contains("create_coding_workspace"));
}

#[test]
fn delegation_tools_are_available_when_enabled() {
    let names = tool_names(build_tool_list(true));

    assert!(names.contains("create_coding_workspace"));
    assert!(names.contains("create_coding_session"));
    assert!(names.contains("send_coding_message"));
    assert!(names.contains("read_coding_events"));
}

#[test]
fn tool_input_schemas_do_not_use_top_level_combinators() {
    let tools = build_tool_list(true);

    assert_no_top_level_schema_combinators(&tools);
}

#[test]
fn mutating_tool_names_are_all_advertised_when_delegation_is_enabled() {
    let names = tool_names(build_tool_list(true));

    for tool_name in MUTATING_TOOL_NAMES {
        assert!(names.contains(*tool_name), "missing tool: {tool_name}");
    }
}

#[test]
fn read_only_tool_names_are_not_marked_mutating() {
    for tool_name in READ_ONLY_TOOL_NAMES {
        assert!(
            !MUTATING_TOOL_NAMES.contains(tool_name),
            "read-only tool should not request write gate: {tool_name}"
        );
    }
}

#[test]
fn read_only_tools_do_not_request_cowork_write_gate() {
    let adapter = ProductMcpEndpointHandlerAdapter::new(
        Arc::new(TestProductMcpServer),
        Some(WorkspaceOperationKind::CoworkWrite),
        MUTATING_TOOL_NAMES,
    );

    for tool_name in READ_ONLY_TOOL_NAMES {
        assert_eq!(
            adapter.endpoint_operation_kind(ProductMcpEndpointOperation::ToolsCall {
                tool_name: Some((*tool_name).to_string())
            }),
            None,
            "read-only tool should not acquire write gate: {tool_name}"
        );
    }

    for tool_name in MUTATING_TOOL_NAMES {
        assert_eq!(
            adapter.endpoint_operation_kind(ProductMcpEndpointOperation::ToolsCall {
                tool_name: Some((*tool_name).to_string())
            }),
            Some(WorkspaceOperationKind::CoworkWrite),
            "mutating tool should acquire write gate: {tool_name}"
        );
    }
}
