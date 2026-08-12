#![cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]

//! Deadline-bound requests and teardown for the parent bridge runtime.

use std::sync::{atomic::Ordering, TryLockError};
use std::time::{Duration, Instant};

use proliferate_diagnostics_client::bridge::wire::{
    ParentFrame, CHILD_BRIDGE_PROTOCOL_VERSION, CHILD_STATUS_RESPONSE_DEADLINE,
};
use tokio::sync::oneshot;
use tokio::time::Instant as TokioInstant;

use super::runtime::{
    BridgeShared, ChildBridgeConnection, ChildDiagnosticsBridge, ChildFlushResult,
    ChildProcessPresence, ChildProducerStatus, DesktopChildDiagnosticsState, PendingRequest,
    RequestBinding, SharedState, MAX_CHILD_FLUSH_DEADLINE_MS,
};

impl ChildProcessPresence {
    pub(crate) fn from_observation(
        observation: std::io::Result<Option<std::process::ExitStatus>>,
    ) -> Self {
        match observation {
            Ok(Some(_)) => Self::Exited,
            Ok(None) => Self::Running,
            Err(_) => Self::Invalid,
        }
    }
}

impl DesktopChildDiagnosticsState {
    pub(crate) fn without_bridge(process: ChildProcessPresence) -> Self {
        Self {
            process,
            bridge: ChildBridgeConnection::NotActivated,
            producer: if process == ChildProcessPresence::Invalid {
                ChildProducerStatus::Invalid
            } else {
                ChildProducerStatus::Unavailable
            },
        }
    }
}

impl BridgeShared {
    /// Classifies a malformed child frame for an outstanding status request
    /// before permanently failing the bridge closed.
    pub(super) fn mark_invalid(&self) {
        self.permanently_lost.store(true, Ordering::Release);
        self.wake_reader();
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        revoke_invalid_state(&mut state);
    }

    /// A status timeout owns only its request slot. If the reader currently
    /// owns the state lock, the dropped receiver still marks the slot stale;
    /// the next request clears it without changing bridge connectivity.
    pub(super) fn cancel_status_request(&self, request_id: u64) {
        let cancel = |state: &mut SharedState| {
            if state
                .status_slot
                .as_ref()
                .is_some_and(|pending| pending.request_id == request_id)
            {
                state.status_slot = None;
            }
        };
        match self.state.try_lock() {
            Ok(mut state) => cancel(&mut state),
            Err(TryLockError::Poisoned(error)) => cancel(&mut error.into_inner()),
            Err(TryLockError::WouldBlock) => {}
        }
    }
}

fn revoke_invalid_state(state: &mut SharedState) {
    state.connection = ChildBridgeConnection::Lost;
    if let Some(pending) = state.status_slot.take() {
        let _ = pending.respond.send(ChildProducerStatus::Invalid);
    }
    state.flush_slot = None;
    state.flush_completed = false;
    state.completed_flush = None;
    state.terminal = None;
}

impl ChildDiagnosticsBridge {
    pub(crate) async fn request_status(&self) -> ChildProducerStatus {
        self.request_status_until(TokioInstant::now() + CHILD_STATUS_RESPONSE_DEADLINE)
            .await
    }

    async fn request_status_until(&self, deadline: TokioInstant) -> ChildProducerStatus {
        let wire_remaining = deadline.saturating_duration_since(TokioInstant::now());
        let wire_deadline = Instant::now() + wire_remaining;
        let (request_id, receiver) = {
            let Ok(_transaction) = self.shared.lock_transaction_until(wire_deadline) else {
                return ChildProducerStatus::Unavailable;
            };
            let (respond, receiver) = oneshot::channel();
            let Some(request_id) =
                self.begin_request(|state| &mut state.status_slot, respond, wire_deadline)
            else {
                return ChildProducerStatus::Unavailable;
            };
            let frame = ParentFrame::StatusRequest {
                protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
                request_id,
            };
            if self.shared.send_until(&frame, &[], wire_deadline).is_err() {
                return ChildProducerStatus::Unavailable;
            }
            (request_id, receiver)
        };
        match tokio::time::timeout_at(deadline, receiver).await {
            Ok(Ok(status)) => status,
            Ok(Err(_)) => ChildProducerStatus::Unavailable,
            Err(_) => {
                self.shared.cancel_status_request(request_id);
                ChildProducerStatus::Unavailable
            }
        }
    }

    /// Uses the caller's absolute joined deadline for lock acquisition,
    /// frame send, and response wait; it never creates a fresh duration.
    pub(crate) async fn request_flush_until(
        &self,
        deadline: TokioInstant,
    ) -> Option<ChildFlushResult> {
        let wire_remaining = deadline.saturating_duration_since(TokioInstant::now());
        let wire_deadline = Instant::now() + wire_remaining;
        let _transaction = self
            .shared
            .lock_transaction_until(wire_deadline)
            .map_err(|_| self.shared.mark_lost())
            .ok()?;
        let remaining = deadline.saturating_duration_since(TokioInstant::now());
        let remaining_deadline_ms = u64::try_from(remaining.as_millis())
            .unwrap_or(u64::MAX)
            .min(MAX_CHILD_FLUSH_DEADLINE_MS);
        if remaining_deadline_ms == 0 {
            return None;
        }
        let (respond, receiver) = oneshot::channel();
        let request_id =
            self.begin_request(|state| &mut state.flush_slot, respond, wire_deadline)?;
        let frame = ParentFrame::FlushRequest {
            protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
            request_id,
            remaining_deadline_ms,
        };
        if self.shared.send_until(&frame, &[], wire_deadline).is_err() {
            return None;
        }
        drop(_transaction);
        match tokio::time::timeout_at(deadline, receiver).await {
            Ok(Ok(result)) => Some(result),
            Ok(Err(_)) => None,
            Err(_) => {
                self.shared.mark_lost();
                None
            }
        }
    }

