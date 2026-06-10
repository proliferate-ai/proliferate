use serde_json::{json, Value};

use super::context::{ReviewMcpContext, ReviewMcpRole};
use super::tools::{GetReviewStatusArgs, MarkReviewRevisionReadyArgs, SubmitReviewResultArgs};
use crate::domains::reviews::runtime::{MarkReviewRevisionReadyInput, ReviewRuntime};
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
            let review_id = args
                .review_id
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .ok_or_else(|| anyhow::anyhow!("reviewId is required"))?;
            runtime
                .mark_revision_ready_from_parent_tool(
                    &ctx.session_id,
                    &review_id,
                    MarkReviewRevisionReadyInput {
                        revised_plan_id: args.revised_plan_id,
                    },
                )
                .await
                .map(|detail| json!({ "review": detail }))
                .map_err(|error| anyhow::anyhow!(error.to_string()))
        }
        (ReviewMcpRole::Parent { .. }, "get_review_status") => {
            let args: GetReviewStatusArgs = deserialize_args(arguments)?;
            let review_id = args
                .review_id
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
            runtime
                .service()
                .list_session_reviews(&ctx.session_id)
                .map(|reviews| {
                    let reviews = reviews
                        .into_iter()
                        .filter(|review| {
                            review_id
                                .as_ref()
                                .is_none_or(|review_id| review.id == *review_id)
                        })
                        .map(review_status_json)
                        .collect::<Vec<_>>();
                    json!({ "reviews": reviews })
                })
                .map_err(|error| anyhow::anyhow!(error.to_string()))
        }
        (_, tool_name) => Err(anyhow::anyhow!("unknown tool for review role: {tool_name}")),
    }
}

fn review_status_json(review: anyharness_contract::v1::ReviewRunDetail) -> Value {
    let active_round = review
        .active_round_id
        .as_ref()
        .and_then(|round_id| review.rounds.iter().find(|round| round.id == *round_id))
        .or_else(|| review.rounds.iter().max_by_key(|round| round.round_number));
    let reviewers = active_round
        .map(|round| {
            round
                .assignments
                .iter()
                .map(|assignment| {
                    json!({
                        "reviewerId": assignment.id,
                        "personaId": assignment.persona_id,
                        "personaLabel": assignment.persona_label,
                        "status": assignment.status,
                        "pass": assignment.pass,
                        "summary": assignment.summary,
                        "updatedAt": assignment.updated_at,
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    json!({
        "reviewId": review.id,
        "status": review.status,
        "kind": review.kind,
        "title": review.title,
        "currentRoundNumber": review.current_round_number,
        "maxRounds": review.max_rounds,
        "autoIterate": review.auto_iterate,
        "parentCanSignalRevisionViaMcp": review.parent_can_signal_revision_via_mcp,
        "targetPlanId": review.target_plan_id,
        "activeRoundId": review.active_round_id,
        "failureReason": review.failure_reason,
        "createdAt": review.created_at,
        "updatedAt": review.updated_at,
        "reviewers": reviewers,
    })
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
