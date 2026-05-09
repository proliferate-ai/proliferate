use serde_json::{json, Value};

use super::super::service::SubagentService;
use super::protocol::build_tool_list;
use super::tools::handle_tool_call;
use crate::integrations::mcp::json_rpc::{
    jsonrpc_error, jsonrpc_result, CallToolParams, InitializeParams, JsonRpcRequest,
};
use crate::sessions::runtime::SessionRuntime;
use crate::workspaces::runtime::WorkspaceRuntime;

pub async fn handle_json_rpc(
    service: &SubagentService,
    session_runtime: &SessionRuntime,
    workspace_runtime: &WorkspaceRuntime,
    workspace_id: &str,
    parent_session_id: &str,
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
    validate_parent_context(service, workspace_runtime, workspace_id, parent_session_id)?;

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
                        "name": "proliferate-subagents",
                        "version": env!("CARGO_PKG_VERSION"),
                    },
                    "instructions": "Use get_subagent_launch_options to inspect defaults, limits, and supported agent/model choices. Use subagent tools to create and manage same-workspace child agent sessions. Child completions are passive by default. After creating or messaging a child, call schedule_subagent_wake if you want AnyHarness to prompt you after the child's next completed turn. Inspect child output with read_subagent_events before continuing."
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
            Ok(Some(
                handle_tool_call(
                    service,
                    session_runtime,
                    parent_session_id,
                    request.id,
                    params,
                )
                .await,
            ))
        }
        _ => Ok(Some(jsonrpc_error(
            request.id,
            -32601,
            format!("unsupported method: {}", request.method),
        ))),
    }
}

fn validate_parent_context(
    service: &SubagentService,
    workspace_runtime: &WorkspaceRuntime,
    workspace_id: &str,
    parent_session_id: &str,
) -> anyhow::Result<()> {
    let parent = service
        .session_store()
        .find_by_id(parent_session_id)?
        .ok_or_else(|| anyhow::anyhow!("parent session not found"))?;
    if parent.workspace_id != workspace_id {
        anyhow::bail!("parent session does not belong to workspace");
    }
    let workspace = workspace_runtime
        .get_workspace(workspace_id)?
        .ok_or_else(|| anyhow::anyhow!("workspace not found"))?;
    if workspace.surface != "standard" {
        anyhow::bail!("subagents are only available in standard workspaces");
    }
    Ok(())
}
