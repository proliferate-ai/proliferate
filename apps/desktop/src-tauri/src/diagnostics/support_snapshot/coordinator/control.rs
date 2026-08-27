use std::sync::{
    atomic::{AtomicBool, AtomicU8, AtomicUsize, Ordering},
    Arc,
};

use tokio::sync::{watch, Notify};

use super::finish::{FinishError, FinishResult};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub(super) enum PreparationInterruption {
    Running = 0,
    Cancelled = 1,
    Deadline = 2,
    Abandoned = 3,
}

/// One admitted preparation has one interruption decision and one idle fence.
/// The first cancellation/deadline request wins; all async and blocking work
/// observes that same decision.
pub(super) struct PreparationControl {
    interruption: AtomicU8,
    cancelled: Arc<AtomicBool>,
    deadline_expired: Arc<AtomicBool>,
    signal: watch::Sender<bool>,
    watchdog_stopped: AtomicBool,
    work: Arc<WorkFence>,
}

impl PreparationControl {
    pub(super) fn new() -> Arc<Self> {
        let (signal, _) = watch::channel(false);
        Arc::new(Self {
            interruption: AtomicU8::new(PreparationInterruption::Running as u8),
            cancelled: Arc::new(AtomicBool::new(false)),
            deadline_expired: Arc::new(AtomicBool::new(false)),
            signal,
            watchdog_stopped: AtomicBool::new(false),
            work: Arc::new(WorkFence::default()),
        })
    }

    pub(super) fn request(&self, interruption: PreparationInterruption) -> bool {
        debug_assert_ne!(interruption, PreparationInterruption::Running);
        if self
            .interruption
            .compare_exchange(
                PreparationInterruption::Running as u8,
                interruption as u8,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_err()
        {
            return false;
        }
        match interruption {
            PreparationInterruption::Cancelled => {
                self.cancelled.store(true, Ordering::Release);
            }
            PreparationInterruption::Deadline => {
                self.deadline_expired.store(true, Ordering::Release);
            }
            PreparationInterruption::Abandoned => {
                self.cancelled.store(true, Ordering::Release);
            }
            PreparationInterruption::Running => unreachable!(),
        }
        self.signal.send_replace(true);
        true
    }

    pub(super) fn interruption(&self) -> PreparationInterruption {
        match self.interruption.load(Ordering::Acquire) {
            1 => PreparationInterruption::Cancelled,
            2 => PreparationInterruption::Deadline,
            3 => PreparationInterruption::Abandoned,
            _ => PreparationInterruption::Running,
        }
    }

    pub(super) fn subscribe(&self) -> watch::Receiver<bool> {
        self.signal.subscribe()
    }

    pub(super) fn stop_watchdog(&self) {
        self.watchdog_stopped.store(true, Ordering::Release);
        self.signal.send_replace(true);
    }

    pub(super) fn watchdog_stopped(&self) -> bool {
        self.watchdog_stopped.load(Ordering::Acquire)
    }

    pub(super) fn cancelled_flag(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.cancelled)
    }

    pub(super) fn deadline_flag(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.deadline_expired)
    }

    pub(super) fn begin_work(&self) -> WorkGuard {
        WorkFence::begin(&self.work)
    }

    pub(super) fn finish_completion(&self) -> FinishCompletion {
        FinishCompletion {
            result: self.work.finish_result.clone(),
        }
    }

    pub(super) async fn wait_idle(&self) {
        self.work.wait_idle().await;
    }

    #[cfg(test)]
    pub(super) fn active_work(&self) -> usize {
        self.work.active.load(Ordering::Acquire)
    }
}

struct WorkFence {
    active: AtomicUsize,
    idle: Notify,
    finish_result: Arc<std::sync::Mutex<FinishCompletionState>>,
}

impl Default for WorkFence {
    fn default() -> Self {
        Self {
            active: AtomicUsize::new(0),
            idle: Notify::new(),
            finish_result: Arc::new(std::sync::Mutex::new(FinishCompletionState::default())),
        }
    }
}

impl WorkFence {
    fn begin(fence: &Arc<Self>) -> WorkGuard {
        fence.active.fetch_add(1, Ordering::AcqRel);
        WorkGuard {
            fence: Arc::clone(fence),
        }
    }

    async fn wait_idle(&self) {
        loop {
            let notified = self.idle.notified();
            if self.active.load(Ordering::Acquire) == 0 {
                return;
            }
            notified.await;
        }
    }
}

pub(super) struct FinishCompletion {
    result: Arc<std::sync::Mutex<FinishCompletionState>>,
}

