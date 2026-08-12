use std::sync::{Arc, Mutex as StdMutex};

use chrono::{DateTime, SecondsFormat, Utc};
use tokio::time::Duration;

use crate::diagnostics_collector::producer::lifecycle::support_lifecycle::SupportSnapshotPreparationFailureClassificationV1 as Failure;

use super::super::artifact_store::{SupportArtifactStore, MAX_ARTIFACT_REFERENCES};
use super::super::schema::validate::{validate_id, validate_timestamp};
use super::capture::{capture_native_support_evidence, CaptureError};
use super::control::{PreparationControl, PreparationInterruption};
use super::finish::{finish_and_stage, FinishError, FinishResult, FinishWork};
use super::model::{
    BeginSupportSnapshotInput, CancelSupportSnapshotInput, FinishSupportSnapshotInput,
    PreparedSupportSnapshotOutput, SupportSnapshotPreparationOutput, SupportSnapshotSelectionInput,
    SupportSnapshotWindowOutput, SupportSnapshotWorkspaceInput, DISCLOSURE_VERSION,
    SESSION_EVIDENCE_BYTES,
};
use super::state::{
    ArtifactAuthorization, ClosedPreparation, OpenPreparation, PreparationPhase, ReadinessState,
};
use super::terminal::{
    abandoned as terminal_abandoned, cancelled as terminal_cancelled,
    code_for_interruption as terminal_code_for_interruption, failed as terminal_failed,
    finish as finish_terminal, finish_error_code, finish_interruption, interruption_error_code,
    succeeded as terminal_succeeded, terminal_for_interruption,
};
use super::watchdog::spawn_preparation_watchdog;
use super::SupportSnapshotCoordinator;

const PREPARATION_TIMEOUT: Duration = Duration::from_secs(25);
const FINISH_TIMEOUT: Duration = Duration::from_secs(10);
const CAPTURE_WINDOW_MINUTES: i64 = 15;

