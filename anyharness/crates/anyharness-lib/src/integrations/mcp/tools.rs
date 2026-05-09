use serde::Serialize;
use serde_json::{json, Value};

use super::json_rpc::jsonrpc_result;

pub fn jsonrpc_tool_result<T, E>(id: Option<Value>, result: Result<T, E>) -> Value
where
    T: Serialize,
    E: ToString,
{
    match result {
        Ok(result) => {
            let structured = serde_json::to_value(result).unwrap_or_else(|_| json!({}));
            jsonrpc_result(
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
            )
        }
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

pub fn tool_definition(name: &str, description: &str, input_schema: Value) -> Value {
    json!({
        "name": name,
        "description": description,
        "inputSchema": input_schema,
    })
}

#[cfg(test)]
mod tests {
    use super::{jsonrpc_tool_result, tool_definition};
    use serde_json::json;

    #[test]
    fn tool_result_includes_text_and_structured_content() {
        let response = jsonrpc_tool_result(
            Some(json!("call-1")),
            Ok::<_, String>(json!({
                "created": true
            })),
        );

        assert_eq!(response["jsonrpc"], "2.0");
        assert_eq!(response["id"], "call-1");
        assert_eq!(response["result"]["isError"], false);
        assert_eq!(response["result"]["structuredContent"]["created"], true);
        assert!(response["result"]["content"][0]["text"]
            .as_str()
            .expect("text content")
            .contains("created"));
    }

    #[test]
    fn tool_definition_uses_mcp_input_schema_field() {
        assert_eq!(
            tool_definition("name", "description", json!({ "type": "object" })),
            json!({
                "name": "name",
                "description": "description",
                "inputSchema": { "type": "object" }
            })
        );
    }
}