    pub(crate) async fn diagnostics_state(
        &self,
        process: ChildProcessPresence,
    ) -> DesktopChildDiagnosticsState {
        self.diagnostics_state_until(
            process,
            TokioInstant::now() + CHILD_STATUS_RESPONSE_DEADLINE,
        )
        .await
    }

    pub(crate) async fn diagnostics_state_until(
        &self,
        process: ChildProcessPresence,
        deadline: TokioInstant,
    ) -> DesktopChildDiagnosticsState {
        let producer = match (process, self.connection()) {
            (ChildProcessPresence::Invalid, _) => ChildProducerStatus::Invalid,
            (ChildProcessPresence::Running, ChildBridgeConnection::Connected) => {
                self.request_status_until(deadline).await
            }
            _ => ChildProducerStatus::Unavailable,
        };
        DesktopChildDiagnosticsState {
            process,
            bridge: self.connection(),
            producer,
        }
    }

    /// Lets the reader consume a terminal frame/EOF only through the caller's
    /// existing deadline. A retained descendant is actively woken and the
    /// join handle is detached; no blocking join or second timeout exists.
    pub(super) async fn finish_reader_after_reap(&self, deadline: TokioInstant) {
        self.abort_generation_task();
        loop {
            let finished = match self.reader.try_lock() {
                Ok(reader) => reader
                    .as_ref()
                    .is_none_or(std::thread::JoinHandle::is_finished),
                Err(TryLockError::Poisoned(error)) => error
                    .into_inner()
                    .as_ref()
                    .is_none_or(std::thread::JoinHandle::is_finished),
                Err(TryLockError::WouldBlock) => false,
            };
            if finished {
                break;
            }
            if TokioInstant::now() >= deadline {
                self.shared.mark_lost();
                self.shared.request_reader_stop(true);
                break;
            }
            tokio::time::sleep(Duration::from_millis(2)).await;
        }
        let join = match self.reader.try_lock() {
            Ok(mut reader) => reader.take(),
            Err(TryLockError::Poisoned(error)) => {
                let mut reader = error.into_inner();
                reader.take()
            }
            Err(TryLockError::WouldBlock) => None,
        };
        if let Some(join) = join {
            if join.is_finished() {
                let _ = join.join();
            }
            // Dropping a still-running handle detaches it after shutdown has
            // woken the socket; product teardown never waits on the thread.
        }
        self.shared.request_reader_stop(false);
    }

    pub(crate) fn stop(&self) {
        self.abort_generation_task();
        self.shared.request_reader_stop(true);
        if let Some(signal) = &self.shutdown_signal {
            signal.close();
        }
        let join = match self.reader.try_lock() {
            Ok(mut reader) => reader.take(),
            Err(TryLockError::Poisoned(error)) => {
                let mut reader = error.into_inner();
                reader.take()
            }
            Err(TryLockError::WouldBlock) => None,
        };
        if let Some(join) = join {
            if join.is_finished() {
                let _ = join.join();
            }
        }
    }

    fn begin_request<T>(
        &self,
        slot: impl Fn(&mut SharedState) -> &mut Option<PendingRequest<T>>,
        respond: oneshot::Sender<T>,
        deadline: Instant,
    ) -> Option<u64> {
        if self.shared.is_permanently_lost() {
            return None;
        }
        let request_id = self.shared.next_request_id()?;
        let mut state = self.shared.lock_state_until(deadline).ok()?;
        let producer_boot_id = state.acked_producer_boot.clone()?;
        {
            let target_slot = slot(&mut state);
            if target_slot
                .as_ref()
                .is_some_and(|pending| pending.respond.is_closed())
            {
                *target_slot = None;
            }
        }
        if state.connection != ChildBridgeConnection::Connected
            || state.flush_completed
            || state.terminal.is_some()
            || slot(&mut state).is_some()
        {
            return None;
        }
        let binding = RequestBinding {
            collector: state.collector.clone(),
            producer_boot_id,
        };
        *slot(&mut state) = Some(PendingRequest {
            request_id,
            binding,
            respond,
        });
        Some(request_id)
    }

    fn abort_generation_task(&self) {
        let task = match self.generation_task.try_lock() {
            Ok(mut task) => task.take(),
            Err(TryLockError::Poisoned(error)) => {
                let mut task = error.into_inner();
                task.take()
            }
            Err(TryLockError::WouldBlock) => None,
        };
        if let Some(task) = task {
            task.abort();
        }
    }
}

impl Drop for ChildDiagnosticsBridge {
    fn drop(&mut self) {
        self.stop();
    }
}
