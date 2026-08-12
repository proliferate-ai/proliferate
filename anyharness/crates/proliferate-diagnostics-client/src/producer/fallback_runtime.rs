use std::sync::{
    atomic::{AtomicBool, AtomicU32, Ordering},
    Arc, Mutex, TryLockError,
};

use proliferate_diagnostics_protocol::v1::types::ProducerRecordV1;
use tokio::task::JoinHandle;
use tokio::time::Instant as TokioInstant;

use super::{ProducerFailureClassification, ProducerInner, ResidentRecord};
use crate::fallback::{FallbackError, FallbackReason, FallbackStatus, FallbackWriter};

pub(super) struct FallbackController {
    writer: Mutex<Option<FallbackWriter>>,
    active: AtomicBool,
    bytes: AtomicU32,
    deadline_abandoned: AtomicBool,
    #[cfg(test)]
    next_stall: Mutex<Option<TestWriteStall>>,
    #[cfg(test)]
    before_restore: Mutex<Option<TestRestoreBarrier>>,
}

impl FallbackController {
    pub(super) fn new(writer: Option<FallbackWriter>) -> Self {
        let status = writer
            .as_ref()
            .map(FallbackWriter::current_status)
            .unwrap_or(FallbackStatus {
                active: false,
                bytes: 0,
            });
        Self {
            writer: Mutex::new(writer),
            active: AtomicBool::new(status.active),
            bytes: AtomicU32::new(status.bytes),
            deadline_abandoned: AtomicBool::new(false),
            #[cfg(test)]
            next_stall: Mutex::new(None),
            #[cfg(test)]
            before_restore: Mutex::new(None),
        }
    }

    pub(super) fn status(&self) -> FallbackStatus {
        FallbackStatus {
            active: self.active.load(Ordering::Acquire),
            bytes: self.bytes.load(Ordering::Acquire),
        }
    }

    fn start(
        self: &Arc<Self>,
        reason: FallbackReason,
        record: ProducerRecordV1,
    ) -> Result<FallbackOperation, StartFailure> {
        if !self.active.load(Ordering::Acquire) {
            return Err(self.unavailable_reason());
        }
        let writer = match self.writer.try_lock() {
            Ok(mut slot) => slot.take(),
            Err(TryLockError::Poisoned(error)) => error.into_inner().take(),
            Err(TryLockError::WouldBlock) => {
                self.active.store(false, Ordering::Release);
                return Err(self.unavailable_reason());
            }
        };
        let Some(mut writer) = writer else {
            self.active.store(false, Ordering::Release);
            return Err(self.unavailable_reason());
        };
        #[cfg(test)]
        let stall = self
            .next_stall
            .try_lock()
            .ok()
            .and_then(|mut slot| slot.take());
        let task_controller = Arc::clone(self);
        let task = tokio::task::spawn_blocking(move || {
            if task_controller.deadline_abandoned.load(Ordering::Acquire) {
                return FallbackTaskOutput::Unstarted(writer);
            }
            #[cfg(test)]
            if let Some(stall) = stall {
                stall.wait();
            }
            let result = writer.write(reason, &record);
            FallbackTaskOutput::Completed { writer, result }
        });
        Ok(FallbackOperation {
            controller: Arc::clone(self),
            task,
            armed: true,
        })
    }

    pub(super) fn abandon_at_deadline(&self) {
        self.deadline_abandoned.store(true, Ordering::Release);
        self.active.store(false, Ordering::Release);
        match self.writer.try_lock() {
            Ok(mut slot) => {
                slot.take();
            }
            Err(TryLockError::Poisoned(error)) => {
                error.into_inner().take();
            }
            Err(TryLockError::WouldBlock) => {}
        }
    }

    fn unavailable_reason(&self) -> StartFailure {
        if self.deadline_abandoned.load(Ordering::Acquire) {
            StartFailure::Deadline
        } else {
            StartFailure::Unavailable
        }
    }

