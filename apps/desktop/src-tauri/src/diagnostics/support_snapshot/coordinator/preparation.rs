use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex as StdMutex,
};

use chrono::{DateTime, SecondsFormat, Utc};
use tokio::sync::watch;
use tokio::time::Duration;

use crate::diagnostics_collector::producer::lifecycle::support_lifecycle::{
    SupportPreparationOperation, SupportSnapshotPreparationFailureClassificationV1 as Failure,
};

use super::super::artifact_store::MAX_ARTIFACT_REFERENCES;
use super::super::schema::validate::{validate_id, validate_timestamp};
use super::capture::{capture_native_support_evidence, CaptureError};
use super::finish::{finish_and_stage, FinishError, FinishResult, FinishWork};
use super::model::{
    BeginSupportSnapshotInput, CancelSupportSnapshotInput, FinishSupportSnapshotInput,
    PreparedSupportSnapshotOutput, SupportSnapshotPreparationOutput, SupportSnapshotSelectionInput,
    SupportSnapshotWindowOutput, SupportSnapshotWorkspaceInput, DISCLOSURE_VERSION,
    SESSION_EVIDENCE_BYTES,
};
use super::state::{ArtifactAuthorization, OpenPreparation, PreparationPhase, ReadinessState};
use super::SupportSnapshotCoordinator;

const PREPARATION_TIMEOUT: Duration = Duration::from_secs(25);
const FINISH_TIMEOUT: Duration = Duration::from_secs(10);
const CAPTURE_WINDOW_MINUTES: i64 = 15;

impl SupportSnapshotCoordinator {
    pub(crate) async fn begin_preparation(
        &self,
        input: BeginSupportSnapshotInput,
    ) -> Result<SupportSnapshotPreparationOutput, String> {
        validate_begin(&input)?;
        let captured = self.runtime.utc_now();
        validate_begin_times(&input, &captured)?;
        let captured_at = captured.to_rfc3339_opts(SecondsFormat::AutoSi, true);
        let source_time_from = (captured - chrono::Duration::minutes(CAPTURE_WINDOW_MINUTES))
            .to_rfc3339_opts(SecondsFormat::AutoSi, true);
        let source_time_to = captured_at.clone();
        let deadline = self.runtime.instant_now() + PREPARATION_TIMEOUT;
        let preparation_id = self.runtime.new_id();
        let snapshot_id = self.runtime.new_id();
        let (cancellation, receiver) = watch::channel(false);
        let cancelled = Arc::new(AtomicBool::new(false));

        let operation = {
            let mut state = self.state.lock().await;
            if state.shutdown_armed
                || state.readiness != ReadinessState::Ready
                || self.store.is_none()
            {
                return Err("support_snapshot_not_ready".to_string());
            }
            if state.preparation.is_some() {
                return Err("support_snapshot_preparation_busy".to_string());
            }
            if state.artifacts.len() >= MAX_ARTIFACT_REFERENCES {
                return Err("support_snapshot_artifact_capacity".to_string());
            }
            let operation = self
                .producer
                .begin_support_snapshot_preparation(&input.client_job_id)
                .map_err(|_| "support_snapshot_invalid_input".to_string())?;
            let operation_id = operation.operation_id().to_owned();
            let operation = Arc::new(StdMutex::new(Some(operation)));
            state.preparation = Some(OpenPreparation {
                input: input.clone(),
                preparation_id: preparation_id.clone(),
                snapshot_id: snapshot_id.clone(),
                preparation_operation_id: operation_id,
                captured_at: captured_at.clone(),
                source_time_from: source_time_from.clone(),
                source_time_to: source_time_to.clone(),
                deadline,
                phase: PreparationPhase::Capturing,
                cancellation,
                cancelled: Arc::clone(&cancelled),
                operation: Arc::clone(&operation),
                captured: None,
            });
            operation
        };

        let capture = capture_native_support_evidence(
            Arc::clone(&self.supervisor),
            self.sidecar.clone(),
            self.worker.clone(),
            &preparation_id,
            &source_time_from,
            &source_time_to,
            deadline,
            receiver,
            Arc::clone(&cancelled),
            Arc::clone(&self.runtime),
        )
        .await;

        let mut state = self.state.lock().await;
        let matches = state.preparation.as_ref().is_some_and(|open| {
            open.preparation_id == preparation_id
                && open.input.consent_epoch == input.consent_epoch
                && open.phase == PreparationPhase::Capturing
        });
        if !matches {
            drop(state);
            terminal_cancelled(&operation);
            return Err("support_snapshot_preparation_cancelled".to_string());
        }
        match capture {
            Ok(captured)
                if !cancelled.load(Ordering::Acquire) && self.runtime.instant_now() < deadline =>
            {
                let open = state.preparation.as_mut().expect("matching preparation");
                if let Some(manifest) = &captured.collector.export_manifest {
                    open.snapshot_id.clone_from(&manifest.snapshot_id);
                }
                open.captured = Some(captured);
                open.phase = PreparationPhase::AwaitingFinish;
                Ok(SupportSnapshotPreparationOutput {
                    preparation_id,
                    preparation_operation_id: open.preparation_operation_id.clone(),
                    captured_at,
                    window: SupportSnapshotWindowOutput {
                        source_time_from,
                        source_time_to,
                    },
                })
            }
            result => {
                state.preparation.take();
                drop(state);
                match result {
                    Err(CaptureError::Deadline) | Ok(_) => {
                        terminal_failed(&operation, Failure::PreparationTimeout);
                        Err("support_snapshot_preparation_timeout".to_string())
                    }
                    Err(CaptureError::Cancelled) => {
                        terminal_cancelled(&operation);
                        Err("support_snapshot_preparation_cancelled".to_string())
                    }
                    Err(CaptureError::Invalid) => {
                        terminal_failed(&operation, Failure::PreparationRejected);
                        Err("support_snapshot_preparation_rejected".to_string())
                    }
                }
            }
        }
    }

