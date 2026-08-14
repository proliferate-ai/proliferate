use std::sync::atomic::Ordering;

use super::{RuntimeInfo, RuntimeStatus, SidecarProcess, SidecarState, DEFAULT_HOST};

impl SidecarProcess {
    pub(super) fn new(port: u16) -> Self {
        Self {
            child: None,
            #[cfg(all(
                target_os = "macos",
                any(target_arch = "aarch64", target_arch = "x86_64")
            ))]
            diagnostics_bridge: None,
            observer_generation: 0,
            exit_observer: None,
            info: RuntimeInfo {
                url: format!("http://{DEFAULT_HOST}:{port}"),
                port,
                status: RuntimeStatus::Stopped,
            },
            launch_env: Default::default(),
            #[cfg(test)]
            suppress_runtime_info_persistence: false,
        }
    }

    #[cfg(all(
        target_os = "macos",
        any(target_arch = "aarch64", target_arch = "x86_64")
    ))]
    pub(super) fn clear_diagnostics_bridge(&mut self) {
        self.diagnostics_bridge = None;
    }

    #[cfg(not(all(
        target_os = "macos",
        any(target_arch = "aarch64", target_arch = "x86_64")
    )))]
    pub(super) fn clear_diagnostics_bridge(&mut self) {}
}

impl Drop for SidecarProcess {
    fn drop(&mut self) {
        if let Some(observer) = self.exit_observer.take() {
            observer.abort();
        }
        if let Some(ref mut child) = self.child {
            let _ = child.start_kill();
        }
    }
}

impl SidecarState {
    pub async fn lock(&self) -> tokio::sync::MutexGuard<'_, SidecarProcess> {
        self.process.lock().await
    }

    pub(super) fn shutdown_is_armed(&self) -> bool {
        self.terminal_shutdown_armed.load(Ordering::Acquire)
    }

    pub(super) fn arm_terminal_shutdown(&self) {
        self.terminal_shutdown_armed.store(true, Ordering::Release);
        #[cfg(all(
            target_os = "macos",
            any(target_arch = "aarch64", target_arch = "x86_64")
        ))]
        {
            // This outer slot is assignment-only and never held across an
            // await or I/O. Taking it orders the signal before Arm can return
            // and broker cancellation can begin, without touching the async
            // process lifecycle mutex.
            let signal = self
                .child_shutdown_signal
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .as_ref()
                .cloned();
            if let Some(signal) = signal {
                signal.signal();
            }
        }
    }

    #[cfg(all(
        target_os = "macos",
        any(target_arch = "aarch64", target_arch = "x86_64")
    ))]
    pub(super) fn set_child_shutdown_signal(
        &self,
        signal: Option<
            crate::diagnostics_collector::child_bridge::shutdown_signal::ChildShutdownSignal,
        >,
    ) {
        let retry = signal.clone();
        {
            *self
                .child_shutdown_signal
                .lock()
                .unwrap_or_else(|error| error.into_inner()) = signal;
        }
        // Completes the handshake when Arm published before this child
        // signal was installed.
        if self.terminal_shutdown_armed.load(Ordering::Acquire) {
            if let Some(signal) = retry {
                signal.signal();
            }
        }
    }
}
