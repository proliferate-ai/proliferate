use serde_json::{json, Value};

use super::context::{ReviewMcpContext, ReviewMcpRole};
use super::tools::{MarkReviewRevisionReadyArgs, SubmitReviewResultArgs};
use crate::domains::reviews::runtime::ReviewRuntime;
use crate::integrations::mcp::json_rpc::deserialize_args;

pub async fn call_tool(
    runtime: &ReviewRuntime,
    ctx: &ReviewMcpContext,
    name: &str,
    arguments: Option<Value>,
) -> anyhow::Result<Value> {
    match (ctx.role, name) {
        (ReviewMcpRole::Reviewer, "submit_review_result") => {
            let args: SubmitReviewResultArgs = deserialize_args(arguments)?;
            runtime
                .submit_review_result(
                    &ctx.session_id,
                    args.pass,
                    args.summary,
                    args.critique_markdown,
                )
                .await
                .map(|job| json!({ "submitted": true, "feedbackJobCreated": job.is_some() }))
                .map_err(|error| anyhow::anyhow!(error.to_string()))
        }
        (
            ReviewMcpRole::Parent {
                can_signal_revision: true,
            },
            "mark_review_revision_ready",
        ) => {
            let args: MarkReviewRevisionReadyArgs = deserialize_args(arguments)?;
            runtime
                .mark_revision_ready_from_parent_tool(
                    &ctx.session_id,
                    &args.review_run_id,
                    anyharness_contract::v1::MarkReviewRevisionReadyRequest {
                        revised_plan_id: args.revised_plan_id,
                    },
                )
                .await
                .map(|detail| json!({ "review": detail }))
                .map_err(|error| anyhow::anyhow!(error.to_string()))
        }
        (ReviewMcpRole::Parent { .. }, "get_review_status") => runtime
            .service()
            .list_session_reviews(&ctx.session_id)
            .map(|reviews| json!({ "reviews": reviews }))
            .map_err(|error| anyhow::anyhow!(error.to_string())),
        (ReviewMcpRole::None, _) => Err(anyhow::anyhow!("no active review role for this session")),
        (_, tool_name) => Err(anyhow::anyhow!("unknown tool for review role: {tool_name}")),
    }
}
