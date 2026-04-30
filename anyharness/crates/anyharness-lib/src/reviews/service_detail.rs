use std::collections::BTreeMap;

use anyharness_contract::v1;
use uuid::Uuid;

use super::model::{
    ReviewAssignmentRecord, ReviewAssignmentStatus, ReviewFeedbackJobRecord, ReviewKind,
    ReviewModeVerificationStatus, ReviewRoundRecord, ReviewRunRecord,
};
use super::service::{
    ReviewError, ReviewPersonaInput, ReviewService, MAX_REVIEWERS_PER_RUN,
    MAX_REVIEW_CRITIQUE_BYTES, MAX_REVIEW_ROUNDS, MAX_REVIEW_SUMMARY_BYTES,
    REVIEWER_DEADLINE_MINUTES,
};
use crate::sessions::links::service::CreateSessionLinkError;
use crate::sessions::model::SessionRecord;

impl ReviewService {
    pub(super) fn detail_for_run(
        &self,
        run: &ReviewRunRecord,
    ) -> Result<v1::ReviewRunDetail, ReviewError> {
        let rounds = self
            .store()
            .list_rounds_for_run(&run.id)
            .map_err(ReviewError::Internal)?;
        let mut child_session_ids = Vec::new();
        let mut detail_rounds = Vec::new();
        for round in rounds {
            let assignments = self
                .store()
                .list_assignments_for_round(&round.id)
                .map_err(ReviewError::Internal)?;
            for assignment in &assignments {
                if let Some(session_id) = assignment.reviewer_session_id.as_ref() {
                    child_session_ids.push(session_id.clone());
                }
            }
            let feedback_job = round
                .feedback_job_id
                .as_ref()
                .map(|job_id| self.store().find_feedback_job(job_id))
                .transpose()
                .map_err(ReviewError::Internal)?
                .flatten();
            detail_rounds.push(round_to_contract(round, assignments, feedback_job));
        }
        child_session_ids.sort();
        child_session_ids.dedup();
        Ok(v1::ReviewRunDetail {
            id: run.id.clone(),
            workspace_id: run.workspace_id.clone(),
            parent_session_id: run.parent_session_id.clone(),
            kind: run.kind.into(),
            status: run.status.into(),
            title: run.title.clone(),
            max_rounds: run.max_rounds,
            current_round_number: run.current_round_number,
            auto_iterate: run.auto_iterate,
            parent_can_signal_revision_via_mcp: self.run_can_signal_revision_via_mcp(run),
            active_round_id: run.active_round_id.clone(),
            target_plan_id: run.target_plan_id.clone(),
            target_plan_snapshot_hash: run.target_plan_snapshot_hash.clone(),
            failure_reason: run.failure_reason.clone(),
            failure_detail: run.failure_detail.clone(),
            child_session_ids,
            rounds: detail_rounds,
            created_at: run.created_at.clone(),
            updated_at: run.updated_at.clone(),
        })
    }
}

pub(super) fn validate_rounds(max_rounds: u32) -> Result<(), ReviewError> {
    if !(1..=MAX_REVIEW_ROUNDS).contains(&max_rounds) {
        return Err(ReviewError::InvalidMaxRounds);
    }
    Ok(())
}

pub(super) fn validate_reviewers(reviewers: &[ReviewPersonaInput]) -> Result<(), ReviewError> {
    if reviewers.is_empty() || reviewers.len() > MAX_REVIEWERS_PER_RUN {
        return Err(ReviewError::InvalidReviewerCount);
    }
    Ok(())
}

