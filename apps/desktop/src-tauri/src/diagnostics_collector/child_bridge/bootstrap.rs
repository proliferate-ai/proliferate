#![cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]

//! Bootstrap frame construction and generation reacquisition for one child.
//!
//! Tauri holds no second token cache: every ready state a child sees is one
//! freshly consumed one-shot [`ProtectedChildHandoff`] verified against the
//! latest supervisor watch pair before its capability descriptor crosses the
//! bridge.

use std::{
    os::fd::AsRawFd,
    os::unix::net::UnixStream,
    sync::Arc,
    time::{Duration, Instant},
};

use proliferate_diagnostics_client::bridge::wire::{
    BootstrapCollectorState, BootstrapFallbackState, CapabilityFdRole,
    CollectorUnavailableClassification, FallbackFdRole, ParentFrame, CHILD_BOOTSTRAP_READ_DEADLINE,
    CHILD_BRIDGE_PROTOCOL_VERSION,
};
use tokio::sync::watch;

use super::{
    fallback_root::FallbackRootOutcome, identity::CollectorIdentity, runtime::BridgeShared,
};
use crate::diagnostics_collector::supervisor::{
    DesktopDiagnosticsSupervisorStateV1, DiagnosticsCollectorSupervisor, ProtectedChildHandoff,
    SupervisorUnavailable,
};

/// One acquired collector view for exactly one outgoing frame. The optional
/// capability channel is the verified one-shot handoff descriptor; dropping
/// it closes the transfer copy.
struct AcquiredCollectorState {
    state: BootstrapCollectorState,
    capability: Option<UnixStream>,
    unsupported: bool,
    /// The generation watch advanced while this view was being acquired; the
    /// caller discards it and converges directly to the newest value.
    stale: bool,
}

/// Maps only states that may participate in a supported bundled launch. An
/// `Unsupported` supervisor state disables protected activation at the owner
/// before descriptor creation and is never normalized into a bundled frame.
fn classification_for_state(
    state: &DesktopDiagnosticsSupervisorStateV1,
) -> Option<CollectorUnavailableClassification> {
    match state {
        DesktopDiagnosticsSupervisorStateV1::Starting { .. } => {
            Some(CollectorUnavailableClassification::Starting)
        }
        DesktopDiagnosticsSupervisorStateV1::Degraded { .. } => {
            Some(CollectorUnavailableClassification::Degraded)
        }
        DesktopDiagnosticsSupervisorStateV1::Stopped { .. } => {
            Some(CollectorUnavailableClassification::Stopped)
        }
        DesktopDiagnosticsSupervisorStateV1::Ready { .. } => {
            Some(CollectorUnavailableClassification::HandoffUnavailable)
        }
        DesktopDiagnosticsSupervisorStateV1::Unsupported { .. } => None,
    }
}

/// PR 3 `collector_replaced`, `collector_rejected`, `deadline_exceeded`, and
/// `protocol_error` all map to `handoff_unavailable`; their raw strings never
/// cross the bridge.
fn classification_for_unavailable(
    unavailable: SupervisorUnavailable,
) -> Option<CollectorUnavailableClassification> {
    match unavailable {
        SupervisorUnavailable::Unsupported => None,
        SupervisorUnavailable::Starting => Some(CollectorUnavailableClassification::Starting),
        SupervisorUnavailable::Degraded => Some(CollectorUnavailableClassification::Degraded),
        SupervisorUnavailable::Stopped => Some(CollectorUnavailableClassification::Stopped),
        SupervisorUnavailable::ShuttingDown => {
            Some(CollectorUnavailableClassification::ShuttingDown)
        }
        SupervisorUnavailable::Replaced
        | SupervisorUnavailable::CollectorRejected
        | SupervisorUnavailable::Deadline
        | SupervisorUnavailable::Protocol => {
            Some(CollectorUnavailableClassification::HandoffUnavailable)
        }
    }
}

fn handoff_matches_watch(
    handoff: &ProtectedChildHandoff,
    supervisor: &DiagnosticsCollectorSupervisor,
    generation: u64,
) -> bool {
    if handoff.generation != generation {
        return false;
    }
    match supervisor.state() {
        DesktopDiagnosticsSupervisorStateV1::Ready {
            collector_boot_id,
            schema_major,
            ..
        } => {
            handoff.descriptor.collector_boot_id == collector_boot_id
                && handoff.descriptor.schema_major == schema_major
        }
        _ => false,
    }
}

fn unavailable_state(
    generation: u64,
    classification: CollectorUnavailableClassification,
) -> BootstrapCollectorState {
    BootstrapCollectorState::Unavailable {
        generation,
        classification,
    }
}