    fn complete(
        &self,
        joined: Result<FallbackTaskOutput, tokio::task::JoinError>,
    ) -> FallbackExecution {
        let Ok(output) = joined else {
            if self.deadline_abandoned.load(Ordering::Acquire) {
                return FallbackExecution::Deadline;
            }
            self.active.store(false, Ordering::Release);
            return FallbackExecution::Failed { overflow: false };
        };
        let (writer, result) = match output {
            FallbackTaskOutput::Completed { writer, result } => (writer, result),
            FallbackTaskOutput::Unstarted(writer) => {
                drop(writer);
                return FallbackExecution::Deadline;
            }
        };
        if self.deadline_abandoned.load(Ordering::Acquire) {
            drop(writer);
            return FallbackExecution::Deadline;
        }
        if !self.active.load(Ordering::Acquire) {
            drop(writer);
            return FallbackExecution::Failed { overflow: false };
        }
        let status = writer.current_status();
        self.bytes.store(status.bytes, Ordering::Release);
        #[cfg(test)]
        if let Some(barrier) = self
            .before_restore
            .try_lock()
            .ok()
            .and_then(|mut slot| slot.take())
        {
            barrier.wait();
        }
        if status.active && self.restore(writer) {
            if self.deadline_abandoned.load(Ordering::Acquire) {
                self.abandon_at_deadline();
                return FallbackExecution::Deadline;
            }
            return match result {
                Ok(_) => FallbackExecution::Written,
                Err(error) => FallbackExecution::Failed {
                    overflow: error.is_overflow(),
                },
            };
        }
        if self.deadline_abandoned.load(Ordering::Acquire) {
            return FallbackExecution::Deadline;
        }
        self.active.store(false, Ordering::Release);
        match result {
            Err(error) => FallbackExecution::Failed {
                overflow: error.is_overflow(),
            },
            Ok(_) => FallbackExecution::Failed { overflow: false },
        }
    }

    fn restore(&self, writer: FallbackWriter) -> bool {
        if self.deadline_abandoned.load(Ordering::Acquire) || !self.active.load(Ordering::Acquire) {
            return false;
        }
        let mut slot = match self.writer.try_lock() {
            Ok(slot) => slot,
            Err(TryLockError::Poisoned(error)) => error.into_inner(),
            Err(TryLockError::WouldBlock) => return false,
        };
        if slot.is_some()
            || self.deadline_abandoned.load(Ordering::Acquire)
            || !self.active.load(Ordering::Acquire)
        {
            return false;
        }
        *slot = Some(writer);
        true
    }

    fn deadline_won(&self) -> bool {
        self.deadline_abandoned.load(Ordering::Acquire)
    }

    #[cfg(test)]
    pub(super) fn stall_next_write(
        &self,
    ) -> (
        std::sync::mpsc::Receiver<()>,
        std::sync::mpsc::SyncSender<()>,
    ) {
        let (entered, entered_rx) = std::sync::mpsc::sync_channel(1);
        let (release, release_rx) = std::sync::mpsc::sync_channel(1);
        let mut slot = self.next_stall.lock().expect("fallback test stall");
        assert!(slot
            .replace(TestWriteStall {
                entered,
                release_rx
            })
            .is_none());
        (entered_rx, release)
    }

    #[cfg(test)]
    pub(super) fn stall_next_restore(
        &self,
    ) -> (
        std::sync::mpsc::Receiver<()>,
        std::sync::mpsc::SyncSender<()>,
    ) {
        let (entered, entered_rx) = std::sync::mpsc::sync_channel(1);
        let (release, release_rx) = std::sync::mpsc::sync_channel(1);
        let mut slot = self
            .before_restore
            .lock()
            .expect("fallback restore barrier");
        assert!(slot
            .replace(TestRestoreBarrier {
                entered,
                release_rx
            })
            .is_none());
        (entered_rx, release)
    }

    #[cfg(test)]
    pub(super) fn close_for_test(&self) {
        self.active.store(false, Ordering::Release);
        self.writer.lock().expect("fallback writer slot").take();
    }
}

enum FallbackTaskOutput {
    Completed {
        writer: FallbackWriter,
        result: Result<u32, FallbackError>,
    },
    Unstarted(FallbackWriter),
}

struct FallbackOperation {
    controller: Arc<FallbackController>,
    task: JoinHandle<FallbackTaskOutput>,
    armed: bool,
}

impl FallbackOperation {
    fn task(&mut self) -> &mut JoinHandle<FallbackTaskOutput> {
        &mut self.task
    }

    fn complete(
        mut self,
        joined: Result<FallbackTaskOutput, tokio::task::JoinError>,
    ) -> FallbackExecution {
        self.armed = false;
        self.controller.complete(joined)
    }

    fn abandon(mut self) {
        self.armed = false;
        self.controller.abandon_at_deadline();
        self.task.abort();
        // A running blocking syscall cannot be cancelled. Dropping its handle
        // deliberately detaches at most this writer and this one record. Any
        // late bytes are possible, but no result or writer can rejoin state.
    }
}

impl Drop for FallbackOperation {
    fn drop(&mut self) {
        if self.armed {
            self.controller.abandon_at_deadline();
            self.task.abort();
        }
    }
}

#[derive(Clone, Copy)]
enum StartFailure {
    Unavailable,
    Deadline,
}

#[derive(Clone, Copy)]
enum FallbackExecution {
    Written,
    Failed { overflow: bool },
    Deadline,
}

enum OperationWait {
    Joined(Result<FallbackTaskOutput, tokio::task::JoinError>),
    Deadline,
    Notified,
}

