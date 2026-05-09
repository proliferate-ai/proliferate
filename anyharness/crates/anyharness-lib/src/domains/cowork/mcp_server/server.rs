use std::time::Instant;

use serde_json::{json, Value};

use super::protocol;
use super::tools;
use crate::domains::cowork::artifacts::CoworkArtifactRuntime;
use crate::domains::cowork::runtime::CoworkRuntime;
use crate::integrations::mcp::json_rpc::{
    jsonrpc_error, jsonrpc_result, CallToolParams, InitializeParams, JsonRpcRequest,
};

pub async fn handle_json_rpc(
    artifact_runtime: &CoworkArtifactRuntime,
    cowork_runtime: &CoworkRuntime,
    workspace_id: &str,
    session_id: &str,
    request_body: Value,
) -> anyhow::Result<Option<Value>> {
    let started = Instant::now();
    let request: JsonRpcRequest = serde_json::from_value(request_body)?;
    let method = request.method.clone();
    let tool_name = request
        .params
        .as_ref()
        .and_then(|params| params.get("name"))
        .and_then(Value::as_str)
        .map(str::to_string);
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
    let mut listed_tool_count: Option<usize> = None;

    let response: anyhow::Result<Option<Value>> = match request.method.as_str() {
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
                        .unwrap_or_else(|| protocol::DEFAULT_PROTOCOL_VERSION.to_string()),
                    "capabilities": { "tools": {} },
                    "serverInfo": {
                        "name": protocol::SERVER_NAME,
                        "version": env!("CARGO_PKG_VERSION"),
                    },
                    "instructions": protocol::SERVER_INSTRUCTIONS
                }),
            )))
        }
        "notifications/initialized" => Ok(None),
        "tools/list" => {
            let tool_list = protocol::tool_list(workspace_delegation_enabled);
            listed_tool_count = Some(tool_list.len());
            Ok(Some(jsonrpc_result(
                request.id,
                json!({
                    "tools": tool_list
                }),
            )))
        }
        "tools/call" => {
            let params: CallToolParams =
                serde_json::from_value(request.params.unwrap_or_else(|| json!({})))?;
            Ok(Some(
                tools::handle_tool_call(
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
    };
    let response = response?;

    tracing::info!(
        workspace_id = %workspace.id,
        session_id,
        method = %method,
        tool_name = tool_name.as_deref().unwrap_or_default(),
        workspace_delegation_enabled,
        listed_tool_count = listed_tool_count.unwrap_or_default(),
        elapsed_ms = started.elapsed().as_millis(),
        "[workspace-latency] cowork.mcp.request.completed"
    );

    Ok(response)
}
