use std::future::Future;
use std::sync::Arc;

use proliferate_diagnostics_client::{
    ProducerCollectorState, ProducerFailureClassification, ProducerStatusSnapshot,
};
use proliferate_diagnostics_protocol::v1::types::CollectorAcceptedRecordV1;
use proliferate_diagnostics_protocol::v1::types::ComponentV1;
use tokio::time::Instant;

use crate::commands::cloud_worker::SharedCloudWorkerState;
use crate::diagnostics_collector::child_bridge::support_evidence::{
    collect_finite_evidence_guarded, EvidenceCaptureGuard, EvidenceCaptureInterrupted,
    FiniteEvidenceCapture, FiniteEvidenceRoots,
};
use crate::diagnostics_collector::child_status::{
    capture_native_child_statuses, CapturedChildProducerStatus, ChildStatusOmission,
    NativeChildStatusCapture, PortableChildProducerStatus,
};
use crate::diagnostics_collector::supervisor::{
    CollectorLaunchKindV1, DesktopDiagnosticsHealthV1 as NativeDesktopHealth,
    DesktopDiagnosticsSupervisorStateV1 as NativeSupervisorState, DiagnosticsCollectorSupervisor,
};
use crate::diagnostics_collector::support_export::{
    issue_support_export_for_coordinator, SupportExportError, SupportExportIssuanceError,
    ValidatedSupportExport,
};
use crate::sidecar::SharedSidecar;

use super::super::schema::enums::{
    DesktopDiagnosticsFailureClassV1, SupportChildComponentV1, SupportChildOmissionReasonV1,
    SupportCollectorCompletenessV1, SupportCollectorStatusV1, SupportCoverageSelectionV1,
    SupportLaunchKindV1, SupportLossReasonV1, SupportProducerStatusUnavailableV1,
};
use super::super::schema::model::evidence::{
    SupportCollectorCoverageV1, SupportCollectorEvidenceV1,
};
use super::super::schema::model::health::{
    DesktopDiagnosticsHealthV1, DesktopDiagnosticsSupervisorStateV1, SupportChildCollectorStateV1,
    SupportChildProducerSnapshotV1, SupportChildProducerStatusV1, SupportLossCountsV1,
    SupportOmittedProducerStatusV1, SupportProducerHealthV1, SupportTauriProducerHealthV1,
};
use super::control::{PreparationControl, PreparationInterruption};
use super::runtime::CoordinatorRuntime;

pub(crate) struct CapturedNativeSupportEvidence {
    pub collector: SupportCollectorEvidenceV1,
    pub collector_records: Vec<CollectorAcceptedRecordV1>,
    pub producer_health: SupportProducerHealthV1,
    pub files: FiniteEvidenceCapture,
}