    pub(crate) async fn finish_preparation(
        &self,
        input: FinishSupportSnapshotInput,
    ) -> Result<PreparedSupportSnapshotOutput, String> {
        if canonical_uuid(&input.preparation_id).is_err()
            || validate_id(&input.consent_epoch).is_err()
            || input
                .session_evidence_json
                .as_ref()
                .is_some_and(|value| value.len() > SESSION_EVIDENCE_BYTES)
        {
            return Err("support_snapshot_invalid_input".to_string());
        }
        let store = self
            .store
            .as_ref()
            .cloned()
            .ok_or_else(|| "support_snapshot_not_ready".to_string())?;
        let (work, operation, cancelled, cancellation, overall_deadline) = {
            let mut state = self.state.lock().await;
            if state.shutdown_armed || state.readiness != ReadinessState::Ready {
                return Err("support_snapshot_not_ready".to_string());
            }
            let matches = state.preparation.as_ref().is_some_and(|open| {
                open.preparation_id == input.preparation_id
                    && open.input.consent_epoch == input.consent_epoch
                    && open.phase == PreparationPhase::AwaitingFinish
            });
            if !matches {
                return Err("support_snapshot_stale_preparation".to_string());
            }
            if state
                .preparation
                .as_ref()
                .is_some_and(|open| self.runtime.instant_now() >= open.deadline)
            {
                let open = state.preparation.take().expect("matching preparation");
                drop(state);
                terminal_failed(&open.operation, Failure::PreparationTimeout);
                return Err("support_snapshot_preparation_timeout".to_string());
            }
            if state
                .preparation
                .as_ref()
                .is_some_and(|open| open.captured.is_none())
            {
                let open = state.preparation.take().expect("matching preparation");
                drop(state);
                terminal_failed(&open.operation, Failure::PreparationRejected);
                return Err("support_snapshot_preparation_rejected".to_string());
            }
            let open = state.preparation.as_mut().expect("matching preparation");
            open.phase = PreparationPhase::Finishing;
            let captured = open.captured.take().expect("validated captured evidence");
            let work = FinishWork {
                begin: open.input.clone(),
                preparation_id: open.preparation_id.clone(),
                snapshot_id: open.snapshot_id.clone(),
                preparation_operation_id: open.preparation_operation_id.clone(),
                captured_at: open.captured_at.clone(),
                source_time_from: open.source_time_from.clone(),
                source_time_to: open.source_time_to.clone(),
                captured,
                session_evidence_json: input.session_evidence_json,
                session_collection: input.session_collection,
            };
            (
                work,
                Arc::clone(&open.operation),
                Arc::clone(&open.cancelled),
                open.cancellation.subscribe(),
                open.deadline,
            )
        };
        let finish_deadline = overall_deadline.min(self.runtime.instant_now() + FINISH_TIMEOUT);
        let blocking_cancelled = Arc::clone(&cancelled);
        let blocking_store = Arc::clone(&store);
        let blocking_runtime = Arc::clone(&self.runtime);
        let mut task = tokio::task::spawn_blocking(move || {
            finish_and_stage(
                blocking_store,
                work,
                &blocking_cancelled,
                finish_deadline,
                blocking_runtime.as_ref(),
            )
        });
        let mut cancellation = cancellation;
        let mut interrupted = None;
        let result = tokio::select! {
            result = &mut task => result,
            _ = tokio::time::sleep_until(finish_deadline) => {
                cancelled.store(true, Ordering::Release);
                interrupted = Some(FinishError::Deadline);
                task.await
            }
            changed = cancellation.changed() => {
                if changed.is_err() || *cancellation.borrow() {
                    cancelled.store(true, Ordering::Release);
                    interrupted = Some(FinishError::Cancelled);
                }
                task.await
            }
        };
        let result = result.map_err(|_| FinishError::Manifest);
        let mut result = match interrupted {
            Some(error) => {
                if let Ok(Ok(success)) = &result {
                    let _ = store.delete(&success.reference.artifact_id);
                }
                Err(error)
            }
            None if self.runtime.instant_now() >= finish_deadline => {
                if let Ok(Ok(success)) = &result {
                    let _ = store.delete(&success.reference.artifact_id);
                }
                Err(FinishError::Deadline)
            }
            None => result.unwrap_or(Err(FinishError::Manifest)),
        };
        let cancellation_requested = *cancellation.borrow() || cancellation.has_changed().is_err();
        if cancellation_requested {
            if let Ok(success) = &result {
                let _ = store.delete(&success.reference.artifact_id);
            }
            result = Err(FinishError::Cancelled);
        }
        let mut state = self.state.lock().await;
        let still_current = state.preparation.as_ref().is_some_and(|open| {
            open.preparation_id == input.preparation_id
                && open.input.consent_epoch == input.consent_epoch
                && open.phase == PreparationPhase::Finishing
        });
        let cancellation_requested =
            cancellation_requested || *cancellation.borrow() || cancellation.has_changed().is_err();
        let deadline_expired = self.runtime.instant_now() >= finish_deadline;
        if still_current {
            state.preparation.take();
        }
        if cancellation_requested {
            if let Ok(success) = &result {
                let artifact_id = success.reference.artifact_id.clone();
                drop(state);
                let _ = store.delete(&artifact_id);
            } else {
                drop(state);
            }
            terminal_cancelled(&operation);
            return Err("support_snapshot_preparation_cancelled".to_string());
        }
        if deadline_expired {
            if let Ok(success) = &result {
                let artifact_id = success.reference.artifact_id.clone();
                drop(state);
                let _ = store.delete(&artifact_id);
            } else {
                drop(state);
            }
            terminal_failed(&operation, Failure::PreparationTimeout);
            return Err("support_snapshot_preparation_timeout".to_string());
        }
        match result {
            Ok(FinishResult { output, reference }) if still_current => {
                state.artifacts.insert(
                    reference.artifact_id.clone(),
                    ArtifactAuthorization {
                        reference,
                        preparation_id: Some(input.preparation_id),
                        preparation_operation_id: Some(output.preparation_operation_id.clone()),
                        consent_epoch: Some(input.consent_epoch),
                    },
                );
                drop(state);
                terminal_succeeded(&operation);
                Ok(output)
            }
            Ok(success) => {
                drop(state);
                let _ = store.delete(&success.reference.artifact_id);
                terminal_failed(&operation, Failure::PreparationRejected);
                Err("support_snapshot_stale_preparation".to_string())
            }
            Err(error) => {
                drop(state);
                finish_terminal(&operation, error);
                Err(finish_error_code(error).to_string())
            }
        }
    }

