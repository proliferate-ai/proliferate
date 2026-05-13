use serde_json::{json, Value};

use super::context::WorkspaceNamingMcpContext;
use super::tools::SetWorkspaceDisplayNameArgs;
use crate::integrations::mcp::json_rpc::deserialize_args;
use crate::sessions::store::SessionStore;
use crate::sessions::workspace_naming::eligibility;
use crate::workspaces::access_gate::WorkspaceAccessGate;
use crate::workspaces::runtime::WorkspaceRuntime;

pub async fn call_tool(
    workspace_runtime: &WorkspaceRuntime,
    workspace_access_gate: &WorkspaceAccessGate,
    session_store: &SessionStore,
    ctx: &WorkspaceNamingMcpContext,
    name: &str,
    arguments: Option<Value>,
) -> anyhow::Result<Value> {
    match name {
        "set_workspace_display_name" => {
            if !ctx.available {
                anyhow::bail!("workspace naming is not available for this session");
            }
            let args: SetWorkspaceDisplayNameArgs = deserialize_args(arguments)?;
            set_workspace_display_name(
                workspace_runtime,
                workspace_access_gate,
                session_store,
                &ctx.workspace_id,
                &ctx.session_id,
                args,
            )
        }
        _ => Err(anyhow::anyhow!("unknown tool: {name}")),
    }
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
    // Re-check at mutation time; the context availability flag only drives
    // tools/list and may be stale by the time the agent calls the tool.
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
