use std::{
    net::Shutdown,
    os::fd::{AsRawFd, OwnedFd},
    os::unix::net::UnixStream,
    sync::{mpsc, Arc},
    thread,
    time::{Duration, Instant},
};

use proliferate_diagnostics_protocol::v1::limits::MAX_SAFE_INTEGER;

use crate::bridge::{
    activation::collector_generation_from_received,
    framing::{receive_frame_until, send_frame_until},
    wire::{
        valid_protocol_version, ChildFrame, ParentFrame, CHILD_BOOTSTRAP_READ_DEADLINE,
        CHILD_BRIDGE_PROTOCOL_VERSION, CHILD_STATUS_RESPONSE_DEADLINE,
    },
};

use super::ProducerInner;

pub(crate) struct BridgeRuntime {
    commands: mpsc::SyncSender<BridgeCommand>,
    stop_stream: Option<UnixStream>,
    join: Option<thread::JoinHandle<()>>,
}

enum BridgeCommand {
    Terminal {
        deadline: Instant,
        completed: mpsc::SyncSender<bool>,
    },
    Stop,
}

impl BridgeRuntime {
    pub(crate) fn start(
        inner: Arc<ProducerInner>,
        bridge: UnixStream,
        shutdown: OwnedFd,
        runtime: tokio::runtime::Handle,
    ) -> Result<Self, ()> {
        let stop_stream = bridge.try_clone().map_err(|_| ())?;
        let (commands, receiver) = mpsc::sync_channel(1);
        let join = thread::Builder::new()
            .name("desktop-diagnostics-bridge".to_owned())
            .spawn(move || {
                crate::tracing_layer::with_suppression(|| {
                    run(inner, bridge, shutdown, runtime, receiver)
                })
            })
            .map_err(|_| ())?;
        Ok(Self {
            commands,
            stop_stream: Some(stop_stream),
            join: Some(join),
        })
    }

    pub(crate) async fn send_terminal_until(&mut self, deadline: tokio::time::Instant) {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return;
        }
        let wire_deadline = Instant::now() + remaining;
        let (completed, receiver) = mpsc::sync_channel(1);
        if self
            .commands
            .try_send(BridgeCommand::Terminal {
                deadline: wire_deadline,
                completed,
            })
            .is_err()
        {
            return;
        }
        // `recv_timeout` itself is blocking, so poll the completion channel
        // cooperatively; neither this async task nor bridge Drop can extend
        // the original guard-owned absolute deadline.
        loop {
            match receiver.try_recv() {
                Ok(_) | Err(mpsc::TryRecvError::Disconnected) => return,
                Err(mpsc::TryRecvError::Empty) => {}
            }
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            if remaining.is_zero() {
                return;
            }
            tokio::time::sleep(remaining.min(Duration::from_millis(1))).await;
        }
    }

    pub(crate) fn stop(&mut self) {
        let _ = self.commands.try_send(BridgeCommand::Stop);
        if let Some(stream) = self.stop_stream.take() {
            let _ = stream.shutdown(Shutdown::Both);
        }
        if let Some(join) = self.join.take() {
            if join.is_finished() {
                let _ = join.join();
            }
        }
    }
}

impl Drop for BridgeRuntime {
    fn drop(&mut self) {
        self.stop();
    }
}

