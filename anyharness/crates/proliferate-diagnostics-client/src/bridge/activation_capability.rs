use std::fs::File;
use std::io::{ErrorKind, Read};
use std::os::fd::{AsRawFd, OwnedFd};
use std::time::Instant;

use zeroize::{Zeroize, Zeroizing};

const MAX_CAPABILITY_BYTES: usize = 256;
const MAX_CAPABILITY_CHANNEL_BYTES: usize = MAX_CAPABILITY_BYTES + 1;

/// Consumes one capability channel before the caller-owned absolute deadline.
///
/// EOF completes an unterminated token. A CR or LF completes a terminated
/// token without waiting for the channel writer to close. The descriptor is
/// made nonblocking so readiness races cannot turn the bounded poll loop back
/// into a blocking read.
pub(super) fn read_capability_until(descriptor: OwnedFd, deadline: Instant) -> Result<String, ()> {
    let flags = unsafe { libc::fcntl(descriptor.as_raw_fd(), libc::F_GETFL) };
    if flags < 0
        || unsafe {
            libc::fcntl(
                descriptor.as_raw_fd(),
                libc::F_SETFL,
                flags | libc::O_NONBLOCK,
            )
        } < 0
    {
        return Err(());
    }

    let mut file = File::from(descriptor);
    let mut bytes = Zeroizing::new(Vec::with_capacity(MAX_CAPABILITY_CHANNEL_BYTES));
    let mut scratch = Zeroizing::new([0_u8; MAX_CAPABILITY_CHANNEL_BYTES]);

    loop {
        let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
            return Err(());
        };
        if remaining.is_zero() {
            return Err(());
        }
        let rounded_millis =
            remaining
                .as_millis()
                .saturating_add(if remaining.subsec_nanos() % 1_000_000 == 0 {
                    0
                } else {
                    1
                });
        let timeout_ms = rounded_millis.clamp(1, i32::MAX as u128) as i32;
        let mut poll_fd = libc::pollfd {
            fd: file.as_raw_fd(),
            events: libc::POLLIN,
            revents: 0,
        };
        let ready = unsafe { libc::poll(&mut poll_fd, 1, timeout_ms) };
        if ready == 0 {
            continue;
        }
        if ready < 0 {
            if std::io::Error::last_os_error().kind() == ErrorKind::Interrupted {
                continue;
            }
            return Err(());
        }
        if poll_fd.revents & libc::POLLNVAL != 0 || Instant::now() >= deadline {
            return Err(());
        }
        if poll_fd.revents & (libc::POLLIN | libc::POLLHUP | libc::POLLERR) == 0 {
            continue;
        }

        let remaining_capacity = MAX_CAPABILITY_CHANNEL_BYTES - bytes.len();
        match file.read(&mut scratch[..remaining_capacity]) {
            Ok(0) => break,
            Ok(read) => {
                bytes.extend_from_slice(&scratch[..read]);
                scratch[..read].zeroize();

                if let Some(terminator) =
                    bytes.iter().position(|byte| matches!(*byte, b'\n' | b'\r'))
                {
                    if !bytes[terminator..]
                        .iter()
                        .all(|byte| matches!(*byte, b'\n' | b'\r'))
                    {
                        return Err(());
                    }
                    bytes[terminator..].zeroize();
                    bytes.truncate(terminator);
                    break;
                }
                if !bytes.iter().all(|byte| byte.is_ascii_graphic())
                    || bytes.len() == MAX_CAPABILITY_CHANNEL_BYTES
                {
                    return Err(());
                }
            }
            Err(error)
                if matches!(error.kind(), ErrorKind::Interrupted | ErrorKind::WouldBlock) =>
            {
                continue;
            }
            Err(_) => return Err(()),
        }
    }

    if bytes.is_empty()
        || bytes.len() > MAX_CAPABILITY_BYTES
        || !bytes.iter().all(|byte| byte.is_ascii_graphic())
    {
        return Err(());
    }
    let mut capability = String::with_capacity(bytes.len());
    capability.extend(bytes.iter().map(|byte| char::from(*byte)));
    bytes.zeroize();
    Ok(capability)
}

#[cfg(test)]
#[path = "activation_capability_tests.rs"]
mod tests;
