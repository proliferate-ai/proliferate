use std::collections::HashMap;

use anyharness_contract::v1::PromptInputBlock;

use super::super::model::{
    ReviewAssignmentRecord, ReviewKind, ReviewModeVerificationStatus, ReviewRunRecord,
};
use super::super::service::ReviewError;
use super::launch::{
    build_reviewer_prompt, map_create_session_error, reviewer_system_prompt_append, verify_mode,
};
use super::ReviewRuntime;
use crate::origin::OriginContext;
use crate::sessions::model::SessionMcpBindingPolicy;
use crate::sessions::prompt::PromptProvenance;

impl ReviewRuntime {
    pub(super) fn spawn_launch_active_round(&self, run: ReviewRunRecord) {
        let runtime = self.clone();
        tokio::spawn(async move {
            let run_id = run.id.clone();
            let round_id = run.active_round_id.clone();
            if let Err(error) = runtime.launch_active_round(&run).await {
                let detail = error.to_string();
                tracing::warn!(
                    review_run_id = %run_id,
                    error = %detail,
                    "failed to launch review round"
                );
                if matches!(error, ReviewError::RetryNotAllowed) {
                    runtime
                        .emit_review_run_updated(&run.parent_session_id, &run_id)
                        .await;
                    return;
                }
                if let Err(mark_error) = runtime.service.store().mark_run_system_failed(
                    &run_id,
                    round_id.as_deref(),
                    "reviewer_launch_failed",
                    Some(&detail),
                ) {
                    tracing::warn!(
                        review_run_id = %run_id,
                        error = %mark_error,
                        "failed to mark review run failed after launch error"
                    );
                }
                runtime
                    .emit_review_run_updated(&run.parent_session_id, &run_id)
                    .await;
            }
        });
    }

    async fn launch_active_round(&self, run: &ReviewRunRecord) -> Result<(), ReviewError> {
        let Some(round_id) = run.active_round_id.as_ref() else {
            return Ok(());
        };
        let assignments = self
            .service
            .store()
            .list_assignments_for_round(round_id)
            .map_err(ReviewError::Internal)?;
        let previous_reviewers = self.previous_reviewers_by_persona(&run.id, round_id)?;
        for assignment in assignments {
            if assignment.reviewer_session_id.is_some() {
                continue;
            }
            if let Some(previous) = previous_reviewers.get(&assignment.persona_id) {
                if let (Some(session_id), Some(session_link_id)) = (
                    previous.reviewer_session_id.as_deref(),
                    previous.session_link_id.as_deref(),
                ) {
                    let launched = self
                        .service
                        .store()
                        .update_assignment_launched(
                            &assignment.id,
                            session_id,
                            session_link_id,
                            previous.actual_mode_id.as_deref(),
                            previous.mode_verification_status,
                        )
                        .map_err(ReviewError::Internal)?;
                    if !launched {
                        return Err(ReviewError::RetryNotAllowed);
                    }
                    self.send_reviewer_assignment_prompt(session_id, run, &assignment)
                        .await?;
                    continue;
                }
            }
            self.launch_new_assignment_session(run, &assignment).await?;
        }
        Ok(())
    }

