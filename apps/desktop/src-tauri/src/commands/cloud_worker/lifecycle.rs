use std::{
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::atomic::Ordering,
};

use tokio::sync::MutexGuard;
use tokio::time::{timeout, Duration};

use proliferate_diagnostics_protocol::v1::types::TerminalOutcomeV1;

use crate::diagnostics::scrub_diagnostic_text;
use crate::diagnostics_collector::producer::{
    lifecycle::LifecycleOperation, TauriDiagnosticsProducer,
};

use super::{
    CloudWorkerLifecycle, CloudWorkerProcess, EnsureDesktopDispatchWorkerResult,
    SharedCloudWorkerState, StopDesktopDispatchWorkerResult,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum WorkerStartFailureKind {
    BinaryMissing,
    EarlyExit,
    InspectionFailed,
    SpawnFailed,
}

impl WorkerStartFailureKind {
    pub(super) const fn classification(self) -> &'static str {
        match self {
            Self::BinaryMissing => "binary_missing",
            Self::EarlyExit => "child_exited",
            Self::InspectionFailed => "child_inspection_failed",
            Self::SpawnFailed => "spawn_failed",
        }
    }
}

pub(super) struct WorkerStartFailure {
    pub(super) kind: WorkerStartFailureKind,
    pub(super) message: String,
}

impl WorkerStartFailure {
    pub(super) fn new(kind: WorkerStartFailureKind, message: String) -> Self {
        Self { kind, message }
    }
}

impl From<String> for WorkerStartFailure {
    fn from(message: String) -> Self {
        let kind = if message.starts_with("Proliferate Worker binary was not found") {
            WorkerStartFailureKind::BinaryMissing
        } else if message.starts_with("Proliferate Worker exited during startup") {
            WorkerStartFailureKind::EarlyExit
        } else if message.starts_with("Failed to inspect") {
            WorkerStartFailureKind::InspectionFailed
        } else {
            WorkerStartFailureKind::SpawnFailed
        };
        Self { kind, message }
    }
}

impl Drop for CloudWorkerProcess {
    fn drop(&mut self) {
        let _ = self.child.start_kill();
    }
}

pub(super) async fn lock_for_worker_start(
    state: &SharedCloudWorkerState,
) -> Option<MutexGuard<'_, CloudWorkerLifecycle>> {
    let lifecycle = state.lifecycle.lock().await;
    (!state.terminal_shutdown_armed.load(Ordering::Acquire)).then_some(lifecycle)
}

/// Reuse the matching live Worker when no fresh enrollment is requested;
/// otherwise stop it through the verified owned-handle path before rotation.
pub(super) async fn prepare_existing_worker_for_ensure(
    lifecycle: &mut CloudWorkerLifecycle,
    target_id: &str,
    fresh_enrollment: bool,
) -> Result<Option<PathBuf>, String> {
    if let Some(process) = lifecycle.process.as_mut() {
        if matches!(process.child.try_wait(), Ok(None))
            && process.target_id == target_id
            && !fresh_enrollment
        {
            return Ok(Some(process.config_path.clone()));
        }
    }
    stop_process(lifecycle).await?;
    Ok(None)
}

pub(super) async fn prepare_existing_worker_for_ensure_observed(
    lifecycle: &mut CloudWorkerLifecycle,
    target_id: &str,
    fresh_enrollment: bool,
    producer: &TauriDiagnosticsProducer,
) -> Result<Option<PathBuf>, String> {
    let should_record_stop = lifecycle.process.as_mut().is_some_and(|process| {
        !matches!(
            process.child.try_wait(),
            Ok(None) if process.target_id == target_id && !fresh_enrollment
        )
    });
    let operation =
        should_record_stop.then(|| producer.begin_lifecycle("desktop.worker_process.stop"));
    let result = prepare_existing_worker_for_ensure(lifecycle, target_id, fresh_enrollment).await;
    match (&result, operation) {
        (Ok(Some(_)), Some(operation)) => operation.terminal(TerminalOutcomeV1::Skipped, None),
        (Ok(None), Some(operation)) => operation.terminal(TerminalOutcomeV1::Succeeded, None),
        (Err(error), Some(operation)) => finish_failed_stop(operation, error),
        (_, None) => {}
    }
    result
}