impl FinishCompletion {
    pub(super) fn publish(&self, result: Result<FinishResult, FinishError>) {
        match self.result.lock() {
            Ok(mut slot) => slot.result = Some(result),
            Err(poisoned) => poisoned.into_inner().result = Some(result),
        }
    }

    pub(super) fn take(&self) -> Option<Result<FinishResult, FinishError>> {
        match self.result.lock() {
            Ok(mut slot) => slot.result.take(),
            Err(poisoned) => poisoned.into_inner().result.take(),
        }
    }

    pub(super) fn authorize(&self) -> bool {
        match self.result.lock() {
            Ok(mut slot) => {
                if slot.cleanup_claimed {
                    false
                } else {
                    slot.authorized = true;
                    true
                }
            }
            Err(poisoned) => {
                let mut slot = poisoned.into_inner();
                if slot.cleanup_claimed {
                    false
                } else {
                    slot.authorized = true;
                    true
                }
            }
        }
    }

    pub(super) fn claim_cleanup(&self) -> Option<FinishResult> {
        match self.result.lock() {
            Ok(mut slot) => slot.claim_cleanup(),
            Err(poisoned) => poisoned.into_inner().claim_cleanup(),
        }
    }
}

#[derive(Default)]
struct FinishCompletionState {
    result: Option<Result<FinishResult, FinishError>>,
    authorized: bool,
    cleanup_claimed: bool,
}

impl FinishCompletionState {
    fn claim_cleanup(&mut self) -> Option<FinishResult> {
        if self.cleanup_claimed || self.authorized {
            return None;
        }
        self.cleanup_claimed = true;
        match self.result.take() {
            Some(Ok(success)) => Some(success),
            _ => None,
        }
    }
}

pub(super) struct WorkGuard {
    fence: Arc<WorkFence>,
}

impl Drop for WorkGuard {
    fn drop(&mut self) {
        if self.fence.active.fetch_sub(1, Ordering::AcqRel) == 1 {
            self.fence.idle.notify_waiters();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn first_interruption_wins_and_idle_waits_for_every_guard() {
        let control = PreparationControl::new();
        let first = control.begin_work();
        let second = control.begin_work();
        assert!(control.request(PreparationInterruption::Cancelled));
        assert!(!control.request(PreparationInterruption::Deadline));
        assert_eq!(control.interruption(), PreparationInterruption::Cancelled);
        assert!(*control.subscribe().borrow());

        drop(first);
        let waiting = control.wait_idle();
        tokio::pin!(waiting);
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(1), &mut waiting)
                .await
                .is_err()
        );
        drop(second);
        waiting.await;
    }

    #[test]
    fn detached_finish_result_stays_owned_until_cleanup_consumes_it() {
        let control = PreparationControl::new();
        let reference = super::super::super::artifact_store::SupportArtifactReference {
            client_job_id: uuid::Uuid::from_u128(7).to_string(),
            artifact_id: format!("ssv1_{}", "a".repeat(64)),
            snapshot_id: uuid::Uuid::from_u128(8).to_string(),
            size_bytes: 1,
            sha256: "b".repeat(64),
        };
        let success = super::FinishResult {
            output: super::super::model::PreparedSupportSnapshotOutput {
                artifact_schema_version: 3,
                artifact_id: reference.artifact_id.clone(),
                snapshot_id: reference.snapshot_id.clone(),
                preparation_operation_id: uuid::Uuid::from_u128(11).to_string(),
                generated_at: "2026-08-12T00:00:00Z".to_string(),
                size_bytes: 1,
                sha256: "b".repeat(64),
                summary: super::super::model::PreparedSupportSnapshotSummaryOutput {
                    collector_records: 0,
                    fallback_records: 0,
                    sessions: 0,
                    omissions: 0,
                    truncations: 0,
                },
            },
            reference: reference.clone(),
        };
        control.finish_completion().publish(Ok(success));

        let taken = control
            .finish_completion()
            .claim_cleanup()
            .expect("owned result");
        assert_eq!(taken.reference, reference);
        assert!(control.finish_completion().claim_cleanup().is_none());
    }

    #[test]
    fn authorization_and_cleanup_claim_are_atomic() {
        let control = PreparationControl::new();
        assert!(control.finish_completion().authorize());
        assert!(control.finish_completion().claim_cleanup().is_none());

        let control = PreparationControl::new();
        assert!(control.finish_completion().claim_cleanup().is_none());
        assert!(!control.finish_completion().authorize());
    }
}