/// Reads the latest watch pair and, when ready, consumes one one-shot
/// protected handoff, verifying its generation/boot/schema against the
/// latest watch state before it may be framed.
fn acquire_collector_state(
    supervisor: &DiagnosticsCollectorSupervisor,
    generation_rx: &mut watch::Receiver<u64>,
) -> AcquiredCollectorState {
    let generation = *generation_rx.borrow_and_update();
    let state = supervisor.state();
    let mut unsupported = matches!(
        &state,
        DesktopDiagnosticsSupervisorStateV1::Unsupported { .. }
    );
    let (state, capability) = if matches!(state, DesktopDiagnosticsSupervisorStateV1::Ready { .. })
    {
        match supervisor.protected_child_handoff() {
            Ok(handoff) if handoff_matches_watch(&handoff, supervisor, generation) => {
                let ProtectedChildHandoff {
                    descriptor,
                    inherited_channel,
                    generation,
                } = handoff;
                (
                    BootstrapCollectorState::Ready {
                        generation,
                        descriptor,
                        capability_fd_role: CapabilityFdRole::CollectorCapability,
                    },
                    Some(inherited_channel),
                )
            }
            // A mismatched handoff is stale authority: dropping it closes its
            // one-shot channel and the next watch change converges.
            Ok(_stale_handoff) => (
                unavailable_state(
                    generation,
                    CollectorUnavailableClassification::HandoffUnavailable,
                ),
                None,
            ),
            Err(unavailable) => match classification_for_unavailable(unavailable) {
                Some(classification) => (unavailable_state(generation, classification), None),
                None => {
                    // The supervisor crossed to Unsupported after the state
                    // snapshot. Preserve PR 3's Disabled/unprotected contract:
                    // this placeholder is never framed because callers reject
                    // the acquired view through `unsupported` below.
                    unsupported = true;
                    (
                        unavailable_state(
                            generation,
                            CollectorUnavailableClassification::HandoffUnavailable,
                        ),
                        None,
                    )
                }
            },
        }
    } else {
        let classification = classification_for_state(&state)
            .unwrap_or(CollectorUnavailableClassification::HandoffUnavailable);
        (unavailable_state(generation, classification), None)
    };
    let stale = generation_rx.has_changed().unwrap_or(false);
    AcquiredCollectorState {
        state,
        capability,
        unsupported,
        stale,
    }
}

/// Sends the single bootstrap frame. Collector and fallback availability are
/// independent; the child consumes `SCM_RIGHTS` in frame order — capability
/// first when the collector is ready, then the fallback directory when
/// available. Transfer copies close when this function returns, whether the
/// send succeeded or failed. A stale acquisition is still a valid bootstrap:
/// the generation task converges immediately after with a strictly newer
/// frame the child cannot confuse for this one.
pub(super) fn send_bootstrap(
    shared: &Arc<BridgeShared>,
    supervisor: &DiagnosticsCollectorSupervisor,
    generation_rx: &mut watch::Receiver<u64>,
    fallback: FallbackRootOutcome,
) {
    let acquired = acquire_collector_state(supervisor, generation_rx);
    if acquired.unsupported {
        shared.mark_lost();
        return;
    }
    let (fallback_state, fallback_descriptor) = match fallback {
        FallbackRootOutcome::Available(descriptor) => (
            BootstrapFallbackState::Available {
                fd_role: FallbackFdRole::DiagnosticsFallbackDirectory,
            },
            Some(descriptor),
        ),
        FallbackRootOutcome::Unavailable(classification) => {
            (BootstrapFallbackState::Unavailable { classification }, None)
        }
    };
    let Some(identity) = CollectorIdentity::from_bootstrap(&acquired.state) else {
        shared.mark_lost();
        return;
    };
    let frame = ParentFrame::Bootstrap {
        protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
        component: shared.component(),
        initial_state: acquired.state,
        fallback_state,
    };
    let mut descriptors = Vec::with_capacity(2);
    if let Some(capability) = &acquired.capability {
        descriptors.push(capability.as_raw_fd());
    }
    if let Some(fallback_descriptor) = &fallback_descriptor {
        descriptors.push(fallback_descriptor.as_raw_fd());
    }
    let deadline = Instant::now() + CHILD_BOOTSTRAP_READ_DEADLINE;
    let Ok(_transaction) = shared.lock_transaction_until(deadline) else {
        shared.mark_lost();
        return;
    };
    if shared.publish_collector_until(identity, deadline).is_err() {
        shared.mark_lost();
        return;
    }
    let _ = shared.send_until(&frame, &descriptors, deadline);
}

/// Drives generation invalidation and reacquisition. On every generation
/// watch change the prior child generation is treated as invalid, the latest
/// supervisor state is read, and exactly one converged frame is sent. The
/// watch is latest-value state, not an event queue: work made stale by a
/// further change is discarded (closing the stale one-shot handoff) before
/// anything crosses the bridge.
pub(super) async fn run_generation_task(
    shared: Arc<BridgeShared>,
    supervisor: Arc<DiagnosticsCollectorSupervisor>,
    mut generation_rx: watch::Receiver<u64>,
) {
    loop {
        if generation_rx.changed().await.is_err() {
            return;
        }
        loop {
            let acquired = acquire_collector_state(&supervisor, &mut generation_rx);
            if acquired.stale {
                continue;
            }
            if acquired.unsupported {
                shared.mark_lost();
                return;
            }
            let Some(identity) = CollectorIdentity::from_bootstrap(&acquired.state) else {
                shared.mark_lost();
                return;
            };
            let frame = match acquired.state {
                BootstrapCollectorState::Ready {
                    generation,
                    descriptor,
                    capability_fd_role,
                } => ParentFrame::GenerationReady {
                    protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
                    generation,
                    descriptor,
                    capability_fd_role,
                },
                BootstrapCollectorState::Unavailable {
                    generation,
                    classification,
                } => ParentFrame::GenerationUnavailable {
                    protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
                    generation,
                    classification,
                },
            };
            let mut descriptors = Vec::with_capacity(1);
            if let Some(capability) = &acquired.capability {
                descriptors.push(capability.as_raw_fd());
            }
            let deadline = Instant::now() + Duration::from_millis(100);
            let Ok(_transaction) = shared.lock_transaction_until(deadline) else {
                shared.mark_lost();
                return;
            };
            if shared.publish_collector_until(identity, deadline).is_err() {
                shared.mark_lost();
                return;
            }
            if shared.send_until(&frame, &descriptors, deadline).is_err() {
                return;
            }
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{classification_for_unavailable, SupervisorUnavailable};

    #[test]
    fn unsupported_has_no_bundled_unavailable_classification() {
        assert!(classification_for_unavailable(SupervisorUnavailable::Unsupported).is_none());
    }
}
