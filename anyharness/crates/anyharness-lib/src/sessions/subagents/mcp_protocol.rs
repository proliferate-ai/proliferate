use serde::Deserialize;
use serde_json::{json, Value};

use crate::sessions::delegation::READ_EVENTS_MAX_LIMIT;

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
pub(super) struct CreateSubagentArgs {
    pub prompt: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub agent_kind: Option<String>,
    #[serde(default)]
    pub model_id: Option<String>,
    #[serde(default)]
    pub mode_id: Option<String>,
    #[serde(default)]
    pub wake_on_completion: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ChildSessionArgs {
    pub child_session_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SendSubagentMessageArgs {
    pub child_session_id: String,
    pub prompt: String,
    #[serde(default)]
    pub wake_on_completion: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ReadSubagentEventsArgs {
    pub child_session_id: String,
    #[serde(default)]
    pub since_seq: Option<i64>,
    #[serde(default)]
    pub limit: Option<usize>,
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
    vec![
        tool_definition(
            "get_subagent_launch_options",
            "Describe subagent creation defaults, limits, supported agent/model choices, and available parent mode hints.",
            json!({ "type": "object", "properties": {} }),
        ),
        tool_definition(
            "create_subagent",
            "Create a same-workspace child agent session and send it an initial prompt. Set wakeOnCompletion when you want AnyHarness to prompt you after this child's next completed turn. Call get_subagent_launch_options first when choosing agentKind, modelId, or modeId.",
            json!({
                "type": "object",
                "properties": {
                    "prompt": { "type": "string" },
                    "label": { "type": "string" },
                    "agentKind": { "type": "string" },
                    "modelId": { "type": "string" },
                    "modeId": { "type": "string" },
                    "wakeOnCompletion": { "type": "boolean" }
                },
                "required": ["prompt"]
            }),
        ),
        tool_definition(
            "list_subagents",
            "List child sessions owned by this parent session.",
            json!({ "type": "object", "properties": {} }),
        ),
        tool_definition(
            "send_subagent_message",
            "Send another prompt to an owned child session. Set wakeOnCompletion when you want AnyHarness to prompt you after this child's next completed turn.",
            json!({
                "type": "object",
                "properties": {
                    "childSessionId": { "type": "string" },
                    "prompt": { "type": "string" },
                    "wakeOnCompletion": { "type": "boolean" }
                },
                "required": ["childSessionId", "prompt"]
            }),
        ),
        tool_definition(
            "schedule_subagent_wake",
            "Schedule a one-shot wake for an owned child session. The next newly recorded completed turn for that child will prompt you; already completed turns are not retroactive.",
            json!({
                "type": "object",
                "properties": {
                    "childSessionId": { "type": "string" }
                },
                "required": ["childSessionId"]
            }),
        ),
        tool_definition(
            "get_subagent_status",
            "Get execution status for an owned child session.",
            json!({
                "type": "object",
                "properties": {
                    "childSessionId": { "type": "string" }
                },
                "required": ["childSessionId"]
            }),
        ),
        tool_definition(
            "read_subagent_events",
            "Read a bounded, sanitized event slice from an owned child session.",
            json!({
                "type": "object",
                "properties": {
                    "childSessionId": { "type": "string" },
                    "sinceSeq": { "type": "integer" },
                    "limit": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": READ_EVENTS_MAX_LIMIT
                    }
                },
                "required": ["childSessionId"]
            }),
        ),
    ]
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
    fn tool_list_exposes_launch_options_before_create() {
        let tools = build_tool_list();
        let names = tools
            .iter()
            .filter_map(|tool| tool.get("name").and_then(|value| value.as_str()))
            .collect::<Vec<_>>();

        assert_eq!(names.first().copied(), Some("get_subagent_launch_options"));
        assert!(names.contains(&"create_subagent"));
    }
}
