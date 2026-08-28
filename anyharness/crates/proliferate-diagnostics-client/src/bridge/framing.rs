//! Length-delimited JSON plus bounded `SCM_RIGHTS` transfer.

use serde::{de::DeserializeOwned, Serialize};

use super::wire::{MAX_CHILD_BRIDGE_ANCILLARY_FDS, MAX_CHILD_BRIDGE_FRAME_BYTES};

#[derive(Debug, thiserror::Error)]
pub enum FrameError {
    #[error("bridge closed")]
    Closed,
    #[error("bridge frame invalid")]
    Invalid,
    #[error("bridge I/O failed")]
    Io,
    #[error("bridge deadline exceeded")]
    Deadline,
}

pub fn encode_frame<T: Serialize>(frame: &T) -> Result<Vec<u8>, FrameError> {
    let body = encode_body(frame)?;
    let length = u32::try_from(body.len()).map_err(|_| FrameError::Invalid)?;
    let mut encoded = Vec::with_capacity(4 + body.len());
    encoded.extend_from_slice(&length.to_be_bytes());
    encoded.extend_from_slice(&body);
    Ok(encoded)
}

fn encode_body<T: Serialize>(frame: &T) -> Result<Vec<u8>, FrameError> {
    let body = serde_json::to_vec(frame).map_err(|_| FrameError::Invalid)?;
    if body.is_empty() || body.len() > MAX_CHILD_BRIDGE_FRAME_BYTES {
        return Err(FrameError::Invalid);
    }
    Ok(body)
}

pub fn decode_body<T: DeserializeOwned>(body: &[u8]) -> Result<T, FrameError> {
    if body.is_empty() || body.len() > MAX_CHILD_BRIDGE_FRAME_BYTES {
        return Err(FrameError::Invalid);
    }
    serde_json::from_slice(body).map_err(|_| FrameError::Invalid)
}

#[cfg(unix)]
mod unix {
    use std::mem::{size_of, size_of_val, zeroed};
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
    use std::os::unix::net::UnixStream;
    use std::time::{Duration, Instant};

    use serde::{de::DeserializeOwned, Serialize};

    use super::{decode_body, encode_body, FrameError, MAX_CHILD_BRIDGE_ANCILLARY_FDS};

    // XNU rejects a single SCM_RIGHTS message above 512 descriptors. Capture
    // that entire closed kernel maximum so `MSG_CTRUNC` can never hide an
    // installed descriptor that user space then has no number to close.
    const MAX_KERNEL_ANCILLARY_FDS: usize = 512;

    pub struct ReceivedFrame<T> {
        pub frame: T,
        pub descriptors: Vec<OwnedFd>,
    }

    pub fn send_frame<T: Serialize>(
        stream: &UnixStream,
        frame: &T,
        descriptors: &[RawFd],
    ) -> Result<(), FrameError> {
        send_frame_until(
            stream,
            frame,
            descriptors,
            Instant::now() + Duration::from_secs(1),
        )
    }

