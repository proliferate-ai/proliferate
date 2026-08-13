use std::sync::Arc;

use super::state::{ClosingPreparation, ClosingSubmission, PreparationCleanup};
use super::submission::emit_submission;
use super::terminal::emit as emit_preparation;
use super::SupportSnapshotCoordinator;

impl SupportSnapshotCoordinator {
    pub(super) fn spawn_closing_owner(self: &Arc<Self>, closing: Arc<ClosingPreparation>) {
        if !closing.claim_owner() {
            return;
        }
        let coordinator = Arc::clone(self);
        tokio::spawn(async move {
            coordinator.finalize_closing_preparation(closing).await;
        });
    }

    async fn finalize_closing_preparation(self: &Arc<Self>, closing: Arc<ClosingPreparation>) {
        closing.control.stop_watchdog();
        closing.control.wait_idle().await;
        self.runtime.before_preparation_terminal().await;

        if closing.cleanup != PreparationCleanup::None {
            let mut deletes = vec![closing.artifact_id.clone()];
            if closing.cleanup == PreparationCleanup::Interrupted {
                if let Some(success) = closing.control.finish_completion().claim_cleanup() {
                    if !deletes.contains(&success.reference.artifact_id) {
                        deletes.push(success.reference.artifact_id);
                    }
                }
            }

            let _artifact_guard = self.artifact_gate.lock().await;
            let mut authorized_deletes = Vec::with_capacity(deletes.len());
            {
                let mut state = self.state.lock().await;
                for artifact_id in deletes {
                    let belongs_to_closing =
                        state
                            .artifacts
                            .get(&artifact_id)
                            .is_none_or(|authorization| {
                                authorization.preparation_id.as_deref()
                                    == Some(closing.preparation_id.as_str())
                                    && authorization.consent_epoch.as_deref()
                                        == Some(closing.consent_epoch.as_str())
                            });
                    if belongs_to_closing {
                        state.artifacts.remove(&artifact_id);
                        state.read_proofs.remove(&artifact_id);
                        authorized_deletes.push(artifact_id);
                    }
                }
            }
            self.delete_artifacts(authorized_deletes).await;
        }
        emit_preparation(&closing.operation, closing.terminal);
        {
            let mut state = self.state.lock().await;
            if state
                .closing_preparation
                .as_ref()
                .is_some_and(|current| Arc::ptr_eq(current, &closing))
            {
                state.closing_preparation = None;
            }
        }
        closing.complete();
    }

    pub(super) fn spawn_closing_submission_owner(
        self: &Arc<Self>,
        closing: Arc<ClosingSubmission>,
    ) {
        if !closing.claim_owner() {
            return;
        }
        let coordinator = Arc::clone(self);
        tokio::spawn(async move {
            coordinator.finalize_closing_submission(closing).await;
        });
    }

    async fn finalize_closing_submission(self: &Arc<Self>, closing: Arc<ClosingSubmission>) {
        self.runtime.before_submission_terminal().await;
        emit_submission(&closing.operation, closing.terminal);
        {
            let mut state = self.state.lock().await;
            if state
                .closing_submission
                .as_ref()
                .is_some_and(|current| Arc::ptr_eq(current, &closing))
            {
                state.closing_submission = None;
            }
        }
        closing.complete();
    }
}
