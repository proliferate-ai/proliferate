use std::collections::VecDeque;
use std::fmt;
use std::io::Write;
use std::os::fd::AsRawFd;
use std::os::unix::net::UnixStream as StdUnixStream;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use proliferate_diagnostics_protocol::v1::limits::CURRENT_SCHEMA_VERSION;
use proliferate_diagnostics_protocol::v1::types::{
    ConnectionDescriptorV1, ExportRequestV1, ExportStreamFrameV1, FallbackHealthV1,
    HealthResponseV1, HealthStatusV1, IngestBatchV1, IngestReceiptV1, ProtectedTokenReferenceV1,
    RecordsPageV1, RecordsQueryV1, SourceV1, TailFrameV1, TerminalOutcomeV1, TokenReferenceKindV1,
};
use proliferate_diagnostics_protocol::v1::validation::{
    parse_ingest_batch_value, validate_ingest_receipt,
};
use serde::{Deserialize, Serialize};
use tokio::sync::{watch, Mutex as AsyncMutex};

use super::export_admission::ExportAdmission;

use terminal_control::TerminalControlState;

use super::artifact::DiagnosticsArtifactKind;
use super::client::{
    contextualize_export_frame, contextualize_health, CollectorClientError, CollectorHttpClient,
    CollectorJsonLineStream,
};
use super::fallback::FallbackDiagnosticsWriter;
use super::process::{
    CollectorLaunchError, CollectorLaunchErrorKind, CollectorProcessLauncher,
    CollectorShutdownOutcome, OwnedCollectorProcess, RetainedLaunchChild,
};
use super::producer::{TauriDiagnosticsProducer, PRODUCER_DRAIN_TIMEOUT};

