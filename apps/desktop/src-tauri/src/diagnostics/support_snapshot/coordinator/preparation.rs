use std::sync::{Arc, Mutex as StdMutex};

use chrono::{DateTime, SecondsFormat, Utc};
use tokio::time::Duration;

use crate::diagnostics_collector::producer::lifecycle::support_lifecycle::SupportSnapshotPreparationFailureClassificationV1 as Failure;

use super::super::artifact_store::MAX_ARTIFACT_REFERENCES;
use super::super::schema::validate::{validate_id, validate_timestamp};
use super::capture::{capture_native_support_evidence, CaptureError};
use super::control::{PreparationControl, PreparationInterruption};
use super::finish::{finish_and_stage, FinishError, FinishResult, FinishWork};
use super::model::{
    BeginSupportSnapshotInput, FinishSupportSnapshotInput, PreparedSupportSnapshotOutput,
    SupportSnapshotPreparationOutput, SupportSnapshotSelectionInput, SupportSnapshotWindowOutput,
    SupportSnapshotWorkspaceInput, DISCLOSURE_VERSION, SESSION_EVIDENCE_BYTES,
};
use super::runtime::truncate_to_milliseconds;
use super::state::{
    ArtifactAuthorization, OpenPreparation, PreparationCleanup, PreparationPhase,
    PreparationTerminal, ReadinessState,
};
use super::terminal::{
    finish_error_code, interruption_error_code, note_export_permit_noncanonical_window,
    terminal_for_finish_error, terminal_for_interruption,
};
use super::watchdog::spawn_preparation_watchdog;
use super::SupportSnapshotCoordinator;

const PREPARATION_TIMEOUT: Duration = Duration::from_secs(25);
const FINISH_TIMEOUT: Duration = Duration::from_secs(10);
/// Exactly 900 seconds: the only duration the strict collector permit accepts.
const SUPPORT_WINDOW_SECONDS: i64 = 900;

