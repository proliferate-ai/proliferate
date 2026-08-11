use serde::Serialize;
use serde_json::{json, Value};

use super::json_rpc::jsonrpc_result;

#[derive(Debug, thiserror::Error)]
#[error("{message}")]
pub struct McpToolCallError {
    pub code: &'static str,
    pub message: String,
}

impl McpToolCallError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

#[derive(Debug)]
pub enum McpToolOutput {
    Structured(Value),
    Represented {
        structured_content: Value,
        text: String,
        max_response_bytes: usize,
    },
}

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

pub fn jsonrpc_mcp_tool_output(id: Option<Value>, output: McpToolOutput) -> Value {
    match output {
        McpToolOutput::Structured(structured) => {
            jsonrpc_tool_result(id, Ok::<_, String>(structured))
        }
        McpToolOutput::Represented {
            structured_content,
            text,
            max_response_bytes,
        } => {
            let response = represented_tool_response(id.clone(), structured_content.clone(), text);
            if serialized_len(&response) <= max_response_bytes {
                return response;
            }
            let compact = represented_tool_response(
                id.clone(),
                structured_content,
                "Task output is available in structuredContent.".into(),
            );
            if serialized_len(&compact) <= max_response_bytes {
                return compact;
            }
            let error = jsonrpc_result(
                id,
                json!({
                    "content": [{
                        "type": "text",
                        "text": "Task output exceeded the response byte limit."
                    }],
                    "structuredContent": {
                        "error": {
                            "code": "TASK_OUTPUT_RESPONSE_TOO_LARGE",
                            "message": "Task output exceeded the response byte limit."
                        }
                    },
                    "isError": true
                }),
            );
            if serialized_len(&error) <= max_response_bytes {
                error
            } else {
                // A caller-controlled oversized JSON-RPC id must not defeat
                // the operation's whole-wire cap.
                jsonrpc_result(
                    None,
                    json!({
                        "content": [{
                            "type": "text",
                            "text": "Task output exceeded the response byte limit."
                        }],
                        "isError": true
                    }),
                )
            }
        }
    }
}

fn represented_tool_response(id: Option<Value>, structured: Value, text: String) -> Value {
    jsonrpc_result(
        id,
        json!({
            "content": [{ "type": "text", "text": text }],
            "structuredContent": structured,
            "isError": false,
        }),
    )
}

fn serialized_len(value: &Value) -> usize {
    serde_json::to_vec(value).map_or(usize::MAX, |bytes| bytes.len())
}

pub fn tool_definition(name: &str, description: &str, input_schema: Value) -> Value {
    json!({
        "name": name,
        "description": description,
        "inputSchema": input_schema,
    })
}

pub fn jsonrpc_typed_tool_error(id: Option<Value>, error: &McpToolCallError) -> Value {
    let structured = json!({
        "error": {
            "code": error.code,
            "message": error.message,
        }
    });
    jsonrpc_result(
        id,
        json!({
            "content": [{ "type": "text", "text": error.message }],
            "structuredContent": structured,
            "isError": true,
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::{jsonrpc_mcp_tool_output, jsonrpc_tool_result, tool_definition, McpToolOutput};
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

    #[test]
    fn represented_output_caps_the_complete_json_rpc_envelope() {
        let response = jsonrpc_mcp_tool_output(
            Some(json!("call-1")),
            McpToolOutput::Represented {
                structured_content: json!({ "messages": [{ "text": "x".repeat(60_000) }] }),
                text: "x".repeat(20_000),
                max_response_bytes: 65_536,
            },
        );

        assert!(serde_json::to_vec(&response).unwrap().len() <= 65_536);
        assert_eq!(response["result"]["isError"], false);
        assert!(response["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("structuredContent"));
        assert_eq!(
            response["result"]["structuredContent"]["messages"][0]["text"]
                .as_str()
                .unwrap()
                .len(),
            60_000
        );
    }
}
