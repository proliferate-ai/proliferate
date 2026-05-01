use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Debug, Deserialize)]
pub(super) struct JsonRpcRequest {
    pub jsonrpc: String,
    #[serde(default)]
    pub id: Option<Value>,
    pub method: String,
    #[serde(default)]
    pub params: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct InitializeParams {
    #[serde(default)]
    pub protocol_version: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct CallToolParams {
    pub name: String,
    #[serde(default)]
    pub arguments: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SetWorkspaceDisplayNameArgs {
    pub display_name: String,
}

pub(super) fn deserialize_args<T: for<'de> Deserialize<'de>>(
    value: Option<Value>,
) -> anyhow::Result<T> {
    serde_json::from_value(value.unwrap_or_else(|| json!({}))).map_err(anyhow::Error::from)
}

pub(super) fn jsonrpc_result(id: Option<Value>, result: Value) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id.unwrap_or(Value::Null),
        "result": result,
    })
}

pub(super) fn jsonrpc_error(id: Option<Value>, code: i64, message: impl Into<String>) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id.unwrap_or(Value::Null),
        "error": {
            "code": code,
            "message": message.into(),
        }
    })
}

pub(super) fn jsonrpc_tool_result(id: Option<Value>, result: anyhow::Result<Value>) -> Value {
    match result {
        Ok(structured) => jsonrpc_result(
            id,
            json!({
                "content": [
                    {
                        "type": "text",
                        "text": serde_json::to_string_pretty(&structured).unwrap_or_else(|_| structured.to_string())
                    }
                ],
                "structuredContent": structured,
                "isError": false
            }),
        ),
        Err(error) => jsonrpc_result(
            id,
            json!({
                "content": [
                    {
                        "type": "text",
                        "text": error.to_string()
                    }
                ],
                "isError": true,
            }),
        ),
    }
}

pub(super) fn build_tool_list() -> Vec<Value> {
    vec![tool_definition(
        "set_workspace_display_name",
        "Set a concise human-readable display name for this workspace. During the first turn, call this before any user-visible response, clarification, plan, subagent request, or other tool call. If tools are namespaced, this is mcp__workspace_naming__set_workspace_display_name. Do not use subagents for workspace naming and do not use this to rename git branches.",
        json!({
            "type": "object",
            "properties": {
                "displayName": {
                    "type": "string",
                    "minLength": 1
                }
            },
            "required": ["displayName"]
        }),
    )]
}

fn tool_definition(name: &str, description: &str, input_schema: Value) -> Value {
    json!({
        "name": name,
        "description": description,
        "inputSchema": input_schema,
    })
}

#[cfg(test)]
mod tests {
    use super::build_tool_list;

    #[test]
    fn tool_description_names_the_agent_visible_qualified_tool() {
        let tools = build_tool_list();
        let description = tools[0]["description"].as_str().expect("tool description");

        assert_eq!(tools[0]["name"], "set_workspace_display_name");
        assert!(description.contains("mcp__workspace_naming__set_workspace_display_name"));
        assert!(description.contains("Do not use subagents"));
    }
}
