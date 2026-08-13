use std::sync::Arc;

use super::super::schema::validate::validate_id;
use super::control::PreparationInterruption;
use super::model::CancelSupportSnapshotInput;
use super::preparation::canonical_uuid;
use super::state::ClosingPreparation;
use super::SupportSnapshotCoordinator;

impl SupportSnapshotCoordinator {
    pub(crate) async fn cancel_preparation(
        self: &Arc<Self>,
        input: CancelSupportSnapshotInput,
    ) -> Result<(), String> {
        if canonical_uuid(&input.client_job_id).is_err()
            || validate_id(&input.consent_epoch).is_err()
            || input
                .preparation_id
                .as_deref()
                .is_some_and(|value| canonical_uuid(value).is_err())
        {
            return Err("support_snapshot_invalid_input".to_string());
        }

        let (closing, deletes) = {
            let mut state = self.state.lock().await;
            let open = state
                .preparation
                .as_ref()
                .filter(|open| {
                    open.input.client_job_id == input.client_job_id
                        && open.input.consent_epoch == input.consent_epoch
                        && input
                            .preparation_id
                            .as_ref()
                            .is_none_or(|value| value == &open.preparation_id)
                })
                .map(|open| {
                    (
                        open.preparation_id.clone(),
                        open.deadline,
                        Arc::clone(&open.control),
                    )
                });
            let closing = if let Some((preparation_id, deadline, control)) = open {
                if self.runtime.instant_now() >= deadline {
                    control.request(PreparationInterruption::Deadline);
                }
                control.request(PreparationInterruption::Cancelled);
                state.transfer_preparation_to_closing(&preparation_id)
            } else {
                state
                    .closing_preparation
                    .as_ref()
                    .filter(|closing| closing_matches(closing, &input))
                    .cloned()
            };
            let ids = state
                .artifacts
                .iter()
                .filter(|(_, authorization)| {
                    authorization.reference.client_job_id == input.client_job_id
                        && authorization.consent_epoch.as_deref() == Some(&input.consent_epoch)
                        && input.preparation_id.as_ref().is_none_or(|value| {
                            authorization.preparation_id.as_ref() == Some(value)
                        })
                })
                .map(|(id, _)| id.clone())
                .collect::<Vec<_>>();
            for id in &ids {
                state.artifacts.remove(id);
                state.read_proofs.remove(id);
            }
            (closing, ids)
        };

        if let Some(closing) = closing {
            self.spawn_closing_owner(Arc::clone(&closing));
            closing.wait_completed().await;
        }
        if !deletes.is_empty() {
            let _artifact_guard = self.artifact_gate.lock().await;
            self.delete_artifacts(deletes).await;
        }
        Ok(())
    }
}

fn closing_matches(closing: &ClosingPreparation, input: &CancelSupportSnapshotInput) -> bool {
    closing.client_job_id == input.client_job_id
        && closing.consent_epoch == input.consent_epoch
        && input
            .preparation_id
            .as_ref()
            .is_none_or(|value| value == &closing.preparation_id)
}