    pub(super) async fn launch_new_assignment_session(
        &self,
        run: &ReviewRunRecord,
        assignment: &ReviewAssignmentRecord,
    ) -> Result<(), ReviewError> {
        let child = match self.session_runtime.create_durable_session(
            &run.workspace_id,
            &assignment.agent_kind,
            assignment.model_id.as_deref(),
            assignment.requested_mode_id.as_deref(),
            Some(vec![reviewer_system_prompt_append()]),
            Vec::new(),
            None,
            SessionMcpBindingPolicy::InternalOnly,
            false,
            None,
            None,
            OriginContext::system_local_runtime(),
        ) {
            Ok(child) => child,
            Err(error) => {
                let detail = format!("{error:?}");
                self.service
                    .store()
                    .mark_assignment_system_failed(
                        &assignment.id,
                        "reviewer_create_failed",
                        Some(&detail),
                    )
                    .map_err(ReviewError::Internal)?;
                return Err(map_create_session_error(error));
            }
        };
        let session_link_id = match self.service.link_reviewer_session(
            &run.id,
            &assignment.id,
            &run.parent_session_id,
            &child.id,
            Some(assignment.persona_label.clone()),
            None,
            ReviewModeVerificationStatus::Pending,
        ) {
            Ok(link_id) => link_id,
            Err(ReviewError::RetryNotAllowed) => {
                self.delete_unlaunched_reviewer_session(run, assignment, &child.id);
                return Err(ReviewError::RetryNotAllowed);
            }
            Err(error) => {
                self.delete_unlaunched_reviewer_session(run, assignment, &child.id);
                let detail = error.to_string();
                self.service
                    .store()
                    .mark_assignment_system_failed(
                        &assignment.id,
                        "reviewer_link_failed",
                        Some(&detail),
                    )
                    .map_err(ReviewError::Internal)?;
                return Err(error);
            }
        };
        let started = match self
            .session_runtime
            .start_persisted_session(&child, None)
            .await
        {
            Ok(started) => started,
            Err(error) => {
                let detail = format!("{error:?}");
                self.service
                    .store()
                    .mark_assignment_system_failed(
                        &assignment.id,
                        "reviewer_start_failed",
                        Some(&detail),
                    )
                    .map_err(ReviewError::Internal)?;
                return Err(map_create_session_error(error));
            }
        };
        let actual_mode_id = started.current_mode_id.as_deref();
        let mode_status = verify_mode(assignment.requested_mode_id.as_deref(), actual_mode_id);
        let launched = self
            .service
            .store()
            .update_assignment_launched(
                &assignment.id,
                &started.id,
                &session_link_id,
                actual_mode_id,
                mode_status,
            )
            .map_err(ReviewError::Internal)?;
        if !launched {
            if let Err(error) = self.session_runtime.close_live_session(&started.id).await {
                tracing::warn!(
                    review_run_id = %run.id,
                    assignment_id = %assignment.id,
                    reviewer_session_id = %started.id,
                    error = ?error,
                    "failed to close reviewer session after review launch was cancelled"
                );
            }
            return Err(ReviewError::RetryNotAllowed);
        }
        self.send_reviewer_assignment_prompt(&started.id, run, assignment)
            .await
    }

    fn delete_unlaunched_reviewer_session(
        &self,
        run: &ReviewRunRecord,
        assignment: &ReviewAssignmentRecord,
        reviewer_session_id: &str,
    ) {
        if let Err(error) = self
            .service
            .delete_unlaunched_reviewer_session(reviewer_session_id)
        {
            tracing::warn!(
                review_run_id = %run.id,
                assignment_id = %assignment.id,
                reviewer_session_id,
                error = %error,
                "failed to delete reviewer session after review launch failed before start"
            );
        }
    }

    fn previous_reviewers_by_persona(
        &self,
        run_id: &str,
        active_round_id: &str,
    ) -> Result<HashMap<String, ReviewAssignmentRecord>, ReviewError> {
        let assignments = self
            .service
            .store()
            .list_assignments_for_run(run_id)
            .map_err(ReviewError::Internal)?;
        let mut reusable = HashMap::new();
        for assignment in assignments {
            if assignment.review_round_id == active_round_id {
                continue;
            }
            if assignment.reviewer_session_id.is_none() || assignment.session_link_id.is_none() {
                continue;
            }
            reusable.insert(assignment.persona_id.clone(), assignment);
        }
        Ok(reusable)
    }

    async fn send_reviewer_assignment_prompt(
        &self,
        reviewer_session_id: &str,
        run: &ReviewRunRecord,
        assignment: &ReviewAssignmentRecord,
    ) -> Result<(), ReviewError> {
        let prompt = build_reviewer_prompt(run, assignment);
        if run.kind == ReviewKind::Plan {
            if let (Some(plan_id), Some(snapshot_hash)) = (
                run.target_plan_id.as_deref(),
                run.target_plan_snapshot_hash.as_deref(),
            ) {
                self.session_runtime
                    .send_prompt(
                        reviewer_session_id,
                        vec![
                            PromptInputBlock::Text { text: prompt },
                            PromptInputBlock::PlanReference {
                                plan_id: plan_id.to_string(),
                                snapshot_hash: snapshot_hash.to_string(),
                            },
                        ],
                        None,
                        None,
                    )
                    .await
                    .map_err(|error| ReviewError::Internal(anyhow::anyhow!("{error:?}")))?;
                return Ok(());
            }
        }
        self.session_runtime
            .send_text_prompt_with_provenance(
                reviewer_session_id,
                prompt,
                PromptProvenance::System {
                    label: Some("review_assignment".to_string()),
                },
            )
            .await
            .map_err(|error| ReviewError::Internal(anyhow::anyhow!("{error:?}")))?;
        Ok(())
    }
}
