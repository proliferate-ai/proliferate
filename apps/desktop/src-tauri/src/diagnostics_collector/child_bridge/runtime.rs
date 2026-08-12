#![cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]

//! Parent-side state machine for one protected child diagnostics bridge.

use std::{
    net::Shutdown,
    os::fd::OwnedFd,
    os::unix::net::UnixStream,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, MutexGuard, TryLockError,
    },
    thread,
    time::{Duration, Instant},
};

use proliferate_diagnostics_client::{
    bridge::{
        framing::{send_frame_until, ReceivedFrame},
        wire::{valid_protocol_version, ChildFrame, DeliveryFence, ParentFrame, WireComponent},
    },
    ProducerStatusSnapshot,
};
use proliferate_diagnostics_protocol::v1::{limits::MAX_SAFE_INTEGER, types::ComponentV1};
use tokio::sync::oneshot;

use super::{
    bootstrap,
    fallback_root::FallbackRootOutcome,
    identity::{valid_id, CollectorIdentity},
    reader::run_reader,
    shutdown_signal::ChildShutdownSignal,
};
use crate::diagnostics_collector::supervisor::DiagnosticsCollectorSupervisor;

pub(crate) const MAX_CHILD_FLUSH_DEADLINE_MS: u64 = 500;
pub(super) const FRAME_COMPLETION_DEADLINE: Duration = Duration::from_millis(100);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ChildProcessPresence {
    Missing,
    Running,
    Exited,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ChildBridgeConnection {
    NotActivated,
    Connected,
    Lost,
}

#[derive(Clone, Debug)]
pub(crate) struct DesktopChildDiagnosticsState {
    pub(crate) process: ChildProcessPresence,
    pub(crate) bridge: ChildBridgeConnection,
    pub(crate) producer: Option<ProducerStatusSnapshot>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ChildFlushResult {
    pub(crate) snapshot: ProducerStatusSnapshot,
    pub(crate) delivery_fence: Option<DeliveryFence>,
}

#[derive(Clone)]
pub(super) struct RequestBinding {
    pub(super) collector: CollectorIdentity,
    pub(super) producer_boot_id: String,
}

pub(super) struct PendingRequest<T> {
    pub(super) request_id: u64,
    pub(super) binding: RequestBinding,
    pub(super) respond: oneshot::Sender<T>,
}

pub(super) struct SharedState {
    pub(super) connection: ChildBridgeConnection,
    pub(super) collector: CollectorIdentity,
    pub(super) acked_producer_boot: Option<String>,
    pub(super) flush_completed: bool,
    pub(super) status_slot: Option<PendingRequest<ProducerStatusSnapshot>>,
    pub(super) flush_slot: Option<PendingRequest<ChildFlushResult>>,
    pub(super) completed_flush: Option<ChildFlushResult>,
    pub(super) terminal: Option<ChildFlushResult>,
}

pub(super) struct BridgeShared {
    component: WireComponent,
    transaction: Mutex<()>,
    writer: Mutex<Option<UnixStream>>,
    reader_waker: Option<UnixStream>,
    reader_stop: AtomicBool,
    permanently_lost: AtomicBool,
    pub(super) clean_eof_allowed: Arc<AtomicBool>,
    next_request_id: AtomicU64,
    pub(super) state: Mutex<SharedState>,
}

impl BridgeShared {
    pub(super) fn new(component: WireComponent, writer: UnixStream) -> Self {
        let reader_waker = writer.try_clone().ok();
        Self {
            component,
            transaction: Mutex::new(()),
            writer: Mutex::new(Some(writer)),
            reader_waker,
            reader_stop: AtomicBool::new(false),
            permanently_lost: AtomicBool::new(false),
            clean_eof_allowed: Arc::new(AtomicBool::new(false)),
            next_request_id: AtomicU64::new(1),
            state: Mutex::new(SharedState {
                connection: ChildBridgeConnection::NotActivated,
                collector: CollectorIdentity::unavailable(0).expect("zero is safe"),
                acked_producer_boot: None,
                flush_completed: false,
                status_slot: None,
                flush_slot: None,
                completed_flush: None,
                terminal: None,
            }),
        }
    }

    pub(super) fn component(&self) -> WireComponent {
        self.component
    }

    /// Serializes collector publication/frame delivery with request
    /// registration/frame delivery. Acquiring it is always charged to the
    /// caller's existing absolute deadline.
    pub(super) fn lock_transaction_until(
        &self,
        deadline: Instant,
    ) -> Result<MutexGuard<'_, ()>, ()> {
        loop {
            match self.transaction.try_lock() {
                Ok(transaction) => return Ok(transaction),
                Err(TryLockError::Poisoned(error)) => return Ok(error.into_inner()),
                Err(TryLockError::WouldBlock) if Instant::now() < deadline => {
                    thread::yield_now();
                }
                Err(TryLockError::WouldBlock) => return Err(()),
            }
        }
    }

    /// Publishes availability, generation, and boot as one coherent value.
    /// Any change cancels requests and revokes proof tied to the old value.
    pub(super) fn publish_collector_until(
        &self,
        collector: CollectorIdentity,
        deadline: Instant,
    ) -> Result<(), ()> {
        let mut state = self.lock_state_until(deadline)?;
        if state.collector == collector {
            return Ok(());
        }
        state.collector = collector;
        state.status_slot = None;
        state.flush_slot = None;
        revoke_proof(&mut state);
        Ok(())
    }

    #[cfg(test)]
    pub(super) fn set_ready_collector(&self, generation: u64, collector_boot_id: &str) {
        self.publish_collector_until(
            CollectorIdentity::ready(generation, collector_boot_id.to_owned())
                .expect("test collector identity is valid"),
            Instant::now() + Duration::from_secs(1),
        )
        .expect("test collector publication");
    }

    pub(super) fn send_until(
        &self,
        frame: &ParentFrame,
        descriptors: &[i32],
        deadline: Instant,
    ) -> Result<(), ()> {
        if self.is_permanently_lost() {
            return Err(());
        }
        let result = loop {
            match self.writer.try_lock() {
                Ok(writer) => {
                    let Some(stream) = writer.as_ref() else {
                        break Err(());
                    };
                    break send_frame_until(stream, frame, descriptors, deadline).map_err(|_| ());
                }
                Err(TryLockError::Poisoned(error)) => {
                    let writer = error.into_inner();
                    let Some(stream) = writer.as_ref() else {
                        break Err(());
                    };
                    break send_frame_until(stream, frame, descriptors, deadline).map_err(|_| ());
                }
                Err(TryLockError::WouldBlock) if Instant::now() < deadline => {
                    thread::yield_now();
                }
                Err(TryLockError::WouldBlock) => break Err(()),
            }
        };
        if result.is_err() {
            self.mark_lost();
        }
        result
    }

    pub(super) fn lock_state_until(
        &self,
        deadline: Instant,
    ) -> Result<MutexGuard<'_, SharedState>, ()> {
        loop {
            match self.state.try_lock() {
                Ok(state) => return Ok(state),
                Err(TryLockError::Poisoned(error)) => return Ok(error.into_inner()),
                Err(TryLockError::WouldBlock) if Instant::now() < deadline => {
                    thread::yield_now();
                }
                Err(TryLockError::WouldBlock) => return Err(()),
            }
        }
    }

    pub(super) fn mark_lost(&self) {
        self.permanently_lost.store(true, Ordering::Release);
        self.wake_reader();
        match self.state.try_lock() {
            Ok(mut state) => revoke_lost_state(&mut state),
            Err(TryLockError::Poisoned(error)) => revoke_lost_state(&mut error.into_inner()),
            Err(TryLockError::WouldBlock) => {}
        }
    }

    /// EOF is proof-preserving only for a terminal frame, or for a completed
    /// parent flush after the dedicated shutdown descriptor was signaled.
    pub(super) fn mark_clean_eof(&self) {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        let preserve = state.terminal.is_some()
            || (self.clean_eof_allowed.load(Ordering::Acquire) && state.completed_flush.is_some());
        state.connection = ChildBridgeConnection::Lost;
        state.status_slot = None;
        state.flush_slot = None;
        if !preserve {
            revoke_proof(&mut state);
        }
    }

    pub(super) fn handle_child_frame(&self, received: ReceivedFrame<ChildFrame>) -> Result<(), ()> {
        if !received.descriptors.is_empty() {
            return Err(());
        }
        if self.permanently_lost.load(Ordering::Acquire) {
            return Err(());
        }
        // Shares the request/publication transaction. A terminal frame can
        // therefore either win before request registration (so no request is
        // sent), or resolve a slot whose FlushRequest is already fully sent.
        let _transaction = self
            .transaction
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        match received.frame {
            ChildFrame::BootstrapAck {
                protocol_version,
                component,
                producer_boot_id,
            } if valid_protocol_version(protocol_version)
                && component == self.component
                && valid_id(&producer_boot_id)
                && state.connection == ChildBridgeConnection::NotActivated =>
            {
                state.connection = ChildBridgeConnection::Connected;
                state.acked_producer_boot = Some(producer_boot_id);
            }
            ChildFrame::StatusResponse {
                protocol_version,
                request_id,
                snapshot,
            } if valid_protocol_version(protocol_version)
                && request_id <= MAX_SAFE_INTEGER
                && state.connection == ChildBridgeConnection::Connected =>
            {
                let pending = state.status_slot.take().ok_or(())?;
                if pending.request_id != request_id
                    || !response_matches(self.component, &state, &pending.binding, &snapshot)
                {
                    return Err(());
                }
                let _ = pending.respond.send(snapshot);
            }
            ChildFrame::FlushResponse {
                protocol_version,
                request_id,
                snapshot,
                delivery_fence,
            } if valid_protocol_version(protocol_version)
                && request_id <= MAX_SAFE_INTEGER
                && state.connection == ChildBridgeConnection::Connected =>
            {
                let pending = state.flush_slot.take().ok_or(())?;
                if pending.request_id != request_id
                    || !response_matches(self.component, &state, &pending.binding, &snapshot)
                    || delivery_fence.as_ref().is_some_and(|fence| {
                        !pending.binding.collector.matches_fence(&snapshot, fence)
                    })
                {
                    return Err(());
                }
                let result = ChildFlushResult {
                    snapshot,
                    delivery_fence,
                };
                state.flush_completed = true;
                state.completed_flush = Some(result.clone());
                let _ = pending.respond.send(result);
            }
            ChildFrame::TerminalStatus {
                protocol_version,
                component,
                producer_boot_id,
                snapshot,
                delivery_fence,
            } if valid_protocol_version(protocol_version)
                && component == self.component
                && state.connection == ChildBridgeConnection::Connected =>
            {
                let binding = RequestBinding {
                    collector: state.collector.clone(),
                    producer_boot_id: producer_boot_id.clone(),
                };
                if state.terminal.is_some()
                    || state.flush_completed
                    || state.acked_producer_boot.as_deref() != Some(producer_boot_id.as_str())
                    || !response_matches(self.component, &state, &binding, &snapshot)
                    || delivery_fence
                        .as_ref()
                        .is_some_and(|fence| !binding.collector.matches_fence(&snapshot, fence))
                {
                    return Err(());
                }
                let result = ChildFlushResult {
                    snapshot,
                    delivery_fence,
                };
                state.terminal = Some(result.clone());
                if let Some(pending) = state.flush_slot.take() {
                    if pending.binding.collector != binding.collector
                        || pending.binding.producer_boot_id != binding.producer_boot_id
                    {
                        return Err(());
                    }
                    state.flush_completed = true;
                    state.completed_flush = Some(result.clone());
                    let _ = pending.respond.send(result);
                }
            }
            _ => return Err(()),
        }
        Ok(())
    }

    pub(super) fn reader_should_stop(&self) -> bool {
        self.reader_stop.load(Ordering::Acquire)
    }

    pub(super) fn is_permanently_lost(&self) -> bool {
        self.permanently_lost.load(Ordering::Acquire)
    }

    pub(super) fn allow_clean_eof(&self) {
        self.clean_eof_allowed.store(true, Ordering::Release);
    }

    pub(super) fn request_reader_stop(&self, revoke: bool) {
        self.reader_stop.store(true, Ordering::Release);
        if revoke {
            self.permanently_lost.store(true, Ordering::Release);
            match self.state.try_lock() {
                Ok(mut state) => revoke_lost_state(&mut state),
                Err(TryLockError::Poisoned(error)) => revoke_lost_state(&mut error.into_inner()),
                Err(TryLockError::WouldBlock) => {}
            }
        }
        self.wake_reader();
    }

    pub(super) fn next_request_id(&self) -> Option<u64> {
        loop {
            let current = self.next_request_id.load(Ordering::Relaxed);
            if current == 0 || current > MAX_SAFE_INTEGER {
                return None;
            }
            if self
                .next_request_id
                .compare_exchange_weak(current, current + 1, Ordering::Relaxed, Ordering::Relaxed)
                .is_ok()
            {
                return Some(current);
            }
        }
    }

    fn wake_reader(&self) {
        if let Some(stream) = &self.reader_waker {
            let _ = stream.shutdown(Shutdown::Both);
        }
        if let Ok(mut writer) = self.writer.try_lock() {
            *writer = None;
        }
    }
}

