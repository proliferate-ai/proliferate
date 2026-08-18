//! Portable, bounded sampling of the two Desktop-owned producer children.
//!
//! Native bridge types exist only on the two supported macOS targets.  This
//! adapter keeps that conditional state out of support assembly, maps it to a
//! closed availability result, and gives both children one joined absolute
//! 100 ms deadline. Unsupported targets return fixed omissions without
//! inspecting process state or fabricating a producer snapshot.

use chrono::{SecondsFormat, Utc};
use proliferate_diagnostics_client::ProducerStatusSnapshot;

use crate::{commands::cloud_worker::SharedCloudWorkerState, sidecar::SharedSidecar};

#[cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
use std::future::Future;

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
    ChildBridgeConnection, ChildProcessPresence, ChildProducerStatus, DesktopChildDiagnosticsState,
};
#[cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
use crate::commands::cloud_worker::state::DesktopWorkerDiagnosticsState;

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
    capture_native_child_statuses_with(
        deadline,
        |shared_deadline| async move {
            match tokio::time::timeout_at(shared_deadline, sidecar.lock()).await {
                Ok(mut owner) => Some(owner.child_diagnostics_state_until(shared_deadline).await),
                Err(_) => None,
            }
        },
        |shared_deadline| worker.child_diagnostics_state_until(shared_deadline),
    )
    .await
}

#[cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
async fn capture_native_child_statuses_with<
    AnyHarnessSampler,
    AnyHarnessFuture,
    WorkerSampler,
    WorkerFuture,
>(
    deadline: tokio::time::Instant,
    anyharness_sampler: AnyHarnessSampler,
    worker_sampler: WorkerSampler,
) -> NativeChildStatusCapture
where
    AnyHarnessSampler: FnOnce(tokio::time::Instant) -> AnyHarnessFuture,
    AnyHarnessFuture: Future<Output = Option<DesktopChildDiagnosticsState>>,
    WorkerSampler: FnOnce(tokio::time::Instant) -> WorkerFuture,
    WorkerFuture: Future<Output = DesktopWorkerDiagnosticsState>,
{
    let anyharness_capture = anyharness_sampler(deadline);
    let worker_capture = worker_sampler(deadline);
    let (anyharness, desktop_worker) = tokio::join!(anyharness_capture, worker_capture);
    NativeChildStatusCapture {
        anyharness: captured(
            anyharness
                .map(map_native_state)
                .unwrap_or_else(source_invalid),
        ),
        desktop_worker: {
            let state = desktop_worker;
            CapturedWorkerProducerStatus {
                target_id: state.target_id,
                producer: captured(map_native_state(state.child)),
            }
        },
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
        // Canonical fixed-millisecond UTC `Z` text: the support schema
        // validator rejects a `+00:00` offset spelling.
        captured_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
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
    match (state.process, state.bridge, state.producer) {
        (ChildProcessPresence::Invalid, _, _) | (_, _, ChildProducerStatus::Invalid) => {
            source_invalid()
        }
        (ChildProcessPresence::Missing | ChildProcessPresence::Exited, _, _) => {
            PortableChildProducerStatus::Omitted(ChildStatusOmission::ChildMissing)
        }
        (
            ChildProcessPresence::Running,
            ChildBridgeConnection::Connected,
            ChildProducerStatus::Available(snapshot),
        ) => PortableChildProducerStatus::Available(snapshot),
        (ChildProcessPresence::Running, _, ChildProducerStatus::Available(_))
        | (ChildProcessPresence::Running, _, ChildProducerStatus::Unavailable) => {
            PortableChildProducerStatus::Omitted(ChildStatusOmission::ProducerStatusUnavailable)
        }
    }
}

#[cfg(test)]
#[path = "child_status_tests.rs"]
mod tests;
