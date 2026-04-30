use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use anyharness_contract::v1::{
    MarkReviewRevisionReadyRequest, PromptInputBlock, ReviewRunDetail, ReviewRunUpdatedPayload,
    StartCodeReviewRequest, StartPlanReviewRequest,
};

use super::hooks::ReviewHookEvent;
use super::model::{
    ReviewFeedbackJobRecord, ReviewFeedbackJobState, ReviewKind, ReviewModeVerificationStatus,
    ReviewRunRecord, ReviewRunStatus,
};
use super::runtime_helpers::{
    build_reviewer_prompt, map_create_session_error, reviewer_system_prompt_append,
    reviewers_from_contract, verify_mode,
};
use super::service::{ReviewError, ReviewService, StartReviewInput};
use crate::origin::OriginContext;
use crate::sessions::extensions::SessionTurnOutcome;
use crate::sessions::model::SessionMcpBindingPolicy;
use crate::sessions::prompt::PromptProvenance;
use crate::sessions::runtime::{SendPromptOutcome, SessionRuntime};
use crate::sessions::runtime_event::RuntimeInjectedSessionEvent;
use crate::workspaces::runtime::WorkspaceRuntime;

const REVIEW_RECONCILE_INTERVAL_SECS: u64 = 15;
const FEEDBACK_RETRY_DELAY_SECS: i64 = 30;

#[derive(Clone)]
pub struct ReviewRuntime {
    pub(crate) service: Arc<ReviewService>,
    pub(crate) session_runtime: Arc<SessionRuntime>,
    pub(crate) workspace_runtime: Arc<WorkspaceRuntime>,
    pub(crate) runtime_home: PathBuf,
}

impl ReviewRuntime {
    pub fn new(
        service: Arc<ReviewService>,
        session_runtime: Arc<SessionRuntime>,
        workspace_runtime: Arc<WorkspaceRuntime>,
        runtime_home: PathBuf,
    ) -> Self {
        Self {
            service,
            session_runtime,
            workspace_runtime,
            runtime_home,
        }
    }

    pub fn service(&self) -> &Arc<ReviewService> {
        &self.service
    }