    pub(crate) async fn cancel_preparation(
        &self,
        input: CancelSupportSnapshotInput,
    ) -> Result<(), String> {
        if canonical_uuid(&input.client_job_id).is_err()
            || validate_id(&input.consent_epoch).is_err()
            || input
                .preparation_id
                .as_deref()
                .is_some_and(|value| canonical_uuid(value).is_err())
        {
            return Err("support_snapshot_invalid_input".to_string());
        }
        let (operation, deletes) = {
            let mut state = self.state.lock().await;
            let matching = state.preparation.as_ref().is_some_and(|open| {
                open.input.client_job_id == input.client_job_id
                    && open.input.consent_epoch == input.consent_epoch
                    && input
                        .preparation_id
                        .as_ref()
                        .is_none_or(|value| value == &open.preparation_id)
            });
            let operation = if matching {
                let open = state.preparation.as_ref().expect("matching preparation");
                open.cancelled.store(true, Ordering::Release);
                let _ = open.cancellation.send(true);
                if open.phase == PreparationPhase::AwaitingFinish {
                    state.preparation.take().map(|open| open.operation)
                } else {
                    None
                }
            } else {
                None
            };
            let ids = state
                .artifacts
                .iter()
                .filter(|(_, authorization)| {
                    authorization.reference.client_job_id == input.client_job_id
                        && authorization.consent_epoch.as_deref() == Some(&input.consent_epoch)
                        && input.preparation_id.as_ref().is_none_or(|value| {
                            authorization.preparation_id.as_ref() == Some(value)
                        })
                })
                .map(|(id, _)| id.clone())
                .collect::<Vec<_>>();
            for id in &ids {
                state.artifacts.remove(id);
                state.read_proofs.remove(id);
            }
            (operation, ids)
        };
        if let Some(operation) = operation {
            terminal_cancelled(&operation);
        }
        self.delete_artifacts(deletes).await;
        Ok(())
    }
}

