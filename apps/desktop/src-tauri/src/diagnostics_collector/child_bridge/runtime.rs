#![cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]

//! Parent-side runtime for one protected child diagnostics bridge.
//!
//! One bridge reader and one serialized writer exist per child; the status
//! and flush request slots are fixed one-slot state, not growable maps. The
//! runtime is stored by the identity-stable process owner together with the
//! owned `Child`; a lost bridge is an observability degradation and never a
//! product failure.

use std::{
    os::fd::OwnedFd,
    os::unix::net::UnixStream,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};

use proliferate_diagnostics_client::{
    bridge::{
        framing::{send_frame, ReceivedFrame},
        wire::{
            valid_protocol_version, ChildFrame, DeliveryFence, ParentFrame, WireComponent,
            CHILD_BRIDGE_PROTOCOL_VERSION, CHILD_STATUS_RESPONSE_DEADLINE,
        },
    },
    ProducerStatusSnapshot,
};
use proliferate_diagnostics_protocol::v1::types::ComponentV1;
use tokio::sync::oneshot;

use super::{bootstrap, fallback_root::FallbackRootOutcome, reader::run_reader};
use crate::diagnostics_collector::supervisor::DiagnosticsCollectorSupervisor;

/// Maximum child share of the joined producer deadline.
pub(crate) const MAX_CHILD_FLUSH_DEADLINE_MS: u64 = 500;

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

/// Bounded internal per-component state for PR 6 consumption. It never
/// fabricates a producer snapshot: a lost bridge, a status timeout, or an
/// invalid returned snapshot all leave `producer` empty.
#[derive(Clone, Debug)]
pub(crate) struct DesktopChildDiagnosticsState {
    pub(crate) process: ChildProcessPresence,
    pub(crate) bridge: ChildBridgeConnection,
    pub(crate) producer: Option<ProducerStatusSnapshot>,
}

/// One flush or terminal result: the child's final snapshot plus, only when
/// every dispatched request closed coherently, its ordered delivery fence.
#[derive(Clone, Debug)]
pub(crate) struct ChildFlushResult {
    pub(crate) snapshot: ProducerStatusSnapshot,
    pub(crate) delivery_fence: Option<DeliveryFence>,
}

struct PendingRequest<T> {
    request_id: u64,
    respond: oneshot::Sender<T>,
}

struct SharedState {
    connection: ChildBridgeConnection,
    acked_producer_boot: Option<String>,
    flush_completed: bool,
    status_slot: Option<PendingRequest<ProducerStatusSnapshot>>,
    flush_slot: Option<PendingRequest<ChildFlushResult>>,
    completed_flush: Option<ChildFlushResult>,
    terminal: Option<ChildFlushResult>,
}

pub(super) struct BridgeShared {
    component: WireComponent,
    writer: Mutex<Option<UnixStream>>,
    reader_stop: AtomicBool,
    current_generation: AtomicU64,
    next_request_id: AtomicU64,
    state: Mutex<SharedState>,
}

