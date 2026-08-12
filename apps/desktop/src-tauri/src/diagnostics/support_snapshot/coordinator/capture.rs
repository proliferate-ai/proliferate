use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use proliferate_diagnostics_client::{
    ProducerCollectorState, ProducerFailureClassification, ProducerStatusSnapshot,
};
use proliferate_diagnostics_protocol::v1::types::CollectorAcceptedRecordV1;
use proliferate_diagnostics_protocol::v1::types::ComponentV1;
use tokio::sync::watch;
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
    issue_support_export_for_coordinator, SupportExportError, ValidatedSupportExport,
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
use super::runtime::CoordinatorRuntime;

pub(super) struct CapturedNativeSupportEvidence {
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
    cancellation: watch::Receiver<bool>,
    cancelled: Arc<AtomicBool>,
    runtime: Arc<dyn CoordinatorRuntime>,
) -> Result<CapturedNativeSupportEvidence, CaptureError> {
    if cancellation_failed_closed(&cancellation, &cancelled) {
        return Err(CaptureError::Cancelled);
    }
    let invocation = issue_support_export_for_coordinator(
        preparation_id,
        source_time_from.to_owned(),
        source_time_to.to_owned(),
        deadline,
    )
    .map_err(|_| CaptureError::Invalid)?;
    let export_supervisor = Arc::clone(&supervisor);
    let export_cancellation = cancellation.clone();
    let mut export_task = tokio::spawn(async move {
        export_supervisor
            .export_support_snapshot(invocation, export_cancellation)
            .await
    });
    let health_supervisor = Arc::clone(&supervisor);
    let mut health_task = tokio::spawn(async move { health_supervisor.health().await });
    let mut child_task =
        tokio::spawn(async move { capture_native_child_statuses(&sidecar, &worker).await });
    let mut cancellation_wait = cancellation.clone();
    let children = tokio::select! {
        _ = tokio::time::sleep_until(deadline) => {
            Err((CaptureError::Deadline, false))
        }
        changed = cancellation_wait.changed() => {
            if changed.is_err() || *cancellation_wait.borrow() {
                Err((CaptureError::Cancelled, false))
            } else {
                (&mut child_task)
                    .await
                    .map_err(|_| (CaptureError::Invalid, true))
            }
        }
        result = &mut child_task => result.map_err(|_| (CaptureError::Invalid, true)),
    };
    let children = match children {
        Ok(children) => children,
        Err((error, child_completed)) => {
            export_task.abort();
            health_task.abort();
            if child_completed {
                let _ = tokio::join!(&mut export_task, &mut health_task);
            } else {
                child_task.abort();
                let _ = tokio::join!(&mut export_task, &mut health_task, &mut child_task);
            }
            return Err(error);
        }
    };
    if cancellation_failed_closed(&cancellation, &cancelled) {
        export_task.abort();
        health_task.abort();
        let _ = tokio::join!(&mut export_task, &mut health_task);
        return Err(CaptureError::Cancelled);
    }
    let logs_dir = match crate::app_config::logs_dir_path() {
        Ok(path) => path,
        Err(_) => {
            export_task.abort();
            health_task.abort();
            let _ = tokio::join!(&mut export_task, &mut health_task);
            return Err(CaptureError::Invalid);
        }
    };
    let app_dir = match crate::app_config::app_dir_path() {
        Ok(path) => path,
        Err(_) => {
            export_task.abort();
            health_task.abort();
            let _ = tokio::join!(&mut export_task, &mut health_task);
            return Err(CaptureError::Invalid);
        }
    };
    let roots = FiniteEvidenceRoots::new(
        &logs_dir,
        crate::app_config::anyharness_runtime_home_path()
            .ok()
            .as_deref(),
        &app_dir,
        &children
            .desktop_worker
            .target_id
            .iter()
            .cloned()
            .collect::<Vec<_>>(),
    );
    let cancelled_now = cancellation_failed_closed(&cancellation, &cancelled);
    if cancelled_now || runtime.instant_now() >= deadline {
        export_task.abort();
        health_task.abort();
        let _ = tokio::join!(&mut export_task, &mut health_task);
        return Err(if cancelled_now {
            CaptureError::Cancelled
        } else {
            CaptureError::Deadline
        });
    }
    let file_guard = EvidenceCaptureGuard::new(Arc::clone(&cancelled), deadline.into_std());
    let mut file_task =
        tokio::task::spawn_blocking(move || collect_finite_evidence_guarded(&roots, &file_guard));
    let export_abort = export_task.abort_handle();
    let health_abort = health_task.abort_handle();
    let remaining = join_capture_tasks(&mut export_task, &mut health_task, &mut file_task);
    tokio::pin!(remaining);
    let mut cancellation = cancellation;
    let joined = loop {
        tokio::select! {
            _ = tokio::time::sleep_until(deadline) => break Err(CaptureError::Deadline),
            changed = cancellation.changed() => {
                if changed.is_err() || *cancellation.borrow() {
                    break Err(CaptureError::Cancelled);
                }
            }
            result = &mut remaining => break Ok(result),
        }
    };
    let (export, native_health, files) = match joined {
        Ok(result) => result?,
        Err(error) => {
            cancelled.store(true, Ordering::Release);
            export_abort.abort();
            health_abort.abort();
            // A blocking task cannot be aborted safely. Its cooperative guard
            // is set above and the owned task is always joined before return.
            let _ = remaining.await;
            return Err(error);
        }
    };
    if cancellation_failed_closed(&cancellation, &cancelled) {
        return Err(CaptureError::Cancelled);
    }
    if runtime.instant_now() >= deadline {
        return Err(CaptureError::Deadline);
    }
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
    file_task: &mut tokio::task::JoinHandle<
        Result<FiniteEvidenceCapture, EvidenceCaptureInterrupted>,
    >,
) -> Result<
    (
        Result<ValidatedSupportExport, SupportExportError>,
        NativeDesktopHealth,
        FiniteEvidenceCapture,
    ),
    CaptureError,
> {
    let (export, native_health, files) = tokio::join!(export_task, health_task, file_task);
    let export = export.map_err(|_| CaptureError::Invalid)?;
    let native_health = native_health.map_err(|_| CaptureError::Invalid)?;
    let files = files
        .map_err(|_| CaptureError::Invalid)?
        .map_err(|error| match error {
            EvidenceCaptureInterrupted::Cancelled => CaptureError::Cancelled,
            EvidenceCaptureInterrupted::Deadline => CaptureError::Deadline,
        })?;
    Ok((export, native_health, files))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum CaptureError {
    Cancelled,
    Deadline,
    Invalid,
}

fn cancellation_failed_closed(receiver: &watch::Receiver<bool>, cancelled: &AtomicBool) -> bool {
    cancelled.load(Ordering::Acquire) || *receiver.borrow() || receiver.has_changed().is_err()
}

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

fn empty_coverage(
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
        ProducerCollectorState::Unavailable => SupportChildCollectorStateV1::Unavailable,
        ProducerCollectorState::Cooldown => SupportChildCollectorStateV1::Cooldown,
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
