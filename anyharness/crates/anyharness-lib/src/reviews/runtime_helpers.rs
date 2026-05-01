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
        "{}\n\nPersona: {}\n\n{}\n\n{}\n\nWhen done, call submit_review_result with pass, summary, and critiqueMarkdown. Do not stop with only prose.",
        reviewer_system_prompt_append(),
        assignment.persona_label,
        assignment.persona_prompt,
        target
    )
}

pub(super) fn map_create_session_error(error: CreateAndStartSessionError) -> ReviewError {
    ReviewError::Internal(anyhow::anyhow!("{error:?}"))
}

pub(super) fn reviewer_system_prompt_append() -> String {
    "You are a review-only agent. Inspect and critique, but do not modify files, commit, push, or launch child agents. Your only completion signal is the review MCP submit_review_result tool.".to_string()
}
