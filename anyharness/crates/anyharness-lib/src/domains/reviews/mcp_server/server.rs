use serde_json::{json, Value};

use super::protocol::{parent_tool_list, reviewer_tool_list};
use super::tools::handle_tool_call;
use crate::domains::reviews::runtime::ReviewRuntime;
use crate::integrations::mcp::json_rpc::{
    jsonrpc_error, jsonrpc_result, CallToolParams, InitializeParams, JsonRpcRequest,
};

pub(super) enum ReviewMcpRole {
    Parent { can_signal_revision: bool },
    Reviewer,
    None,
}

pub async fn handle_json_rpc(
    runtime: &ReviewRuntime,
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
    let role = resolve_role(runtime, workspace_id, session_id)?;

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
                        "name": "proliferate-reviews",
                        "version": env!("CARGO_PKG_VERSION"),
                    },
                    "instructions": "Review tools are role-scoped by AnyHarness. Reviewers must submit submit_review_result. Parent sessions may use get_review_status. mark_review_revision_ready is only available for manual fallback states when a revised target is ready and another review round is expected."
                }),
            )))
        }
        "notifications/initialized" => Ok(None),
        "tools/list" => Ok(Some(jsonrpc_result(
            request.id,
            json!({ "tools": tools_for_role(&role) }),
        ))),
        "tools/call" => {
            let params: CallToolParams =
                serde_json::from_value(request.params.unwrap_or_else(|| json!({})))?;
            Ok(Some(
                handle_tool_call(runtime, session_id, role, request.id, params).await,
            ))
        }
        _ => Ok(Some(jsonrpc_error(
            request.id,
            -32601,
            format!("unsupported method: {}", request.method),
        ))),
    }
}

fn resolve_role(
    runtime: &ReviewRuntime,
    workspace_id: &str,
    session_id: &str,
) -> anyhow::Result<ReviewMcpRole> {
    if runtime
        .service()
        .store()
        .find_assignment_for_reviewer_session(session_id)?
        .is_some()
    {
        return Ok(ReviewMcpRole::Reviewer);
    }
    let active = runtime
        .service()
        .store()
        .find_active_run_for_parent(session_id)?;
    if let Some(run) = active
        .as_ref()
        .filter(|run| run.workspace_id == workspace_id && run.status.is_active())
    {
        return Ok(ReviewMcpRole::Parent {
            can_signal_revision: runtime.service().run_can_signal_revision_via_mcp(run),
        });
    }
    Ok(ReviewMcpRole::None)
}

fn tools_for_role(role: &ReviewMcpRole) -> Vec<Value> {
    match role {
        ReviewMcpRole::Parent {
            can_signal_revision,
        } => parent_tool_list(*can_signal_revision),
        ReviewMcpRole::Reviewer => reviewer_tool_list(),
        ReviewMcpRole::None => Vec::new(),
    }
}
