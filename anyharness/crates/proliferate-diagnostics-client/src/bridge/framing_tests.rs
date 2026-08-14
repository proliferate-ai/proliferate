//! Length-delimited framing proofs: the four-byte big-endian prefix, the
//! 16 KiB cap on both encode and decode, byte-at-a-time fragmentation over a
//! real socketpair, oversized/zero declared lengths failing without ever
//! allocating a body buffer, truncated streams failing closed rather than
//! hanging, and ancillary-descriptor coalescing/`MSG_CTRUNC`/extra-rights
//! rejection.

use serde::Serialize;

use super::*;
use crate::bridge::wire::{ParentFrame, CHILD_BRIDGE_PROTOCOL_VERSION};

#[derive(Serialize)]
struct OversizedFixture {
    padding: String,
}

fn status_request(request_id: u64) -> ParentFrame {
    ParentFrame::StatusRequest {
        protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
        request_id,
    }
}

#[test]
fn encode_frame_writes_four_byte_big_endian_length_prefix() {
    let frame = status_request(7);
    let body = serde_json::to_vec(&frame).expect("serializable");
    let encoded = encode_frame(&frame).expect("within cap");
    assert_eq!(encoded.len(), 4 + body.len());
    let declared = u32::from_be_bytes(encoded[..4].try_into().expect("four bytes"));
    assert_eq!(declared as usize, body.len());
    assert_eq!(&encoded[4..], body.as_slice());
}

#[test]
fn encode_frame_rejects_a_body_over_the_frame_cap() {
    let fixture = OversizedFixture {
        padding: "x".repeat(MAX_CHILD_BRIDGE_FRAME_BYTES + 1),
    };
    assert!(matches!(encode_frame(&fixture), Err(FrameError::Invalid)));
}

#[test]
fn decode_body_round_trips_a_valid_frame() {
    let frame = status_request(9);
    let body = serde_json::to_vec(&frame).expect("serializable");
    let decoded: ParentFrame = decode_body(&body).expect("within cap");
    assert_eq!(decoded, frame);
}

#[test]
fn decode_body_rejects_empty_and_oversized_bodies() {
    assert!(matches!(
        decode_body::<serde_json::Value>(&[]),
        Err(FrameError::Invalid)
    ));
    let oversized = vec![b'a'; MAX_CHILD_BRIDGE_FRAME_BYTES + 1];
    assert!(matches!(
        decode_body::<serde_json::Value>(&oversized),
        Err(FrameError::Invalid)
    ));
}

#[cfg(unix)]
mod unix_socket_tests {
    use std::io::{Read, Write};
    use std::mem::{size_of_val, zeroed};
    use std::net::Shutdown;
    use std::os::fd::{AsRawFd, RawFd};
    use std::os::unix::net::UnixStream;
    use std::thread;
    use std::time::Duration;

    use super::*;
    use crate::bridge::wire::MAX_CHILD_BRIDGE_ANCILLARY_FDS;

    /// Bypasses the crate's own `send_frame` cap check so a test can send
    /// more rights than a well-behaved sender ever would, proving the
    /// receiver's own defenses (not the sender's cooperation) hold the line.
    fn raw_send_with_rights<T: Serialize>(stream: &UnixStream, frame: &T, descriptors: &[RawFd]) {
        let body = serde_json::to_vec(frame).expect("serializable");
        let header = (body.len() as u32).to_be_bytes();
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
        let descriptor_bytes = size_of_val(descriptors);
        let control_len = unsafe { libc::CMSG_SPACE(descriptor_bytes as _) as usize };
        let mut control = vec![0_u8; control_len.max(1)];
        let mut message: libc::msghdr = unsafe { zeroed() };
        message.msg_iov = iov.as_mut_ptr();
        message.msg_iovlen = iov.len() as _;
        if !descriptors.is_empty() {
            message.msg_control = control.as_mut_ptr().cast();
            message.msg_controllen = control_len as _;
            unsafe {
                let cmsg = libc::CMSG_FIRSTHDR(&message);
                assert!(!cmsg.is_null());
                (*cmsg).cmsg_level = libc::SOL_SOCKET;
                (*cmsg).cmsg_type = libc::SCM_RIGHTS;
                (*cmsg).cmsg_len = libc::CMSG_LEN(descriptor_bytes as _) as _;
                std::ptr::copy_nonoverlapping(
                    descriptors.as_ptr().cast::<u8>(),
                    libc::CMSG_DATA(cmsg),
                    descriptor_bytes,
                );
            }
        }
        let written = unsafe { libc::sendmsg(stream.as_raw_fd(), &message, libc::MSG_NOSIGNAL) };
        assert!(written >= 0, "raw sendmsg failed");
    }