pub(crate) const STEADY_HEALTH_INTERVAL: Duration = Duration::from_secs(2);
pub(crate) const HEALTH_FAILURE_THRESHOLD: u8 = 3;
pub(crate) const AUTOMATIC_RESTART_DELAYS: [Duration; 3] = [
    Duration::from_millis(250),
    Duration::from_secs(1),
    Duration::from_secs(4),
];
pub(crate) const RESTART_BUDGET_WINDOW: Duration = Duration::from_secs(60);
pub(crate) const HEALTHY_BUDGET_RESET_AFTER: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CollectorLaunchKindV1 {
    Initial,
    AutomaticRestart,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum DesktopDiagnosticsSupervisorStateV1 {
    Unsupported {
        classification: String,
    },
    Starting {
        launch_kind: CollectorLaunchKindV1,
        attempt: u8,
        restart_count: u64,
    },
    Ready {
        collector_boot_id: String,
        schema_major: u16,
        restart_count: u64,
    },
    Degraded {
        classification: String,
        restart_count: u64,
        retry_exhausted: bool,
    },
    Stopped {
        orderly: bool,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopDiagnosticsHealthV1 {
    pub supervisor: DesktopDiagnosticsSupervisorStateV1,
    pub fallback: FallbackHealthV1,
    pub collector: Option<HealthResponseV1>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum StartupBarrierResult {
    Pending,
    Ready,
    Degraded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SupervisorUnavailable {
    Starting,
    Unsupported,
    Degraded,
    Stopped,
    Replaced,
    ShuttingDown,
    CollectorRejected,
    Deadline,
    Protocol,
}

impl SupervisorUnavailable {
    pub(crate) const fn classification(self) -> &'static str {
        match self {
            Self::Starting => "collector_starting",
            Self::Unsupported => "collector_unsupported",
            Self::Degraded => "collector_degraded",
            Self::Stopped => "collector_stopped",
            Self::Replaced => "collector_replaced",
            Self::ShuttingDown => "broker_shutting_down",
            Self::CollectorRejected => "collector_rejected",
            Self::Deadline => "deadline_exceeded",
            Self::Protocol => "protocol_error",
        }
    }
}

#[derive(Clone)]
pub(crate) struct ReadyCollectorGeneration {
    pub(crate) generation: u64,
    pub(crate) client: Arc<CollectorHttpClient>,
    pub(crate) collector_boot_id: String,
    pub(crate) restart_count: u64,
}

impl fmt::Debug for ReadyCollectorGeneration {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ReadyCollectorGeneration")
            .field("generation", &self.generation)
            .field("collector_boot_id", &self.collector_boot_id)
            .field("restart_count", &self.restart_count)
            .finish_non_exhaustive()
    }
}

pub(crate) struct ProtectedChildHandoff {
    pub(crate) descriptor: ConnectionDescriptorV1,
    pub(crate) inherited_channel: StdUnixStream,
    pub(crate) generation: u64,
}

impl fmt::Debug for ProtectedChildHandoff {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ProtectedChildHandoff")
            .field("collector_boot_id", &self.descriptor.collector_boot_id)
            .field("schema_major", &self.descriptor.schema_major)
            .field("generation", &self.generation)
            .finish_non_exhaustive()
    }
}

pub(crate) struct SupervisorTailLease {
    pub(crate) generation: u64,
    pub(crate) stream: CollectorJsonLineStream<TailFrameV1>,
    pub(crate) generation_changed: watch::Receiver<u64>,
    pub(crate) shutdown: watch::Receiver<bool>,
}

pub(crate) struct SupervisorExportLease {
    pub(crate) generation: u64,
    pub(crate) collector_boot_id: String,
    pub(crate) restart_count: u64,
    pub(crate) stream: CollectorJsonLineStream<ExportStreamFrameV1>,
    pub(crate) generation_changed: watch::Receiver<u64>,
    pub(crate) shutdown: watch::Receiver<bool>,
}

/// Everything an externally launched AnyHarness needs to reach this
/// collector without an inherited bridge descriptor. Dev builds only; see
/// `sidecar::diagnostics::publish_dev_diagnostics_env`.
#[cfg(debug_assertions)]
pub(crate) struct DevCollectorEnv {
    pub(crate) endpoint: String,
    pub(crate) capability: String,
    pub(crate) collector_boot_id: String,
}

pub(crate) struct DiagnosticsCollectorSupervisor {
    inner: Mutex<SupervisorInner>,
    decisions: AsyncMutex<()>,
    launcher: Result<CollectorProcessLauncher, CollectorLaunchError>,
    producer: TauriDiagnosticsProducer,
    fallback: FallbackDiagnosticsWriter,
    state_tx: watch::Sender<DesktopDiagnosticsSupervisorStateV1>,
    startup_tx: watch::Sender<StartupBarrierResult>,
    generation_tx: watch::Sender<u64>,
    shutdown_tx: watch::Sender<bool>,
    export_admission: Arc<ExportAdmission>,
    shutdown_armed: AtomicBool,
    terminal_control: TerminalControlState,
}

struct SupervisorInner {
    process: Option<OwnedCollectorProcess>,
    retained_launch: Option<RetainedLaunchChild>,
    state: DesktopDiagnosticsSupervisorStateV1,
    generation: u64,
    restart_count: u64,
    restart_attempts: VecDeque<Instant>,
    ready_since: Option<Instant>,
}

impl fmt::Debug for DiagnosticsCollectorSupervisor {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DiagnosticsCollectorSupervisor")
            .field("state", &self.state())
            .field(
                "shutdown_armed",
                &self.shutdown_armed.load(Ordering::Acquire),
            )
            .finish()
    }
}

#[path = "supervisor/death_certificate.rs"]
mod death_certificate;
#[path = "supervisor/initialization.rs"]
mod initialization;
#[path = "supervisor/lifecycle.rs"]
mod lifecycle;
#[path = "supervisor/queries.rs"]
mod queries;
#[path = "supervisor/terminal_control.rs"]
mod terminal_control;

pub(crate) use terminal_control::{TerminalControlOutcome, TerminalProducerSlot};

fn accept_restart_budget_at(inner: &mut SupervisorInner, now: Instant) -> bool {
    while inner
        .restart_attempts
        .front()
        .is_some_and(|at| now.duration_since(*at) >= RESTART_BUDGET_WINDOW)
    {
        inner.restart_attempts.pop_front();
    }
    if inner.restart_attempts.len() >= AUTOMATIC_RESTART_DELAYS.len() {
        return false;
    }
    inner.restart_attempts.push_back(now);
    inner.restart_count = inner.restart_count.saturating_add(1);
    true
}

fn reset_restart_budget_after_health(inner: &mut SupervisorInner, now: Instant) {
    if inner
        .ready_since
        .is_some_and(|ready| now.duration_since(ready) >= HEALTHY_BUDGET_RESET_AFTER)
    {
        inner.restart_attempts.clear();
        inner.ready_since = Some(now);
    }
}

fn validate_renderer_ingest_batch(batch: &IngestBatchV1) -> Result<(), SupervisorUnavailable> {
    // `specs/systems/desktop-host/desktop-native.md` promises *exact* schema-v1.1 for renderer batches, but
    // `parse_ingest_batch_value` only enforces the compatible producer-minor window, so it
    // admits 1.0 as well. Until now the exactness check lived solely in the renderer
    // (`apps/desktop/src/lib/access/tauri/diagnostics.ts`) — the party `require_main_window`
    // exists to distrust. Pin it here too, against the protocol version this binary was
    // compiled with, so a protocol bump fails loudly instead of silently widening what the
    // trust boundary accepts. The renderer twin must be bumped in lockstep.
    if batch.schema_version != CURRENT_SCHEMA_VERSION
        || batch.records.is_empty()
        || batch.records.iter().any(|record| {
            record.schema_version != CURRENT_SCHEMA_VERSION
                || record.component
                    != proliferate_diagnostics_protocol::v1::types::ComponentV1::DesktopRenderer
                || record.source != SourceV1::Renderer
        })
    {
        return Err(SupervisorUnavailable::CollectorRejected);
    }
    let value = serde_json::to_value(batch).map_err(|_| SupervisorUnavailable::Protocol)?;
    parse_ingest_batch_value(&value).map_err(|_| SupervisorUnavailable::CollectorRejected)?;
    Ok(())
}

fn validate_renderer_ingest_receipt(
    receipt: &IngestReceiptV1,
    expected_collector_boot_id: &str,
) -> Result<(), SupervisorUnavailable> {
    validate_ingest_receipt(receipt).map_err(|_| SupervisorUnavailable::Protocol)?;
    if receipt.collector_boot_id.as_str() != expected_collector_boot_id {
        return Err(SupervisorUnavailable::Protocol);
    }
    Ok(())
}

fn retryable(kind: CollectorLaunchErrorKind) -> bool {
    matches!(
        kind,
        CollectorLaunchErrorKind::SpawnFailed
            | CollectorLaunchErrorKind::EndpointUnavailable
            | CollectorLaunchErrorKind::ReadinessTimeout
            | CollectorLaunchErrorKind::ChildExited
    )
}

fn classification_for_launch_error(kind: CollectorLaunchErrorKind) -> &'static str {
    match kind {
        CollectorLaunchErrorKind::UnsupportedTarget => "unsupported_target",
        CollectorLaunchErrorKind::BinaryMissing => "binary_missing",
        CollectorLaunchErrorKind::BinaryInvalid => "binary_invalid",
        CollectorLaunchErrorKind::SpawnFailed => "spawn_failed",
        CollectorLaunchErrorKind::EndpointUnavailable => "endpoint_unavailable",
        CollectorLaunchErrorKind::ReadinessTimeout => "readiness_timeout",
        CollectorLaunchErrorKind::AuthenticationFailed => "authentication_failed",
        CollectorLaunchErrorKind::SchemaIncompatible => "schema_incompatible",
        CollectorLaunchErrorKind::BootIdMismatch => "boot_id_mismatch",
        CollectorLaunchErrorKind::ChildExited => "child_exited",
        CollectorLaunchErrorKind::ChildInspectionFailed => "child_inspection_failed",
    }
}

