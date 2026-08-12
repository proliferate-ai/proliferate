#![cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]

//! Cloneable, nonawaiting ownership of one child's shutdown signal.

use std::os::fd::{AsRawFd, OwnedFd};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, TryLockError,
};
use std::time::{Duration, Instant};

const SIGNAL_LOCK_BUDGET: Duration = Duration::from_millis(1);

#[derive(Clone)]
pub(crate) struct ChildShutdownSignal {
    inner: Arc<SignalInner>,
}

struct SignalInner {
    writer: Mutex<Option<OwnedFd>>,
    signaled: AtomicBool,
    clean_eof_allowed: Arc<AtomicBool>,
}

impl ChildShutdownSignal {
    pub(super) fn new(writer: OwnedFd, clean_eof_allowed: Arc<AtomicBool>) -> Self {
        let flags = unsafe { libc::fcntl(writer.as_raw_fd(), libc::F_GETFL) };
        if flags >= 0 {
            let _ =
                unsafe { libc::fcntl(writer.as_raw_fd(), libc::F_SETFL, flags | libc::O_NONBLOCK) };
        }
        Self {
            inner: Arc::new(SignalInner {
                writer: Mutex::new(Some(writer)),
                signaled: AtomicBool::new(false),
                clean_eof_allowed,
            }),
        }
    }

    #[cfg(test)]
    pub(crate) fn for_test(writer: OwnedFd) -> Self {
        Self::new(writer, Arc::new(AtomicBool::new(false)))
    }

    /// Closes child admission exactly once without acquiring an async lock.
    pub(crate) fn signal(&self) {
        self.inner.clean_eof_allowed.store(true, Ordering::Release);
        if self.inner.signaled.swap(true, Ordering::AcqRel) {
            return;
        }
        let deadline = Instant::now() + SIGNAL_LOCK_BUDGET;
        let writer = loop {
            match self.inner.writer.try_lock() {
                Ok(writer) => break writer,
                Err(TryLockError::Poisoned(error)) => break error.into_inner(),
                Err(TryLockError::WouldBlock) if Instant::now() < deadline => {
                    std::thread::yield_now();
                }
                Err(TryLockError::WouldBlock) => {
                    // Permit the joined flush path to retry if a concurrent
                    // close occupied the slot for this whole bounded budget.
                    self.inner.signaled.store(false, Ordering::Release);
                    return;
                }
            }
        };
        let Some(writer) = writer.as_ref() else {
            return;
        };
        let byte = [1_u8];
        let _ = unsafe { libc::write(writer.as_raw_fd(), byte.as_ptr().cast(), byte.len()) };
    }

    pub(super) fn close(&self) {
        let deadline = Instant::now() + SIGNAL_LOCK_BUDGET;
        loop {
            match self.inner.writer.try_lock() {
                Ok(mut writer) => {
                    *writer = None;
                    return;
                }
                Err(TryLockError::Poisoned(error)) => {
                    *error.into_inner() = None;
                    return;
                }
                Err(TryLockError::WouldBlock) if Instant::now() < deadline => {
                    std::thread::yield_now();
                }
                Err(TryLockError::WouldBlock) => return,
            }
        }
    }

    #[cfg(test)]
    pub(super) fn is_signaled(&self) -> bool {
        self.inner.signaled.load(Ordering::Acquire)
    }
}
