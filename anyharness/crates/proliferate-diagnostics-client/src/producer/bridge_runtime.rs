use std::{
    os::fd::{AsRawFd, OwnedFd},
    os::unix::net::UnixStream,
    sync::{mpsc, Arc},
    thread,
    time::Duration,
};

use proliferate_diagnostics_protocol::v1::limits::MAX_SAFE_INTEGER;

use crate::bridge::{
    activation::collector_generation_from_received,
    framing::{receive_frame, send_frame},
    wire::{valid_protocol_version, ChildFrame, ParentFrame, CHILD_BRIDGE_PROTOCOL_VERSION},
};

use super::ProducerInner;

pub(crate) struct BridgeRuntime {
    commands: mpsc::SyncSender<BridgeCommand>,
    join: Option<thread::JoinHandle<()>>,
}

enum BridgeCommand {
    Terminal(Duration),
    Stop,
}

impl BridgeRuntime {
    pub(crate) fn start(
        inner: Arc<ProducerInner>,
        bridge: UnixStream,
        shutdown: OwnedFd,
        runtime: tokio::runtime::Handle,
    ) -> Result<Self, ()> {
        let (commands, receiver) = mpsc::sync_channel(1);
        let join = thread::Builder::new()
            .name("desktop-diagnostics-bridge".to_owned())
            .spawn(move || run(inner, bridge, shutdown, runtime, receiver))
            .map_err(|_| ())?;
        Ok(Self {
            commands,
            join: Some(join),
        })
    }

    pub(crate) fn send_terminal(&mut self, remaining: Duration) {
        let _ = self.commands.try_send(BridgeCommand::Terminal(remaining));
    }

    pub(crate) fn stop(&mut self) {
        let _ = self.commands.send(BridgeCommand::Stop);
    }
}

impl Drop for BridgeRuntime {
    fn drop(&mut self) {
        self.stop();
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

fn run(
    inner: Arc<ProducerInner>,
    mut bridge: UnixStream,
    shutdown: OwnedFd,
    runtime: tokio::runtime::Handle,
    commands: mpsc::Receiver<BridgeCommand>,
) {
    let _ = bridge.set_read_timeout(Some(Duration::from_millis(100)));
    let ack = ChildFrame::BootstrapAck {
        protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
        component: inner.component.wire_name(),
        producer_boot_id: inner.producer_boot_id.clone(),
    };
    if send_frame(&bridge, &ack, &[]).is_err() {
        inner.mark_generation_unavailable(MAX_SAFE_INTEGER);
        return;
    }
    let mut terminal_sent = false;
    loop {
        match commands.try_recv() {
            Ok(BridgeCommand::Terminal(remaining)) if !terminal_sent => {
                let snapshot = runtime.block_on(inner.flush_until(remaining));
                let frame = ChildFrame::TerminalStatus {
                    protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
                    component: inner.component.wire_name(),
                    producer_boot_id: inner.producer_boot_id.clone(),
                    snapshot,
                    delivery_fence: inner.delivery_fence(),
                };
                let _ = send_frame(&bridge, &frame, &[]);
                terminal_sent = true;
            }
            Ok(BridgeCommand::Stop) | Err(mpsc::TryRecvError::Disconnected) => return,
            Err(mpsc::TryRecvError::Empty) | Ok(BridgeCommand::Terminal(_)) => {}
        }
        let mut descriptors = [
            libc::pollfd {
                fd: bridge.as_raw_fd(),
                events: libc::POLLIN,
                revents: 0,
            },
            libc::pollfd {
                fd: shutdown.as_raw_fd(),
                events: libc::POLLIN | libc::POLLHUP,
                revents: 0,
            },
        ];
        let ready = unsafe { libc::poll(descriptors.as_mut_ptr(), descriptors.len() as _, 10) };
        if ready < 0 {
            inner.mark_generation_unavailable(MAX_SAFE_INTEGER);
            return;
        }
        if descriptors[1].revents & (libc::POLLIN | libc::POLLHUP) != 0 {
            let mut byte = [0_u8; 1];
            let _ =
                unsafe { libc::read(shutdown.as_raw_fd(), byte.as_mut_ptr().cast(), byte.len()) };
            inner.arm_terminal();
        }
        if descriptors[0].revents & (libc::POLLERR | libc::POLLHUP | libc::POLLNVAL) != 0 {
            inner.mark_generation_unavailable(MAX_SAFE_INTEGER);
            return;
        }
        if descriptors[0].revents & libc::POLLIN == 0 {
            continue;
        }
        let received = match receive_frame::<ParentFrame>(&mut bridge) {
            Ok(received) => received,
            Err(_) => {
                inner.mark_generation_unavailable(MAX_SAFE_INTEGER);
                return;
            }
        };
        if handle_parent_frame(&inner, &bridge, &runtime, received, &mut terminal_sent).is_err() {
            inner.mark_generation_unavailable(MAX_SAFE_INTEGER);
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
        } if valid_protocol_version(protocol_version) => {
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
        } if valid_protocol_version(protocol_version) && descriptors.next().is_none() => {
            inner.mark_generation_unavailable(generation);
        }
        ParentFrame::StatusRequest {
            protocol_version,
            request_id,
        } if valid_protocol_version(protocol_version)
            && request_id <= MAX_SAFE_INTEGER
            && descriptors.next().is_none() =>
        {
            send_frame(
                bridge,
                &ChildFrame::StatusResponse {
                    protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
                    request_id,
                    snapshot: inner.snapshot(),
                },
                &[],
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
            && descriptors.next().is_none() =>
        {
            let snapshot =
                runtime.block_on(inner.flush_until(Duration::from_millis(remaining_deadline_ms)));
            send_frame(
                bridge,
                &ChildFrame::FlushResponse {
                    protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
                    request_id,
                    snapshot,
                    delivery_fence: inner.delivery_fence(),
                },
                &[],
            )
            .map_err(|_| ())?;
            if inner.snapshot().resident_records == 0 {
                *terminal_sent = true;
            }
        }
        ParentFrame::Bootstrap { .. }
        | ParentFrame::GenerationReady { .. }
        | ParentFrame::GenerationUnavailable { .. }
        | ParentFrame::StatusRequest { .. }
        | ParentFrame::FlushRequest { .. } => return Err(()),
    }
    Ok(())
}