pub(super) fn finish_worker_start_operation(
    operation: LifecycleOperation,
    result: &Result<EnsureDesktopDispatchWorkerResult, WorkerStartFailure>,
) {
    match result {
        Ok(result) if result.status == "started" => {
            operation.terminal(TerminalOutcomeV1::Succeeded, None)
        }
        Ok(result) if result.status == "terminal_shutdown_armed" => {
            operation.terminal(TerminalOutcomeV1::Rejected, Some("shutdown_armed"))
        }
        Ok(_) => operation.terminal(TerminalOutcomeV1::Skipped, None),
        Err(error) => {
            operation.terminal(TerminalOutcomeV1::Failed, Some(error.kind.classification()))
        }
    }
}

pub(super) fn finish_worker_stop_operation(
    operation: LifecycleOperation,
    result: &Result<StopDesktopDispatchWorkerResult, String>,
) {
    match result {
        Ok(result) if result.stopped => operation.terminal(TerminalOutcomeV1::Succeeded, None),
        Ok(_) => operation.terminal(TerminalOutcomeV1::Skipped, None),
        Err(error) => finish_failed_stop(operation, error),
    }
}

fn finish_failed_stop(operation: LifecycleOperation, error: &str) {
    if error.starts_with("Timed out") {
        operation.terminal(TerminalOutcomeV1::TimedOut, Some("shutdown_timeout"));
    } else if error.starts_with("Failed to inspect") {
        operation.terminal(TerminalOutcomeV1::Failed, Some("child_inspection_failed"));
    } else {
        operation.terminal(TerminalOutcomeV1::Failed, Some("shutdown_failed"));
    }
}

pub(crate) async fn prepare_desktop_dispatch_worker_update(
    state: &SharedCloudWorkerState,
    installer_exits_process: bool,
) -> Result<(), String> {
    if !installer_exits_process {
        return Ok(());
    }

    arm_terminal_shutdown_and_stop_worker(state).await?;
    Ok(())
}

pub(crate) fn arm_terminal_shutdown(state: &SharedCloudWorkerState) {
    state.terminal_shutdown_armed.store(true, Ordering::Release);
}

pub(crate) async fn arm_terminal_shutdown_and_stop_worker(
    state: &SharedCloudWorkerState,
) -> Result<bool, String> {
    arm_terminal_shutdown(state);
    let mut lifecycle = state.lifecycle.lock().await;
    stop_process(&mut lifecycle).await
}

/// Stops and reaps the tracked Worker launcher before Desktop exits.
///
/// Tauri's desktop event loop terminates with `std::process::exit`, which skips
/// Rust destructors. `CloudWorkerProcess::drop` remains a best-effort fallback
/// for ordinary state replacement, but app shutdown must call this explicitly
/// or the Worker survives and keeps its database lock into the next launch.
pub(crate) async fn stop_tracked_desktop_dispatch_worker(
    state: &SharedCloudWorkerState,
) -> Result<bool, String> {
    let mut lifecycle = state.lifecycle.lock().await;
    stop_process(&mut lifecycle).await
}

#[cfg(test)]
pub(crate) async fn install_shutdown_test_child(
    state: &SharedCloudWorkerState,
    child: tokio::process::Child,
) {
    let mut lifecycle = state.lifecycle.lock().await;
    lifecycle.process = Some(CloudWorkerProcess {
        target_id: "shutdown-fixture".to_string(),
        child,
        config_path: PathBuf::from("shutdown-fixture.toml"),
    });
}

/// Fails the next stop attempt only. Later attempts run the real reap, which is
/// how a shutdown retry is exercised.
#[cfg(test)]
pub(crate) async fn inject_shutdown_test_stop_error(state: &SharedCloudWorkerState, error: String) {
    let mut lifecycle = state.lifecycle.lock().await;
    lifecycle.injected_stop_error = Some(error);
}

