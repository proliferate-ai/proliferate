use std::{path::PathBuf, sync::atomic::Ordering};

use tokio::sync::MutexGuard;

use super::{CloudWorkerLifecycle, CloudWorkerProcess, SharedCloudWorkerState};

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

pub(crate) async fn arm_terminal_shutdown_and_stop_worker(
    state: &SharedCloudWorkerState,
) -> Result<bool, String> {
    state.terminal_shutdown_armed.store(true, Ordering::Release);
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
        Ok(None) => process
            .child
            .kill()
            .await
            .map_err(|error| format!("Failed to stop Proliferate Worker: {error}")),
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