fn response_matches(
    component: WireComponent,
    state: &SharedState,
    binding: &RequestBinding,
    snapshot: &ProducerStatusSnapshot,
) -> bool {
    let expected_component = match component {
        WireComponent::Anyharness => ComponentV1::Anyharness,
        WireComponent::DesktopWorker => ComponentV1::DesktopWorker,
    };
    snapshot.component == expected_component
        && state.collector == binding.collector
        && state.acked_producer_boot.as_deref() == Some(binding.producer_boot_id.as_str())
        && snapshot.producer_boot_id == binding.producer_boot_id
        && binding.collector.matches_snapshot(snapshot)
}

fn revoke_proof(state: &mut SharedState) {
    state.flush_completed = false;
    state.completed_flush = None;
    state.terminal = None;
}

fn revoke_lost_state(state: &mut SharedState) {
    state.connection = ChildBridgeConnection::Lost;
    state.status_slot = None;
    state.flush_slot = None;
    revoke_proof(state);
}

pub(crate) struct ChildDiagnosticsBridge {
    pub(super) shared: Arc<BridgeShared>,
    pub(super) supervisor: Option<Arc<DiagnosticsCollectorSupervisor>>,
    pub(super) shutdown_signal: Option<ChildShutdownSignal>,
    pub(super) reader: Mutex<Option<thread::JoinHandle<()>>>,
    pub(super) generation_task: Mutex<Option<tokio::task::JoinHandle<()>>>,
}

