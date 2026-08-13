use std::sync::Arc;

use super::state::ClosingPreparation;
use super::terminal::terminal_for_interruption;
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
        closing.control.wait_idle().await;

        let mut deletes = vec![closing.artifact_id.clone()];
        if let Some(success) = closing.control.finish_completion().claim_cleanup() {
            if !deletes.contains(&success.reference.artifact_id) {
                deletes.push(success.reference.artifact_id);
            }
        }

        let _artifact_guard = self.artifact_gate.lock().await;
        {
            let mut state = self.state.lock().await;
            for artifact_id in &deletes {
                state.artifacts.remove(artifact_id);
                state.read_proofs.remove(artifact_id);
            }
        }
        self.delete_artifacts(deletes).await;
        terminal_for_interruption(&closing.operation, closing.interruption);
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
        drop(_artifact_guard);
        closing.complete();
    }
}