fn run(
    inner: Arc<ProducerInner>,
    bridge: UnixStream,
    shutdown: OwnedFd,
    runtime: tokio::runtime::Handle,
    commands: mpsc::Receiver<BridgeCommand>,
) {
    let ack = ChildFrame::BootstrapAck {
        protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
        component: inner.component.wire_name(),
        producer_boot_id: inner.producer_boot_id.clone(),
    };
    if send_frame_until(
        &bridge,
        &ack,
        &[],
        Instant::now() + CHILD_BOOTSTRAP_READ_DEADLINE,
    )
    .is_err()
    {
        inner.mark_bridge_lost();
        return;
    }
    let mut terminal_sent = false;
    let mut shutdown_armed = false;
    loop {
        match commands.try_recv() {
            Ok(BridgeCommand::Terminal {
                deadline,
                completed,
            }) if !terminal_sent => {
                // The guard already drained or cancelled its worker under its
                // chosen terminal deadline before enqueueing this command.
                // Emitting the cached current result starts no bridge-local
                // wait and cannot extend a parent-owned shutdown phase.
                let snapshot = inner.snapshot();
                let frame = ChildFrame::TerminalStatus {
                    protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
                    component: inner.component.wire_name(),
                    producer_boot_id: inner.producer_boot_id.clone(),
                    snapshot,
                    delivery_fence: inner.delivery_fence(),
                };
                let sent = send_frame_until(&bridge, &frame, &[], deadline).is_ok();
                terminal_sent = sent;
                let _ = completed.try_send(sent);
            }
            Ok(BridgeCommand::Stop) | Err(mpsc::TryRecvError::Disconnected) => return,
            Err(mpsc::TryRecvError::Empty) => {}
            Ok(BridgeCommand::Terminal { completed, .. }) => {
                let _ = completed.try_send(false);
            }
        }
        let mut descriptors = [
            libc::pollfd {
                fd: bridge.as_raw_fd(),
                events: libc::POLLIN,
                revents: 0,
            },
            libc::pollfd {
                // Once armed, the closed pipe would report POLLHUP forever;
                // a negative descriptor tells poll to ignore the slot.
                fd: if shutdown_armed {
                    -1
                } else {
                    shutdown.as_raw_fd()
                },
                events: libc::POLLIN | libc::POLLHUP,
                revents: 0,
            },
        ];
        let ready = unsafe { libc::poll(descriptors.as_mut_ptr(), descriptors.len() as _, 10) };
        if ready < 0 {
            inner.mark_bridge_lost();
            return;
        }
        if !shutdown_armed && descriptors[1].revents & (libc::POLLIN | libc::POLLHUP) != 0 {
            let mut byte = [0_u8; 1];
            let _ =
                unsafe { libc::read(shutdown.as_raw_fd(), byte.as_mut_ptr().cast(), byte.len()) };
            inner.arm_parent_shutdown();
            shutdown_armed = true;
        }
        if descriptors[0].revents & (libc::POLLERR | libc::POLLNVAL) != 0
            || (descriptors[0].revents & libc::POLLHUP != 0
                && descriptors[0].revents & libc::POLLIN == 0)
        {
            inner.mark_bridge_lost();
            return;
        }
        if descriptors[0].revents & libc::POLLIN == 0 {
            continue;
        }
        let received = match receive_frame_until::<ParentFrame>(
            &bridge,
            Instant::now() + CHILD_STATUS_RESPONSE_DEADLINE,
        ) {
            Ok(received) => received,
            Err(_) => {
                inner.mark_bridge_lost();
                return;
            }
        };
        if handle_parent_frame(&inner, &bridge, &runtime, received, &mut terminal_sent).is_err() {
            inner.mark_bridge_lost();
            return;
        }
    }
}

fn handle_parent_frame(
    inner: &Arc<ProducerInner>,
    bridge: &UnixStream,
    runtime: &tokio::runtime::Handle,
    received: crate::bridge::framing::ReceivedFrame<ParentFrame>,
    terminal_sent: &mut bool,
) -> Result<(), ()> {
    let mut descriptors = received.descriptors.into_iter();
    match received.frame {
        ParentFrame::GenerationReady {
            protocol_version,
            generation,
            descriptor,
            ..
        } if valid_protocol_version(protocol_version) && generation <= MAX_SAFE_INTEGER => {
            // A stale/equal generation cannot affect state and must not even
            // detach or parse attacker-controlled capability bytes. The
            // frame shape is still closed: exactly one unread owned right.
            if !generation_is_newer(inner, generation) {
                return (descriptors.len() == 1).then_some(()).ok_or(());
            }
            let capability = descriptors.next().ok_or(())?;
            if descriptors.next().is_some() {
                return Err(());
            }
            let generation =
                collector_generation_from_received(generation, descriptor, capability)?;
            inner.replace_generation(generation);
        }
        ParentFrame::GenerationUnavailable {
            protocol_version,
            generation,
            ..
        } if valid_protocol_version(protocol_version)
            && generation <= MAX_SAFE_INTEGER
            && descriptors.next().is_none() =>
        {
            inner.mark_generation_unavailable(generation);
        }
        ParentFrame::StatusRequest {
            protocol_version,
            request_id,
        } if valid_protocol_version(protocol_version)
            && request_id <= MAX_SAFE_INTEGER
            && descriptors.next().is_none() =>
        {
            send_frame_until(
                bridge,
                &ChildFrame::StatusResponse {
                    protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
                    request_id,
                    snapshot: inner.snapshot(),
                },
                &[],
                Instant::now() + CHILD_STATUS_RESPONSE_DEADLINE,
            )
            .map_err(|_| ())?;
        }
        ParentFrame::FlushRequest {
            protocol_version,
            request_id,
            remaining_deadline_ms,
        } if valid_protocol_version(protocol_version)
            && request_id <= MAX_SAFE_INTEGER
            && remaining_deadline_ms <= 500
            && !*terminal_sent
            && descriptors.next().is_none() =>
        {
            let remaining = Duration::from_millis(remaining_deadline_ms);
            let deadline = Instant::now() + remaining;
            let snapshot = runtime.block_on(inner.flush_until(remaining));
            send_frame_until(
                bridge,
                &ChildFrame::FlushResponse {
                    protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
                    request_id,
                    snapshot,
                    delivery_fence: inner.delivery_fence(),
                },
                &[],
                deadline,
            )
            .map_err(|_| ())?;
            // Any completed parent flush supersedes the terminal status:
            // it is sent only for a natural return outside one.
            *terminal_sent = true;
        }
        // A natural terminal result can cross the already-registered parent
        // flush request in the socket. It already resolves that one parent
        // slot, so consuming the late request without a second response is
        // the idempotent winner path rather than a protocol failure.
        ParentFrame::FlushRequest {
            protocol_version,
            request_id,
            remaining_deadline_ms,
        } if valid_protocol_version(protocol_version)
            && request_id <= MAX_SAFE_INTEGER
            && remaining_deadline_ms <= 500
            && *terminal_sent
            && descriptors.next().is_none() =>
        {
            inner.begin_parent_flush(Duration::from_millis(remaining_deadline_ms));
        }
        ParentFrame::Bootstrap { .. }
        | ParentFrame::GenerationReady { .. }
        | ParentFrame::GenerationUnavailable { .. }
        | ParentFrame::StatusRequest { .. }
        | ParentFrame::FlushRequest { .. } => return Err(()),
    }
    Ok(())
}

