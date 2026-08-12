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

use std::{os::fd::AsRawFd, os::unix::net::UnixStream, sync::Arc};

use proliferate_diagnostics_client::bridge::wire::{
    BootstrapCollectorState, BootstrapFallbackState, CapabilityFdRole,
    CollectorUnavailableClassification, FallbackFdRole, ParentFrame, CHILD_BRIDGE_PROTOCOL_VERSION,
};
use tokio::sync::watch;

use super::{fallback_root::FallbackRootOutcome, runtime::BridgeShared};
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
    /// The generation watch advanced while this view was being acquired; the
    /// caller discards it and converges directly to the newest value.
    stale: bool,
}

/// PR 3 states map onto the closed wire vocabulary. `unsupported` never
/// enters a bundled frame: a bundled bridge cannot exist on an unsupported
/// target, so observing it fails closed to `handoff_unavailable`. A `Ready`
/// state reaching this mapping means the ready handoff itself was not usable.
fn classification_for_state(
    state: &DesktopDiagnosticsSupervisorStateV1,
) -> CollectorUnavailableClassification {
    match state {
        DesktopDiagnosticsSupervisorStateV1::Starting { .. } => {
            CollectorUnavailableClassification::Starting
        }
        DesktopDiagnosticsSupervisorStateV1::Degraded { .. } => {
            CollectorUnavailableClassification::Degraded
        }
        DesktopDiagnosticsSupervisorStateV1::Stopped { .. } => {
            CollectorUnavailableClassification::Stopped
        }
        DesktopDiagnosticsSupervisorStateV1::Ready { .. }
        | DesktopDiagnosticsSupervisorStateV1::Unsupported { .. } => {
            CollectorUnavailableClassification::HandoffUnavailable
        }
    }
}

/// PR 3 `collector_replaced`, `collector_rejected`, `deadline_exceeded`, and
/// `protocol_error` all map to `handoff_unavailable`; their raw strings never
/// cross the bridge.
fn classification_for_unavailable(
    unavailable: SupervisorUnavailable,
) -> CollectorUnavailableClassification {
    match unavailable {
        SupervisorUnavailable::Starting => CollectorUnavailableClassification::Starting,
        SupervisorUnavailable::Degraded => CollectorUnavailableClassification::Degraded,
        SupervisorUnavailable::Stopped => CollectorUnavailableClassification::Stopped,
        SupervisorUnavailable::ShuttingDown => CollectorUnavailableClassification::ShuttingDown,
        SupervisorUnavailable::Unsupported
        | SupervisorUnavailable::Replaced
        | SupervisorUnavailable::CollectorRejected
        | SupervisorUnavailable::Deadline
        | SupervisorUnavailable::Protocol => CollectorUnavailableClassification::HandoffUnavailable,
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
            Err(unavailable) => (
                unavailable_state(generation, classification_for_unavailable(unavailable)),
                None,
            ),
        }
    } else {
        (
            unavailable_state(generation, classification_for_state(&state)),
            None,
        )
    };
    let stale = generation_rx.has_changed().unwrap_or(false);
    AcquiredCollectorState {
        state,
        capability,
        stale,
    }
}

fn frame_generation(state: &BootstrapCollectorState) -> u64 {
    match state {
        BootstrapCollectorState::Ready { generation, .. }
        | BootstrapCollectorState::Unavailable { generation, .. } => *generation,
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
    let generation = frame_generation(&acquired.state);
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
    shared.set_current_generation(generation);
    let _ = shared.send(&frame, &descriptors);
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
            let generation = frame_generation(&acquired.state);
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
            shared.set_current_generation(generation);
            if shared.send(&frame, &descriptors).is_err() {
                return;
            }
            break;
        }
    }
}
