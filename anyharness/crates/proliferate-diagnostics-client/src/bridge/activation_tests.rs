//! Proofs for the non-consuming activation probes and the small descriptor
//! utilities, exercised directly against arbitrary file descriptors rather
//! than the compile-time-reserved 198/199 numbers `take()` hardcodes.
//!
//! Coverage gap (documented, not silently skipped): proving the *positive*
//! branch of `owned_bridge_probe` requires a socket whose peer PID, as seen
//! by `LOCAL_PEERPID`, equals this process's real parent PID. That is only
//! true for a socket created by an actual ancestor process before this
//! process existed (exactly what Tauri does before `exec`). Reproducing it
//! in-process would require either `fork()` inside this shared, multi
//! threaded `cargo test` binary (unsafe: another thread's held libc
//! allocator lock is never released in the child and can deadlock on the
//! first allocation) or an external helper binary (disallowed by this task's
//! rules). The negative branches below are exhaustive instead: wrong type,
//! wrong family, and a same-process pair that is provably not from a real
//! parent all fail closed, which is the security-relevant direction anyway.

use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::os::unix::fs::PermissionsExt;

use tempfile::TempDir;

use super::platform::*;
use super::*;
use crate::bridge::wire::{CHILD_BRIDGE_RESERVED_FD, CHILD_SHUTDOWN_RESERVED_FD};

fn tempdir_fd(mode: u32) -> (TempDir, OwnedFd) {
    let directory = tempfile::tempdir().expect("tempdir");
    std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(mode))
        .expect("set mode");
    let raw = unsafe {
        libc::open(
            std::ffi::CString::new(directory.path().to_str().expect("utf8 path"))
                .expect("no NUL")
                .as_ptr(),
            libc::O_DIRECTORY | libc::O_RDONLY,
        )
    };
    assert!(raw >= 0, "open directory failed");
    (directory, unsafe { OwnedFd::from_raw_fd(raw) })
}

fn regular_file_fd() -> OwnedFd {
    let file = tempfile::NamedTempFile::new().expect("tempfile");
    let raw = unsafe {
        libc::open(
            std::ffi::CString::new(file.path().to_str().expect("utf8 path"))
                .expect("no NUL")
                .as_ptr(),
            libc::O_RDONLY,
        )
    };
    assert!(raw >= 0, "open regular file failed");
    unsafe { OwnedFd::from_raw_fd(raw) }
}

fn pipe_pair() -> (OwnedFd, OwnedFd) {
    let mut fds = [0_i32; 2];
    assert_eq!(unsafe { libc::pipe(fds.as_mut_ptr()) }, 0);
    unsafe { (OwnedFd::from_raw_fd(fds[0]), OwnedFd::from_raw_fd(fds[1])) }
}

// ---------------------------------------------------------------------
// owned_bridge_probe
// ---------------------------------------------------------------------

#[test]
fn owned_bridge_probe_rejects_a_regular_file() {
    let file = regular_file_fd();
    assert!(!owned_bridge_probe(file.as_raw_fd()));
}

#[test]
fn owned_bridge_probe_rejects_a_pipe_endpoint() {
    let (read_end, _write_end) = pipe_pair();
    assert!(!owned_bridge_probe(read_end.as_raw_fd()));
}

#[test]
fn owned_bridge_probe_rejects_a_unix_datagram_socket() {
    let raw = unsafe { libc::socket(libc::AF_UNIX, libc::SOCK_DGRAM, 0) };
    assert!(raw >= 0, "socket() failed");
    let socket = unsafe { OwnedFd::from_raw_fd(raw) };
    assert!(!owned_bridge_probe(socket.as_raw_fd()));
}

#[test]
fn owned_bridge_probe_rejects_a_foreign_address_family() {
    let raw = unsafe { libc::socket(libc::AF_INET, libc::SOCK_STREAM, 0) };
    assert!(raw >= 0, "socket() failed");
    let socket = unsafe { OwnedFd::from_raw_fd(raw) };
    // SOCK_STREAM matches, so this specifically exercises the AF_UNIX check
    // rather than the socket-type check above.
    assert!(!owned_bridge_probe(socket.as_raw_fd()));
}

#[test]
fn owned_bridge_probe_rejects_a_same_process_pair_with_no_real_parent() {
    // A same-process socketpair passes type/family/UID but its peer PID is
    // this process's own PID, not `getppid()`; a genuine Desktop-owned
    // bridge is created by the real parent before `exec`, so this must fail.
    let (one, _two) = std::os::unix::net::UnixStream::pair().expect("socketpair");
    assert!(!owned_bridge_probe(one.as_raw_fd()));
}

// ---------------------------------------------------------------------
// valid_shutdown_descriptor
// ---------------------------------------------------------------------

#[test]
fn valid_shutdown_descriptor_accepts_the_read_end_of_a_pipe() {
    let (read_end, _write_end) = pipe_pair();
    assert!(valid_shutdown_descriptor(read_end.as_raw_fd()));
}

#[test]
fn valid_shutdown_descriptor_rejects_the_write_end_of_the_same_pipe() {
    let (_read_end, write_end) = pipe_pair();
    assert!(!valid_shutdown_descriptor(write_end.as_raw_fd()));
}

#[test]
fn valid_shutdown_descriptor_rejects_a_regular_file() {
    let file = regular_file_fd();
    assert!(!valid_shutdown_descriptor(file.as_raw_fd()));
}

#[test]
fn valid_shutdown_descriptor_rejects_an_absent_fd() {
    let (read_end, _write_end) = pipe_pair();
    let fd = read_end.as_raw_fd();
    drop(read_end);
    assert!(!valid_shutdown_descriptor(fd));
}

