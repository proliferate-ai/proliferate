use serde_json::{json, Value};

use super::protocol::{MarkReviewRevisionReadyArgs, SubmitReviewResultArgs};
use super::server::ReviewMcpRole;
use crate::domains::reviews::runtime::ReviewRuntime;
use crate::integrations::mcp::json_rpc::{deserialize_args, CallToolParams};
use crate::integrations::mcp::tools::jsonrpc_tool_result;

pub(super) async fn handle_tool_call(
    runtime: &ReviewRuntime,
    session_id: &str,
    role: ReviewMcpRole,
    id: Option<Value>,
    params: CallToolParams,
) -> Value {
    let result = match (role, params.name.as_str()) {
        (ReviewMcpRole::Reviewer, "submit_review_result") => {
            let args: anyhow::Result<SubmitReviewResultArgs> = deserialize_args(params.arguments);
            match args {
                Ok(args) => runtime
                    .submit_review_result(
                        session_id,
                        args.pass,
                        args.summary,
                        args.critique_markdown,
                    )
                    .await
                    .map(|job| json!({ "submitted": true, "feedbackJobCreated": job.is_some() }))
                    .map_err(|error| anyhow::anyhow!(error.to_string())),
                Err(error) => Err(anyhow::anyhow!(error.to_string())),
            }
        }
        (ReviewMcpRole::Parent { .. }, "mark_review_revision_ready")
        | (ReviewMcpRole::None, "mark_review_revision_ready") => {
            let args: anyhow::Result<MarkReviewRevisionReadyArgs> =
                deserialize_args(params.arguments);
            match args {
                Ok(args) => runtime
                    .mark_revision_ready_from_parent_tool(
                        session_id,
                        &args.review_run_id,
                        anyharness_contract::v1::MarkReviewRevisionReadyRequest {
                            revised_plan_id: args.revised_plan_id,
                        },
                    )
                    .await
                    .map(|detail| json!({ "review": detail }))
                    .map_err(|error| anyhow::anyhow!(error.to_string())),
                Err(error) => Err(anyhow::anyhow!(error.to_string())),
            }
        }
        (ReviewMcpRole::Parent { .. }, "get_review_status") => runtime
            .service()
            .list_session_reviews(session_id)
            .map(|reviews| json!({ "reviews": reviews }))
            .map_err(|error| anyhow::anyhow!(error.to_string())),
        (ReviewMcpRole::None, _) => Err(anyhow::anyhow!("no active review role for this session")),
        (_, name) => Err(anyhow::anyhow!("unknown tool for review role: {name}")),
    };
    jsonrpc_tool_result(id, result)
}