    /// Sends one complete frame without ever blocking past `deadline`.
    ///
    /// Header, body, and rights are submitted by one `sendmsg`. A short write
    /// makes descriptor association ambiguous, so it closes the bridge rather
    /// than attempting to complete a partially transferred frame.
    pub fn send_frame_until<T: Serialize>(
        stream: &UnixStream,
        frame: &T,
        descriptors: &[RawFd],
        deadline: Instant,
    ) -> Result<(), FrameError> {
        ensure_nonblocking(stream.as_raw_fd())?;
        if descriptors.len() > MAX_CHILD_BRIDGE_ANCILLARY_FDS {
            return Err(FrameError::Invalid);
        }
        let body = encode_body(frame)?;
        let header = u32::try_from(body.len())
            .map_err(|_| FrameError::Invalid)?
            .to_be_bytes();
        let mut iov = [
            libc::iovec {
                iov_base: header.as_ptr().cast_mut().cast(),
                iov_len: header.len(),
            },
            libc::iovec {
                iov_base: body.as_ptr().cast_mut().cast(),
                iov_len: body.len(),
            },
        ];
        let frame_len = header.len() + body.len();
        let control_len = if descriptors.is_empty() {
            0
        } else {
            unsafe { libc::CMSG_SPACE(size_of_val(descriptors) as _) as usize }
        };
        let mut control = vec![0_u8; control_len];
        let mut message: libc::msghdr = unsafe { zeroed() };
        message.msg_iov = iov.as_mut_ptr();
        message.msg_iovlen = iov.len() as _;
        if !descriptors.is_empty() {
            message.msg_control = control.as_mut_ptr().cast();
            message.msg_controllen = control.len() as _;
            unsafe {
                let cmsg = libc::CMSG_FIRSTHDR(&message);
                if cmsg.is_null() {
                    return Err(FrameError::Invalid);
                }
                (*cmsg).cmsg_level = libc::SOL_SOCKET;
                (*cmsg).cmsg_type = libc::SCM_RIGHTS;
                (*cmsg).cmsg_len = libc::CMSG_LEN(size_of_val(descriptors) as _) as _;
                std::ptr::copy_nonoverlapping(
                    descriptors.as_ptr().cast::<u8>(),
                    libc::CMSG_DATA(cmsg),
                    size_of_val(descriptors),
                );
            }
        }
        loop {
            wait_ready(stream.as_raw_fd(), libc::POLLOUT, deadline)?;
            let written = unsafe {
                libc::sendmsg(
                    stream.as_raw_fd(),
                    &message,
                    libc::MSG_NOSIGNAL | libc::MSG_DONTWAIT,
                )
            };
            if written < 0 {
                let error = std::io::Error::last_os_error();
                if matches!(error.raw_os_error(), Some(libc::EAGAIN) | Some(libc::EINTR)) {
                    continue;
                }
                return Err(FrameError::Io);
            }
            if written == 0 {
                let _ = stream.shutdown(std::net::Shutdown::Both);
                return Err(FrameError::Closed);
            }
            if written as usize == frame_len {
                return Ok(());
            }
            let _ = stream.shutdown(std::net::Shutdown::Both);
            return Err(FrameError::Io);
        }
    }

    pub fn receive_frame<T: DeserializeOwned>(
        stream: &mut UnixStream,
    ) -> Result<ReceivedFrame<T>, FrameError> {
        receive_frame_until(stream, Instant::now() + Duration::from_secs(1))
    }

    /// Receives one complete frame under one absolute deadline. Every read is
    /// a nonblocking `recvmsg`, so ancillary rights delivered on a later
    /// fragment are still owned and closed before the frame is rejected.
    pub fn receive_frame_until<T: DeserializeOwned>(
        stream: &UnixStream,
        deadline: Instant,
    ) -> Result<ReceivedFrame<T>, FrameError> {
        ensure_nonblocking(stream.as_raw_fd())?;
        let mut header = [0_u8; 4];
        let (received, descriptors) = receive_chunk(stream, &mut header, deadline)?;
        receive_remainder(stream, &mut header[received..], deadline)?;
        let length = u32::from_be_bytes(header) as usize;
        if length == 0 || length > super::MAX_CHILD_BRIDGE_FRAME_BYTES {
            return Err(FrameError::Invalid);
        }
        let mut body = vec![0_u8; length];
        receive_remainder(stream, &mut body, deadline)?;
        let frame = decode_body(&body)?;
        Ok(ReceivedFrame { frame, descriptors })
    }

    fn receive_remainder(
        stream: &UnixStream,
        mut output: &mut [u8],
        deadline: Instant,
    ) -> Result<(), FrameError> {
        while !output.is_empty() {
            let (received, descriptors) = receive_chunk(stream, output, deadline)?;
            if !descriptors.is_empty() {
                return Err(FrameError::Invalid);
            }
            output = &mut output[received..];
        }
        Ok(())
    }