pub(super) fn build_assignments(
    run: &ReviewRunRecord,
    round: &ReviewRoundRecord,
    reviewers: &[ReviewPersonaInput],
    now: &str,
) -> Vec<ReviewAssignmentRecord> {
    let deadline_at =
        (chrono::Utc::now() + chrono::Duration::minutes(REVIEWER_DEADLINE_MINUTES)).to_rfc3339();
    reviewers
        .iter()
        .map(|reviewer| ReviewAssignmentRecord {
            id: Uuid::new_v4().to_string(),
            review_run_id: run.id.clone(),
            review_round_id: round.id.clone(),
            reviewer_session_id: None,
            session_link_id: None,
            persona_id: reviewer.persona_id.clone(),
            persona_label: reviewer.label.clone(),
            persona_prompt: reviewer.prompt.clone(),
            agent_kind: reviewer.agent_kind.clone(),
            model_id: reviewer.model_id.clone(),
            requested_mode_id: reviewer.mode_id.clone(),
            actual_mode_id: None,
            mode_verification_status: ReviewModeVerificationStatus::Pending,
            status: ReviewAssignmentStatus::Queued,
            pass: None,
            summary: None,
            critique_markdown: None,
            critique_artifact_path: None,
            submitted_at: None,
            deadline_at: deadline_at.clone(),
            reminder_count: 0,
            failure_reason: None,
            failure_detail: None,
            created_at: now.to_string(),
            updated_at: now.to_string(),
        })
        .collect()
}

pub(super) fn dedupe_personas(assignments: Vec<ReviewAssignmentRecord>) -> Vec<ReviewPersonaInput> {
    let mut by_persona = BTreeMap::new();
    for assignment in assignments {
        by_persona
            .entry(assignment.persona_id.clone())
            .or_insert(ReviewPersonaInput {
                persona_id: assignment.persona_id,
                label: assignment.persona_label,
                prompt: assignment.persona_prompt,
                agent_kind: assignment.agent_kind,
                model_id: assignment.model_id,
                mode_id: assignment.requested_mode_id,
            });
    }
    by_persona.into_values().collect()
}

pub(super) fn assignment_is_terminal(status: ReviewAssignmentStatus) -> bool {
    matches!(
        status,
        ReviewAssignmentStatus::Submitted
            | ReviewAssignmentStatus::Cancelled
            | ReviewAssignmentStatus::TimedOut
            | ReviewAssignmentStatus::SystemFailed
    )
}

pub(super) fn build_feedback_prompt(
    run: &ReviewRunRecord,
    round: &ReviewRoundRecord,
    assignments: &[ReviewAssignmentRecord],
) -> String {
    let mut text = String::new();
    let all_approved = assignments.iter().all(|assignment| {
        assignment.status == ReviewAssignmentStatus::Submitted && assignment.pass == Some(true)
    });
    text.push_str(if all_approved {
        "Review is complete.\n\n"
    } else {
        "Review feedback is ready.\n\n"
    });
    text.push_str(&format!(
        "Review run: {}\nRound: {}\nTarget: {}\n\n",
        run.id,
        round.round_number,
        match run.kind {
            ReviewKind::Plan => "plan",
            ReviewKind::Code => "implementation",
        }
    ));
    if all_approved {
        match run.kind {
            ReviewKind::Plan => {
                text.push_str("All reviewers approved. Use the final reviewer feedback below to present the final plan. Do not start another automated review round unless the user asks.\n\n");
            }
            ReviewKind::Code => {
                text.push_str("All reviewers approved. Use the final reviewer feedback below as context and continue the implementation. Do not start another automated review round unless the user asks.\n\n");
            }
        }
    } else if run.current_round_number >= run.max_rounds {
        match run.kind {
            ReviewKind::Plan => {
                text.push_str("This is the final configured review round. Address the feedback you agree with, ignore feedback you can justify ignoring, and present the final plan. No further automated review round will start.\n\n");
            }
            ReviewKind::Code => {
                text.push_str("This is the final configured review round. Address the feedback you agree with, ignore feedback you can justify ignoring, and continue the implementation. No further automated review round will start.\n\n");
            }
        }
    } else if run.auto_iterate {
        text.push_str("Address the feedback you agree with, ignore feedback you can justify ignoring, and finish the revised target normally. Auto iterate is enabled, so AnyHarness will detect the completed revision and start the next review round when it is safe.\n\n");
    } else {
        text.push_str("Address the feedback you agree with, ignore feedback you can justify ignoring, then signal the revised target with `mark_review_revision_ready` if that tool is available. If the tool is not available, present the revised plan or implementation and wait for the user to start the next review round from the review card.\n\n");
    }
    for assignment in assignments {
        text.push_str(&format!(
            "## {}\n\nStatus: {}\nPass: {}\n\nSummary:\n{}\n\nCritique:\n{}\n\nArtifact: {}\n\n",
            assignment.persona_label,
            assignment.status.as_str(),
            assignment.pass.unwrap_or(false),
            assignment
                .summary
                .as_deref()
                .unwrap_or("No summary provided."),
            assignment
                .critique_markdown
                .as_deref()
                .unwrap_or("No critique body provided."),
            assignment
                .critique_artifact_path
                .as_deref()
                .unwrap_or("No artifact path recorded.")
        ));
    }
    text
}

