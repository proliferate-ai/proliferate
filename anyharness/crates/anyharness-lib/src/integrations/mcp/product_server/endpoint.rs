use serde_json::Value;

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
