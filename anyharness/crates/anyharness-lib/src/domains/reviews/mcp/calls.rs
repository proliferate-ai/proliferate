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
    validate_tool_for_role(ctx.role, name)?;

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
        (_, tool_name) => Err(anyhow::anyhow!("unknown tool for review role: {tool_name}")),
    }
}

fn validate_tool_for_role(role: ReviewMcpRole, tool_name: &str) -> anyhow::Result<()> {
    match (role, tool_name) {
        (ReviewMcpRole::Reviewer, "submit_review_result") => Ok(()),
        (
            ReviewMcpRole::Parent {
                can_signal_revision: true,
            },
            "mark_review_revision_ready",
        ) => Ok(()),
        (ReviewMcpRole::Parent { .. }, "get_review_status") => Ok(()),
        (ReviewMcpRole::None, _) => Err(anyhow::anyhow!("no active review role for this session")),
        (_, tool_name) => Err(anyhow::anyhow!("unknown tool for review role: {tool_name}")),
    }
}

#[cfg(test)]
mod tests {
    use super::validate_tool_for_role;
    use crate::domains::reviews::mcp::context::ReviewMcpRole;

    #[test]
    fn no_role_rejects_review_tool_calls() {
        let error = validate_tool_for_role(ReviewMcpRole::None, "get_review_status")
            .err()
            .expect("no-role call should fail");

        assert!(error.to_string().contains("no active review role"));
    }

    #[test]
    fn reviewer_rejects_parent_only_tools() {
        let error = validate_tool_for_role(ReviewMcpRole::Reviewer, "get_review_status")
            .err()
            .expect("reviewer cannot use parent tool");

        assert!(error.to_string().contains("unknown tool for review role"));
    }

    #[test]
    fn parent_without_revision_signal_rejects_signal_tool() {
        let error = validate_tool_for_role(
            ReviewMcpRole::Parent {
                can_signal_revision: false,
            },
            "mark_review_revision_ready",
        )
        .err()
        .expect("parent without revision signal cannot use signal tool");

        assert!(error.to_string().contains("unknown tool for review role"));
    }
}
