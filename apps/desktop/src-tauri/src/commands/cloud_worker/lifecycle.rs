use std::sync::atomic::Ordering;

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
    let Some(process) = lifecycle.process.as_mut() else {
        return Ok(false);
    };

    let stop_result = match process.child.try_wait() {
        Ok(Some(_)) => Ok(()),
        Ok(None) => process
            .child
            .kill()
            .await
            .map_err(|error| format!("Failed to stop Proliferate Worker: {error}")),
        Err(error) => Err(format!(
            "Failed to inspect Proliferate Worker shutdown: {error}"
        )),
    };
    lifecycle.process = None;
    stop_result?;
    Ok(true)
}