impl SupportSnapshotCoordinator {
    pub(crate) async fn begin_preparation(
        self: &Arc<Self>,
        input: BeginSupportSnapshotInput,
    ) -> Result<SupportSnapshotPreparationOutput, String> {
        validate_begin(&input)?;
        // One raw UTC read owns the capture instant and both window endpoints,
        // truncated (never rounded) and never reparsed as a second clock.
        let captured = self.runtime.utc_now();
        validate_begin_times(&input, &captured)?;
        let captured = truncate_to_milliseconds(captured);
        let captured_at = captured.to_rfc3339_opts(SecondsFormat::Millis, true);
        let window_start = captured - chrono::Duration::seconds(SUPPORT_WINDOW_SECONDS);
        let source_time_from = window_start.to_rfc3339_opts(SecondsFormat::Millis, true);
        let source_time_to = captured_at.clone();
        let deadline = self.runtime.instant_now() + PREPARATION_TIMEOUT;
        let preparation_id = self.runtime.new_id();
        let snapshot_id = self.runtime.new_id();
        let control = PreparationControl::new();
        let _capture_work = control.begin_work();

        {
            let mut state = self.state.lock().await;
            if state.shutdown_armed
                || state.readiness != ReadinessState::Ready
                || self.store.is_none()
            {
                return Err("support_snapshot_not_ready".to_string());
            }
            if state.preparation.is_some() || state.closing_preparation.is_some() {
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
        };

        spawn_preparation_watchdog(self, preparation_id.clone(), deadline, Arc::clone(&control));

        let capture = match self.runtime.capture_error_override().await {
            Some(error) => Err(error),
            None => {
                capture_native_support_evidence(
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
                .await
            }
        };

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
            let closing = state
                .closing_preparation
                .as_ref()
                .filter(|closing| closing.preparation_id == preparation_id)
                .cloned();
            drop(state);
            drop(_capture_work);
            if let Some(closing) = closing {
                self.spawn_closing_owner(Arc::clone(&closing));
                closing.wait_completed().await;
                return Err(interruption_error_code(closing.interruption).to_string());
            }
            return Err("support_snapshot_stale_preparation".to_string());
        }
        if control.interruption() == PreparationInterruption::Running {
            match &capture {
                Err(CaptureError::Deadline) => {
                    control.request(PreparationInterruption::Deadline);
                }
                Err(CaptureError::Cancelled) => {
                    control.request(PreparationInterruption::Cancelled);
                }
                _ => {}
            }
        }
        if control.interruption() != PreparationInterruption::Running {
            let closing = state
                .transfer_preparation_to_closing(
                    &preparation_id,
                    terminal_for_interruption(control.interruption()),
                    PreparationCleanup::Interrupted,
                )
                .expect("matching interrupted preparation closes");
            drop(state);
            drop(_capture_work);
            self.spawn_closing_owner(Arc::clone(&closing));
            closing.wait_completed().await;
            return Err(interruption_error_code(closing.interruption).to_string());
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
            capture => {
                // First-wins: keep permit detail off an interrupted terminal.
                if control.interruption() == PreparationInterruption::Running
                    && capture
                        .as_ref()
                        .err()
                        .is_some_and(|error| error.is_noncanonical_window())
                {
                    if let Some(open) = state.preparation.as_ref() {
                        note_export_permit_noncanonical_window(&open.operation);
                    }
                }
                let closing = state
                    .transfer_preparation_to_closing(
                        &preparation_id,
                        PreparationTerminal::Failed(Failure::PreparationRejected),
                        PreparationCleanup::None,
                    )
                    .expect("matching rejected capture closes");
                drop(state);
                drop(_capture_work);
                self.spawn_closing_owner(Arc::clone(&closing));
                closing.wait_completed().await;
                Err("support_snapshot_preparation_rejected".to_string())
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
        let artifact_guard = self.artifact_gate.lock().await;
        let (work, control, finish_deadline, finish_work, finish_call_work) = {
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
                let open = state.preparation.as_ref().expect("matching preparation");
                open.control.request(PreparationInterruption::Deadline);
                let closing = state
                    .transfer_preparation_to_closing(
                        &input.preparation_id,
                        terminal_for_interruption(PreparationInterruption::Deadline),
                        PreparationCleanup::Interrupted,
                    )
                    .expect("matching preparation closes");
                drop(state);
                drop(artifact_guard);
                self.spawn_closing_owner(Arc::clone(&closing));
                closing.wait_completed().await;
                return Err(interruption_error_code(closing.interruption).to_string());
            }
            if state
                .preparation
                .as_ref()
                .is_some_and(|open| open.captured.is_none())
            {
                let closing = state
                    .transfer_preparation_to_closing(
                        &input.preparation_id,
                        PreparationTerminal::Failed(Failure::PreparationRejected),
                        PreparationCleanup::None,
                    )
                    .expect("matching rejected preparation closes");
                drop(state);
                drop(artifact_guard);
                self.spawn_closing_owner(Arc::clone(&closing));
                closing.wait_completed().await;
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
                Arc::clone(&open.control),
                finish_deadline,
                finish_work,
                finish_call_work,
            )
        };
        // Coordinator ownership survives a dropped finish invocation.
        spawn_preparation_watchdog(
            self,
            input.preparation_id.clone(),
            finish_deadline,
            Arc::clone(&control),
        );
        let mut signal = control.subscribe();
        let interrupted = async {
            loop {
                if control.interruption() != PreparationInterruption::Running {
                    return;
                }
                if signal.changed().await.is_err() {
                    return;
                }
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
            blocking_runtime.before_finish_result_publish();
            blocking_completion.publish(result);
        });
        let finish_timer = self.runtime.sleep_until(finish_deadline);
        tokio::pin!(finish_timer);
        tokio::select! {
            result = &mut task => { let _ = result; }
            _ = &mut finish_timer => {
                control.request(PreparationInterruption::Deadline);
                self.runtime.finish_timer_fired();
                let _ = task.await;
            }
            _ = &mut interrupted => {
                let _ = task.await;
            }
        }
        // The pre-lock check is only an optimization. The hard arbitration
        // happens again while holding the state/publication critical section.
        if control.interruption() == PreparationInterruption::Running
            && self.runtime.instant_now() >= finish_deadline
        {
            control.request(PreparationInterruption::Deadline);
        }
        self.runtime.before_finish_publication().await;
        let mut state = self.state.lock().await;
        let still_current = state.preparation.as_ref().is_some_and(|open| {
            open.preparation_id == input.preparation_id
                && open.input.consent_epoch == input.consent_epoch
                && open.phase == PreparationPhase::Finishing
        });
        if still_current && self.runtime.instant_now() >= finish_deadline {
            control.request(PreparationInterruption::Deadline);
        }
        if !still_current {
            let closing = state
                .closing_preparation
                .as_ref()
                .filter(|closing| closing.preparation_id == input.preparation_id)
                .cloned()
                .expect("admitted preparation remains visible while finish work is active");
            drop(state);
            drop(finish_call_work);
            drop(artifact_guard);
            self.spawn_closing_owner(Arc::clone(&closing));
            closing.wait_completed().await;
            return Err(interruption_error_code(closing.interruption).to_string());
        }
        if control.interruption() != PreparationInterruption::Running {
            let closing = state
                .transfer_preparation_to_closing(
                    &input.preparation_id,
                    terminal_for_interruption(control.interruption()),
                    PreparationCleanup::Interrupted,
                )
                .expect("current interrupted preparation closes");
            drop(state);
            drop(finish_call_work);
            drop(artifact_guard);
            self.spawn_closing_owner(Arc::clone(&closing));
            closing.wait_completed().await;
            return Err(interruption_error_code(closing.interruption).to_string());
        }

        let result = finish_completion
            .take()
            .unwrap_or(Err(FinishError::Manifest));

        match result {
            Ok(success) => {
                // Recheck immediately before authorization while this mutex
                // excludes watchdog, cancellation, and shutdown publication.
                if self.runtime.instant_now() >= finish_deadline {
                    control.request(PreparationInterruption::Deadline);
                }
                if control.interruption() != PreparationInterruption::Running {
                    finish_completion.publish(Ok(success));
                    let closing = state
                        .transfer_preparation_to_closing(
                            &input.preparation_id,
                            terminal_for_interruption(control.interruption()),
                            PreparationCleanup::Interrupted,
                        )
                        .expect("current interrupted preparation closes");
                    drop(state);
                    drop(finish_call_work);
                    drop(artifact_guard);
                    self.spawn_closing_owner(Arc::clone(&closing));
                    closing.wait_completed().await;
                    return Err(interruption_error_code(closing.interruption).to_string());
                }
                let FinishResult { output, reference } = success;
                state.closed_preparation = None;
                let authorization = ArtifactAuthorization {
                    reference,
                    preparation_id: Some(input.preparation_id.clone()),
                    preparation_operation_id: Some(output.preparation_operation_id.clone()),
                    consent_epoch: Some(input.consent_epoch.clone()),
                };
                if !finish_completion.authorize() {
                    let closing = state
                        .transfer_preparation_to_closing(
                            &input.preparation_id,
                            PreparationTerminal::Failed(Failure::PreparationRejected),
                            PreparationCleanup::StagedArtifact,
                        )
                        .expect("current rejected preparation closes");
                    drop(state);
                    drop(finish_call_work);
                    drop(artifact_guard);
                    self.spawn_closing_owner(Arc::clone(&closing));
                    closing.wait_completed().await;
                    return Err("support_snapshot_stale_preparation".to_string());
                }
                state
                    .artifacts
                    .insert(authorization.reference.artifact_id.clone(), authorization);
                let closing = state
                    .transfer_preparation_to_closing(
                        &input.preparation_id,
                        PreparationTerminal::Succeeded,
                        PreparationCleanup::None,
                    )
                    .expect("current successful preparation closes");
                drop(state);
                drop(finish_call_work);
                drop(artifact_guard);
                self.spawn_closing_owner(Arc::clone(&closing));
                closing.wait_completed().await;
                Ok(output)
            }
            Err(error @ (FinishError::Deadline | FinishError::Cancelled)) => {
                match error {
                    FinishError::Deadline => {
                        control.request(PreparationInterruption::Deadline);
                    }
                    _ => {
                        control.request(PreparationInterruption::Cancelled);
                    }
                }
                let closing = state
                    .transfer_preparation_to_closing(
                        &input.preparation_id,
                        terminal_for_interruption(control.interruption()),
                        PreparationCleanup::Interrupted,
                    )
                    .expect("current interrupted preparation closes");
                drop(state);
                drop(finish_call_work);
                drop(artifact_guard);
                self.spawn_closing_owner(Arc::clone(&closing));
                closing.wait_completed().await;
                Err(interruption_error_code(closing.interruption).to_string())
            }
            Err(error) => {
                let closing = state
                    .transfer_preparation_to_closing(
                        &input.preparation_id,
                        terminal_for_finish_error(error),
                        PreparationCleanup::None,
                    )
                    .expect("current failed preparation closes");
                drop(state);
                drop(finish_call_work);
                drop(artifact_guard);
                self.spawn_closing_owner(Arc::clone(&closing));
                closing.wait_completed().await;
                Err(finish_error_code(error).to_string())
            }
        }
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
    if report > granted || granted > *now {
        return Err("support_snapshot_invalid_input".to_string());
    }
    Ok(())
}

pub(super) fn canonical_uuid(value: &str) -> Result<(), String> {
    let parsed =
        uuid::Uuid::parse_str(value).map_err(|_| "support_snapshot_invalid_input".to_string())?;
    if parsed.to_string() != value {
        return Err("support_snapshot_invalid_input".to_string());
    }
    Ok(())
}
