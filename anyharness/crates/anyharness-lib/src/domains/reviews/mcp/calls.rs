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
            let assignment = runtime
                .service()
                .store()
                .find_assignment_for_reviewer_session(&ctx.session_id)
                .map_err(|error| anyhow::anyhow!(error.to_string()))?
                .ok_or_else(|| anyhow::anyhow!("review assignment not found"))?;
            let review_id = assignment.review_run_id.clone();
            let reviewer_id = assignment.id.clone();
            runtime
                .submit_review_result(
                    &ctx.session_id,
                    args.pass,
                    args.summary,
                    args.critique_markdown,
                )
                .await
                .map(|job| {
                    json!({
                        "submitted": true,
                        "reviewId": review_id.clone(),
                        "reviewRunId": review_id,
                        "reviewerId": reviewer_id,
                        "status": "submitted",
                        "feedbackJobCreated": job.is_some(),
                    })
                })
                .map_err(|error| anyhow::anyhow!(error.to_string()))
        }
        (
            ReviewMcpRole::Parent {
                can_signal_revision: true,
            },
            "mark_review_revision_ready",
        ) => {
            let args: MarkReviewRevisionReadyArgs = deserialize_args(arguments)?;
            let review_id = resolve_review_id(args.review_id, args.review_run_id)?;
            runtime
                .mark_revision_ready_from_parent_tool(
                    &ctx.session_id,
                    &review_id,
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

fn resolve_review_id(
    review_id: Option<String>,
    review_run_id: Option<String>,
) -> anyhow::Result<String> {
    let review_id = review_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let review_run_id = review_run_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if let (Some(current), Some(legacy)) = (review_id.as_deref(), review_run_id.as_deref()) {
        if current != legacy {
            anyhow::bail!("reviewId conflicts with deprecated reviewRunId");
        }
    }
    review_id
        .or(review_run_id)
        .ok_or_else(|| anyhow::anyhow!("reviewId is required"))
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