    fn receive_chunk(
        stream: &UnixStream,
        output: &mut [u8],
        deadline: Instant,
    ) -> Result<(usize, Vec<OwnedFd>), FrameError> {
        loop {
            wait_ready(stream.as_raw_fd(), libc::POLLIN, deadline)?;
            let mut iov = libc::iovec {
                iov_base: output.as_mut_ptr().cast(),
                iov_len: output.len(),
            };
            let control_len = unsafe {
                libc::CMSG_SPACE((MAX_KERNEL_ANCILLARY_FDS * size_of::<RawFd>()) as _) as usize
            };
            // Keep unused ancillary bytes distinguishable from valid file
            // descriptors. Some kernels report a truncated cmsg length that
            // reaches alignment padding; zero-filled padding would otherwise
            // look like descriptor 0 and could close an unrelated handle.
            let mut control = vec![u8::MAX; control_len];
            let mut message: libc::msghdr = unsafe { zeroed() };
            message.msg_iov = &mut iov;
            message.msg_iovlen = 1;
            message.msg_control = control.as_mut_ptr().cast();
            message.msg_controllen = control.len() as _;
            let received =
                unsafe { libc::recvmsg(stream.as_raw_fd(), &mut message, libc::MSG_DONTWAIT) };
            if received == 0 {
                return Err(FrameError::Closed);
            }
            if received < 0 {
                let error = std::io::Error::last_os_error();
                if matches!(error.raw_os_error(), Some(libc::EAGAIN) | Some(libc::EINTR)) {
                    continue;
                }
                return Err(FrameError::Io);
            }
            // `recvmsg` has already installed every delivered `SCM_RIGHTS`
            // entry. Wrap all of them before evaluating any rejection.
            let descriptors = collect_descriptors(
                &message,
                control.len(),
                message.msg_flags & libc::MSG_CTRUNC != 0,
            )?;
            return Ok((received as usize, descriptors));
        }
    }

    fn wait_ready(fd: RawFd, events: libc::c_short, deadline: Instant) -> Result<(), FrameError> {
        loop {
            let now = Instant::now();
            if now >= deadline {
                return Err(FrameError::Deadline);
            }
            let remaining = deadline.saturating_duration_since(now);
            let timeout_ms =
                remaining.as_millis().max(1).min(libc::c_int::MAX as u128) as libc::c_int;
            let mut pollfd = libc::pollfd {
                fd,
                events,
                revents: 0,
            };
            let ready = unsafe { libc::poll(&mut pollfd, 1, timeout_ms) };
            if ready < 0 {
                if std::io::Error::last_os_error().raw_os_error() == Some(libc::EINTR) {
                    continue;
                }
                return Err(FrameError::Io);
            }
            if ready == 0 {
                return Err(FrameError::Deadline);
            }
            if pollfd.revents & libc::POLLNVAL != 0 {
                return Err(FrameError::Io);
            }
            if pollfd.revents & events != 0 || pollfd.revents & libc::POLLHUP != 0 {
                return Ok(());
            }
            if pollfd.revents & libc::POLLERR != 0 {
                return Err(FrameError::Io);
            }
        }
    }

    fn ensure_nonblocking(fd: RawFd) -> Result<(), FrameError> {
        let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
        if flags < 0 {
            return Err(FrameError::Io);
        }
        if flags & libc::O_NONBLOCK == 0
            && unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0
        {
            return Err(FrameError::Io);
        }
        Ok(())
    }