impl ProducerInner {
    /// Permanent bridge loss: no newer generation can arrive, so the sentinel
    /// latches unavailable. Queued records retain routing until worker drain.
    fn mark_bridge_lost(&self) {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        if matches!(
            &state.collector,
            super::CollectorAvailability::Unavailable { generation } if *generation == MAX_SAFE_INTEGER
        ) {
            return;
        }
        state.collector = super::CollectorAvailability::Unavailable {
            generation: MAX_SAFE_INTEGER,
        };
        if !state.in_flight.is_empty() {
            state.delivery_fence_eligible = false;
        }
        drop(state);
        self.notify.notify_one();
    }
}

fn generation_is_newer(inner: &ProducerInner, generation: u64) -> bool {
    let state = inner
        .state
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let current = match &state.collector {
        super::CollectorAvailability::Ready(current)
        | super::CollectorAvailability::Cooldown {
            generation: current,
            ..
        } => current.generation,
        super::CollectorAvailability::Unavailable { generation } => *generation,
    };
    generation > current
}

#[cfg(test)]
mod tests {
    use std::os::fd::{FromRawFd, OwnedFd};
    use std::os::unix::net::UnixStream;
    use std::sync::Arc;
    use std::time::Duration;

    use crate::bridge::{
        framing::receive_frame,
        wire::{ChildFrame, CHILD_BRIDGE_PROTOCOL_VERSION},
    };
    use crate::producer::tests_support::unavailable_producer;

    use super::BridgeRuntime;

    fn shutdown_reader() -> (OwnedFd, OwnedFd) {
        let mut descriptors = [0_i32; 2];
        assert_eq!(unsafe { libc::pipe(descriptors.as_mut_ptr()) }, 0);
        unsafe {
            (
                OwnedFd::from_raw_fd(descriptors[0]),
                OwnedFd::from_raw_fd(descriptors[1]),
            )
        }
    }

    #[tokio::test]
    async fn terminal_completion_is_observed_before_bridge_drop_can_close_the_socket() {
        let (bridge, mut parent) = UnixStream::pair().expect("bridge pair");
        let (shutdown_reader, _shutdown_writer) = shutdown_reader();
        let inner = unavailable_producer();
        let mut runtime = BridgeRuntime::start(
            Arc::clone(&inner),
            bridge,
            shutdown_reader,
            tokio::runtime::Handle::current(),
        )
        .expect("runtime");
        let ack = receive_frame::<ChildFrame>(&mut parent).expect("bootstrap ack");
        assert!(matches!(
            ack.frame,
            ChildFrame::BootstrapAck {
                protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
                ..
            }
        ));

        runtime
            .send_terminal_until(tokio::time::Instant::now() + Duration::from_millis(200))
            .await;
        runtime.stop();
        let terminal = receive_frame::<ChildFrame>(&mut parent).expect("terminal before close");
        assert!(matches!(terminal.frame, ChildFrame::TerminalStatus { .. }));
    }

    #[tokio::test]
    async fn parent_flush_winner_does_not_emit_a_second_terminal_frame() {
        let (bridge, mut parent) = UnixStream::pair().expect("bridge pair");
        let (shutdown_reader, _shutdown_writer) = shutdown_reader();
        let inner = unavailable_producer();
        inner.begin_parent_flush(Duration::from_millis(100));
        let mut runtime = BridgeRuntime::start(
            Arc::clone(&inner),
            bridge,
            shutdown_reader,
            tokio::runtime::Handle::current(),
        )
        .expect("runtime");
        let _ack = receive_frame::<ChildFrame>(&mut parent).expect("bootstrap ack");

        if !inner.parent_flush_observed() {
            runtime
                .send_terminal_until(tokio::time::Instant::now() + Duration::from_millis(100))
                .await;
        }
        runtime.stop();
        assert!(matches!(
            receive_frame::<ChildFrame>(&mut parent),
            Err(crate::bridge::framing::FrameError::Closed)
        ));
    }
}
