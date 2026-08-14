//! Sole natural-exit observer and parent-deadline flush for owned AnyHarness.

use std::sync::Arc;

use tokio::time::Duration;

use super::{persist_sidecar_runtime_info, RuntimeStatus, SharedSidecar, SidecarProcess};

const OBSERVATION_INTERVAL: Duration = Duration::from_millis(100);
const NATURAL_REAP_FENCE_TIMEOUT: Duration = Duration::from_millis(500);

pub(super) fn next_generation(current: u64) -> u64 {
    current.wrapping_add(1).max(1)
}

pub(super) fn generation_matches(expected: u64, current: u64) -> bool {
    expected == current
}

/// Installs exactly one generation-bound observer after healthy startup. The
/// task keeps only a `Weak` reference and can neither outlive nor replace the
/// identity-stable child owner held under the sidecar mutex.
pub(super) async fn start(sidecar: &SharedSidecar) {
    let mut guard = sidecar.lock().await;
    cancel_locked(&mut guard);
    if guard.child.is_none() {
        return;
    }
    guard.observer_generation = next_generation(guard.observer_generation);
    let generation = guard.observer_generation;
    let weak = Arc::downgrade(sidecar);
    guard.exit_observer = Some(tokio::spawn(async move {
        let mut ambiguity_reported = false;
        loop {
            tokio::time::sleep(OBSERVATION_INTERVAL).await;
            let Some(sidecar) = weak.upgrade() else {
                return;
            };
            let mut guard = sidecar.lock().await;
            if !generation_matches(generation, guard.observer_generation) {
                return;
            }
            let observation = match guard.child.as_mut() {
                Some(child) => child.try_wait(),
                None => return,
            };
            match observation {
                Ok(None) => {}
                Err(error) => {
                    if !ambiguity_reported {
                        tracing::warn!(
                            error = %error,
                            "AnyHarness natural-exit inspection is ambiguous; retaining owner"
                        );
                        ambiguity_reported = true;
                    }
                }
                Ok(Some(status)) => {
                    guard.exit_observer.take();
                    guard
                        .finish_diagnostics_reap(
                            status,
                            crate::diagnostics_collector::child_bridge::reap::ChildReapKind::Natural,
                            tokio::time::Instant::now() + NATURAL_REAP_FENCE_TIMEOUT,
                        )
                        .await;
                    guard.child = None;
                    guard.clear_diagnostics_bridge();
                    #[cfg(all(
                        target_os = "macos",
                        any(target_arch = "aarch64", target_arch = "x86_64")
                    ))]
                    sidecar.set_child_shutdown_signal(None);
                    guard.info.status = RuntimeStatus::Failed;
                    persist_sidecar_runtime_info(&guard, None);
                    tracing::warn!(%status, "AnyHarness exited after healthy startup");
                    return;
                }
            }
        }
    }));
}

pub(super) fn cancel_locked(process: &mut SidecarProcess) {
    if let Some(observer) = process.exit_observer.take() {
        observer.abort();
    }
}

/// Signals the owned child's shutdown descriptor and requests its diagnostics
/// flush with only the time remaining on the coordinator's one deadline.
#[cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
pub(crate) async fn flush_child_diagnostics(
    sidecar: &SharedSidecar,
    deadline: tokio::time::Instant,
) {
    let Ok(guard) = tokio::time::timeout_at(deadline, sidecar.lock()).await else {
        return;
    };
    let Some(bridge) = guard.diagnostics_bridge() else {
        return;
    };
    // Retry the idempotent signal from stable process ownership. This also
    // closes the narrow outer-slot handoff race without a fresh deadline.
    bridge.signal_shutdown();
    let _ = bridge.request_flush_until(deadline).await;
}

#[cfg(not(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
)))]
pub(crate) async fn flush_child_diagnostics(
    _sidecar: &SharedSidecar,
    _deadline: tokio::time::Instant,
) {
}