pub(super) async fn capture_native_support_evidence(
    supervisor: Arc<DiagnosticsCollectorSupervisor>,
    sidecar: SharedSidecar,
    worker: SharedCloudWorkerState,
    preparation_id: &str,
    source_time_from: &str,
    source_time_to: &str,
    deadline: Instant,
    control: Arc<PreparationControl>,
    runtime: Arc<dyn CoordinatorRuntime>,
) -> Result<CapturedNativeSupportEvidence, CaptureError> {
    if let Some(error) = capture_interruption(&control, runtime.as_ref(), deadline) {
        return Err(error);
    }
    let logs_dir = crate::app_config::logs_dir_path().map_err(|_| CaptureError::Invalid)?;
    let app_dir = crate::app_config::app_dir_path().map_err(|_| CaptureError::Invalid)?;
    let runtime_home = crate::app_config::anyharness_runtime_home_path().ok();
    let worker_target_ids = worker
        .support_evidence_target_id()
        .into_iter()
        .collect::<Vec<_>>();
    if let Some(error) = capture_interruption(&control, runtime.as_ref(), deadline) {
        return Err(error);
    }
    let roots = FiniteEvidenceRoots::new(
        &logs_dir,
        runtime_home.as_deref(),
        &app_dir,
        &worker_target_ids,
    );
    let invocation = issue_support_export_for_coordinator(
        preparation_id,
        source_time_from.to_owned(),
        source_time_to.to_owned(),
        deadline,
    )
    .map_err(CaptureError::Issuance)?;
    let export_supervisor = Arc::clone(&supervisor);
    let export_cancellation = control.subscribe();
    let export_work = control.begin_work();
    let mut export_task = tokio::spawn(async move {
        let _work = export_work;
        export_supervisor
            .export_support_snapshot(invocation, export_cancellation)
            .await
    });
    let health_supervisor = Arc::clone(&supervisor);
    let health_work = control.begin_work();
    let mut health_task = tokio::spawn(async move {
        let _work = health_work;
        health_supervisor.health().await
    });
    let child_work = control.begin_work();
    let mut child_task = tokio::spawn(async move {
        let _work = child_work;
        capture_native_child_statuses(&sidecar, &worker).await
    });
    let file_guard = EvidenceCaptureGuard::new(control.cancelled_flag(), control.deadline_flag());
    let file_work = control.begin_work();
    let mut file_task = tokio::task::spawn_blocking(move || {
        let _work = file_work;
        collect_finite_evidence_guarded(&roots, &file_guard)
    });
    let export_abort = export_task.abort_handle();
    let health_abort = health_task.abort_handle();
    let child_abort = child_task.abort_handle();
    let remaining = join_capture_tasks(
        &mut export_task,
        &mut health_task,
        &mut child_task,
        &mut file_task,
    );
    tokio::pin!(remaining);
    let mut interruption = control.subscribe();
    let interruption_signal = async {
        if !*interruption.borrow() {
            let _ = interruption.changed().await;
        }
    };
    tokio::pin!(interruption_signal);
    let joined = tokio::select! {
        _ = &mut interruption_signal => Err(interruption_error(&control)),
        result = &mut remaining => Ok(result),
    };
    let (export, native_health, real_children, files) = match joined {
        Ok(result) => result?,
        Err(error) => {
            export_abort.abort();
            health_abort.abort();
            child_abort.abort();
            // A blocking task cannot be aborted safely. Its cooperative guard
            // is set above and the owned task is always joined before return.
            let _ = remaining.await;
            return Err(error);
        }
    };
    if let Some(error) = capture_interruption(&control, runtime.as_ref(), deadline) {
        return Err(error);
    }
    let children = real_children;
    let (collector, collector_records) =
        collector_evidence(source_time_to, native_health.clone(), export);
    let producer_health = producer_health(native_health, &children);
    Ok(CapturedNativeSupportEvidence {
        collector,
        collector_records,
        producer_health,
        files,
    })
}

async fn join_capture_tasks(
    export_task: &mut tokio::task::JoinHandle<Result<ValidatedSupportExport, SupportExportError>>,
    health_task: &mut tokio::task::JoinHandle<NativeDesktopHealth>,
    child_task: &mut tokio::task::JoinHandle<NativeChildStatusCapture>,
    file_task: &mut tokio::task::JoinHandle<
        Result<FiniteEvidenceCapture, EvidenceCaptureInterrupted>,
    >,
) -> Result<
    (
        Result<ValidatedSupportExport, SupportExportError>,
        NativeDesktopHealth,
        NativeChildStatusCapture,
        FiniteEvidenceCapture,
    ),
    CaptureError,
> {
    let (export, native_health, children, files) =
        join_concurrently(export_task, health_task, child_task, file_task).await;
    let export = export.map_err(|_| CaptureError::Invalid)?;
    let native_health = native_health.map_err(|_| CaptureError::Invalid)?;
    let children = children.map_err(|_| CaptureError::Invalid)?;
    let files = files
        .map_err(|_| CaptureError::Invalid)?
        .map_err(|error| match error {
            EvidenceCaptureInterrupted::Cancelled => CaptureError::Cancelled,
            EvidenceCaptureInterrupted::Deadline => CaptureError::Deadline,
        })?;
    Ok((export, native_health, children, files))
}