impl SupportSnapshotCoordinator {
    pub(crate) async fn begin_preparation(
        self: &Arc<Self>,
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
        let control = PreparationControl::new();
        let _capture_work = control.begin_work();

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
            state.closed_preparation = None;
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
                control: Arc::clone(&control),
                operation: Arc::clone(&operation),
                captured: None,
                session_phase_started_at: None,
            });
            operation
        };

        spawn_preparation_watchdog(self, preparation_id.clone(), deadline, Arc::clone(&control));

        let capture = capture_native_support_evidence(
            Arc::clone(&self.supervisor),
            self.sidecar.clone(),
            self.worker.clone(),
            &preparation_id,
            &source_time_from,
            &source_time_to,
            deadline,
            Arc::clone(&control),
            Arc::clone(&self.runtime),
        )
        .await;

        let mut state = self.state.lock().await;
        if control.interruption() == PreparationInterruption::Running
            && self.runtime.instant_now() >= deadline
        {
            control.request(PreparationInterruption::Deadline);
        }
        let matches = state.preparation.as_ref().is_some_and(|open| {
            open.preparation_id == preparation_id
                && open.input.consent_epoch == input.consent_epoch
                && open.phase == PreparationPhase::Capturing
        });
        if !matches {
            drop(state);
            return Err(terminal_code_for_interruption(&operation, &control));
        }
        match capture {
            Ok(captured) if control.interruption() == PreparationInterruption::Running => {
                let session_phase_started_at = self
                    .runtime
                    .utc_now()
                    .to_rfc3339_opts(SecondsFormat::AutoSi, true);
                let open = state.preparation.as_mut().expect("matching preparation");
                if let Some(manifest) = &captured.collector.export_manifest {
                    open.snapshot_id.clone_from(&manifest.snapshot_id);
                }
                open.captured = Some(captured);
                open.session_phase_started_at = Some(session_phase_started_at);
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
                control.stop_watchdog();
                match (result, control.interruption()) {
                    (_, PreparationInterruption::Deadline)
                    | (Err(CaptureError::Deadline), PreparationInterruption::Running) => {
                        terminal_failed(&operation, Failure::PreparationTimeout);
                        Err("support_snapshot_preparation_timeout".to_string())
                    }
                    (_, PreparationInterruption::Cancelled)
                    | (Err(CaptureError::Cancelled), PreparationInterruption::Running) => {
                        terminal_cancelled(&operation);
                        Err("support_snapshot_preparation_cancelled".to_string())
                    }
                    (_, PreparationInterruption::Abandoned) => {
                        terminal_abandoned(&operation);
                        Err("support_snapshot_preparation_cancelled".to_string())
                    }
                    (Err(CaptureError::Invalid), PreparationInterruption::Running)
                    | (Ok(_), PreparationInterruption::Running) => {
                        terminal_failed(&operation, Failure::PreparationRejected);
                        Err("support_snapshot_preparation_rejected".to_string())
                    }
                }
            }
        }
    }

    pub(crate) async fn finish_preparation(
        self: &Arc<Self>,
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
        let _artifact_guard = self.artifact_gate.lock().await;
        let (work, operation, control, finish_deadline, finish_work, finish_call_work) = {
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
                if let Some(closed) = state.closed_preparation.as_ref().filter(|closed| {
                    closed.preparation_id == input.preparation_id
                        && closed.consent_epoch == input.consent_epoch
                }) {
                    return Err(interruption_error_code(closed.interruption).to_string());
                }
                return Err("support_snapshot_stale_preparation".to_string());
            }
            if state
                .preparation
                .as_ref()
                .is_some_and(|open| self.runtime.instant_now() >= open.deadline)
            {
                let open = state.preparation.take().expect("matching preparation");
                open.control.request(PreparationInterruption::Deadline);
                state.closed_preparation = Some(ClosedPreparation {
                    preparation_id: open.preparation_id.clone(),
                    consent_epoch: open.input.consent_epoch.clone(),
                    interruption: PreparationInterruption::Deadline,
                });
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
                open.control.stop_watchdog();
                terminal_failed(&open.operation, Failure::PreparationRejected);
                return Err("support_snapshot_preparation_rejected".to_string());
            }
            let open = state.preparation.as_mut().expect("matching preparation");
            let finish_deadline = open
                .deadline
                .min(self.runtime.instant_now() + FINISH_TIMEOUT);
            // Publish the effective deadline to every competing state owner.
            open.deadline = finish_deadline;
            open.phase = PreparationPhase::Finishing;
            let finish_work = open.control.begin_work();
            let finish_call_work = open.control.begin_work();
            let captured = open.captured.take().expect("validated captured evidence");
            let session_phase_started_at = open
                .session_phase_started_at
                .clone()
                .expect("captured session phase boundary");
            let work = FinishWork {
                begin: open.input.clone(),
                preparation_id: open.preparation_id.clone(),
                snapshot_id: open.snapshot_id.clone(),
                preparation_operation_id: open.preparation_operation_id.clone(),
                captured_at: open.captured_at.clone(),
                source_time_from: open.source_time_from.clone(),
                source_time_to: open.source_time_to.clone(),
                session_phase_started_at,
                captured,
                session_evidence_json: input.session_evidence_json,
                session_collection: input.session_collection,
            };
            (
                work,
                Arc::clone(&open.operation),
                Arc::clone(&open.control),
                finish_deadline,
                finish_work,
                finish_call_work,
            )
        };
        let _finish_call_work = finish_call_work;
        // Coordinator ownership survives a dropped finish invocation.
        spawn_preparation_watchdog(
            self,
            input.preparation_id.clone(),
            finish_deadline,
            Arc::clone(&control),
        );
        let mut signal = control.subscribe();
        let interrupted = async {
            if !*signal.borrow() {
                let _ = signal.changed().await;
            }
        };
        tokio::pin!(interrupted);
        if control.interruption() == PreparationInterruption::Running
            && self.runtime.instant_now() >= finish_deadline
        {
            control.request(PreparationInterruption::Deadline);
        }
        let blocking_control = Arc::clone(&control);
        let blocking_store = Arc::clone(&store);
        let blocking_runtime = Arc::clone(&self.runtime);
        let finish_completion = control.finish_completion();
        let blocking_completion = control.finish_completion();
        let mut task = tokio::task::spawn_blocking(move || {
            let _work = finish_work;
            let result = finish_and_stage(
                blocking_store,
                work,
                blocking_control.as_ref(),
                finish_deadline,
                blocking_runtime.as_ref(),
            );
            blocking_completion.publish(result);
        });
        let finish_timer = self.runtime.sleep_until(finish_deadline);
        tokio::pin!(finish_timer);
        tokio::select! {
            result = &mut task => { let _ = result; }
            _ = &mut finish_timer => {
                control.request(PreparationInterruption::Deadline);
                let _ = task.await;
            }
            _ = &mut interrupted => {
                let _ = task.await;
            }
        }
        let mut result = finish_completion
            .take()
            .unwrap_or(Err(FinishError::Manifest));
        if control.interruption() == PreparationInterruption::Running
            && self.runtime.instant_now() >= finish_deadline
        {
            control.request(PreparationInterruption::Deadline);
        }
        if let Some(interrupted) = finish_interruption(&control) {
            if let Ok(success) = &result {
                let _ = store.delete(&success.reference.artifact_id);
            }
            result = Err(interrupted);
        }
        let mut state = self.state.lock().await;
        let still_current = state.preparation.as_ref().is_some_and(|open| {
            open.preparation_id == input.preparation_id
                && open.input.consent_epoch == input.consent_epoch
                && open.phase == PreparationPhase::Finishing
        });
        if still_current {
            state.preparation.take();
        }
        if control.interruption() == PreparationInterruption::Cancelled {
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
        if control.interruption() == PreparationInterruption::Deadline {
            state.closed_preparation = Some(ClosedPreparation {
                preparation_id: input.preparation_id.clone(),
                consent_epoch: input.consent_epoch.clone(),
                interruption: PreparationInterruption::Deadline,
            });
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
        if control.interruption() == PreparationInterruption::Abandoned {
            if let Ok(success) = &result {
                let artifact_id = success.reference.artifact_id.clone();
                drop(state);
                let _ = store.delete(&artifact_id);
            } else {
                drop(state);
            }
            terminal_abandoned(&operation);
            return Err("support_snapshot_preparation_cancelled".to_string());
        }
        match result {
            Ok(FinishResult { output, reference }) if still_current => {
                state.closed_preparation = None;
                let authorization = ArtifactAuthorization {
                    reference,
                    preparation_id: Some(input.preparation_id),
                    preparation_operation_id: Some(output.preparation_operation_id.clone()),
                    consent_epoch: Some(input.consent_epoch),
                };
                if !finish_completion.authorize() {
                    let artifact_id = authorization.reference.artifact_id;
                    drop(state);
                    let _ = store.delete(&artifact_id);
                    return Err(terminal_code_for_interruption(&operation, &control));
                }
                state
                    .artifacts
                    .insert(authorization.reference.artifact_id.clone(), authorization);
                drop(state);
                control.stop_watchdog();
                terminal_succeeded(&operation);
                Ok(output)
            }
            Ok(success) => {
                drop(state);
                let _ = store.delete(&success.reference.artifact_id);
                control.stop_watchdog();
                terminal_failed(&operation, Failure::PreparationRejected);
                Err("support_snapshot_stale_preparation".to_string())
            }
            Err(error) => {
                drop(state);
                control.stop_watchdog();
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
        let (operation, control, terminal_interruption, mut deletes) = {
            let mut state = self.state.lock().await;
            let matching = state.preparation.as_ref().is_some_and(|open| {
                open.input.client_job_id == input.client_job_id
                    && open.input.consent_epoch == input.consent_epoch
                    && input
                        .preparation_id
                        .as_ref()
                        .is_none_or(|value| value == &open.preparation_id)
            });
            let (operation, control, terminal_interruption) = if matching {
                let open = state.preparation.as_ref().expect("matching preparation");
                if self.runtime.instant_now() >= open.deadline {
                    open.control.request(PreparationInterruption::Deadline);
                }
                open.control.request(PreparationInterruption::Cancelled);
                let control = Arc::clone(&open.control);
                if open.phase == PreparationPhase::AwaitingFinish {
                    let open = state.preparation.take().expect("matching preparation");
                    let interruption = control.interruption();
                    state.closed_preparation = Some(ClosedPreparation {
                        preparation_id: open.preparation_id.clone(),
                        consent_epoch: open.input.consent_epoch.clone(),
                        interruption,
                    });
                    (Some(open.operation), Some(control), Some(interruption))
                } else {
                    (None, Some(control), None)
                }
            } else {
                (None, None, None)
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
            (operation, control, terminal_interruption, ids)
        };
        if let Some(control) = &control {
            control.wait_idle().await;
        }
        let detached_operation = if operation.is_none() {
            let mut state = self.state.lock().await;
            let detached = state.preparation.as_ref().is_some_and(|open| {
                control
                    .as_ref()
                    .is_some_and(|control| Arc::ptr_eq(&open.control, control))
            });
            detached.then(|| {
                let open = state.preparation.take().expect("detached preparation");
                let interruption = open.control.interruption();
                state.closed_preparation = Some(ClosedPreparation {
                    preparation_id: open.preparation_id,
                    consent_epoch: open.input.consent_epoch,
                    interruption,
                });
                open.operation
            })
        } else {
            None
        };
        if let (Some(operation), Some(interruption)) = (
            operation.or(detached_operation),
            terminal_interruption
                .or_else(|| control.as_ref().map(|control| control.interruption())),
        ) {
            terminal_for_interruption(&operation, interruption);
        }
        if let Some(success) = control
            .as_ref()
            .and_then(|control| control.finish_completion().claim_cleanup())
        {
            if !deletes.contains(&success.reference.artifact_id) {
                deletes.push(success.reference.artifact_id);
            }
        }
        if control.is_some() {
            if let Ok(artifact_id) = SupportArtifactStore::artifact_id(&input.client_job_id) {
                if !deletes.contains(&artifact_id) {
                    deletes.push(artifact_id);
                }
            }
        }
        let _artifact_guard = self.artifact_gate.lock().await;
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