    pub fn spawn_background_tasks(
        self: Arc<Self>,
        mut hook_events: tokio::sync::mpsc::Receiver<ReviewHookEvent>,
    ) {
        let events_runtime = self.clone();
        tokio::spawn(async move {
            while let Some(event) = hook_events.recv().await {
                events_runtime.handle_hook_event(event).await;
            }
        });

        let reconcile_runtime = self;
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(
                REVIEW_RECONCILE_INTERVAL_SECS,
            ));
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                interval.tick().await;
                reconcile_runtime.reconcile_active_reviews().await;
            }
        });
    }

    pub async fn start_plan_review(
        &self,
        workspace_id: &str,
        plan_id: &str,
        req: StartPlanReviewRequest,
    ) -> Result<ReviewRunDetail, ReviewError> {
        let target_plan = self
            .service
            .get_plan(plan_id)
            .map_err(ReviewError::Internal)?
            .ok_or_else(|| ReviewError::PlanNotFound(plan_id.to_string()))?;
        let run = self.service.start_review(StartReviewInput {
            workspace_id: workspace_id.to_string(),
            parent_session_id: req.parent_session_id,
            kind: ReviewKind::Plan,
            title: format!("Plan review: {}", target_plan.title),
            target_plan: Some(target_plan),
            target_code_manifest: None,
            max_rounds: req.max_rounds,
            auto_iterate: req.auto_iterate,
            reviewers: reviewers_from_contract(req.reviewers),
        })?;
        self.spawn_launch_active_round(run.clone());
        self.service.get_run_detail(&run.id)
    }

    pub async fn start_code_review(
        &self,
        workspace_id: &str,
        req: StartCodeReviewRequest,
    ) -> Result<ReviewRunDetail, ReviewError> {
        let manifest = self.capture_code_manifest(workspace_id).await?;
        let run = self.service.start_review(StartReviewInput {
            workspace_id: workspace_id.to_string(),
            parent_session_id: req.parent_session_id,
            kind: ReviewKind::Code,
            title: "Implementation review".to_string(),
            target_plan: None,
            target_code_manifest: Some(manifest),
            max_rounds: req.max_rounds,
            auto_iterate: req.auto_iterate,
            reviewers: reviewers_from_contract(req.reviewers),
        })?;
        self.spawn_launch_active_round(run.clone());
        self.service.get_run_detail(&run.id)
    }

    pub async fn submit_review_result(
        &self,
        reviewer_session_id: &str,
        pass: bool,
        summary: String,
        critique_markdown: String,
    ) -> Result<Option<ReviewFeedbackJobRecord>, ReviewError> {
        let assignment = self
            .service
            .store()
            .find_assignment_for_reviewer_session(reviewer_session_id)
            .map_err(ReviewError::Internal)?
            .ok_or_else(|| ReviewError::AssignmentNotFound(reviewer_session_id.to_string()))?;
        let artifact_path = self.write_critique_artifact(&assignment, &critique_markdown)?;
        let job = self.service.submit_assignment_result(
            reviewer_session_id,
            pass,
            &summary,
            &critique_markdown,
            &artifact_path,
        )?;
        if let Some(job) = job.as_ref() {
            self.emit_review_run_updated_for_job(job).await;
            let run = self
                .service
                .store()
                .find_run(&job.review_run_id)
                .map_err(ReviewError::Internal)?
                .ok_or_else(|| ReviewError::RunNotFound(job.review_run_id.clone()))?;
            if run.auto_iterate || run.status == ReviewRunStatus::Passed {
                self.send_feedback_job(job).await?;
            }
        }
        Ok(job)
    }

    pub async fn send_feedback(&self, run_id: &str) -> Result<ReviewRunDetail, ReviewError> {
        let run = self
            .service
            .store()
            .find_run(run_id)
            .map_err(ReviewError::Internal)?
            .ok_or_else(|| ReviewError::RunNotFound(run_id.to_string()))?;
        let rounds = self
            .service
            .store()
            .list_rounds_for_run(run_id)
            .map_err(ReviewError::Internal)?;
        let Some(job_id) = rounds
            .iter()
            .rev()
            .find_map(|round| round.feedback_job_id.clone())
        else {
            return Err(ReviewError::NotWaitingForRevision);
        };
        let job = self
            .service
            .store()
            .find_feedback_job(&job_id)
            .map_err(ReviewError::Internal)?
            .ok_or_else(|| ReviewError::RunNotFound(run.id.clone()))?;
        self.send_feedback_job(&job).await?;
        self.service.get_run_detail(run_id)
    }

    pub async fn mark_revision_ready(
        &self,
        run_id: &str,
        req: MarkReviewRevisionReadyRequest,
    ) -> Result<ReviewRunDetail, ReviewError> {
        let existing = self
            .service
            .store()
            .find_run(run_id)
            .map_err(ReviewError::Internal)?
            .ok_or_else(|| ReviewError::RunNotFound(run_id.to_string()))?;
        if !matches!(
            existing.status,
            ReviewRunStatus::ParentRevising | ReviewRunStatus::WaitingForRevision
        ) || (existing.status == ReviewRunStatus::ParentRevising && existing.auto_iterate)
        {
            return Err(ReviewError::NotWaitingForRevision);
        }
        let manifest = {
            if existing.kind == ReviewKind::Code {
                Some(self.capture_code_manifest(&existing.workspace_id).await?)
            } else {
                None
            }
        };
        let run = self.service.start_next_round_records(
            run_id,
            req.revised_plan_id.as_deref(),
            manifest,
        )?;
        if run.status == ReviewRunStatus::Reviewing {
            self.spawn_launch_active_round(run.clone());
        }
        self.emit_review_run_updated(&run.parent_session_id, run_id)
            .await;
        self.service.get_run_detail(run_id)
    }

    pub async fn mark_revision_ready_from_parent_tool(
        &self,
        parent_session_id: &str,
        run_id: &str,
        req: MarkReviewRevisionReadyRequest,
    ) -> Result<ReviewRunDetail, ReviewError> {
        let run = self
            .service
            .store()
            .find_run(run_id)
            .map_err(ReviewError::Internal)?
            .ok_or_else(|| ReviewError::RunNotFound(run_id.to_string()))?;
        if run.parent_session_id != parent_session_id {
            return Err(ReviewError::RunNotFound(run_id.to_string()));
        }
        if !self.service.run_accepts_manual_revision_signal(&run) {
            return self.service.get_run_detail(run_id);
        }
        self.mark_revision_ready(run_id, req).await
    }

    pub async fn stop_run(&self, run_id: &str) -> Result<ReviewRunDetail, ReviewError> {
        let reviewer_session_ids = self.service.stop_run(run_id)?;
        for session_id in reviewer_session_ids {
            let _ = self.session_runtime.cancel_live_session(&session_id).await;
        }
        if let Some(run) = self
            .service
            .store()
            .find_run(run_id)
            .map_err(ReviewError::Internal)?
        {
            self.emit_review_run_updated(&run.parent_session_id, run_id)
                .await;
        }
        self.service.get_run_detail(run_id)
    }

    async fn try_auto_iterate_run(
        &self,
        run_id: &str,
        feedback_turn_id: &str,
    ) -> Result<ReviewRunDetail, ReviewError> {
        let run = self
            .service
            .store()
            .find_run(run_id)
            .map_err(ReviewError::Internal)?
            .ok_or_else(|| ReviewError::RunNotFound(run_id.to_string()))?;
        if run.status != ReviewRunStatus::ParentRevising
            || !run.auto_iterate
            || run.current_round_number >= run.max_rounds
        {
            return self.service.get_run_detail(run_id);
        }

        let manifest = if run.kind == ReviewKind::Code {
            Some(self.capture_code_manifest(&run.workspace_id).await?)
        } else {
            None
        };
        let result = self.service.start_next_round_records_after_feedback_turn(
            run_id,
            feedback_turn_id,
            None,
            manifest,
        );
        let (run, started) = match result {
            Ok(value) => value,
            Err(ReviewError::RevisedPlanRequired | ReviewError::AmbiguousRevisedPlan) => {
                if self
                    .service
                    .store()
                    .mark_run_waiting_for_revision(run_id)
                    .map_err(ReviewError::Internal)?
                {
                    self.emit_review_run_updated(&run.parent_session_id, run_id)
                        .await;
                }
                return self.service.get_run_detail(run_id);
            }
            Err(error) => return Err(error),
        };
        if started {
            self.spawn_launch_active_round(run.clone());
            self.emit_review_run_updated(&run.parent_session_id, run_id)
                .await;
        }
        self.service.get_run_detail(run_id)
    }

    async fn emit_review_run_updated_for_job(&self, job: &ReviewFeedbackJobRecord) {
        self.emit_review_run_updated(&job.parent_session_id, &job.review_run_id)
            .await;
    }

    async fn emit_review_run_updated(&self, parent_session_id: &str, run_id: &str) {
        let Ok(Some(run)) = self.service.store().find_run(run_id) else {
            return;
        };
        let payload = ReviewRunUpdatedPayload {
            review_run_id: run.id.clone(),
            parent_session_id: run.parent_session_id.clone(),
            kind: run.kind.into(),
            status: run.status.into(),
            current_round_number: run.current_round_number,
            max_rounds: run.max_rounds,
            auto_iterate: run.auto_iterate,
            active_round_id: run.active_round_id.clone(),
            updated_at: run.updated_at.clone(),
        };
        if let Err(error) = self
            .session_runtime
            .emit_runtime_event(
                &run.parent_session_id,
                RuntimeInjectedSessionEvent::ReviewRunUpdated(payload),
            )
            .await
        {
            tracing::warn!(
                review_run_id = %run.id,
                parent_session_id = %run.parent_session_id,
                requested_parent_session_id = %parent_session_id,
                error = %error,
                "failed to emit review run update event"
            );
        }
    }

    fn spawn_launch_active_round(&self, run: ReviewRunRecord) {
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
                    self.service
                        .store()
                        .update_assignment_launched(
                            &assignment.id,
                            session_id,
                            session_link_id,
                            previous.actual_mode_id.as_deref(),
                            previous.mode_verification_status,
                        )
                        .map_err(ReviewError::Internal)?;
                    self.send_reviewer_assignment_prompt(session_id, run, &assignment)
                        .await?;
                    continue;
                }
            }
            let child = self
                .session_runtime
                .create_durable_session(
                    &run.workspace_id,
                    &assignment.agent_kind,
                    assignment.model_id.as_deref(),
                    assignment.requested_mode_id.as_deref(),
                    Some(vec![reviewer_system_prompt_append()]),
                    Vec::new(),
                    None,
                    SessionMcpBindingPolicy::InternalOnly,
                    false,
                    OriginContext::system_local_runtime(),
                )
                .map_err(map_create_session_error)?;
            let session_link_id = self.service.link_reviewer_session(
                &run.id,
                &assignment.id,
                &run.parent_session_id,
                &child.id,
                Some(assignment.persona_label.clone()),
                None,
                ReviewModeVerificationStatus::Pending,
            )?;
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
            self.service
                .store()
                .update_assignment_launched(
                    &assignment.id,
                    &started.id,
                    &session_link_id,
                    actual_mode_id,
                    mode_status,
                )
                .map_err(ReviewError::Internal)?;
            self.send_reviewer_assignment_prompt(&started.id, run, &assignment)
                .await?;
        }
        Ok(())
    }

    fn previous_reviewers_by_persona(
        &self,
        run_id: &str,
        active_round_id: &str,
    ) -> Result<HashMap<String, super::model::ReviewAssignmentRecord>, ReviewError> {
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
        assignment: &super::model::ReviewAssignmentRecord,
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

    async fn send_feedback_job(&self, job: &ReviewFeedbackJobRecord) -> Result<(), ReviewError> {
        if job.state == ReviewFeedbackJobState::Sent || job.sent_prompt_seq.is_some() {
            return Ok(());
        }
        let Some(job) = self
            .service
            .store()
            .mark_feedback_job_sending(&job.id)
            .map_err(ReviewError::Internal)?
        else {
            return Ok(());
        };
        self.emit_review_run_updated_for_job(&job).await;
        let outcome = self
            .session_runtime
            .send_text_prompt_with_provenance(
                &job.parent_session_id,
                job.prompt_text.clone(),
                PromptProvenance::ReviewFeedback {
                    review_run_id: job.review_run_id.clone(),
                    review_round_id: job.review_round_id.clone(),
                    feedback_job_id: job.id.clone(),
                    label: None,
                },
            )
            .await;
        match outcome {
            Ok(SendPromptOutcome::Queued { seq, .. }) => {
                self.service
                    .store()
                    .mark_feedback_job_queued(&job.id, Some(seq))
                    .map_err(ReviewError::Internal)?;
                self.emit_review_run_updated_for_job(&job).await;
            }
            Ok(SendPromptOutcome::Running { turn_id, .. }) => {
                self.service
                    .store()
                    .mark_feedback_job_sent(&job.id, None, Some(&turn_id), None)
                    .map_err(ReviewError::Internal)?;
                self.emit_review_run_updated_for_job(&job).await;
            }
            Err(error) => {
                let detail = format!("{error:?}");
                let next_attempt_at = (chrono::Utc::now()
                    + chrono::Duration::seconds(FEEDBACK_RETRY_DELAY_SECS))
                .to_rfc3339();
                if job.attempt_count >= 3 {
                    self.service
                        .store()
                        .mark_feedback_job_failed(&job.id, "prompt_send_failed", Some(&detail))
                        .map_err(ReviewError::Internal)?;
                    self.emit_review_run_updated_for_job(&job).await;
                    return Err(ReviewError::Internal(anyhow::anyhow!(detail)));
                } else {
                    self.service
                        .store()
                        .mark_feedback_job_retry(
                            &job.id,
                            "prompt_send_failed",
                            Some(&detail),
                            &next_attempt_at,
                        )
                        .map_err(ReviewError::Internal)?;
                    self.emit_review_run_updated_for_job(&job).await;
                }
            }
        }
        Ok(())
    }

    async fn handle_hook_event(&self, event: ReviewHookEvent) {
        match event {
            ReviewHookEvent::TurnFinished(ctx) => {
                if ctx.outcome == SessionTurnOutcome::Completed {
                    match self
                        .service
                        .mark_parent_feedback_turn_finished(&ctx.session_id, &ctx.turn_id)
                    {
                        Ok(Some(run)) => {
                            self.emit_review_run_updated(&run.parent_session_id, &run.id)
                                .await;
                            if run.status == ReviewRunStatus::ParentRevising && run.auto_iterate {
                                if let Err(error) =
                                    self.try_auto_iterate_run(&run.id, &ctx.turn_id).await
                                {
                                    tracing::warn!(
                                        review_run_id = %run.id,
                                        error = %error,
                                        "failed to auto-iterate review run after parent turn finished"
                                    );
                                }
                            }
                        }
                        Ok(None) => {}
                        Err(error) => {
                            tracing::warn!(
                                parent_session_id = %ctx.session_id,
                                turn_id = %ctx.turn_id,
                                error = %error,
                                "failed to process review parent turn-finished hook"
                            );
                        }
                    }
                }
                if let Err(error) = self.handle_reviewer_turn_finished(&ctx.session_id).await {
                    tracing::warn!(
                        session_id = %ctx.session_id,
                        error = %error,
                        "failed to process reviewer turn-finished review hook"
                    );
                }
            }
        }
    }

    async fn handle_reviewer_turn_finished(&self, session_id: &str) -> Result<(), ReviewError> {
        let Some(assignment) = self
            .service
            .store()
            .find_assignment_for_reviewer_session(session_id)
            .map_err(ReviewError::Internal)?
        else {
            return Ok(());
        };
        if assignment.reminder_count < 2 {
            if self
                .service
                .store()
                .mark_assignment_reminded(&assignment.id)
                .map_err(ReviewError::Internal)?
            {
                self.session_runtime
                    .send_text_prompt_with_provenance(
                        session_id,
                        "Submit your review verdict now with submit_review_result. If you need to fail the review, include the concrete findings in critiqueMarkdown. Do not continue with only prose.".to_string(),
                        PromptProvenance::System {
                            label: Some("review_submit_reminder".to_string()),
                        },
                    )
                    .await
                    .map_err(|error| ReviewError::Internal(anyhow::anyhow!("{error:?}")))?;
            }
            return Ok(());
        }
        self.service
            .store()
            .mark_assignment_system_failed(
                &assignment.id,
                "missing_review_result",
                Some("Reviewer finished multiple turns without calling submit_review_result."),
            )
            .map_err(ReviewError::Internal)?;
        if let Some(job) = self
            .service
            .try_complete_round(&assignment.review_round_id)?
        {
            self.emit_review_run_updated_for_job(&job).await;
            let run = self
                .service
                .store()
                .find_run(&job.review_run_id)
                .map_err(ReviewError::Internal)?
                .ok_or_else(|| ReviewError::RunNotFound(job.review_run_id.clone()))?;
            if run.auto_iterate {
                self.send_feedback_job(&job).await?;
            }
        } else if let Some(run) = self
            .service
            .store()
            .find_run(&assignment.review_run_id)
            .map_err(ReviewError::Internal)?
            .filter(|run| run.status == ReviewRunStatus::SystemFailed)
        {
            self.emit_review_run_updated(&run.parent_session_id, &run.id)
                .await;
        }
        Ok(())
    }

    async fn reconcile_active_reviews(&self) {
        if let Err(error) = self.resolve_queued_feedback_jobs().await {
            tracing::warn!(error = %error, "failed to reconcile queued review feedback jobs");
        }
        if let Err(error) = self.finish_completed_feedback_turns().await {
            tracing::warn!(error = %error, "failed to reconcile finished review feedback turns");
        }
        if let Err(error) = self.send_due_feedback_jobs().await {
            tracing::warn!(error = %error, "failed to reconcile due review feedback jobs");
        }
        if let Err(error) = self.timeout_overdue_assignments().await {
            tracing::warn!(error = %error, "failed to reconcile overdue review assignments");
        }
    }

    async fn resolve_queued_feedback_jobs(&self) -> Result<(), ReviewError> {
        let jobs = self
            .service
            .store()
            .queued_feedback_jobs_without_turn()
            .map_err(ReviewError::Internal)?;
        for job in jobs {
            let Some(seq) = job.sent_prompt_seq else {
                continue;
            };
            let Some((turn_id, executed_at)) = self
                .service
                .store()
                .find_pending_prompt_execution(&job.parent_session_id, seq)
                .map_err(ReviewError::Internal)?
            else {
                continue;
            };
            self.service
                .store()
                .mark_feedback_job_sent(&job.id, Some(seq), Some(&turn_id), Some(&executed_at))
                .map_err(ReviewError::Internal)?;
            self.emit_review_run_updated_for_job(&job).await;
        }
        Ok(())
    }

    async fn finish_completed_feedback_turns(&self) -> Result<(), ReviewError> {
        let jobs = self
            .service
            .store()
            .sent_feedback_jobs_with_parent_revising()
            .map_err(ReviewError::Internal)?;
        for job in jobs {
            let Some(turn_id) = job.feedback_turn_id.as_deref() else {
                continue;
            };
            if !self
                .service
                .store()
                .turn_has_finished(&job.parent_session_id, turn_id)
                .map_err(ReviewError::Internal)?
            {
                continue;
            }
            let Some(run) = self
                .service
                .mark_parent_feedback_turn_finished(&job.parent_session_id, turn_id)?
            else {
                continue;
            };
            self.emit_review_run_updated(&run.parent_session_id, &run.id)
                .await;
            if run.status == ReviewRunStatus::ParentRevising && run.auto_iterate {
                self.try_auto_iterate_run(&run.id, turn_id).await?;
            }
        }
        Ok(())
    }

    async fn send_due_feedback_jobs(&self) -> Result<(), ReviewError> {
        let now = chrono::Utc::now().to_rfc3339();
        let jobs = self
            .service
            .store()
            .pending_feedback_jobs(&now)
            .map_err(ReviewError::Internal)?;
        for job in jobs {
            if let Err(error) = self.send_feedback_job(&job).await {
                tracing::warn!(
                    review_feedback_job_id = %job.id,
                    error = %error,
                    "failed to send due review feedback job"
                );
            }
        }
        Ok(())
    }

    async fn timeout_overdue_assignments(&self) -> Result<(), ReviewError> {
        let now = chrono::Utc::now().to_rfc3339();
        let assignments = self
            .service
            .store()
            .active_assignments_past_deadline(&now)
            .map_err(ReviewError::Internal)?;
        for assignment in assignments {
            if !self
                .service
                .store()
                .mark_assignment_timed_out(
                    &assignment.id,
                    "reviewer_deadline_exceeded",
                    Some("Reviewer did not submit a result before the assignment deadline."),
                )
                .map_err(ReviewError::Internal)?
            {
                continue;
            }
            if let Some(session_id) = assignment.reviewer_session_id.as_deref() {
                let _ = self.session_runtime.cancel_live_session(session_id).await;
            }
            if let Some(job) = self
                .service
                .try_complete_round(&assignment.review_round_id)?
            {
                self.emit_review_run_updated_for_job(&job).await;
                let run = self
                    .service
                    .store()
                    .find_run(&job.review_run_id)
                    .map_err(ReviewError::Internal)?
                    .ok_or_else(|| ReviewError::RunNotFound(job.review_run_id.clone()))?;
                if run.auto_iterate {
                    self.send_feedback_job(&job).await?;
                }
            } else if let Some(run) = self
                .service
                .store()
                .find_run(&assignment.review_run_id)
                .map_err(ReviewError::Internal)?
                .filter(|run| run.status == ReviewRunStatus::SystemFailed)
            {
                self.emit_review_run_updated(&run.parent_session_id, &run.id)
                    .await;
            }
        }
        Ok(())
    }
}
