use serde::Deserialize;
use serde_json::{json, Value};

use super::artifacts::{
    CoworkArtifactRuntime, CreateCoworkArtifactInput, UpdateCoworkArtifactInput,
};
use super::delegation::mcp as delegation_mcp;
use super::runtime::CoworkRuntime;
use crate::workspaces::model::WorkspaceRecord;

#[derive(Debug, Deserialize)]
struct JsonRpcRequest {
    jsonrpc: String,
    #[serde(default)]
    id: Option<Value>,
    method: String,
    #[serde(default)]
    params: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InitializeParams {
    #[serde(default)]
    protocol_version: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CallToolParams {
    name: String,
    #[serde(default)]
    arguments: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct CreateArtifactArgs {
    path: String,
    content: String,
    title: String,
    #[serde(default)]
    description: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UpdateArtifactArgs {
    id: String,
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    description: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DeleteArtifactArgs {
    id: String,
}

#[derive(Debug, Deserialize)]
struct GetArtifactArgs {
    id: String,
}

pub async fn handle_json_rpc(
    artifact_runtime: &CoworkArtifactRuntime,
    cowork_runtime: &CoworkRuntime,
    workspace_id: &str,
    session_id: &str,
    request_body: Value,
) -> anyhow::Result<Option<Value>> {
    let request: JsonRpcRequest = serde_json::from_value(request_body)?;
    if request.jsonrpc != "2.0" {
        return Ok(Some(jsonrpc_error(
            request.id,
            -32600,
            "invalid jsonrpc version",
        )));
    }

    let (thread, workspace, _session) =
        cowork_runtime.validate_canonical_thread(workspace_id, session_id)?;
    let workspace_delegation_enabled = thread.workspace_delegation_enabled;

    match request.method.as_str() {
        "initialize" => {
            let params = request
                .params
                .map(serde_json::from_value::<InitializeParams>)
                .transpose()?;
            Ok(Some(jsonrpc_result(
                request.id,
                json!({
                    "protocolVersion": params
                        .and_then(|value| value.protocol_version)
                        .unwrap_or_else(|| "2025-11-25".to_string()),
                    "capabilities": { "tools": {} },
                    "serverInfo": {
                        "name": "proliferate-cowork",
                        "version": env!("CARGO_PKG_VERSION"),
                    },
                    "instructions": "Use cowork artifact tools to manage cowork artifacts for this workspace. When workspace delegation is available, use get_coding_workspace_launch_options to choose a source workspace, then create_coding_workspace to provision a normal coding worktree. create_coding_workspace does not start agent work. Use get_coding_session_launch_options for that managed workspace, then create_coding_session to start a linked coding session with a prompt. Set wakeOnCompletion or call schedule_coding_wake when you want this cowork thread prompted after the coding session's next completed turn. Inspect coding work with get_coding_status and read_coding_events."
                }),
            )))
        }
        "notifications/initialized" => Ok(None),
        "tools/list" => Ok(Some(jsonrpc_result(
            request.id,
            json!({
                "tools": build_tool_list(workspace_delegation_enabled)
            }),
        ))),
        "tools/call" => {
            let params: CallToolParams =
                serde_json::from_value(request.params.unwrap_or_else(|| json!({})))?;
            Ok(Some(
                handle_tool_call(
                    artifact_runtime,
                    cowork_runtime,
                    &workspace,
                    session_id,
                    workspace_delegation_enabled,
                    request.id,
                    params,
                )
                .await?,
            ))
        }
        _ => Ok(Some(jsonrpc_error(
            request.id,
            -32601,
            format!("unsupported method: {}", request.method),
        ))),
    }
}

async fn handle_tool_call(
    artifact_runtime: &CoworkArtifactRuntime,
    cowork_runtime: &CoworkRuntime,
    workspace: &WorkspaceRecord,
    parent_session_id: &str,
    workspace_delegation_enabled: bool,
    id: Option<Value>,
    params: CallToolParams,
) -> anyhow::Result<Value> {
    if delegation_mcp::is_tool(&params.name) && !workspace_delegation_enabled {
        return Ok(jsonrpc_tool_result::<Value, _>(
            id,
            Err(anyhow::anyhow!(
                "cowork workspace delegation is disabled for this thread"
            )),
        ));
    }

    match params.name.as_str() {
        "create_artifact" => {
            let args: CreateArtifactArgs = deserialize_args(params.arguments)?;
            let artifact_runtime = artifact_runtime.clone();
            let workspace = workspace.clone();
            let artifact = tokio::task::spawn_blocking(move || {
                artifact_runtime.create_artifact(
                    &workspace,
                    CreateCoworkArtifactInput {
                        path: args.path,
                        content: args.content,
                        title: args.title,
                        description: args.description,
                    },
                )
            })
            .await?;
            Ok(jsonrpc_tool_result(id, artifact))
        }
        "update_artifact" => {
            let args: UpdateArtifactArgs = deserialize_args(params.arguments)?;
            let artifact_runtime = artifact_runtime.clone();
            let workspace = workspace.clone();
            let artifact = tokio::task::spawn_blocking(move || {
                artifact_runtime.update_artifact(
                    &workspace,
                    UpdateCoworkArtifactInput {
                        id: args.id,
                        content: args.content,
                        title: args.title,
                        description: args.description,
                    },
                )
            })
            .await?;
            Ok(jsonrpc_tool_result(id, artifact))
        }
        "delete_artifact" => {
            let args: DeleteArtifactArgs = deserialize_args(params.arguments)?;
            let artifact_runtime = artifact_runtime.clone();
            let workspace = workspace.clone();
            let result = tokio::task::spawn_blocking(move || {
                artifact_runtime
                    .delete_artifact(&workspace, &args.id)
                    .map(|_| {
                        json!({
                            "id": args.id,
                            "deleted": true,
                        })
                    })
            })
            .await?;
            Ok(jsonrpc_tool_result(id, result))
        }
        "list_artifacts" => {
            let artifact_runtime = artifact_runtime.clone();
            let workspace = workspace.clone();
            let manifest =
                tokio::task::spawn_blocking(move || artifact_runtime.get_manifest(&workspace))
                    .await?;
            Ok(jsonrpc_tool_result(id, manifest))
        }
        "get_artifact" => {
            let args: GetArtifactArgs = deserialize_args(params.arguments)?;
            let artifact_runtime = artifact_runtime.clone();
            let workspace = workspace.clone();
            let artifact = tokio::task::spawn_blocking(move || {
                artifact_runtime.get_artifact(&workspace, &args.id)
            })
            .await?;
            Ok(jsonrpc_tool_result(id, artifact))
        }
        name if delegation_mcp::is_tool(name) => Ok(jsonrpc_tool_result(
            id,
            delegation_mcp::handle_tool_call(
                cowork_runtime,
                parent_session_id,
                name,
                params.arguments,
            )
            .await,
        )),
        _ => Ok(jsonrpc_error(
            id,
            -32601,
            format!("unknown tool: {}", params.name),
        )),
    }
}

fn deserialize_args<T: for<'de> Deserialize<'de>>(value: Option<Value>) -> anyhow::Result<T> {
    serde_json::from_value(value.unwrap_or_else(|| json!({}))).map_err(anyhow::Error::from)
}

fn jsonrpc_result(id: Option<Value>, result: Value) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id.unwrap_or(Value::Null),
        "result": result,
    })
}

fn jsonrpc_error(id: Option<Value>, code: i64, message: impl Into<String>) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id.unwrap_or(Value::Null),
        "error": {
            "code": code,
            "message": message.into(),
        }
    })
}