fn unavailable_for_state(state: &DesktopDiagnosticsSupervisorStateV1) -> SupervisorUnavailable {
    match state {
        DesktopDiagnosticsSupervisorStateV1::Starting { .. } => SupervisorUnavailable::Starting,
        DesktopDiagnosticsSupervisorStateV1::Unsupported { .. } => {
            SupervisorUnavailable::Unsupported
        }
        DesktopDiagnosticsSupervisorStateV1::Degraded { .. } => SupervisorUnavailable::Degraded,
        DesktopDiagnosticsSupervisorStateV1::Stopped { .. } => SupervisorUnavailable::Stopped,
        DesktopDiagnosticsSupervisorStateV1::Ready { .. } => SupervisorUnavailable::Protocol,
    }
}

fn map_client_error(error: CollectorClientError) -> SupervisorUnavailable {
    match error {
        CollectorClientError::Authentication | CollectorClientError::Rejected => {
            SupervisorUnavailable::CollectorRejected
        }
        CollectorClientError::Deadline => SupervisorUnavailable::Deadline,
        CollectorClientError::Protocol => SupervisorUnavailable::Protocol,
        CollectorClientError::Unavailable => SupervisorUnavailable::Degraded,
    }
}

fn set_cloexec(fd: std::os::fd::RawFd) -> std::io::Result<()> {
    // SAFETY: fcntl changes only the supplied owned descriptor.
    unsafe {
        let flags = libc::fcntl(fd, libc::F_GETFD);
        if flags < 0 || libc::fcntl(fd, libc::F_SETFD, flags | libc::FD_CLOEXEC) < 0 {
            return Err(std::io::Error::last_os_error());
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "supervisor_recovery_tests.rs"]
mod recovery_tests;
#[cfg(test)]
#[path = "supervisor_tests.rs"]
mod tests;
