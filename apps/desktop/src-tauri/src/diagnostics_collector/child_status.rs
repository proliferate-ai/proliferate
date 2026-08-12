//! Portable, bounded sampling of the two Desktop-owned producer children.
//!
//! Native bridge types exist only on the two supported macOS targets.  This
//! adapter keeps that conditional state out of support assembly, maps it to a
//! closed availability result, and gives both children one joined absolute
//! 100 ms deadline. Unsupported targets return fixed omissions without
//! inspecting process state or fabricating a producer snapshot.

use chrono::Utc;
use proliferate_diagnostics_client::ProducerStatusSnapshot;

use crate::{commands::cloud_worker::SharedCloudWorkerState, sidecar::SharedSidecar};

#[cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
use proliferate_diagnostics_client::bridge::wire::CHILD_STATUS_RESPONSE_DEADLINE;

#[cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
use super::child_bridge::runtime::{
    ChildProcessPresence, ChildProducerStatus, DesktopChildDiagnosticsState,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ChildStatusOmission {
    ProducerStatusUnavailable,
    ChildMissing,
    SourceInvalid,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum PortableChildProducerStatus {
    Available(ProducerStatusSnapshot),
    Omitted(ChildStatusOmission),
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct CapturedChildProducerStatus {
    pub(crate) captured_at: String,
    pub(crate) status: PortableChildProducerStatus,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct CapturedWorkerProducerStatus {
    pub(crate) target_id: Option<String>,
    pub(crate) producer: CapturedChildProducerStatus,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct NativeChildStatusCapture {
    pub(crate) anyharness: CapturedChildProducerStatus,
    pub(crate) desktop_worker: CapturedWorkerProducerStatus,
}

/// Samples AnyHarness and Worker concurrently. Both lock acquisition and
/// protected status RPCs consume the same absolute deadline.
#[cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
pub(crate) async fn capture_native_child_statuses(
    sidecar: &SharedSidecar,
    worker: &SharedCloudWorkerState,
) -> NativeChildStatusCapture {
    let deadline = tokio::time::Instant::now() + CHILD_STATUS_RESPONSE_DEADLINE;
    let anyharness_capture = async {
        let state = match tokio::time::timeout_at(deadline, sidecar.lock()).await {
            Ok(mut owner) => Some(owner.child_diagnostics_state_until(deadline).await),
            Err(_) => None,
        };
        captured(state.map(map_native_state).unwrap_or_else(source_invalid))
    };
    let worker_capture = async {
        let state = worker.child_diagnostics_state_until(deadline).await;
        CapturedWorkerProducerStatus {
            target_id: state.target_id,
            producer: captured(map_native_state(state.child)),
        }
    };
    let (anyharness, desktop_worker) = tokio::join!(anyharness_capture, worker_capture);
    NativeChildStatusCapture {
        anyharness,
        desktop_worker,
    }
}

/// Unsupported targets have no protected bridge authority. Do not inspect a
/// legacy/unprotected child and imply that it produced a PR 5 status snapshot.
#[cfg(not(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
)))]
pub(crate) async fn capture_native_child_statuses(
    _sidecar: &SharedSidecar,
    _worker: &SharedCloudWorkerState,
) -> NativeChildStatusCapture {
    unsupported_capture()
}

fn captured(status: PortableChildProducerStatus) -> CapturedChildProducerStatus {
    CapturedChildProducerStatus {
        captured_at: Utc::now().to_rfc3339(),
        status,
    }
}

fn source_invalid() -> PortableChildProducerStatus {
    PortableChildProducerStatus::Omitted(ChildStatusOmission::SourceInvalid)
}

fn unsupported_capture() -> NativeChildStatusCapture {
    NativeChildStatusCapture {
        anyharness: captured(PortableChildProducerStatus::Omitted(
            ChildStatusOmission::ProducerStatusUnavailable,
        )),
        desktop_worker: CapturedWorkerProducerStatus {
            target_id: None,
            producer: captured(PortableChildProducerStatus::Omitted(
                ChildStatusOmission::ProducerStatusUnavailable,
            )),
        },
    }
}

#[cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
fn map_native_state(state: DesktopChildDiagnosticsState) -> PortableChildProducerStatus {
    match (state.process, state.producer) {
        (ChildProcessPresence::Invalid, _) | (_, ChildProducerStatus::Invalid) => source_invalid(),
        (ChildProcessPresence::Missing | ChildProcessPresence::Exited, _) => {
            PortableChildProducerStatus::Omitted(ChildStatusOmission::ChildMissing)
        }
        (ChildProcessPresence::Running, ChildProducerStatus::Available(snapshot)) => {
            PortableChildProducerStatus::Available(snapshot)
        }
        (ChildProcessPresence::Running, ChildProducerStatus::Unavailable) => {
            PortableChildProducerStatus::Omitted(ChildStatusOmission::ProducerStatusUnavailable)
        }
    }
}

#[cfg(test)]
#[path = "child_status_tests.rs"]
mod tests;