impl ChildDiagnosticsBridge {
    pub(crate) fn start(
        component: WireComponent,
        bridge: UnixStream,
        shutdown_writer: OwnedFd,
        supervisor: Arc<DiagnosticsCollectorSupervisor>,
        fallback: FallbackRootOutcome,
    ) -> Self {
        let reader_stream = bridge.try_clone();
        let shared = Arc::new(BridgeShared::new(component, bridge));
        let mut generation_rx = supervisor.subscribe_generation();
        bootstrap::send_bootstrap(&shared, &supervisor, &mut generation_rx, fallback);
        let reader = reader_stream.ok().and_then(|stream| {
            let reader_shared = Arc::clone(&shared);
            thread::Builder::new()
                .name("child-diagnostics-bridge".to_owned())
                .spawn(move || run_reader(reader_shared, stream))
                .ok()
        });
        if reader.is_none() {
            shared.mark_lost();
        }
        let generation_task = tokio::runtime::Handle::try_current().ok().map(|handle| {
            handle.spawn(bootstrap::run_generation_task(
                Arc::clone(&shared),
                Arc::clone(&supervisor),
                generation_rx,
            ))
        });
        let shutdown_signal =
            ChildShutdownSignal::new(shutdown_writer, Arc::clone(&shared.clean_eof_allowed));
        Self {
            shared,
            supervisor: Some(supervisor),
            shutdown_signal: Some(shutdown_signal),
            reader: Mutex::new(reader),
            generation_task: Mutex::new(generation_task),
        }
    }