async fn join_concurrently<A, B, C, D>(
    a: A,
    b: B,
    c: C,
    d: D,
) -> (A::Output, B::Output, C::Output, D::Output)
where
    A: Future,
    B: Future,
    C: Future,
    D: Future,
{
    tokio::join!(a, b, c, d)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum CaptureError {
    Cancelled,
    Deadline,
    Invalid,
    /// The typed permit-issuance cause, carried without erasure so the
    /// coordinator can attribute exactly one of them at terminal time.
    Issuance(SupportExportIssuanceError),
}

impl CaptureError {
    /// True only for the one cause eligible for bounded terminal detail.
    pub(super) fn is_noncanonical_window(self) -> bool {
        self == Self::Issuance(SupportExportIssuanceError::NoncanonicalWindow)
    }
}

fn capture_interruption(
    control: &PreparationControl,
    runtime: &dyn CoordinatorRuntime,
    deadline: Instant,
) -> Option<CaptureError> {
    if control.interruption() == PreparationInterruption::Running
        && runtime.instant_now() >= deadline
    {
        control.request(PreparationInterruption::Deadline);
    }
    (control.interruption() != PreparationInterruption::Running)
        .then(|| interruption_error(control))
}

fn interruption_error(control: &PreparationControl) -> CaptureError {
    match control.interruption() {
        PreparationInterruption::Deadline => CaptureError::Deadline,
        PreparationInterruption::Cancelled
        | PreparationInterruption::Abandoned
        | PreparationInterruption::Running => CaptureError::Cancelled,
    }
}

#[cfg(test)]
#[path = "capture_tests.rs"]
mod tests;

fn collector_evidence(
    captured_at: &str,
    native_health: NativeDesktopHealth,
    export: Result<ValidatedSupportExport, SupportExportError>,
) -> (SupportCollectorEvidenceV1, Vec<CollectorAcceptedRecordV1>) {
    let desktop_health = map_desktop_health(native_health);
    match export {
        Ok(export) => {
            let uncertain = export.manifest.record_count == 10_000
                || export.manifest.byte_count > 16_777_216 - 65_536;
            let coverage = SupportCollectorCoverageV1 {
                status: if uncertain {
                    SupportCollectorStatusV1::LimitUncertain
                } else {
                    SupportCollectorStatusV1::Complete
                },
                completeness: if uncertain {
                    SupportCollectorCompletenessV1::LimitUncertain
                } else {
                    SupportCollectorCompletenessV1::Complete
                },
                limit_uncertain: uncertain,
                request_record_limit: 10_000,
                request_byte_limit: 16_777_216,
                returned_records: export.manifest.record_count.into(),
                returned_record_bytes: export.manifest.byte_count,
                cursor_start: export.manifest.cursor_start,
                cursor_end: export.manifest.cursor_end,
                health_oldest_cursor: export.health.oldest_cursor,
                health_newest_cursor: export.health.newest_cursor,
                selection: SupportCoverageSelectionV1::OldestMatchingRetainedPrefix,
                newest_edge_claimed: false,
            };
            let records = export.records;
            (
                SupportCollectorEvidenceV1 {
                    captured_at: captured_at.to_owned(),
                    desktop_health,
                    coverage,
                    export_manifest: Some(export.manifest),
                    export_health: Some(export.health),
                    gaps: export.gaps,
                },
                records,
            )
        }
        Err(error) => {
            let (status, completeness) = match error {
                SupportExportError::Cancelled
                | SupportExportError::Deadline
                | SupportExportError::CollectorReplaced => (
                    SupportCollectorStatusV1::Interrupted,
                    SupportCollectorCompletenessV1::Unknown,
                ),
                SupportExportError::InvalidRequest
                | SupportExportError::InvalidAuthority
                | SupportExportError::InvalidStream => (
                    SupportCollectorStatusV1::Invalid,
                    SupportCollectorCompletenessV1::Unknown,
                ),
                SupportExportError::Busy
                | SupportExportError::CollectorUnavailable
                | SupportExportError::Unsupported => (
                    SupportCollectorStatusV1::Unavailable,
                    SupportCollectorCompletenessV1::Unknown,
                ),
            };
            (
                SupportCollectorEvidenceV1 {
                    captured_at: captured_at.to_owned(),
                    desktop_health,
                    coverage: empty_coverage(status, completeness),
                    export_manifest: None,
                    export_health: None,
                    gaps: Vec::new(),
                },
                Vec::new(),
            )
        }
    }
}

pub(super) fn empty_coverage(
    status: SupportCollectorStatusV1,
    completeness: SupportCollectorCompletenessV1,
) -> SupportCollectorCoverageV1 {
    SupportCollectorCoverageV1 {
        status,
        completeness,
        limit_uncertain: false,
        request_record_limit: 10_000,
        request_byte_limit: 16_777_216,
        returned_records: 0,
        returned_record_bytes: 0,
        cursor_start: None,
        cursor_end: None,
        health_oldest_cursor: None,
        health_newest_cursor: None,
        selection: SupportCoverageSelectionV1::OldestMatchingRetainedPrefix,
        newest_edge_claimed: false,
    }
}

fn producer_health(
    native_health: NativeDesktopHealth,
    children: &NativeChildStatusCapture,
) -> SupportProducerHealthV1 {
    let desktop_health = map_desktop_health(native_health);
    SupportProducerHealthV1 {
        renderer: SupportOmittedProducerStatusV1::default(),
        tauri: desktop_health
            .map(
                |desktop_health| SupportTauriProducerHealthV1::SupervisorOnly {
                    desktop_health,
                    producer_status: SupportOmittedProducerStatusV1::default(),
                },
            )
            .unwrap_or(SupportTauriProducerHealthV1::Omitted {
                reason: SupportProducerStatusUnavailableV1::ProducerStatusUnavailable,
            }),
        anyharness: map_child(&children.anyharness, SupportChildComponentV1::Anyharness),
        desktop_worker: map_child(
            &children.desktop_worker.producer,
            SupportChildComponentV1::DesktopWorker,
        ),
    }
}

fn map_child(
    captured: &CapturedChildProducerStatus,
    expected: SupportChildComponentV1,
) -> SupportChildProducerStatusV1 {
    match &captured.status {
        PortableChildProducerStatus::Available(snapshot) => map_child_snapshot(snapshot, expected)
            .map(|snapshot| SupportChildProducerStatusV1::Available {
                captured_at: captured.captured_at.clone(),
                snapshot,
            })
            .unwrap_or_else(|| SupportChildProducerStatusV1::Omitted {
                captured_at: captured.captured_at.clone(),
                reason: SupportChildOmissionReasonV1::SourceInvalid,
            }),
        PortableChildProducerStatus::Omitted(reason) => SupportChildProducerStatusV1::Omitted {
            captured_at: captured.captured_at.clone(),
            reason: match reason {
                ChildStatusOmission::ProducerStatusUnavailable => {
                    SupportChildOmissionReasonV1::ProducerStatusUnavailable
                }
                ChildStatusOmission::ChildMissing => SupportChildOmissionReasonV1::ChildMissing,
                ChildStatusOmission::SourceInvalid => SupportChildOmissionReasonV1::SourceInvalid,
            },
        },
    }
}

fn map_child_snapshot(
    snapshot: &ProducerStatusSnapshot,
    expected: SupportChildComponentV1,
) -> Option<SupportChildProducerSnapshotV1> {
    let component = match snapshot.component {
        ComponentV1::Anyharness => SupportChildComponentV1::Anyharness,
        ComponentV1::DesktopWorker => SupportChildComponentV1::DesktopWorker,
        _ => return None,
    };
    if component != expected {
        return None;
    }
    let collector_state = match &snapshot.collector_state {
        ProducerCollectorState::Unavailable => SupportChildCollectorStateV1::Unavailable {},
        ProducerCollectorState::Cooldown => SupportChildCollectorStateV1::Cooldown {},
        ProducerCollectorState::Ready {
            collector_boot_id,
            generation_number,
        } => SupportChildCollectorStateV1::Ready {
            collector_boot_id: collector_boot_id.clone(),
            generation_number: *generation_number,
        },
    };
    Some(SupportChildProducerSnapshotV1 {
        component,
        producer_boot_id: snapshot.producer_boot_id.clone(),
        last_assigned_sequence: snapshot.last_assigned_sequence,
        next_sequence: snapshot.next_sequence,
        collector_state,
        resident_records: snapshot.resident_records.into(),
        resident_bytes: snapshot.resident_bytes.into(),
        in_flight: snapshot.in_flight,
        fallback_active: snapshot.fallback_active,
        fallback_bytes: snapshot.fallback_bytes.into(),
        fallback_write_failures: snapshot.fallback_write_failures,
        dropped_by_reason: SupportLossCountsV1 {
            queue_records: snapshot.dropped_by_reason.queue_records,
            queue_bytes: snapshot.dropped_by_reason.queue_bytes,
            protected_eviction: snapshot.dropped_by_reason.protected_eviction,
            pressure: snapshot.dropped_by_reason.pressure,
            generation_changed: snapshot.dropped_by_reason.generation_changed,
            transport_timeout: snapshot.dropped_by_reason.transport_timeout,
            transport_failure: snapshot.dropped_by_reason.transport_failure,
            receipt_invalid: snapshot.dropped_by_reason.receipt_invalid,
            receipt_rejected: snapshot.dropped_by_reason.receipt_rejected,
            fallback_overflow: snapshot.dropped_by_reason.fallback_overflow,
            fallback_write_failed: snapshot.dropped_by_reason.fallback_write_failed,
            shutdown_timeout: snapshot.dropped_by_reason.shutdown_timeout,
            filter_invalid: snapshot.dropped_by_reason.filter_invalid,
            sequence_exhausted: snapshot.dropped_by_reason.sequence_exhausted,
        },
        fallback_routed: snapshot.fallback_routed,
        delivery_fence_eligible: snapshot.delivery_fence_eligible,
        last_failure: snapshot.last_failure.map(map_loss_reason),
    })
}

fn map_loss_reason(reason: ProducerFailureClassification) -> SupportLossReasonV1 {
    match reason {
        ProducerFailureClassification::QueueRecords => SupportLossReasonV1::QueueRecords,
        ProducerFailureClassification::QueueBytes => SupportLossReasonV1::QueueBytes,
        ProducerFailureClassification::ProtectedEviction => SupportLossReasonV1::ProtectedEviction,
        ProducerFailureClassification::Pressure => SupportLossReasonV1::Pressure,
        ProducerFailureClassification::GenerationChanged => SupportLossReasonV1::GenerationChanged,
        ProducerFailureClassification::TransportTimeout => SupportLossReasonV1::TransportTimeout,
        ProducerFailureClassification::TransportFailure => SupportLossReasonV1::TransportFailure,
        ProducerFailureClassification::ReceiptInvalid => SupportLossReasonV1::ReceiptInvalid,
        ProducerFailureClassification::ReceiptRejected => SupportLossReasonV1::ReceiptRejected,
        ProducerFailureClassification::FallbackOverflow => SupportLossReasonV1::FallbackOverflow,
        ProducerFailureClassification::FallbackWriteFailed => {
            SupportLossReasonV1::FallbackWriteFailed
        }
        ProducerFailureClassification::ShutdownTimeout => SupportLossReasonV1::ShutdownTimeout,
        ProducerFailureClassification::FilterInvalid => SupportLossReasonV1::FilterInvalid,
        ProducerFailureClassification::SequenceExhausted => SupportLossReasonV1::SequenceExhausted,
    }
}

fn map_desktop_health(native: NativeDesktopHealth) -> Option<DesktopDiagnosticsHealthV1> {
    let supervisor = match native.supervisor {
        NativeSupervisorState::Unsupported { classification } => {
            DesktopDiagnosticsSupervisorStateV1::Unsupported {
                classification: map_failure_classification(&classification)?,
            }
        }
        NativeSupervisorState::Starting {
            launch_kind,
            attempt,
            restart_count,
        } => DesktopDiagnosticsSupervisorStateV1::Starting {
            launch_kind: match launch_kind {
                CollectorLaunchKindV1::Initial => SupportLaunchKindV1::Initial,
                CollectorLaunchKindV1::AutomaticRestart => SupportLaunchKindV1::AutomaticRestart,
            },
            attempt: attempt.into(),
            restart_count,
        },
        NativeSupervisorState::Ready {
            collector_boot_id,
            schema_major,
            restart_count,
        } => DesktopDiagnosticsSupervisorStateV1::Ready {
            collector_boot_id,
            schema_major,
            restart_count,
        },
        NativeSupervisorState::Degraded {
            classification,
            restart_count,
            retry_exhausted,
        } => DesktopDiagnosticsSupervisorStateV1::Degraded {
            classification: map_failure_classification(&classification)?,
            restart_count,
            retry_exhausted,
        },
        NativeSupervisorState::Stopped { orderly } => {
            DesktopDiagnosticsSupervisorStateV1::Stopped { orderly }
        }
    };
    Some(DesktopDiagnosticsHealthV1 {
        supervisor,
        fallback: native.fallback,
        collector: native.collector,
    })
}

fn map_failure_classification(value: &str) -> Option<DesktopDiagnosticsFailureClassV1> {
    Some(match value {
        "unsupported_target" => DesktopDiagnosticsFailureClassV1::UnsupportedTarget,
        "binary_missing" => DesktopDiagnosticsFailureClassV1::BinaryMissing,
        "binary_invalid" => DesktopDiagnosticsFailureClassV1::BinaryInvalid,
        "spawn_failed" => DesktopDiagnosticsFailureClassV1::SpawnFailed,
        "endpoint_unavailable" => DesktopDiagnosticsFailureClassV1::EndpointUnavailable,
        "readiness_timeout" => DesktopDiagnosticsFailureClassV1::ReadinessTimeout,
        "authentication_failed" => DesktopDiagnosticsFailureClassV1::AuthenticationFailed,
        "schema_incompatible" => DesktopDiagnosticsFailureClassV1::SchemaIncompatible,
        "boot_id_mismatch" => DesktopDiagnosticsFailureClassV1::BootIdMismatch,
        "health_unavailable" => DesktopDiagnosticsFailureClassV1::HealthUnavailable,
        "child_exited" => DesktopDiagnosticsFailureClassV1::ChildExited,
        "child_inspection_failed" => DesktopDiagnosticsFailureClassV1::ChildInspectionFailed,
        "restart_exhausted" => DesktopDiagnosticsFailureClassV1::RestartExhausted,
        "shutdown_armed" => DesktopDiagnosticsFailureClassV1::ShutdownArmed,
        "shutdown_timeout" => DesktopDiagnosticsFailureClassV1::ShutdownTimeout,
        "shutdown_failed" => DesktopDiagnosticsFailureClassV1::ShutdownFailed,
        _ => return None,
    })
}
