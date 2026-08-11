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
}

pub fn encode_frame<T: Serialize>(frame: &T) -> Result<Vec<u8>, FrameError> {
    let body = serde_json::to_vec(frame).map_err(|_| FrameError::Invalid)?;
    if body.is_empty() || body.len() > MAX_CHILD_BRIDGE_FRAME_BYTES {
        return Err(FrameError::Invalid);
    }
    let length = u32::try_from(body.len()).map_err(|_| FrameError::Invalid)?;
    let mut encoded = Vec::with_capacity(4 + body.len());
    encoded.extend_from_slice(&length.to_be_bytes());
    encoded.extend_from_slice(&body);
    Ok(encoded)
}

pub fn decode_body<T: DeserializeOwned>(body: &[u8]) -> Result<T, FrameError> {
    if body.is_empty() || body.len() > MAX_CHILD_BRIDGE_FRAME_BYTES {
        return Err(FrameError::Invalid);
    }
    serde_json::from_slice(body).map_err(|_| FrameError::Invalid)
}

#[cfg(unix)]
mod unix {
    use std::io::Read;
    use std::mem::{size_of, zeroed};
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
    use std::os::unix::net::UnixStream;

    use serde::{de::DeserializeOwned, Serialize};

    use super::{decode_body, FrameError, MAX_CHILD_BRIDGE_ANCILLARY_FDS};

    pub struct ReceivedFrame<T> {
        pub frame: T,
        pub descriptors: Vec<OwnedFd>,
    }

    pub fn send_frame<T: Serialize>(
        stream: &UnixStream,
        frame: &T,
        descriptors: &[RawFd],
    ) -> Result<(), FrameError> {
        if descriptors.len() > MAX_CHILD_BRIDGE_ANCILLARY_FDS {
            return Err(FrameError::Invalid);
        }
        let body = serde_json::to_vec(frame).map_err(|_| FrameError::Invalid)?;
        if body.is_empty() || body.len() > super::MAX_CHILD_BRIDGE_FRAME_BYTES {
            return Err(FrameError::Invalid);
        }
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
        let control_len = if descriptors.is_empty() {
            0
        } else {
            unsafe { libc::CMSG_SPACE((descriptors.len() * size_of::<RawFd>()) as _) as usize }
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
                (*cmsg).cmsg_len =
                    libc::CMSG_LEN((descriptors.len() * size_of::<RawFd>()) as _) as _;
                std::ptr::copy_nonoverlapping(
                    descriptors.as_ptr().cast::<u8>(),
                    libc::CMSG_DATA(cmsg),
                    descriptors.len() * size_of::<RawFd>(),
                );
            }
        }
        let expected = header.len() + body.len();
        let written = unsafe { libc::sendmsg(stream.as_raw_fd(), &message, libc::MSG_NOSIGNAL) };
        if written < 0 {
            return Err(FrameError::Io);
        }
        if written as usize != expected {
            return Err(FrameError::Closed);
        }
        Ok(())
    }

    pub fn receive_frame<T: DeserializeOwned>(
        stream: &mut UnixStream,
    ) -> Result<ReceivedFrame<T>, FrameError> {
        let mut header = [0_u8; 4];
        let mut iov = libc::iovec {
            iov_base: header.as_mut_ptr().cast(),
            iov_len: header.len(),
        };
        let control_len = unsafe {
            libc::CMSG_SPACE(((MAX_CHILD_BRIDGE_ANCILLARY_FDS + 1) * size_of::<RawFd>()) as _)
                as usize
        };
        let mut control = vec![0_u8; control_len];
        let mut message: libc::msghdr = unsafe { zeroed() };
        message.msg_iov = &mut iov;
        message.msg_iovlen = 1;
        message.msg_control = control.as_mut_ptr().cast();
        message.msg_controllen = control.len() as _;
        let received = unsafe { libc::recvmsg(stream.as_raw_fd(), &mut message, 0) };
        if received == 0 {
            return Err(FrameError::Closed);
        }
        if received < 0 {
            return Err(FrameError::Io);
        }
        if message.msg_flags & libc::MSG_CTRUNC != 0 {
            return Err(FrameError::Invalid);
        }
        let descriptors = collect_descriptors(&message)?;
        let received = received as usize;
        if received < header.len() {
            stream
                .read_exact(&mut header[received..])
                .map_err(|_| FrameError::Closed)?;
        }
        let length = u32::from_be_bytes(header) as usize;
        if length == 0 || length > super::MAX_CHILD_BRIDGE_FRAME_BYTES {
            return Err(FrameError::Invalid);
        }
        let mut body = vec![0_u8; length];
        stream
            .read_exact(&mut body)
            .map_err(|_| FrameError::Closed)?;
        let frame = decode_body(&body)?;
        Ok(ReceivedFrame { frame, descriptors })
    }

    fn collect_descriptors(message: &libc::msghdr) -> Result<Vec<OwnedFd>, FrameError> {
        let mut output = Vec::new();
        unsafe {
            let mut cmsg = libc::CMSG_FIRSTHDR(message);
            while !cmsg.is_null() {
                if (*cmsg).cmsg_level != libc::SOL_SOCKET || (*cmsg).cmsg_type != libc::SCM_RIGHTS {
                    return Err(FrameError::Invalid);
                }
                let header_len = libc::CMSG_LEN(0) as usize;
                if (*cmsg).cmsg_len < header_len as _ {
                    return Err(FrameError::Invalid);
                }
                let bytes = (*cmsg).cmsg_len as usize - header_len;
                if bytes % size_of::<RawFd>() != 0 {
                    return Err(FrameError::Invalid);
                }
                let count = bytes / size_of::<RawFd>();
                let values =
                    std::slice::from_raw_parts(libc::CMSG_DATA(cmsg).cast::<RawFd>(), count);
                for raw in values {
                    let descriptor = OwnedFd::from_raw_fd(*raw);
                    let flags = libc::fcntl(descriptor.as_raw_fd(), libc::F_GETFD);
                    if flags < 0
                        || libc::fcntl(
                            descriptor.as_raw_fd(),
                            libc::F_SETFD,
                            flags | libc::FD_CLOEXEC,
                        ) < 0
                    {
                        return Err(FrameError::Io);
                    }
                    output.push(descriptor);
                }
                cmsg = libc::CMSG_NXTHDR(message, cmsg);
            }
        }
        if output.len() > MAX_CHILD_BRIDGE_ANCILLARY_FDS {
            return Err(FrameError::Invalid);
        }
        Ok(output)
    }
}

#[cfg(unix)]
pub use unix::{receive_frame, send_frame, ReceivedFrame};
