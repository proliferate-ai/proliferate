#![cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]

//! Single bounded reader for the protected child diagnostics bridge.

use std::{os::fd::AsRawFd, os::unix::net::UnixStream, sync::Arc, time::Instant};

use proliferate_diagnostics_client::bridge::{
    framing::{receive_frame_until, FrameError},
    wire::ChildFrame,
};

use super::runtime::{BridgeShared, FRAME_COMPLETION_DEADLINE};

const READER_POLL_INTERVAL_MS: libc::c_int = 50;

pub(super) fn run_reader(shared: Arc<BridgeShared>, stream: UnixStream) {
    loop {
        if shared.reader_should_stop() {
            return;
        }
        let mut descriptors = [libc::pollfd {
            fd: stream.as_raw_fd(),
            events: libc::POLLIN,
            revents: 0,
        }];
        // SAFETY: `descriptors` is a valid single-element pollfd array.
        let ready = unsafe { libc::poll(descriptors.as_mut_ptr(), 1, READER_POLL_INTERVAL_MS) };
        if ready < 0 || descriptors[0].revents & (libc::POLLERR | libc::POLLNVAL) != 0 {
            shared.mark_lost();
            return;
        }
        if descriptors[0].revents & libc::POLLIN == 0 {
            if descriptors[0].revents & libc::POLLHUP != 0 {
                shared.mark_clean_eof();
                return;
            }
            continue;
        }
        let received = match receive_frame_until::<ChildFrame>(
            &stream,
            Instant::now() + FRAME_COMPLETION_DEADLINE,
        ) {
            Ok(received) => received,
            Err(FrameError::Closed) => {
                shared.mark_clean_eof();
                return;
            }
            Err(FrameError::Invalid | FrameError::Deadline) => {
                shared.mark_invalid();
                return;
            }
            Err(FrameError::Io) => {
                shared.mark_lost();
                return;
            }
        };
        if shared.handle_child_frame(received).is_err() {
            shared.mark_invalid();
            return;
        }
    }
}