fn validate_begin(input: &BeginSupportSnapshotInput) -> Result<(), String> {
    canonical_uuid(&input.client_job_id)?;
    if validate_timestamp(&input.report_opened_at).is_err()
        || validate_timestamp(&input.consent.granted_at).is_err()
        || validate_id(&input.consent_epoch).is_err()
        || input.consent.version != 1
        || input.consent.disclosure_version != DISCLOSURE_VERSION
    {
        return Err("support_snapshot_invalid_input".to_string());
    }
    match &input.consent.selection {
        SupportSnapshotSelectionInput::ActiveSession {
            workspace,
            ui_session_id,
            materialized_session_id,
        } => {
            for value in [
                workspace.workspace_id.as_str(),
                workspace.anyharness_workspace_id.as_str(),
                ui_session_id,
                materialized_session_id,
            ] {
                validate_id(value).map_err(|_| "support_snapshot_invalid_input".to_string())?;
            }
        }
        SupportSnapshotSelectionInput::RecentActivity { workspace } => match workspace {
            SupportSnapshotWorkspaceInput::BundledLocal {
                workspace_id,
                anyharness_workspace_id,
            } => {
                validate_id(workspace_id)
                    .and_then(|_| validate_id(anyharness_workspace_id))
                    .map_err(|_| "support_snapshot_invalid_input".to_string())?;
            }
            SupportSnapshotWorkspaceInput::None { .. } => {}
        },
    }
    Ok(())
}

fn validate_begin_times(
    input: &BeginSupportSnapshotInput,
    now: &DateTime<Utc>,
) -> Result<(), String> {
    let report = DateTime::parse_from_rfc3339(&input.report_opened_at)
        .map_err(|_| "support_snapshot_invalid_input".to_string())?
        .with_timezone(&Utc);
    let granted = DateTime::parse_from_rfc3339(&input.consent.granted_at)
        .map_err(|_| "support_snapshot_invalid_input".to_string())?
        .with_timezone(&Utc);
    if report > granted || granted > now.clone() {
        return Err("support_snapshot_invalid_input".to_string());
    }
    Ok(())
}

fn canonical_uuid(value: &str) -> Result<(), String> {
    let parsed =
        uuid::Uuid::parse_str(value).map_err(|_| "support_snapshot_invalid_input".to_string())?;
    if parsed.to_string() != value {
        return Err("support_snapshot_invalid_input".to_string());
    }
    Ok(())
}

pub(super) fn take_operation(
    operation: &Arc<StdMutex<Option<SupportPreparationOperation>>>,
) -> Option<SupportPreparationOperation> {
    match operation.lock() {
        Ok(mut operation) => operation.take(),
        Err(poisoned) => poisoned.into_inner().take(),
    }
}

fn terminal_succeeded(operation: &Arc<StdMutex<Option<SupportPreparationOperation>>>) {
    if let Some(operation) = take_operation(operation) {
        operation.succeeded();
    }
}

fn terminal_cancelled(operation: &Arc<StdMutex<Option<SupportPreparationOperation>>>) {
    if let Some(operation) = take_operation(operation) {
        operation.cancelled();
    }
}

fn terminal_failed(
    operation: &Arc<StdMutex<Option<SupportPreparationOperation>>>,
    classification: Failure,
) {
    if let Some(operation) = take_operation(operation) {
        operation.failed(classification);
    }
}

fn finish_terminal(
    operation: &Arc<StdMutex<Option<SupportPreparationOperation>>>,
    error: FinishError,
) {
    match error {
        FinishError::Cancelled => terminal_cancelled(operation),
        FinishError::Deadline => terminal_failed(operation, Failure::PreparationTimeout),
        FinishError::Scrub => terminal_failed(operation, Failure::ScrubFailed),
        FinishError::Manifest => terminal_failed(operation, Failure::ManifestInvalid),
        FinishError::Stage => terminal_failed(operation, Failure::StageFailed),
        FinishError::Verification => {
            terminal_failed(operation, Failure::ArtifactVerificationFailed)
        }
    }
}

fn finish_error_code(error: FinishError) -> &'static str {
    match error {
        FinishError::Cancelled => "support_snapshot_preparation_cancelled",
        FinishError::Deadline => "support_snapshot_preparation_timeout",
        FinishError::Scrub => "support_snapshot_scrub_failed",
        FinishError::Manifest => "support_snapshot_manifest_invalid",
        FinishError::Stage => "support_snapshot_stage_failed",
        FinishError::Verification => "support_snapshot_artifact_verification_failed",
    }
}