fn jsonrpc_tool_result<T, E>(id: Option<Value>, result: Result<T, E>) -> Value
where
    T: serde::Serialize,
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
                    { "type": "text", "text": error.to_string() }
                ],
                "isError": true,
            }),
        ),
    }
}

fn build_tool_list(include_delegation_tools: bool) -> Vec<Value> {
    let mut tools = vec![
        tool_definition(
            "create_artifact",
            "Create a new cowork artifact file and register it in the manifest.",
            json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "content": { "type": "string" },
                    "title": { "type": "string" },
                    "description": { "type": "string" }
                },
                "required": ["path", "content", "title"]
            }),
        ),
        tool_definition(
            "update_artifact",
            "Update a cowork artifact's content or metadata without changing its path.",
            json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "content": { "type": "string" },
                    "title": { "type": "string" },
                    "description": { "type": "string" }
                },
                "required": ["id"]
            }),
        ),
        tool_definition(
            "delete_artifact",
            "Delete a cowork artifact and remove its manifest entry.",
            json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string" }
                },
                "required": ["id"]
            }),
        ),
        tool_definition(
            "list_artifacts",
            "List normalized cowork artifact summaries for the current workspace.",
            json!({
                "type": "object",
                "properties": {}
            }),
        ),
        tool_definition(
            "get_artifact",
            "Read one cowork artifact by id, including its text content.",
            json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string" }
                },
                "required": ["id"]
            }),
        ),
    ];

    if include_delegation_tools {
        tools.extend(delegation_mcp::tool_definitions());
    }

    tools
}

fn tool_definition(name: &str, description: &str, input_schema: Value) -> Value {
    json!({
        "name": name,
        "description": description,
        "inputSchema": input_schema,
    })
}
