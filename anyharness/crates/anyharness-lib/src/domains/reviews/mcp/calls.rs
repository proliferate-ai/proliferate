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
                .submit_review_result_under_workspace_lease(
                    &ctx.workspace_id,
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
    use std::time::Duration;

    use serde_json::json;

    use super::{call_tool, validate_tool_for_role};
    use crate::app::test_support;
    use crate::domains::reviews::mcp::context::{self, ReviewMcpRole};
    use crate::domains::reviews::mcp::definition;
    use crate::domains::reviews::model::{ReviewKind, ReviewLaunchVerificationStatus};
    use crate::domains::reviews::service::{ReviewPersonaInput, StartReviewInput};
    use crate::domains::sessions::runtime::prompt_message_actor_tests::{
        build_state, temp_runtime_home,
    };
    use crate::domains::workspaces::checkpoints::test_support::EnvGuard;
    use crate::domains::workspaces::operation_gate::WorkspaceOperationKind;
    use crate::integrations::mcp::product_server::ProductMcpRequestContext;
    use crate::persistence::Db;

    #[tokio::test(flavor = "current_thread")]
    async fn reviewer_result_does_not_nest_a_prompt_lease_behind_a_queued_writer() {
        let _capture = EnvGuard::off();
        let _bearer = test_support::set_bearer_token_env(None);
        let _data_key = test_support::set_data_key_env(None);
        let runtime_home = temp_runtime_home("review-mcp-prompt-lease");
        let state = build_state(
            &runtime_home,
            Db::open_in_memory().expect("open in-memory db"),
            true,
        );
        test_support::insert_session_row(
            state.session_service.store(),
            "workspace-b",
            "reviewer",
            "idle",
        );
        let run = state
            .review_service
            .start_review(StartReviewInput {
                workspace_id: "workspace-b".into(),
                parent_session_id: "target".into(),
                kind: ReviewKind::Code,
                title: "Lease regression".into(),
                target_plan: None,
                target_code_manifest: None,
                max_rounds: 1,
                auto_iterate: false,
                reviewers: vec![ReviewPersonaInput {
                    persona_id: "lease-reviewer".into(),
                    label: "Lease reviewer".into(),
                    prompt: "Review the target.".into(),
                    agent_kind: "claude".into(),
                    model_id: None,
                    control_values: Default::default(),
                }],
            })
            .expect("start review");
        let assignment = state
            .review_service
            .store()
            .list_assignments_for_run(&run.id)
            .expect("list review assignments")
            .pop()
            .expect("review assignment");
        state
            .review_service
            .link_reviewer_session(
                &run.id,
                &assignment.id,
                "target",
                "reviewer",
                None,
                ReviewLaunchVerificationStatus::NotChecked,
            )
            .expect("link reviewer session");
        state
            .session_runtime
            .acp_manager_for_test()
            .insert_unavailable_session_for_test("target")
            .await;
        let request =
            ProductMcpRequestContext::new("workspace-b", "reviewer", definition::DEFINITION.id);
        let ctx = context::resolve_context(&state.review_runtime, &request)
            .expect("resolve reviewer MCP context");

        let outer_lease = state
            .workspace_operation_gate
            .acquire_shared("workspace-b", WorkspaceOperationKind::ReviewWrite)
            .await;
        let writer_gate = state.workspace_operation_gate.clone();
        let (writer_started_tx, writer_started_rx) = tokio::sync::oneshot::channel();
        let mut writer = tokio::spawn(async move {
            let _ = writer_started_tx.send(());
            writer_gate.acquire_exclusive("workspace-b").await
        });
        writer_started_rx.await.expect("writer task starts");
        assert!(
            tokio::time::timeout(Duration::from_millis(20), &mut writer)
                .await
                .is_err(),
            "the exclusive writer must be queued behind ReviewWrite"
        );

        let response = tokio::time::timeout(
            Duration::from_secs(1),
            call_tool(
                &state.review_runtime,
                &ctx,
                "submit_review_result",
                Some(json!({
                    "pass": true,
                    "summary": "Looks good.",
                    "critiqueMarkdown": "No findings."
                })),
            ),
        )
        .await
        .expect("review result must not deadlock behind the queued writer")
        .expect("submit review result");
        assert_eq!(response["submitted"], true);
        assert_eq!(response["feedbackJobCreated"], true);

        drop(outer_lease);
        let writer_lease = tokio::time::timeout(Duration::from_secs(1), writer)
            .await
            .expect("writer proceeds after ReviewWrite drops")
            .expect("writer task joins");
        drop(writer_lease);
        drop(state);
        std::fs::remove_dir_all(runtime_home).expect("remove runtime home");
    }

    #[test]
    fn no_role_rejects_review_tool_calls() {
        let error = validate_tool_for_role(ReviewMcpRole::None, "get_review_status")
            .expect_err("no-role call should fail");

        assert!(error.to_string().contains("no active review role"));
    }

    #[test]
    fn reviewer_rejects_parent_only_tools() {
        let error = validate_tool_for_role(ReviewMcpRole::Reviewer, "get_review_status")
            .expect_err("reviewer cannot use parent tool");

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
        .expect_err("parent without revision signal cannot use signal tool");

        assert!(error.to_string().contains("unknown tool for review role"));
    }
}
