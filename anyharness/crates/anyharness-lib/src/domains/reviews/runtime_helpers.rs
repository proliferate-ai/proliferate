use anyharness_contract::v1::ReviewPersonaRequest;

use super::model::{
    ReviewAssignmentRecord, ReviewKind, ReviewModeVerificationStatus, ReviewRunRecord,
};
use super::service::{ReviewError, ReviewPersonaInput};
use crate::sessions::runtime::CreateAndStartSessionError;

pub(super) fn reviewers_from_contract(
    reviewers: Vec<ReviewPersonaRequest>,
) -> Vec<ReviewPersonaInput> {
    reviewers
        .into_iter()
        .map(|reviewer| ReviewPersonaInput {
            persona_id: reviewer.persona_id,
            label: reviewer.label,
            prompt: reviewer.prompt,
            agent_kind: reviewer.agent_kind,
            model_id: reviewer.model_id,
            mode_id: reviewer.mode_id,
        })
        .collect()
}

pub(super) fn verify_mode(
    requested_mode_id: Option<&str>,
    actual_mode_id: Option<&str>,
) -> ReviewModeVerificationStatus {
    match requested_mode_id {
        None => ReviewModeVerificationStatus::NotChecked,
        Some(requested) if Some(requested) == actual_mode_id => {
            ReviewModeVerificationStatus::Verified
        }
        Some(_) => ReviewModeVerificationStatus::Mismatch,
    }
}

pub(super) fn build_reviewer_prompt(
    run: &ReviewRunRecord,
    assignment: &ReviewAssignmentRecord,
) -> String {
    let target = match run.kind {
        ReviewKind::Plan => {
            let revision = if run.current_round_number > 1 {
                "revised proposed plan"
            } else {
                "proposed plan"
            };
            format!(
                "Review the {revision} attached to this prompt. Plan id: {}. Inspect the repository as needed.",
                run.target_plan_id.as_deref().unwrap_or("unknown")
            )
        }
        ReviewKind::Code => {
            if run.current_round_number > 1 {
                "Review the revised implementation state in this workspace. Inspect the branch, git status, diffs, and tests as needed. Do not edit files.".to_string()
            } else {
                "Review the current implementation state in this workspace. Inspect the branch, git status, diffs, and tests as needed. Do not edit files.".to_string()
            }
        }
    };
    format!(
        "Review target: {}\nRound: {} of {}\nReviewer: {}\n\nTarget context:\n{}\n\nReviewer instructions:\n{}\n\nWhen done, call submit_review_result with pass, summary, and critiqueMarkdown. Do not stop with only prose.",
        run.title,
        run.current_round_number,
        run.max_rounds,
        assignment.persona_label,
        target,
        assignment.persona_prompt
    )
}

pub(super) fn map_create_session_error(error: CreateAndStartSessionError) -> ReviewError {
    ReviewError::Internal(anyhow::anyhow!("{error:?}"))
}

pub(super) fn reviewer_system_prompt_append() -> String {
    "You are a review-only agent. Inspect and critique, but do not modify files, commit, push, or launch child agents. Your only completion signal is the review MCP submit_review_result tool.".to_string()
}

#[cfg(test)]
mod tests {
    use super::{build_reviewer_prompt, reviewer_system_prompt_append};
    use crate::domains::reviews::model::{
        ReviewAssignmentRecord, ReviewAssignmentStatus, ReviewKind, ReviewModeVerificationStatus,
        ReviewRunRecord, ReviewRunStatus,
    };

    #[test]
    fn reviewer_prompt_uses_assignment_shape_without_repeating_system_role_text() {
        let prompt = build_reviewer_prompt(&run(ReviewKind::Plan), &assignment());

        assert!(prompt.contains("Review target: Plan Review"));
        assert!(prompt.contains("Round: 1 of 2"));
        assert!(prompt.contains("Reviewer: Architecture Review"));
        assert!(prompt.contains("Target context:"));
        assert!(prompt.contains("Reviewer instructions:"));
        assert!(prompt.contains("call submit_review_result"));
        assert!(!prompt.contains(&reviewer_system_prompt_append()));
    }

    fn run(kind: ReviewKind) -> ReviewRunRecord {
        ReviewRunRecord {
            id: "review-1".to_string(),
            workspace_id: "workspace-1".to_string(),
            parent_session_id: "parent-1".to_string(),
            kind,
            status: ReviewRunStatus::Reviewing,
            target_plan_id: Some("plan-1".to_string()),
            target_plan_snapshot_hash: Some("hash-1".to_string()),
            target_code_manifest_json: None,
            title: match kind {
                ReviewKind::Plan => "Plan Review",
                ReviewKind::Code => "Code Review",
            }
            .to_string(),
            max_rounds: 2,
            auto_iterate: false,
            active_round_id: Some("round-1".to_string()),
            current_round_number: 1,
            parent_can_signal_revision_via_mcp: true,
            failure_reason: None,
            failure_detail: None,
            stopped_at: None,
            created_at: "2026-05-14T00:00:00Z".to_string(),
            updated_at: "2026-05-14T00:00:00Z".to_string(),
        }
    }

    fn assignment() -> ReviewAssignmentRecord {
        ReviewAssignmentRecord {
            id: "assignment-1".to_string(),
            review_run_id: "review-1".to_string(),
            review_round_id: "round-1".to_string(),
            reviewer_session_id: None,
            session_link_id: None,
            persona_id: "architecture".to_string(),
            persona_label: "Architecture Review".to_string(),
            persona_prompt: "Inspect architecture and migration risks.".to_string(),
            agent_kind: "claude".to_string(),
            model_id: Some("claude-sonnet-4-5".to_string()),
            requested_mode_id: Some("bypassPermissions".to_string()),
            actual_mode_id: None,
            mode_verification_status: ReviewModeVerificationStatus::Pending,
            status: ReviewAssignmentStatus::Queued,
            pass: None,
            summary: None,
            critique_markdown: None,
            critique_artifact_path: None,
            submitted_at: None,
            deadline_at: "2026-05-14T00:30:00Z".to_string(),
            reminder_count: 0,
            failure_reason: None,
            failure_detail: None,
            created_at: "2026-05-14T00:00:00Z".to_string(),
            updated_at: "2026-05-14T00:00:00Z".to_string(),
        }
    }
}
