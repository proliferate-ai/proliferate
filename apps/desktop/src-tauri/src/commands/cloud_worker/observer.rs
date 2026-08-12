//! The one continuous, identity-stable natural-exit observer per owned Worker.

use std::sync::Arc;

use tokio::time::{Duration, Instant};

use super::{CloudWorkerLifecycle, SharedCloudWorkerState};

const OBSERVATION_INTERVAL: Duration = Duration::from_millis(100);
const NATURAL_REAP_FENCE_TIMEOUT: Duration = Duration::from_millis(500);

pub(super) fn next_generation(current: u64) -> u64 {
    current.wrapping_add(1).max(1)
}

pub(super) fn generation_matches(expected: u64, process_generation: u64) -> bool {
    expected == process_generation
}

/// Installs exactly one observer for the current process. The task retains
/// only a `Weak` state reference; lifecycle ownership stays in the mutex, and
/// the generation token makes an old task inert after replacement.
pub(super) fn start(state: &SharedCloudWorkerState, lifecycle: &mut CloudWorkerLifecycle) {
    cancel(lifecycle);
    if lifecycle.process.is_none() {
        return;
    }
    lifecycle.observer_generation = next_generation(lifecycle.observer_generation);
    let generation = lifecycle.observer_generation;
    lifecycle
        .process
        .as_mut()
        .expect("process presence checked")
        .observer_generation = generation;
    let weak = Arc::downgrade(state);
    lifecycle.exit_observer = Some(tokio::spawn(async move {
        let mut ambiguity_reported = false;
        loop {
            tokio::time::sleep(OBSERVATION_INTERVAL).await;
            let Some(state) = weak.upgrade() else {
                return;
            };
            let mut lifecycle = state.lifecycle.lock().await;
            let observation = match lifecycle.process.as_mut() {
                Some(process) if generation_matches(generation, process.observer_generation) => {
                    process.child.try_wait()
                }
                _ => return,
            };
            match observation {
                Ok(None) => {}
                Err(error) => {
                    // Ambiguity never releases or kills the identity-stable
                    // owner. Continue through the same sole observer instead
                    // of adding a competing waiter.
                    if !ambiguity_reported {
                        tracing::warn!(
                            error = %error,
                            "Worker natural-exit inspection is ambiguous; retaining owner"
                        );
                        ambiguity_reported = true;
                    }
                }
                Ok(Some(status)) => {
                    lifecycle.exit_observer.take();
                    let deadline = Instant::now() + NATURAL_REAP_FENCE_TIMEOUT;
                    let process = lifecycle
                        .process
                        .as_mut()
                        .expect("observer generation was validated");
                    process
                        .finish_verified_reap(
                            status,
                            crate::diagnostics_collector::child_bridge::reap::ChildReapKind::Natural,
                            deadline,
                        )
                        .await;
                    lifecycle.process = None;
                    return;
                }
            }
        }
    }));
}

/// Explicit stop/restart owns the same lifecycle mutex before cancelling, so
/// the observer can never be inside a competing `try_wait` or reap operation.
pub(super) fn cancel(lifecycle: &mut CloudWorkerLifecycle) {
    if let Some(observer) = lifecycle.exit_observer.take() {
        observer.abort();
    }
}
