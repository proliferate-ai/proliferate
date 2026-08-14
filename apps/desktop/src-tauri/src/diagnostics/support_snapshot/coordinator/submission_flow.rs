use super::super::schema::limits::MAX_SAFE_INTEGER;
use super::artifacts::valid_artifact_id;
use super::model::{
    BeginSupportSnapshotSubmissionInput, BeginSupportSnapshotSubmissionOutput,
    FinishSupportSnapshotSubmissionInput,
};
use super::state::{OpenSubmission, ReadinessState};
use super::submission::{terminal_for_input, valid_finish_input};
use super::SupportSnapshotCoordinator;

impl SupportSnapshotCoordinator {
    pub(crate) async fn begin_submission(
        &self,
        input: BeginSupportSnapshotSubmissionInput,
    ) -> Result<BeginSupportSnapshotSubmissionOutput, String> {
        if !valid_artifact_id(&input.artifact_id)
            || !canonical_uuid(&input.client_job_id)
            || !canonical_uuid(&input.parent_operation_id)
            || !(1..=MAX_SAFE_INTEGER).contains(&input.attempt)
        {
            return Err("support_snapshot_submission_invalid".to_string());
        }
        let mut state = self.state.lock().await;
        if state.shutdown_armed || state.readiness != ReadinessState::Ready {
            return Err("support_snapshot_not_ready".to_string());
        }
        if state.submission.is_some() || state.closing_submission.is_some() {
            return Err("support_snapshot_submission_busy".to_string());
        }
        state.purge_expired_proofs(self.runtime.instant_now());
        let proof = state
            .read_proofs
            .get(&input.artifact_id)
            .filter(|proof| {
                proof.reference.client_job_id == input.client_job_id
                    && proof.expires_at > self.runtime.instant_now()
            })
            .cloned()
            .ok_or_else(|| "support_snapshot_verification_required".to_string())?;
        let authorization = state
            .artifacts
            .get(&input.artifact_id)
            .filter(|authorization| authorization.reference == proof.reference)
            .ok_or_else(|| "support_snapshot_artifact_stale".to_string())?;
        if authorization
            .preparation_operation_id
            .as_ref()
            .is_some_and(|expected| expected != &input.parent_operation_id)
        {
            return Err("support_snapshot_submission_parent_mismatch".to_string());
        }
        let operation = self
            .producer
            .begin_support_snapshot_submission(
                &input.client_job_id,
                &input.parent_operation_id,
                input.attempt,
            )
            .map_err(|_| "support_snapshot_submission_invalid".to_string())?;
        let operation_id = operation.operation_id().to_owned();
        let submission_id = self.runtime.new_id();
        state.read_proofs.remove(&input.artifact_id);
        state.submission = Some(OpenSubmission {
            submission_id: submission_id.clone(),
            artifact_id: input.artifact_id,
            client_job_id: input.client_job_id,
            operation: Some(operation),
        });
        Ok(BeginSupportSnapshotSubmissionOutput {
            submission_id,
            operation_id,
        })
    }

    pub(crate) async fn finish_submission(
        self: &std::sync::Arc<Self>,
        input: FinishSupportSnapshotSubmissionInput,
    ) -> Result<(), String> {
        if !canonical_uuid(input.submission_id()) || !valid_finish_input(&input) {
            return Err("support_snapshot_submission_invalid_terminal".to_string());
        }
        let terminal = terminal_for_input(&input);
        let closing = {
            let mut state = self.state.lock().await;
            let matches = state
                .submission
                .as_ref()
                .is_some_and(|open| open.submission_id == input.submission_id());
            if !matches {
                return Err("support_snapshot_submission_stale".to_string());
            }
            state
                .transfer_submission_to_closing(input.submission_id(), terminal)
                .ok_or_else(|| "support_snapshot_submission_stale".to_string())?
        };
        self.spawn_closing_submission_owner(std::sync::Arc::clone(&closing));
        closing.wait_completed().await;
        Ok(())
    }
}

fn canonical_uuid(value: &str) -> bool {
    uuid::Uuid::parse_str(value)
        .ok()
        .is_some_and(|parsed| parsed.to_string() == value)
}
