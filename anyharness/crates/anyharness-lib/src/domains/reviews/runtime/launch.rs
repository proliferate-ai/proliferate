use super::super::model::{
    ReviewAssignmentRecord, ReviewKind, ReviewModeVerificationStatus, ReviewRunRecord,
};
use super::super::service::ReviewError;
use crate::domains::sessions::runtime::CreateAndStartSessionError;

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
        "{}\n\nPersona: {}\n\n{}\n\n{}\n\n{}\n\nWhen done, call submit_review_result with pass, summary, and critiqueMarkdown. Put the formatted review body in critiqueMarkdown. Do not stop with only prose.",
        reviewer_system_prompt_append(),
        assignment.persona_label,
        assignment.persona_prompt,
        target,
        review_markdown_instructions(run.kind),
    )
}

pub(super) fn map_create_session_error(error: CreateAndStartSessionError) -> ReviewError {
    ReviewError::Internal(anyhow::anyhow!("{error:?}"))
}

pub(super) fn reviewer_system_prompt_append() -> String {
    "You are a review-only agent. Inspect and critique, but do not modify files, commit, push, or launch child agents. Your only completion signal is the review MCP submit_review_result tool.".to_string()
}

fn review_markdown_instructions(kind: ReviewKind) -> &'static str {
    match kind {
        ReviewKind::Plan => {
            "Format critiqueMarkdown as concise Markdown for a plan review. Use these sections: ## Verdict, ## Findings, ## Risks, and ## Verification. Use bullet lists for actionable items. If approving, state that no blocking issues were found and list what you checked."
        }
        ReviewKind::Code => {
            "Format critiqueMarkdown as concise Markdown for a code review. Use these sections: ## Verdict, ## Findings, and ## Tests. Order findings by severity, include affected file paths in backticks when possible, and use bullet lists. If approving, state that no blocking issues were found and list what you checked."
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::super::model::{ReviewAssignmentStatus, ReviewRunStatus};
    use super::*;

    #[test]
    fn plan_reviewer_prompt_requests_structured_markdown() {
        let run = review_run(ReviewKind::Plan);
        let assignment = review_assignment();

        let prompt = build_reviewer_prompt(&run, &assignment);

        assert!(prompt.contains("Format critiqueMarkdown as concise Markdown for a plan review"));
        assert!(prompt.contains("## Verdict"));
        assert!(prompt.contains("## Findings"));
        assert!(prompt.contains("## Risks"));
        assert!(prompt.contains("## Verification"));
        assert!(prompt.contains("submit_review_result"));
    }

    #[test]
    fn code_reviewer_prompt_requests_structured_markdown() {
        let run = review_run(ReviewKind::Code);
        let assignment = review_assignment();

        let prompt = build_reviewer_prompt(&run, &assignment);

        assert!(prompt.contains("Format critiqueMarkdown as concise Markdown for a code review"));
        assert!(prompt.contains("## Verdict"));
        assert!(prompt.contains("## Findings"));
        assert!(prompt.contains("## Tests"));
        assert!(prompt.contains("Order findings by severity"));
        assert!(prompt.contains("file paths in backticks"));
    }

    fn review_run(kind: ReviewKind) -> ReviewRunRecord {
        ReviewRunRecord {
            id: "review-run".to_string(),
            workspace_id: "workspace".to_string(),
            parent_session_id: "parent-session".to_string(),
            kind,
            status: ReviewRunStatus::Reviewing,
            target_plan_id: Some("plan-1".to_string()),
            target_plan_snapshot_hash: None,
            target_code_manifest_json: None,
            title: "Review".to_string(),
            max_rounds: 1,
            auto_iterate: false,
            active_round_id: Some("round-1".to_string()),
            current_round_number: 1,
            parent_can_signal_revision_via_mcp: false,
            failure_reason: None,
            failure_detail: None,
            stopped_at: None,
            created_at: "2026-05-19T00:00:00Z".to_string(),
            updated_at: "2026-05-19T00:00:00Z".to_string(),
        }
    }

    fn review_assignment() -> ReviewAssignmentRecord {
        ReviewAssignmentRecord {
            id: "assignment-1".to_string(),
            review_run_id: "review-run".to_string(),
            review_round_id: "round-1".to_string(),
            reviewer_session_id: Some("reviewer-session".to_string()),
            session_link_id: Some("session-link".to_string()),
            persona_id: "security".to_string(),
            persona_label: "Security reviewer".to_string(),
            persona_prompt: "Look for security issues.".to_string(),
            agent_kind: "proliferate".to_string(),
            model_id: Some("gpt-5.4".to_string()),
            requested_mode_id: None,
            actual_mode_id: None,
            mode_verification_status: ReviewModeVerificationStatus::NotChecked,
            status: ReviewAssignmentStatus::Queued,
            pass: None,
            summary: None,
            critique_markdown: None,
            critique_artifact_path: None,
            submitted_at: None,
            deadline_at: "2026-05-19T00:10:00Z".to_string(),
            reminder_count: 0,
            failure_reason: None,
            failure_detail: None,
            created_at: "2026-05-19T00:00:00Z".to_string(),
            updated_at: "2026-05-19T00:00:00Z".to_string(),
        }
    }
}