    // `msg_controllen` is socklen_t (u32) on macOS but usize on Linux: the
    // casts below are real on macOS and no-ops on Linux, where this lint
    // fires. Platform skew — the Linux CI job is the clippy authority.
    #[allow(clippy::unnecessary_cast)]
    fn collect_descriptors(
        message: &libc::msghdr,
        control_capacity: usize,
        control_truncated: bool,
    ) -> Result<Vec<OwnedFd>, FrameError> {
        let mut output = Vec::new();
        let mut invalid = control_truncated || message.msg_controllen as usize > control_capacity;
        let mut io_failed = false;
        let control_start = message.msg_control as usize;
        let visible_control_len = (message.msg_controllen as usize).min(control_capacity);
        let Some(control_end) = control_start.checked_add(visible_control_len) else {
            return Err(FrameError::Invalid);
        };
        unsafe {
            let mut cmsg = libc::CMSG_FIRSTHDR(message);
            while !cmsg.is_null() {
                let header_len = libc::CMSG_LEN(0) as usize;
                let cmsg_start = cmsg as usize;
                let Some(header_end) = cmsg_start.checked_add(header_len) else {
                    invalid = true;
                    break;
                };
                if cmsg_start < control_start || header_end > control_end {
                    invalid = true;
                    break;
                }
                if (*cmsg).cmsg_level != libc::SOL_SOCKET || (*cmsg).cmsg_type != libc::SCM_RIGHTS {
                    invalid = true;
                } else {
                    if (*cmsg).cmsg_len < header_len as _ {
                        invalid = true;
                        break;
                    } else {
                        let declared_bytes = (*cmsg).cmsg_len as usize - header_len;
                        let data = libc::CMSG_DATA(cmsg).cast::<u8>();
                        let data_start = data as usize;
                        if data_start < header_end || data_start > control_end {
                            invalid = true;
                        } else {
                            let available_bytes = control_end - data_start;
                            let captured_bytes = declared_bytes.min(available_bytes);
                            if declared_bytes > available_bytes
                                || !captured_bytes.is_multiple_of(size_of::<RawFd>())
                            {
                                invalid = true;
                            }
                            for index in 0..captured_bytes / size_of::<RawFd>() {
                                let raw = std::ptr::read_unaligned(
                                    data.add(index * size_of::<RawFd>()).cast::<RawFd>(),
                                );
                                if raw < 0
                                    || output
                                        .iter()
                                        .any(|descriptor: &OwnedFd| descriptor.as_raw_fd() == raw)
                                {
                                    invalid = true;
                                    continue;
                                }
                                let flags = libc::fcntl(raw, libc::F_GETFD);
                                if flags < 0 {
                                    invalid = true;
                                    continue;
                                }
                                let descriptor = OwnedFd::from_raw_fd(raw);
                                if libc::fcntl(
                                    descriptor.as_raw_fd(),
                                    libc::F_SETFD,
                                    flags | libc::FD_CLOEXEC,
                                ) < 0
                                {
                                    io_failed = true;
                                }
                                output.push(descriptor);
                            }
                        }
                    }
                }
                if (*cmsg).cmsg_len as usize > control_end.saturating_sub(cmsg_start) {
                    invalid = true;
                    break;
                }
                let next = libc::CMSG_NXTHDR(message, cmsg);
                if !next.is_null() && next as usize <= cmsg_start {
                    invalid = true;
                    break;
                }
                cmsg = next;
            }
        }
        if output.len() > MAX_CHILD_BRIDGE_ANCILLARY_FDS {
            invalid = true;
        }
        if io_failed {
            Err(FrameError::Io)
        } else if invalid {
            Err(FrameError::Invalid)
        } else {
            Ok(output)
        }
    }

    #[cfg(test)]
    mod descriptor_tests {
        use super::*;

        #[test]
        fn synthetic_ctrunc_closes_every_visible_descriptor() {
            let (source, _peer) = UnixStream::pair().expect("socketpair");
            let duplicate = unsafe { libc::dup(source.as_raw_fd()) };
            assert!(duplicate >= 0, "dup failed");
            let control_len = unsafe { libc::CMSG_SPACE(size_of::<RawFd>() as _) as usize };
            let mut control = vec![0_u8; control_len];
            let mut message: libc::msghdr = unsafe { zeroed() };
            message.msg_control = control.as_mut_ptr().cast();
            message.msg_controllen = control.len() as _;
            unsafe {
                let cmsg = libc::CMSG_FIRSTHDR(&message);
                assert!(!cmsg.is_null());
                (*cmsg).cmsg_level = libc::SOL_SOCKET;
                (*cmsg).cmsg_type = libc::SCM_RIGHTS;
                (*cmsg).cmsg_len = libc::CMSG_LEN(size_of::<RawFd>() as _) as _;
                std::ptr::write_unaligned(libc::CMSG_DATA(cmsg).cast::<RawFd>(), duplicate);
            }

            assert!(matches!(
                collect_descriptors(&message, control.len(), true),
                Err(FrameError::Invalid)
            ));
            assert_eq!(unsafe { libc::fcntl(duplicate, libc::F_GETFD) }, -1);
        }

        #[test]
        fn malformed_zero_length_control_header_fails_without_looping() {
            let control_len = unsafe { libc::CMSG_SPACE(0) as usize };
            let mut control = vec![0_u8; control_len];
            let mut message: libc::msghdr = unsafe { zeroed() };
            message.msg_control = control.as_mut_ptr().cast();
            message.msg_controllen = control.len() as _;
            unsafe {
                let cmsg = libc::CMSG_FIRSTHDR(&message);
                assert!(!cmsg.is_null());
                (*cmsg).cmsg_len = 0;
            }

            assert!(matches!(
                collect_descriptors(&message, control.len(), false),
                Err(FrameError::Invalid)
            ));
        }
    }
}

#[cfg(unix)]
pub use unix::{receive_frame, receive_frame_until, send_frame, send_frame_until, ReceivedFrame};

#[cfg(test)]
#[path = "framing_tests.rs"]
mod tests;
