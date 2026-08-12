#[cfg(test)]
use std::path::PathBuf;
#[cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
use std::sync::atomic::Ordering;

#[cfg(test)]
use tokio::process::Child;

use super::{CloudWorkerProcess, CloudWorkerState};

impl CloudWorkerState {
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

    #[cfg(all(
        target_os = "macos",
        any(target_arch = "aarch64", target_arch = "x86_64")
    ))]
    pub(super) fn signal_child_shutdown(&self) {
        // This outer slot is assignment-only and never held across an await
        // or I/O. Taking it here orders the signal before Arm can return and
        // broker cancellation can begin, without touching the async process
        // lifecycle mutex.
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

    #[cfg(not(all(
        target_os = "macos",
        any(target_arch = "aarch64", target_arch = "x86_64")
    )))]
    pub(super) fn signal_child_shutdown(&self) {}
}

impl CloudWorkerProcess {
    #[cfg(test)]
    pub(super) fn untracked(target_id: String, child: Child, config_path: PathBuf) -> Self {
        Self {
            target_id,
            child,
            config_path,
            observer_generation: 0,
            #[cfg(all(
                target_os = "macos",
                any(target_arch = "aarch64", target_arch = "x86_64")
            ))]
            bridge: None,
            #[cfg(all(
                target_os = "macos",
                any(target_arch = "aarch64", target_arch = "x86_64")
            ))]
            drainers: Vec::new(),
            #[cfg(all(
                target_os = "macos",
                any(target_arch = "aarch64", target_arch = "x86_64")
            ))]
            tail: super::tail::SharedWorkerTail::new(),
        }
    }
}

#[cfg(all(
    test,
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
mod tests {
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
    use std::sync::{mpsc, Arc, Barrier};
    use std::time::{Duration, Instant};

    use super::super::{lifecycle, CloudWorkerState};
    use crate::diagnostics_collector::child_bridge::shutdown_signal::ChildShutdownSignal;

    fn signal_pair() -> (ChildShutdownSignal, OwnedFd) {
        let mut descriptors = [0_i32; 2];
        assert_eq!(unsafe { libc::pipe(descriptors.as_mut_ptr()) }, 0);
        let (reader, writer) = unsafe {
            (
                OwnedFd::from_raw_fd(descriptors[0]),
                OwnedFd::from_raw_fd(descriptors[1]),
            )
        };
        (ChildShutdownSignal::for_test(writer), reader)
    }

    fn assert_signaled(reader: &OwnedFd) {
        let mut byte = [0_u8; 1];
        assert_eq!(
            unsafe { libc::read(reader.as_raw_fd(), byte.as_mut_ptr().cast(), 1) },
            1
        );
        assert_eq!(byte, [1]);
    }

    #[tokio::test]
    async fn arm_signals_worker_while_lifecycle_owner_is_held_and_flush_is_bounded() {
        let state = Arc::new(CloudWorkerState::default());
        let (signal, reader) = signal_pair();
        state.set_child_shutdown_signal(Some(signal));
        let _owner = state.lifecycle.lock().await;

        let started = Instant::now();
        lifecycle::arm_terminal_shutdown(&state);
        assert_signaled(&reader);
        lifecycle::flush_child_diagnostics(
            &state,
            tokio::time::Instant::now() + Duration::from_millis(20),
        )
        .await;
        assert!(started.elapsed() < Duration::from_millis(500));
    }

    #[test]
    fn arm_return_is_ordered_after_a_contended_worker_signal_slot() {
        let state = Arc::new(CloudWorkerState::default());
        let (signal, reader) = signal_pair();
        state.set_child_shutdown_signal(Some(signal));
        let slot = state.child_shutdown_signal.lock().expect("signal slot");
        let barrier = Arc::new(Barrier::new(2));
        let (returned_tx, returned_rx) = mpsc::channel();
        let arm_state = Arc::clone(&state);
        let arm_barrier = Arc::clone(&barrier);
        let arm = std::thread::spawn(move || {
            arm_barrier.wait();
            lifecycle::arm_terminal_shutdown(&arm_state);
            returned_tx.send(()).expect("arm return receipt");
        });
        barrier.wait();
        assert!(returned_rx.recv_timeout(Duration::from_millis(20)).is_err());
        drop(slot);
        returned_rx
            .recv_timeout(Duration::from_millis(500))
            .expect("Arm returned after signaling");
        arm.join().expect("Arm thread");
        assert_signaled(&reader);
    }

    #[test]
    fn armed_bit_closes_worker_signal_install_race() {
        let state = Arc::new(CloudWorkerState::default());
        lifecycle::arm_terminal_shutdown(&state);
        let (signal, reader) = signal_pair();
        state.set_child_shutdown_signal(Some(signal));
        assert_signaled(&reader);
    }
}