// ---------------------------------------------------------------------
// valid_fallback_directory
// ---------------------------------------------------------------------

#[test]
fn valid_fallback_directory_accepts_an_owned_0700_directory() {
    let (_directory, fd) = tempdir_fd(0o700);
    assert!(valid_fallback_directory(fd.as_raw_fd()));
}

#[test]
fn valid_fallback_directory_rejects_a_regular_file() {
    let file = regular_file_fd();
    assert!(!valid_fallback_directory(file.as_raw_fd()));
}

#[test]
fn valid_fallback_directory_rejects_the_wrong_mode() {
    let (_directory, fd) = tempdir_fd(0o755);
    assert!(!valid_fallback_directory(fd.as_raw_fd()));
}

// ---------------------------------------------------------------------
// descriptor_exists / set_cloexec / close_if_open
// ---------------------------------------------------------------------

/// Re-homes `fd` at or above `floor` so closed-state assertions (and
/// `close_if_open` calls) probe a number the suite's lowest-free descriptor
/// allocation cannot reallocate mid-test. This binary runs its tests
/// concurrently in one process: a released low number is re-picked by any
/// neighbouring test within microseconds, which turns an "is it closed"
/// assertion into a probe of someone else's descriptor — and a stale-number
/// `close_if_open` into closing it. Every caller uses a distinct floor so the
/// re-homed numbers cannot collide with each other either.
fn rehome_above(fd: OwnedFd, floor: libc::c_int) -> libc::c_int {
    let high = unsafe { libc::fcntl(fd.as_raw_fd(), libc::F_DUPFD, floor) };
    assert!(high >= floor, "F_DUPFD above {floor} failed");
    high
}

#[test]
fn descriptor_exists_reflects_open_and_closed_state() {
    let (read_end, _write_end) = pipe_pair();
    let fd = rehome_above(read_end, 512);
    assert!(descriptor_exists(fd));
    unsafe { libc::close(fd) };
    assert!(!descriptor_exists(fd));
}

#[test]
fn set_cloexec_adds_the_flag_when_absent() {
    // Raw `pipe(2)` does not set `FD_CLOEXEC`, unlike Rust's `File`/`OwnedFd`
    // constructors, so this is a genuine before/after proof.
    let (read_end, _write_end) = pipe_pair();
    let fd = read_end.as_raw_fd();
    let before = unsafe { libc::fcntl(fd, libc::F_GETFD) };
    assert_eq!(before & libc::FD_CLOEXEC, 0);
    assert!(set_cloexec(fd));
    let after = unsafe { libc::fcntl(fd, libc::F_GETFD) };
    assert_ne!(after & libc::FD_CLOEXEC, 0);
}

#[test]
fn set_cloexec_reports_a_closed_descriptor() {
    let (read_end, _write_end) = pipe_pair();
    let fd = rehome_above(read_end, 520);
    unsafe { libc::close(fd) };
    assert!(!set_cloexec(fd));
}

#[test]
fn owned_bridge_with_failed_cloexec_degrades_and_closes_both_authorities() {
    let (bridge, shutdown) = pipe_pair();
    let bridge_fd = rehome_above(bridge, 528);
    let shutdown_fd = rehome_above(shutdown, 528);

    assert_eq!(
        resolve_descriptor_authority(bridge_fd, shutdown_fd, true, false),
        DescriptorDisposition::Degraded
    );
    assert!(!descriptor_exists(bridge_fd));
    assert!(!descriptor_exists(shutdown_fd));
}

#[test]
fn unrelated_bridge_probe_remains_disabled_when_cloexec_fails() {
    let (bridge, shutdown) = pipe_pair();
    let bridge_fd = rehome_above(bridge, 536);
    let shutdown_fd = rehome_above(shutdown, 536);

    assert_eq!(
        resolve_descriptor_authority(bridge_fd, shutdown_fd, false, false),
        DescriptorDisposition::Disabled
    );
    assert!(!descriptor_exists(bridge_fd));
    assert!(!descriptor_exists(shutdown_fd));
}

#[test]
fn close_if_open_closes_an_open_descriptor_and_is_a_no_op_when_absent() {
    let (read_end, _write_end) = pipe_pair();
    let fd = rehome_above(read_end, 544);
    assert!(descriptor_exists(fd));
    close_if_open(fd);
    assert!(!descriptor_exists(fd));
    // Second call on an already-absent descriptor must not panic or error.
    // The high floor above is what makes this call safe to repeat: on a
    // reallocatable low number it would close an unrelated descriptor.
    close_if_open(fd);
    assert!(!descriptor_exists(fd));
}

// ---------------------------------------------------------------------
// take(): absent reserved descriptors
// ---------------------------------------------------------------------

#[test]
fn take_is_disabled_when_the_reserved_bridge_descriptor_is_absent() {
    // Zero-risk by construction: this only *reads* the fixed numbers via
    // `fcntl(F_GETFD)` and never creates, dups, or closes anything at 198 or
    // 199, so there is nothing to restore afterward. `take()` itself must
    // reach the same conclusion the check below proves independently.
    assert!(
        !descriptor_exists(CHILD_BRIDGE_RESERVED_FD),
        "fd 198 unexpectedly open in the test process"
    );
    assert!(
        !descriptor_exists(CHILD_SHUTDOWN_RESERVED_FD),
        "fd 199 unexpectedly open in the test process"
    );
    assert!(matches!(
        take(DiagnosticsComponent::AnyHarness),
        DesktopDiagnosticsActivation::Disabled
    ));
}