async fn stop_process(lifecycle: &mut CloudWorkerLifecycle) -> Result<bool, String> {
    if lifecycle.process.is_none() {
        return Ok(false);
    }

    #[cfg(test)]
    if let Some(error) = lifecycle.injected_stop_error.take() {
        return finish_stop_attempt(lifecycle, Err(error));
    }

    let process = lifecycle
        .process
        .as_mut()
        .expect("process presence checked above");

    let stop_result = match process.child.try_wait() {
        Ok(Some(_)) => Ok(()),
        Ok(None) => {
            process
                .child
                .start_kill()
                .map_err(|error| format!("Failed to stop Proliferate Worker: {error}"))?;
            timeout(Duration::from_secs(2), process.child.wait())
                .await
                .map_err(|_| "Timed out stopping Proliferate Worker".to_string())?
                .map(|_| ())
                .map_err(|error| format!("Failed to reap Proliferate Worker: {error}"))
        }
        // Do not fall through to `kill` after an ambiguous inspection error.
        // On Unix, `ECHILD` can mean another reaper collected this child while
        // std still has no cached status; its kill fallback uses the bare PID
        // and could signal an unrelated process after PID reuse. Retaining the
        // owned handle and returning the classified error is the fail-closed
        // choice. On Windows, a valid process handle is identity-stable across
        // exit, while an invalid-handle error cannot verify shutdown; retain
        // either way.
        Err(error) => Err(format!(
            "Failed to inspect Proliferate Worker shutdown: {error}"
        )),
    };
    finish_stop_attempt(lifecycle, stop_result)
}

/// Clears the owned handle only after shutdown has been verified.
///
/// Both credential rotation and a Windows updater retry must still see the
/// child after a failed `try_wait` or `kill`; otherwise rotation loses its
/// retry handle or the installer can exit while the Worker still owns its
/// lock.
fn finish_stop_attempt(
    lifecycle: &mut CloudWorkerLifecycle,
    stop_result: Result<(), String>,
) -> Result<bool, String> {
    stop_result?;
    lifecycle.process = None;
    Ok(true)
}

pub(super) const WORKER_LOG_TAIL_MAX_BYTES: u64 = 64 * 1024;

pub(super) fn worker_startup_failure_message(
    status: &str,
    log_path: &Path,
    log_tail: &str,
) -> String {
    let scrubbed_log_path = scrub_diagnostic_text(&log_path.to_string_lossy());
    let mut message = format!(
        "Proliferate Worker exited during startup with {status}. See {scrubbed_log_path} for output."
    );
    if !log_tail.is_empty() {
        message.push_str("\n\nLast worker log lines:\n");
        message.push_str(log_tail);
    }
    message
}

/// Best-effort context for a startup error returned to the renderer. The
/// worker log is truncated for every launch. Read only a fixed suffix so this
/// error path cannot allocate or block in proportion to total log volume.
pub(super) fn read_worker_log_tail(path: &Path, max_lines: usize) -> String {
    let Ok(mut file) = std::fs::File::open(path) else {
        return String::new();
    };
    let Ok(file_len) = file.metadata().map(|metadata| metadata.len()) else {
        return String::new();
    };
    let read_len = file_len.min(WORKER_LOG_TAIL_MAX_BYTES) as usize;
    let start = file_len.saturating_sub(read_len as u64);
    if file.seek(SeekFrom::Start(start)).is_err() {
        return String::new();
    }
    let mut bytes = vec![0; read_len];
    if file.read_exact(&mut bytes).is_err() {
        return String::new();
    }
    let contents = String::from_utf8_lossy(&bytes);
    let lines = contents.lines().collect::<Vec<_>>();
    let start = lines.len().saturating_sub(max_lines);
    scrub_diagnostic_text(&lines[start..].join("\n"))
}
