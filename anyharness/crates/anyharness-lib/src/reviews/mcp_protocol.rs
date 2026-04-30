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
pub(super) struct SubmitReviewResultArgs {
    pub pass: bool,
    pub summary: String,
    pub critique_markdown: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct MarkReviewRevisionReadyArgs {
    pub review_run_id: String,
    #[serde(default)]
    pub revised_plan_id: Option<String>,
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

pub(super) fn reviewer_tool_list() -> Vec<Value> {
    vec![tool_definition(
        "submit_review_result",
        "Submit the final structured review verdict. This is the only way to complete your review assignment.",
        json!({
            "type": "object",
            "properties": {
                "pass": { "type": "boolean" },
                "summary": { "type": "string" },
                "critiqueMarkdown": { "type": "string" }
            },
            "required": ["pass", "summary", "critiqueMarkdown"]
        }),
    )]
}

pub(super) fn parent_tool_list() -> Vec<Value> {
    vec![
        tool_definition(
            "mark_review_revision_ready",
            "Signal that the reviewed plan or implementation has been revised and is ready for the next review round. reviewRunId is required.",
            json!({
                "type": "object",
                "properties": {
                    "reviewRunId": { "type": "string" },
                    "revisedPlanId": { "type": "string" }
                },
                "required": ["reviewRunId"]
            }),
        ),
        tool_definition(
            "get_review_status",
            "Get active review status for this parent session.",
            json!({ "type": "object", "properties": {} }),
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
