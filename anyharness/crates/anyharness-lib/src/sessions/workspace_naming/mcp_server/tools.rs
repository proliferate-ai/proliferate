use serde_json::{json, Value};

use super::protocol::SetWorkspaceDisplayNameArgs;
use crate::integrations::mcp::json_rpc::{deserialize_args, CallToolParams};
use crate::integrations::mcp::tools::jsonrpc_tool_result;
use crate::sessions::store::SessionStore;
use crate::sessions::workspace_naming::eligibility;
use crate::workspaces::access_gate::WorkspaceAccessGate;
use crate::workspaces::runtime::WorkspaceRuntime;

pub(super) fn handle_tool_call(
    workspace_runtime: &WorkspaceRuntime,
    workspace_access_gate: &WorkspaceAccessGate,
    session_store: &SessionStore,
    workspace_id: &str,
    session_id: &str,
    id: Option<Value>,
    params: CallToolParams,
) -> Value {
    let result = match params.name.as_str() {
        "set_workspace_display_name" => {
            let args: anyhow::Result<SetWorkspaceDisplayNameArgs> =
                deserialize_args(params.arguments);
            match args {
                Ok(args) => set_workspace_display_name(
                    workspace_runtime,
                    workspace_access_gate,
                    session_store,
                    workspace_id,
                    session_id,
                    args,
                ),
                Err(error) => Err(anyhow::anyhow!(error.to_string())),
            }
        }
        _ => Err(anyhow::anyhow!("unknown tool: {}", params.name)),
    };
    jsonrpc_tool_result(id, result)
}

fn set_workspace_display_name(
    workspace_runtime: &WorkspaceRuntime,
    workspace_access_gate: &WorkspaceAccessGate,
    session_store: &SessionStore,
    workspace_id: &str,
    session_id: &str,
    args: SetWorkspaceDisplayNameArgs,
) -> anyhow::Result<Value> {
    let display_name = args.display_name.trim();
    if display_name.is_empty() {
        anyhow::bail!("displayName is required");
    }
    let session = session_store
        .find_by_id(session_id)?
        .ok_or_else(|| anyhow::anyhow!("session not found"))?;
    let workspace = workspace_runtime
        .get_workspace(workspace_id)?
        .ok_or_else(|| anyhow::anyhow!("workspace not found"))?;
    eligibility::validate_tool_call(session_store, &workspace, &session)?;
    workspace_access_gate.assert_can_mutate_for_workspace(workspace_id)?;
    let workspace = workspace_runtime
        .set_display_name(workspace_id, Some(display_name))
        .map_err(|error| anyhow::anyhow!(error.to_string()))?;
    Ok(json!({
        "workspaceId": workspace.id,
        "displayName": workspace.display_name,
    }))
}