    fn duplicated_fds(source: RawFd, count: usize) -> Vec<RawFd> {
        (0..count)
            .map(|_| {
                let duplicate = unsafe { libc::dup(source) };
                assert!(duplicate >= 0, "dup failed");
                duplicate
            })
            .collect()
    }

    fn close_all(fds: &[RawFd]) {
        for fd in fds {
            unsafe { libc::close(*fd) };
        }
    }

    fn assert_peer_observes_all_received_rights_closed(peer: &mut UnixStream) {
        peer.set_nonblocking(true).expect("nonblocking peer");
        let mut byte = [0_u8; 1];
        let deadline = std::time::Instant::now() + Duration::from_millis(100);
        loop {
            match peer.read(&mut byte) {
                Ok(0) => return,
                Ok(_) => panic!("unexpected payload from transferred descriptor"),
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    assert!(
                        std::time::Instant::now() < deadline,
                        "a received SCM_RIGHTS descriptor leaked on rejection"
                    );
                    thread::sleep(Duration::from_millis(1));
                }
                Err(error) => panic!("peer read failed: {error}"),
            }
        }
    }

    #[test]
    fn receive_frame_parses_a_frame_delivered_one_byte_at_a_time() {
        let (mut receiver, sender) = UnixStream::pair().expect("socketpair");
        let frame = status_request(11);
        let encoded = encode_frame(&frame).expect("within cap");
        let writer = thread::spawn(move || {
            let mut sender = sender;
            for byte in encoded {
                sender.write_all(&[byte]).expect("byte write");
                thread::sleep(Duration::from_micros(200));
            }
        });
        let received = receive_frame::<ParentFrame>(&mut receiver).expect("fragmented frame");
        assert_eq!(received.frame, frame);
        assert!(received.descriptors.is_empty());
        writer.join().expect("writer thread");
    }

    #[test]
    fn receive_frame_rejects_oversized_declared_length_before_reading_a_body() {
        let (mut receiver, mut sender) = UnixStream::pair().expect("socketpair");
        let declared = (MAX_CHILD_BRIDGE_FRAME_BYTES as u32) + 1;
        sender
            .write_all(&declared.to_be_bytes())
            .expect("write oversized header");
        // Never send a body: a correct receiver must reject the header
        // itself and must not attempt to allocate/read `declared` bytes.
        assert!(matches!(
            receive_frame::<ParentFrame>(&mut receiver).map(|_| ()),
            Err(FrameError::Invalid)
        ));
    }

    #[test]
    fn receive_frame_rejects_zero_declared_length() {
        let (mut receiver, mut sender) = UnixStream::pair().expect("socketpair");
        sender
            .write_all(&0_u32.to_be_bytes())
            .expect("write header");
        assert!(matches!(
            receive_frame::<ParentFrame>(&mut receiver).map(|_| ()),
            Err(FrameError::Invalid)
        ));
    }

    #[test]
    fn receive_frame_on_truncated_header_fails_closed_not_hung() {
        let (mut receiver, mut sender) = UnixStream::pair().expect("socketpair");
        sender.write_all(&[0, 1]).expect("partial header");
        sender.shutdown(Shutdown::Write).expect("half-close");
        assert!(matches!(
            receive_frame::<ParentFrame>(&mut receiver).map(|_| ()),
            Err(FrameError::Closed)
        ));
    }

    #[test]
    fn receive_frame_on_truncated_body_fails_closed_not_hung() {
        let (mut receiver, mut sender) = UnixStream::pair().expect("socketpair");
        sender.write_all(&50_u32.to_be_bytes()).expect("header");
        sender.write_all(&[b'{'; 10]).expect("partial body");
        sender.shutdown(Shutdown::Write).expect("half-close");
        assert!(matches!(
            receive_frame::<ParentFrame>(&mut receiver).map(|_| ()),
            Err(FrameError::Closed)
        ));
    }

    #[test]
    fn partial_header_held_open_obeys_one_absolute_deadline() {
        let (receiver, mut sender) = UnixStream::pair().expect("socketpair");
        sender.write_all(&[0, 1]).expect("partial header");
        let started = std::time::Instant::now();
        assert!(matches!(
            receive_frame_until::<ParentFrame>(&receiver, started + Duration::from_millis(40),)
                .map(|_| ()),
            Err(FrameError::Deadline)
        ));
        assert!(started.elapsed() < Duration::from_millis(250));
    }

    #[test]
    fn partial_body_held_open_obeys_the_same_deadline() {
        let (receiver, mut sender) = UnixStream::pair().expect("socketpair");
        sender.write_all(&50_u32.to_be_bytes()).expect("header");
        sender.write_all(&[b'{'; 10]).expect("partial body");
        let started = std::time::Instant::now();
        assert!(matches!(
            receive_frame_until::<ParentFrame>(&receiver, started + Duration::from_millis(40),)
                .map(|_| ()),
            Err(FrameError::Deadline)
        ));
        assert!(started.elapsed() < Duration::from_millis(250));
    }

    #[test]
    fn saturated_peer_cannot_block_a_frame_send() {
        let (sender, _receiver) = UnixStream::pair().expect("socketpair");
        sender.set_nonblocking(true).expect("nonblocking sender");
        let bytes = [b'x'; 4096];
        loop {
            let written = unsafe {
                libc::send(
                    sender.as_raw_fd(),
                    bytes.as_ptr().cast(),
                    bytes.len(),
                    libc::MSG_DONTWAIT | libc::MSG_NOSIGNAL,
                )
            };
            if written >= 0 {
                continue;
            }
            assert_eq!(
                std::io::Error::last_os_error().raw_os_error(),
                Some(libc::EAGAIN)
            );
            break;
        }
        let started = std::time::Instant::now();
        assert!(matches!(
            send_frame_until(
                &sender,
                &status_request(44),
                &[],
                started + Duration::from_millis(40),
            ),
            Err(FrameError::Deadline)
        ));
        assert!(started.elapsed() < Duration::from_millis(250));
    }

    #[test]
    fn receive_frame_rejects_rights_beyond_the_declared_maximum() {
        let (mut receiver, sender) = UnixStream::pair().expect("socketpair");
        let (mut peer, spare) = UnixStream::pair().expect("spare fd source");
        // Exactly one more right than the closed maximum, but still within
        // the receiver's control buffer: this exercises the post-collection
        // count check, not `MSG_CTRUNC`.
        let extra = duplicated_fds(spare.as_raw_fd(), MAX_CHILD_BRIDGE_ANCILLARY_FDS + 1);
        raw_send_with_rights(&sender, &status_request(3), &extra);
        close_all(&extra);
        drop(spare);
        assert!(matches!(
            receive_frame::<ParentFrame>(&mut receiver).map(|_| ()),
            Err(FrameError::Invalid)
        ));
        assert_peer_observes_all_received_rights_closed(&mut peer);
    }

    #[test]
    fn receive_frame_captures_and_closes_a_large_rejected_rights_message() {
        let (mut receiver, sender) = UnixStream::pair().expect("socketpair");
        let (mut peer, spare) = UnixStream::pair().expect("spare fd source");
        // Far more descriptors than the wire contract permits. The receiver
        // captures the kernel's entire bounded SCM_RIGHTS message so every
        // installed descriptor can be closed before rejection.
        let many = duplicated_fds(spare.as_raw_fd(), 40);
        raw_send_with_rights(&sender, &status_request(4), &many);
        close_all(&many);
        drop(spare);
        assert!(matches!(
            receive_frame::<ParentFrame>(&mut receiver).map(|_| ()),
            Err(FrameError::Invalid)
        ));
        assert_peer_observes_all_received_rights_closed(&mut peer);
    }
}
