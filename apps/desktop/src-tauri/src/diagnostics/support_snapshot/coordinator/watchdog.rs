use std::sync::Arc;

use tokio::time::Instant;

use crate::diagnostics_collector::producer::lifecycle::support_lifecycle::SupportSnapshotPreparationFailureClassificationV1 as Failure;

use super::super::artifact_store::SupportArtifactStore;
use super::control::{PreparationControl, PreparationInterruption};
use super::state::{ClosedPreparation, PreparationPhase};
use super::terminal::failed as terminal_failed;
use super::SupportSnapshotCoordinator;

pub(super) fn spawn_preparation_watchdog(
    coordinator: &Arc<SupportSnapshotCoordinator>,
    preparation_id: String,
    deadline: Instant,
    control: Arc<PreparationControl>,
) {
    let weak = Arc::downgrade(coordinator);
    let runtime = Arc::clone(&coordinator.runtime);
    let mut signal = control.subscribe();
    let work = control.begin_work();
    tokio::spawn(async move {
        let _work = work;
        if *signal.borrow() {
            return;
        }
        tokio::select! {
            _ = runtime.sleep_until(deadline) => {}
            changed = signal.changed() => {
                if changed.is_err() || *signal.borrow() {
                    return;
                }
                return;
            }
        }
        let Some(coordinator) = weak.upgrade() else {
            return;
        };
        let (operation, cleanup_artifact_id) = {
            let mut state = coordinator.state.lock().await;
            let Some(open) = state
                .preparation
                .as_ref()
                .filter(|open| open.preparation_id == preparation_id)
            else {
                return;
            };
            control.request(PreparationInterruption::Deadline);
            if control.interruption() != PreparationInterruption::Deadline {
                return;
            }
            let operation = Arc::clone(&open.operation);
            let phase = open.phase;
            let closed = ClosedPreparation {
                preparation_id: open.preparation_id.clone(),
                consent_epoch: open.input.consent_epoch.clone(),
                interruption: PreparationInterruption::Deadline,
            };
            let cleanup_artifact_id = (phase == PreparationPhase::Finishing)
                .then(|| SupportArtifactStore::artifact_id(&open.input.client_job_id).ok())
                .flatten();
            // Active invocation owners need the state slot to finish and drop
            // their fence guards. AwaitingFinish has no such owner.
            if phase == PreparationPhase::AwaitingFinish {
                state.preparation.take();
            }
            state.closed_preparation = Some(closed);
            (operation, cleanup_artifact_id)
        };

        // This task is itself part of the fence. Release that ownership before
        // waiting for capture/finish work, including a detached blocking
        // finisher, to become quiescent.
        drop(_work);
        control.wait_idle().await;
        {
            let mut state = coordinator.state.lock().await;
            let detached = state.preparation.as_ref().is_some_and(|open| {
                open.preparation_id == preparation_id && Arc::ptr_eq(&open.control, &control)
            });
            if detached {
                state.preparation.take();
            }
        }
        if let Some(success) = control.finish_completion().claim_cleanup() {
            let _artifact_guard = coordinator.artifact_gate.lock().await;
            coordinator
                .delete_artifacts(vec![success.reference.artifact_id])
                .await;
        } else if let Some(artifact_id) = cleanup_artifact_id {
            let _artifact_guard = coordinator.artifact_gate.lock().await;
            coordinator.delete_artifacts(vec![artifact_id]).await;
        }
        terminal_failed(&operation, Failure::PreparationTimeout);
    });
}