pub(super) async fn route_fallback(
    inner: &ProducerInner,
    records: Vec<ResidentRecord>,
    deadline: Option<TokioInstant>,
) {
    if waiting_for_parent_deadline(inner) {
        let mut state = inner
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        for record in records.into_iter().rev() {
            state.queue.push_front(record);
        }
        state.clear_in_flight();
        drop(state);
        inner.notify.notify_one();
        return;
    }
    let mut outcomes = Vec::with_capacity(records.len());
    for record in &records {
        let reason = record
            .fallback_reason
            .unwrap_or(FallbackReason::CollectorUnavailable);
        outcomes.push(execute_write(inner, reason, record.record.clone(), deadline).await);
    }
    let mut state = inner
        .state
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    // The parent deadline can expire and release this sole in-flight batch
    // before a detached blocking operation returns. That terminal owner wins.
    if state.in_flight.is_empty() {
        return;
    }
    let deadline_won = inner.fallback.deadline_won();
    for (record, outcome) in records.iter().zip(outcomes) {
        if record.is_loss_summary {
            state.return_loss_snapshot();
        }
        let outcome = if deadline_won {
            FallbackExecution::Deadline
        } else {
            outcome
        };
        match outcome {
            FallbackExecution::Written => {
                state.fallback_routed = state
                    .fallback_routed
                    .saturating_add(1)
                    .min(proliferate_diagnostics_protocol::v1::limits::MAX_SAFE_INTEGER);
            }
            FallbackExecution::Failed { overflow } => state.record_loss_with_sequence(
                if overflow {
                    ProducerFailureClassification::FallbackOverflow
                } else {
                    ProducerFailureClassification::FallbackWriteFailed
                },
                Some(record.record.producer_sequence),
            ),
            FallbackExecution::Deadline => {
                state.delivery_fence_eligible = false;
                state.record_loss_with_sequence(
                    ProducerFailureClassification::ShutdownTimeout,
                    Some(record.record.producer_sequence),
                );
            }
        }
        state.release_record(record);
    }
    state.clear_in_flight();
}

async fn execute_write(
    inner: &ProducerInner,
    reason: FallbackReason,
    record: ProducerRecordV1,
    initial_deadline: Option<TokioInstant>,
) -> FallbackExecution {
    let mut deadline = earlier_deadline(initial_deadline, inner.terminal_deadline());
    if deadline.is_some_and(|deadline| TokioInstant::now() >= deadline) {
        inner.fallback.abandon_at_deadline();
        return FallbackExecution::Deadline;
    }
    let mut operation = match inner.fallback.start(reason, record) {
        Ok(operation) => operation,
        Err(StartFailure::Deadline) => return FallbackExecution::Deadline,
        Err(StartFailure::Unavailable) => return FallbackExecution::Failed { overflow: false },
    };
    loop {
        deadline = earlier_deadline(deadline, inner.terminal_deadline());
        let wait = match deadline {
            Some(deadline) => {
                tokio::select! {
                    biased;
                    _ = tokio::time::sleep_until(deadline) => OperationWait::Deadline,
                    joined = operation.task() => OperationWait::Joined(joined),
                    _ = inner.notify.notified() => OperationWait::Notified,
                }
            }
            None => {
                tokio::select! {
                    biased;
                    joined = operation.task() => OperationWait::Joined(joined),
                    _ = inner.notify.notified() => OperationWait::Notified,
                }
            }
        };
        match wait {
            OperationWait::Joined(joined) => return operation.complete(joined),
            OperationWait::Deadline => {
                operation.abandon();
                return FallbackExecution::Deadline;
            }
            OperationWait::Notified => {}
        }
    }
}

fn earlier_deadline(
    first: Option<TokioInstant>,
    second: Option<TokioInstant>,
) -> Option<TokioInstant> {
    match (first, second) {
        (Some(first), Some(second)) => Some(first.min(second)),
        (Some(deadline), None) | (None, Some(deadline)) => Some(deadline),
        (None, None) => None,
    }
}

fn waiting_for_parent_deadline(inner: &ProducerInner) -> bool {
    let state = inner
        .state
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    state.parent_shutdown_observed && state.terminal_deadline.is_none()
}

#[cfg(test)]
struct TestWriteStall {
    entered: std::sync::mpsc::SyncSender<()>,
    release_rx: std::sync::mpsc::Receiver<()>,
}

#[cfg(test)]
struct TestRestoreBarrier {
    entered: std::sync::mpsc::SyncSender<()>,
    release_rx: std::sync::mpsc::Receiver<()>,
}

#[cfg(test)]
impl TestWriteStall {
    fn wait(self) {
        let _ = self.entered.send(());
        let _ = self.release_rx.recv();
    }
}

#[cfg(test)]
impl TestRestoreBarrier {
    fn wait(self) {
        let _ = self.entered.send(());
        let _ = self.release_rx.recv();
    }
}
