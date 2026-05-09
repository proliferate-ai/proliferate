use serde_json::{json, Value};

use super::protocol::build_tool_list;
use super::tools::handle_tool_call;
use crate::integrations::mcp::json_rpc::{
    jsonrpc_error, jsonrpc_result, CallToolParams, InitializeParams, JsonRpcRequest,
};
use crate::sessions::store::SessionStore;
use crate::workspaces::access_gate::WorkspaceAccessGate;
use crate::workspaces::runtime::WorkspaceRuntime;

pub async fn handle_json_rpc(
    workspace_runtime: &WorkspaceRuntime,
    workspace_access_gate: &WorkspaceAccessGate,
    session_store: &SessionStore,
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
    validate_context(workspace_runtime, session_store, workspace_id, session_id)?;

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
                        "name": "proliferate-workspace-naming",
                        "version": env!("CARGO_PKG_VERSION"),
                    },
                    "instructions": "Your first action in this first turn MUST be a direct call to set_workspace_display_name with a concise task title for the workspace. If MCP tools are namespaced, the exact tool name is mcp__workspace_naming__set_workspace_display_name. This tool is already available in the active tool list; do not use ToolSearch, subagents, or any other tool to find or invoke it. Do not send a user-visible response, clarification, plan, or other tool call before naming the workspace. After the workspace is named, continue with the user's request. Do not rename the git branch for naming."
                }),
            )))
        }
        "notifications/initialized" => Ok(None),
        "tools/list" => Ok(Some(jsonrpc_result(
            request.id,
            json!({ "tools": build_tool_list() }),
        ))),
        "tools/call" => {
            let params: CallToolParams =
                serde_json::from_value(request.params.unwrap_or_else(|| json!({})))?;
            Ok(Some(handle_tool_call(
                workspace_runtime,
                workspace_access_gate,
                session_store,
                workspace_id,
                session_id,
                request.id,
                params,
            )))
        }
        _ => Ok(Some(jsonrpc_error(
            request.id,
            -32601,
            format!("unsupported method: {}", request.method),
        ))),
    }
}

fn validate_context(
    workspace_runtime: &WorkspaceRuntime,
    session_store: &SessionStore,
    workspace_id: &str,
    session_id: &str,
) -> anyhow::Result<()> {
    let session = session_store
        .find_by_id(session_id)?
        .ok_or_else(|| anyhow::anyhow!("session not found"))?;
    if session.workspace_id != workspace_id {
        anyhow::bail!("session does not belong to workspace");
    }
    workspace_runtime
        .get_workspace(workspace_id)?
        .ok_or_else(|| anyhow::anyhow!("workspace not found"))?;
    Ok(())
}
