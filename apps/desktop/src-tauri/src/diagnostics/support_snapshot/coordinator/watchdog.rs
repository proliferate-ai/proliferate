use std::sync::Arc;

use tokio::time::Instant;

use super::control::{PreparationControl, PreparationInterruption};
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
        if control.watchdog_stopped() {
            return;
        }
        if control.interruption() == PreparationInterruption::Running {
            tokio::select! {
                _ = runtime.watchdog_sleep_until(deadline) => {}
                changed = signal.changed() => {
                    if changed.is_err() {
                        return;
                    }
                }
            }
        }
        if control.watchdog_stopped() {
            return;
        }
        let Some(coordinator) = weak.upgrade() else {
            return;
        };
        let closing = {
            let mut state = coordinator.state.lock().await;
            if state
                .preparation
                .as_ref()
                .is_some_and(|open| open.preparation_id == preparation_id)
            {
                if runtime.instant_now() >= deadline {
                    control.request(PreparationInterruption::Deadline);
                }
                if control.interruption() == PreparationInterruption::Running {
                    None
                } else {
                    state.transfer_preparation_to_closing(&preparation_id)
                }
            } else {
                state
                    .closing_preparation
                    .as_ref()
                    .filter(|closing| closing.preparation_id == preparation_id)
                    .cloned()
            }
        };
        let Some(closing) = closing else {
            return;
        };
        // A closing owner cannot wait on a fence while retaining this
        // watchdog's own work guard.
        drop(work);
        coordinator.spawn_closing_owner(closing);
    });
}