impl BridgeShared {
    fn new(component: WireComponent, writer: UnixStream) -> Self {
        Self {
            component,
            writer: Mutex::new(Some(writer)),
            reader_stop: AtomicBool::new(false),
            current_generation: AtomicU64::new(0),
            next_request_id: AtomicU64::new(1),
            state: Mutex::new(SharedState {
                connection: ChildBridgeConnection::NotActivated,
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

    pub(super) fn set_current_generation(&self, generation: u64) {
        self.current_generation.store(generation, Ordering::Release);
    }

    /// Serializes one frame onto the bridge. Any send failure — including a
    /// short send inside the framing layer — closes the bridge permanently.
    pub(super) fn send(&self, frame: &ParentFrame, descriptors: &[i32]) -> Result<(), ()> {
        {
            let writer = self
                .writer
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            let Some(stream) = writer.as_ref() else {
                return Err(());
            };
            if send_frame(stream, frame, descriptors).is_ok() {
                return Ok(());
            }
        }
        self.mark_lost();
        Err(())
    }

    /// Permanent bridge loss: drops the writer, fails both one-slot requests
    /// (their senders drop, waking the callers with "unavailable"), and pins
    /// the connection state.
    pub(super) fn mark_lost(&self) {
        *self
            .writer
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = None;
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        state.connection = ChildBridgeConnection::Lost;
        state.status_slot = None;
        state.flush_slot = None;
    }

    /// Validates and applies one received child frame. Any violation of the
    /// closed protocol — rights on a child frame, an unknown version, a wrong
    /// component, an unsolicited or mismatched response, or a duplicate /
    /// pre-bootstrap / post-flush / wrong-boot / wrong-generation terminal —
    /// fails closed and terminates the bridge.
    pub(super) fn handle_child_frame(&self, received: ReceivedFrame<ChildFrame>) -> Result<(), ()> {
        if !received.descriptors.is_empty() {
            return Err(());
        }
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        match received.frame {
            ChildFrame::BootstrapAck {
                protocol_version,
                component,
                producer_boot_id,
            } if valid_protocol_version(protocol_version)
                && component == self.component
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
                && self.snapshot_matches(&state, &snapshot) =>
            {
                let Some(pending) = state.status_slot.take() else {
                    return Err(());
                };
                if pending.request_id != request_id {
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
                && self.snapshot_matches(&state, &snapshot) =>
            {
                let Some(pending) = state.flush_slot.take() else {
                    return Err(());
                };
                if pending.request_id != request_id {
                    return Err(());
                }
                // A fence whose boot or generation does not match current
                // state is rejected and cannot qualify delivery; the response
                // itself still resolves the request.
                let delivery_fence =
                    delivery_fence.filter(|fence| self.fence_matches(&state, fence));
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
            } if valid_protocol_version(protocol_version) && component == self.component => {
                if state.terminal.is_some()
                    || state.flush_completed
                    || state.acked_producer_boot.as_deref() != Some(producer_boot_id.as_str())
                    || !self.snapshot_matches(&state, &snapshot)
                {
                    return Err(());
                }
                if let Some(fence) = &delivery_fence {
                    if fence.producer_boot_id != producer_boot_id
                        || !self.fence_matches(&state, fence)
                    {
                        return Err(());
                    }
                }
                let result = ChildFlushResult {
                    snapshot,
                    delivery_fence,
                };
                state.terminal = Some(result.clone());
                // If a parent flush request and natural return cross, this
                // terminal result wins the one outstanding slot. The child
                // then suppresses a second terminal response for that race.
                if let Some(pending) = state.flush_slot.take() {
                    state.flush_completed = true;
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

    fn fence_matches(&self, state: &SharedState, fence: &DeliveryFence) -> bool {
        state.acked_producer_boot.as_deref() == Some(fence.producer_boot_id.as_str())
            && fence.generation == self.current_generation.load(Ordering::Acquire)
    }

    fn snapshot_matches(&self, state: &SharedState, snapshot: &ProducerStatusSnapshot) -> bool {
        let expected = match self.component {
            WireComponent::Anyharness => ComponentV1::Anyharness,
            WireComponent::DesktopWorker => ComponentV1::DesktopWorker,
        };
        snapshot.component == expected
            && state.acked_producer_boot.as_deref() == Some(snapshot.producer_boot_id.as_str())
    }
}

/// Parent-side bridge retained alongside the identity-stable owned `Child`.
pub(crate) struct ChildDiagnosticsBridge {
    shared: Arc<BridgeShared>,
    supervisor: Option<Arc<DiagnosticsCollectorSupervisor>>,
    shutdown_writer: Option<OwnedFd>,
    shutdown_signaled: AtomicBool,
    reader: Mutex<Option<thread::JoinHandle<()>>>,
    generation_task: Mutex<Option<tokio::task::JoinHandle<()>>>,
}

impl ChildDiagnosticsBridge {
    /// Sends the bootstrap frame, then starts the single reader thread and
    /// the generation-watch task. The fallback directory descriptor is
    /// consumed: transferred to the child, or closed on failure.
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
        Self {
            shared,
            supervisor: Some(supervisor),
            shutdown_writer: Some(shutdown_writer),
            shutdown_signaled: AtomicBool::new(false),
            reader: Mutex::new(reader),
            generation_task: Mutex::new(generation_task),
        }
    }

    /// Signals the child's dedicated shutdown descriptor exactly once. This
    /// closes child admission but starts no timer and keeps the bridge open
    /// for the flush/status that follow.
    pub(crate) fn signal_shutdown(&self) {
        if self.shutdown_signaled.swap(true, Ordering::AcqRel) {
            return;
        }
        if let Some(writer) = self.shutdown_writer.as_ref() {
            let byte = [1_u8];
            // SAFETY: one single-byte write to an owned, otherwise unused
            // pipe writer; the pipe buffer is empty so this cannot block.
            let _ = unsafe { libc::write(writer.as_raw_fd(), byte.as_ptr().cast(), byte.len()) };
        }
    }

    pub(crate) fn connection(&self) -> ChildBridgeConnection {
        self.shared
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .connection
    }

    pub(crate) fn acknowledged_producer_boot(&self) -> Option<String> {
        self.shared
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .acked_producer_boot
            .clone()
    }

    /// The cached at-most-once terminal status/fence, if the child returned
    /// naturally outside a completed parent flush.
    pub(crate) fn terminal_result(&self) -> Option<ChildFlushResult> {
        self.shared
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .terminal
            .clone()
    }

    pub(super) fn qualified_result(&self) -> Option<ChildFlushResult> {
        let state = self
            .shared
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        state
            .completed_flush
            .clone()
            .or_else(|| state.terminal.clone())
    }

    pub(super) fn component(&self) -> WireComponent {
        self.shared.component()
    }

    pub(super) fn supervisor(&self) -> Option<&DiagnosticsCollectorSupervisor> {
        self.supervisor.as_deref()
    }

    /// One-slot status RPC with the exact 100 ms caller-side deadline. A
    /// timeout cancels the slot and yields status unavailable.
    pub(crate) async fn request_status(&self) -> Option<ProducerStatusSnapshot> {
        let (respond, receiver) = oneshot::channel();
        let request_id = self.begin_request(|state| &mut state.status_slot, respond)?;
        let frame = ParentFrame::StatusRequest {
            protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
            request_id,
        };
        if self.shared.send(&frame, &[]).is_err() {
            self.cancel_slot(|state| &mut state.status_slot, request_id);
            return None;
        }
        match tokio::time::timeout(CHILD_STATUS_RESPONSE_DEADLINE, receiver).await {
            Ok(Ok(snapshot)) => Some(snapshot),
            _ => {
                self.cancel_slot(|state| &mut state.status_slot, request_id);
                None
            }
        }
    }

    /// One-slot flush RPC. The declared and awaited deadline both use only
    /// the caller's remaining milliseconds, capped at the joined 500 ms
    /// producer deadline; a missing response never extends it.
    pub(crate) async fn request_flush(&self, remaining: Duration) -> Option<ChildFlushResult> {
        let remaining_deadline_ms = u64::try_from(remaining.as_millis())
            .unwrap_or(u64::MAX)
            .min(MAX_CHILD_FLUSH_DEADLINE_MS);
        let (respond, receiver) = oneshot::channel();
        let request_id = self.begin_request(|state| &mut state.flush_slot, respond)?;
        let frame = ParentFrame::FlushRequest {
            protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
            request_id,
            remaining_deadline_ms,
        };
        if self.shared.send(&frame, &[]).is_err() {
            self.cancel_slot(|state| &mut state.flush_slot, request_id);
            return None;
        }
        let deadline = Duration::from_millis(remaining_deadline_ms);
        match tokio::time::timeout(deadline, receiver).await {
            Ok(Ok(result)) => Some(result),
            _ => {
                self.cancel_slot(|state| &mut state.flush_slot, request_id);
                None
            }
        }
    }

    /// Assembles the bounded per-component state. The producer snapshot is
    /// requested only through the one-slot RPC and only for a running child
    /// on a connected bridge; an invalid returned snapshot is discarded.
    pub(crate) async fn diagnostics_state(
        &self,
        process: ChildProcessPresence,
    ) -> DesktopChildDiagnosticsState {
        let bridge = self.connection();
        let producer = if process == ChildProcessPresence::Running
            && bridge == ChildBridgeConnection::Connected
        {
            self.request_status().await
        } else {
            None
        };
        DesktopChildDiagnosticsState {
            process,
            bridge,
            producer,
        }
    }

    pub(super) async fn finish_reader_after_reap(&self) {
        if let Some(task) = self
            .generation_task
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .take()
        {
            task.abort();
        }
        *self
            .shared
            .writer
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = None;
        let join = self
            .reader
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .take();
        let Some(join) = join else {
            return;
        };
        let mut result = tokio::task::spawn_blocking(move || join.join());
        if tokio::time::timeout(Duration::from_millis(100), &mut result)
            .await
            .is_err()
        {
            // The reaped producer itself cannot retain the socket. A timeout
            // therefore means an inherited descendant or ambiguous peer; no
            // buffered terminal frame is qualified and no owner blocks.
            self.shared.mark_lost();
            let _ = tokio::time::timeout(Duration::from_millis(100), &mut result).await;
        }
    }

    pub(crate) fn stop(&self) {
        self.close_and_join(true);
    }

    fn close_and_join(&self, stop_reader: bool) {
        if stop_reader {
            self.shared.reader_stop.store(true, Ordering::Release);
        }
        if let Some(task) = self
            .generation_task
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .take()
        {
            task.abort();
        }
        *self
            .shared
            .writer
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = None;
        if let Some(join) = self
            .reader
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .take()
        {
            let _ = join.join();
        }
    }

    fn begin_request<T>(
        &self,
        slot: impl Fn(&mut SharedState) -> &mut Option<PendingRequest<T>>,
        respond: oneshot::Sender<T>,
    ) -> Option<u64> {
        let request_id = self.shared.next_request_id.fetch_add(1, Ordering::Relaxed);
        let mut state = self
            .shared
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if state.connection != ChildBridgeConnection::Connected
            || state.flush_completed
            || state.terminal.is_some()
            || slot(&mut state).is_some()
        {
            return None;
        }
        *slot(&mut state) = Some(PendingRequest {
            request_id,
            respond,
        });
        Some(request_id)
    }

    fn cancel_slot<T>(
        &self,
        slot: impl Fn(&mut SharedState) -> &mut Option<PendingRequest<T>>,
        request_id: u64,
    ) {
        let mut state = self
            .shared
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if slot(&mut state)
            .as_ref()
            .is_some_and(|pending| pending.request_id == request_id)
        {
            *slot(&mut state) = None;
        }
    }
}

impl Drop for ChildDiagnosticsBridge {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
#[path = "runtime_tests.rs"]
mod tests;