    pub(crate) fn signal_shutdown(&self) {
        self.shared.allow_clean_eof();
        if let Some(signal) = &self.shutdown_signal {
            signal.signal();
        }
    }

    pub(crate) fn shutdown_signal(&self) -> Option<ChildShutdownSignal> {
        self.shutdown_signal.clone()
    }

    pub(crate) fn connection(&self) -> ChildBridgeConnection {
        if self.shared.is_permanently_lost() {
            return ChildBridgeConnection::Lost;
        }
        match self.shared.state.try_lock() {
            Ok(state) => state.connection,
            Err(TryLockError::Poisoned(error)) => error.into_inner().connection,
            Err(TryLockError::WouldBlock) => ChildBridgeConnection::Lost,
        }
    }

    pub(crate) fn acknowledged_producer_boot(&self) -> Option<String> {
        match self.shared.state.try_lock() {
            Ok(state) => state.acked_producer_boot.clone(),
            Err(TryLockError::Poisoned(error)) => error.into_inner().acked_producer_boot.clone(),
            Err(TryLockError::WouldBlock) => None,
        }
    }

    pub(crate) fn terminal_result(&self) -> Option<ChildFlushResult> {
        if self.shared.is_permanently_lost() {
            return None;
        }
        match self.shared.state.try_lock() {
            Ok(state) => state.terminal.clone(),
            Err(TryLockError::Poisoned(error)) => error.into_inner().terminal.clone(),
            Err(TryLockError::WouldBlock) => None,
        }
    }

    pub(super) fn qualified_result(&self) -> Option<ChildFlushResult> {
        if self.shared.is_permanently_lost() {
            return None;
        }
        match self.shared.state.try_lock() {
            Ok(state) => state
                .completed_flush
                .clone()
                .or_else(|| state.terminal.clone()),
            Err(TryLockError::Poisoned(error)) => {
                let state = error.into_inner();
                state
                    .completed_flush
                    .clone()
                    .or_else(|| state.terminal.clone())
            }
            Err(TryLockError::WouldBlock) => None,
        }
    }

    pub(super) fn component(&self) -> WireComponent {
        self.shared.component()
    }

    pub(super) fn supervisor(&self) -> Option<&DiagnosticsCollectorSupervisor> {
        self.supervisor.as_deref()
    }
}

#[cfg(test)]
#[path = "runtime_identity_tests.rs"]
mod identity_tests;
#[cfg(test)]
#[path = "runtime_tests.rs"]
mod tests;