pub(super) fn session_has_review_mcp(session: &SessionRecord) -> bool {
    session
        .to_contract()
        .mcp_binding_summaries
        .unwrap_or_default()
        .iter()
        .any(|summary| summary.id == "internal:reviews" || summary.id == "reviews")
}

pub(super) fn validate_review_submission(
    summary: &str,
    critique_markdown: &str,
) -> Result<(), ReviewError> {
    if summary.len() > MAX_REVIEW_SUMMARY_BYTES {
        return Err(ReviewError::ReviewSubmissionTooLarge("summary"));
    }
    if critique_markdown.len() > MAX_REVIEW_CRITIQUE_BYTES {
        return Err(ReviewError::ReviewSubmissionTooLarge("critiqueMarkdown"));
    }
    Ok(())
}

pub(super) fn map_link_error(error: CreateSessionLinkError) -> ReviewError {
    match error {
        CreateSessionLinkError::ParentNotFound(id) | CreateSessionLinkError::ChildNotFound(id) => {
            ReviewError::SessionNotFound(id)
        }
        other => ReviewError::Link(other.to_string()),
    }
}

fn round_to_contract(
    round: ReviewRoundRecord,
    assignments: Vec<ReviewAssignmentRecord>,
    feedback_job: Option<ReviewFeedbackJobRecord>,
) -> v1::ReviewRoundDetail {
    v1::ReviewRoundDetail {
        id: round.id,
        review_run_id: round.review_run_id,
        round_number: round.round_number,
        status: round.status.into(),
        target_plan_id: round.target_plan_id,
        target_plan_snapshot_hash: round.target_plan_snapshot_hash,
        feedback_job_id: round.feedback_job_id,
        feedback_prompt_sent_at: round.feedback_prompt_sent_at,
        feedback_delivery: feedback_job.map(feedback_job_to_contract),
        failure_reason: round.failure_reason,
        failure_detail: round.failure_detail,
        assignments: assignments
            .into_iter()
            .map(assignment_to_contract)
            .collect(),
        created_at: round.created_at,
        updated_at: round.updated_at,
    }
}

fn feedback_job_to_contract(job: ReviewFeedbackJobRecord) -> v1::ReviewFeedbackDeliveryDetail {
    v1::ReviewFeedbackDeliveryDetail {
        state: job.state.into(),
        attempt_count: job.attempt_count,
        next_attempt_at: job.next_attempt_at,
        failure_reason: job.failure_reason,
        failure_detail: job.failure_detail,
    }
}

fn assignment_to_contract(assignment: ReviewAssignmentRecord) -> v1::ReviewAssignmentDetail {
    v1::ReviewAssignmentDetail {
        id: assignment.id,
        review_run_id: assignment.review_run_id,
        review_round_id: assignment.review_round_id,
        reviewer_session_id: assignment.reviewer_session_id,
        session_link_id: assignment.session_link_id,
        persona_id: assignment.persona_id,
        persona_label: assignment.persona_label,
        agent_kind: assignment.agent_kind,
        model_id: assignment.model_id,
        requested_mode_id: assignment.requested_mode_id,
        actual_mode_id: assignment.actual_mode_id,
        mode_verification_status: assignment.mode_verification_status.into(),
        status: assignment.status.into(),
        pass: assignment.pass,
        summary: assignment.summary,
        has_critique: assignment.critique_markdown.is_some(),
        critique_artifact_path: assignment.critique_artifact_path,
        failure_reason: assignment.failure_reason,
        failure_detail: assignment.failure_detail,
        deadline_at: assignment.deadline_at,
        created_at: assignment.created_at,
        updated_at: assignment.updated_at,
    }
}
