#![cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]

use std::{mem, os::fd::RawFd};

use proliferate_diagnostics_client::bridge::wire::{
    CHILD_BRIDGE_RESERVED_FD, CHILD_SHUTDOWN_RESERVED_FD,
};
use tokio::process::Command;

use super::{
    remap_child_descriptors_for_test, PreparedChildDiagnosticsLaunch, PreparedDescriptorSnapshot,
};

#[test]
fn prepared_endpoints_have_expected_roles_and_are_cloexec() {
    let prepared = PreparedChildDiagnosticsLaunch::create().expect("prepare descriptors");
    let descriptors = prepared.raw_descriptors();

    for descriptor in all_descriptors(descriptors) {
        assert!(descriptor >= 0);
        assert_ne!(fd_flags(descriptor) & libc::FD_CLOEXEC, 0);
    }

    assert_unix_stream(descriptors.parent_bridge);
    assert_unix_stream(descriptors.child_bridge);
    assert_pipe_end(descriptors.child_shutdown, libc::O_RDONLY);
    assert_pipe_end(descriptors.parent_shutdown_writer, libc::O_WRONLY);
}

#[test]
fn dropping_prepared_launch_closes_every_endpoint() {
    let prepared = PreparedChildDiagnosticsLaunch::create().expect("prepare descriptors");
    let descriptors = all_descriptors(prepared.raw_descriptors());

    drop(prepared);

    for descriptor in descriptors {
        assert_descriptor_closed(descriptor);
    }
}

#[test]
fn failed_spawn_closes_every_endpoint() {
    let prepared = PreparedChildDiagnosticsLaunch::create().expect("prepare descriptors");
    let descriptors = all_descriptors(prepared.raw_descriptors());
    let command = Command::new("/definitely/not/a/proliferate/executable");

    assert!(prepared.spawn(command).is_err(), "spawn must fail");

    for descriptor in descriptors {
        assert_descriptor_closed(descriptor);
    }
}

#[test]
fn raw_remap_handles_ordinary_sources() {
    assert_remap_case(RemapCase::Ordinary);
}

#[test]
fn raw_remap_handles_sources_already_at_their_targets() {
    assert_remap_case(RemapCase::AlreadyInstalled);
}

#[test]
fn raw_remap_handles_crossed_reserved_sources() {
    assert_remap_case(RemapCase::Crossed);
}

#[test]
fn raw_remap_failure_closes_sources_and_partial_targets() {
    let prepared = PreparedChildDiagnosticsLaunch::create().expect("prepare descriptors");
    let descriptors = prepared.raw_descriptors();

    // SAFETY: the child executes only raw descriptor operations and `_exit`.
    let child = unsafe { libc::fork() };
    assert!(
        child >= 0,
        "fork failed: {}",
        std::io::Error::last_os_error()
    );
    if child == 0 {
        // SAFETY: this process owns fork-private copies of every descriptor.
        unsafe {
            libc::close(descriptors.child_shutdown);
            let result = remap_child_descriptors_for_test(
                descriptors.child_bridge,
                descriptors.child_shutdown,
                descriptors.parent_bridge,
                descriptors.parent_shutdown_writer,
            );
            let closed = descriptor_is_closed(descriptors.child_bridge)
                && descriptor_is_closed(descriptors.parent_bridge)
                && descriptor_is_closed(descriptors.parent_shutdown_writer)
                && descriptor_is_closed(CHILD_BRIDGE_RESERVED_FD)
                && descriptor_is_closed(CHILD_SHUTDOWN_RESERVED_FD);
            libc::_exit(if result.is_err() && closed { 0 } else { 71 });
        }
    }

    assert_child_succeeded(child);
}

#[derive(Clone, Copy)]
enum RemapCase {
    Ordinary,
    AlreadyInstalled,
    Crossed,
}

fn assert_remap_case(case: RemapCase) {
    let prepared = PreparedChildDiagnosticsLaunch::create().expect("prepare descriptors");
    let descriptors = prepared.raw_descriptors();
    write_byte(descriptors.parent_bridge, b'B');
    write_byte(descriptors.parent_shutdown_writer, b'S');

    // SAFETY: the child executes only raw descriptor operations and `_exit`.
    let child = unsafe { libc::fork() };
    assert!(
        child >= 0,
        "fork failed: {}",
        std::io::Error::last_os_error()
    );
    if child == 0 {
        // SAFETY: this process owns fork-private copies of every descriptor.
        unsafe {
            libc::_exit(run_remap_child(case, descriptors));
        }
    }

    assert_child_succeeded(child);
}

unsafe fn run_remap_child(case: RemapCase, descriptors: PreparedDescriptorSnapshot) -> libc::c_int {
    let (bridge_source, shutdown_source) = match case {
        RemapCase::Ordinary => (descriptors.child_bridge, descriptors.child_shutdown),
        RemapCase::AlreadyInstalled => {
            if unsafe {
                install_test_sources(
                    descriptors.child_bridge,
                    descriptors.child_shutdown,
                    CHILD_BRIDGE_RESERVED_FD,
                    CHILD_SHUTDOWN_RESERVED_FD,
                )
            } < 0
            {
                return 72;
            }
            (CHILD_BRIDGE_RESERVED_FD, CHILD_SHUTDOWN_RESERVED_FD)
        }
        RemapCase::Crossed => {
            if unsafe {
                install_test_sources(
                    descriptors.child_bridge,
                    descriptors.child_shutdown,
                    CHILD_SHUTDOWN_RESERVED_FD,
                    CHILD_BRIDGE_RESERVED_FD,
                )
            } < 0
            {
                return 73;
            }
            (CHILD_SHUTDOWN_RESERVED_FD, CHILD_BRIDGE_RESERVED_FD)
        }
    };

    if unsafe {
        remap_child_descriptors_for_test(
            bridge_source,
            shutdown_source,
            descriptors.parent_bridge,
            descriptors.parent_shutdown_writer,
        )
    }
    .is_err()
    {
        return 74;
    }

    if !descriptor_open_without_cloexec(CHILD_BRIDGE_RESERVED_FD)
        || !descriptor_open_without_cloexec(CHILD_SHUTDOWN_RESERVED_FD)
    {
        return 75;
    }
    if unsafe { read_byte(CHILD_BRIDGE_RESERVED_FD) } != b'B'
        || unsafe { read_byte(CHILD_SHUTDOWN_RESERVED_FD) } != b'S'
    {
        return 76;
    }
    if !descriptor_is_closed(descriptors.parent_bridge)
        || !descriptor_is_closed(descriptors.parent_shutdown_writer)
    {
        return 77;
    }
    0
}

/// Installs fork-local copies at the requested targets and removes the
/// original low-numbered sources, accurately modeling reserved-fd collisions.
unsafe fn install_test_sources(
    bridge_source: RawFd,
    shutdown_source: RawFd,
    bridge_target: RawFd,
    shutdown_target: RawFd,
) -> libc::c_int {
    // SAFETY: both sources are open fork-private descriptors.
    let bridge_copy = unsafe { libc::fcntl(bridge_source, libc::F_DUPFD_CLOEXEC, 200) };
    if bridge_copy < 0 {
        return -1;
    }
    // SAFETY: both sources are open fork-private descriptors.
    let shutdown_copy = unsafe { libc::fcntl(shutdown_source, libc::F_DUPFD_CLOEXEC, 200) };
    if shutdown_copy < 0 {
        // SAFETY: bridge_copy was created above.
        unsafe { libc::close(bridge_copy) };
        return -1;
    }

    // SAFETY: the temporary copies keep each endpoint stable across dup2.
    let mapped = unsafe {
        libc::dup2(bridge_copy, bridge_target) >= 0
            && libc::dup2(shutdown_copy, shutdown_target) >= 0
            && set_cloexec_raw(bridge_target)
            && set_cloexec_raw(shutdown_target)
    };
    // SAFETY: these are fork-private originals and temporaries.
    unsafe {
        close_unless_reserved(bridge_source);
        close_unless_reserved(shutdown_source);
        libc::close(bridge_copy);
        libc::close(shutdown_copy);
    }
    if mapped {
        0
    } else {
        -1
    }
}

unsafe fn set_cloexec_raw(descriptor: RawFd) -> bool {
    // SAFETY: descriptor is a fork-local installed target.
    let flags = unsafe { libc::fcntl(descriptor, libc::F_GETFD) };
    flags >= 0
        // SAFETY: flags came from F_GETFD for this descriptor.
        && unsafe { libc::fcntl(descriptor, libc::F_SETFD, flags | libc::FD_CLOEXEC) } >= 0
}

unsafe fn close_unless_reserved(descriptor: RawFd) {
    if descriptor != CHILD_BRIDGE_RESERVED_FD && descriptor != CHILD_SHUTDOWN_RESERVED_FD {
        // SAFETY: caller passes a fork-private owned descriptor.
        unsafe { libc::close(descriptor) };
    }
}

fn all_descriptors(snapshot: PreparedDescriptorSnapshot) -> [RawFd; 4] {
    [
        snapshot.parent_bridge,
        snapshot.child_bridge,
        snapshot.child_shutdown,
        snapshot.parent_shutdown_writer,
    ]
}

fn fd_flags(descriptor: RawFd) -> libc::c_int {
    // SAFETY: tests pass a live descriptor.
    unsafe { libc::fcntl(descriptor, libc::F_GETFD) }
}

fn assert_unix_stream(descriptor: RawFd) {
    let mut socket_type: libc::c_int = 0;
    let mut length = mem::size_of_val(&socket_type) as libc::socklen_t;
    // SAFETY: both output pointers are valid for their advertised lengths.
    let result = unsafe {
        libc::getsockopt(
            descriptor,
            libc::SOL_SOCKET,
            libc::SO_TYPE,
            (&mut socket_type as *mut libc::c_int).cast(),
            &mut length,
        )
    };
    assert_eq!(result, 0);
    assert_eq!(socket_type, libc::SOCK_STREAM);

    // SAFETY: zero is a valid initial representation for sockaddr_storage.
    let mut address: libc::sockaddr_storage = unsafe { mem::zeroed() };
    let mut address_length = mem::size_of_val(&address) as libc::socklen_t;
    // SAFETY: address is a sufficiently large socket-address output buffer.
    let result = unsafe {
        libc::getsockname(
            descriptor,
            (&mut address as *mut libc::sockaddr_storage).cast(),
            &mut address_length,
        )
    };
    assert_eq!(result, 0);
    assert_eq!(address.ss_family as libc::c_int, libc::AF_UNIX);
}

fn assert_pipe_end(descriptor: RawFd, expected_access: libc::c_int) {
    // SAFETY: zero is a valid initial representation for stat.
    let mut status: libc::stat = unsafe { mem::zeroed() };
    // SAFETY: status points to writable stat storage.
    assert_eq!(unsafe { libc::fstat(descriptor, &mut status) }, 0);
    assert_eq!(status.st_mode & libc::S_IFMT, libc::S_IFIFO);
    // SAFETY: descriptor is live.
    let flags = unsafe { libc::fcntl(descriptor, libc::F_GETFL) };
    assert!(flags >= 0);
    assert_eq!(flags & libc::O_ACCMODE, expected_access);
}

fn write_byte(descriptor: RawFd, byte: u8) {
    // SAFETY: descriptor is a live stream/pipe writer and byte is readable.
    assert_eq!(
        unsafe { libc::write(descriptor, (&byte as *const u8).cast(), 1) },
        1
    );
}

unsafe fn read_byte(descriptor: RawFd) -> u8 {
    let mut byte = 0_u8;
    // SAFETY: descriptor is readable and byte is writable.
    if unsafe { libc::read(descriptor, (&mut byte as *mut u8).cast(), 1) } == 1 {
        byte
    } else {
        0
    }
}

fn descriptor_open_without_cloexec(descriptor: RawFd) -> bool {
    let flags = fd_flags(descriptor);
    flags >= 0 && flags & libc::FD_CLOEXEC == 0
}

fn descriptor_is_closed(descriptor: RawFd) -> bool {
    // SAFETY: F_GETFD is the non-mutating validity probe for a raw descriptor.
    unsafe { libc::fcntl(descriptor, libc::F_GETFD) < 0 }
}

fn assert_descriptor_closed(descriptor: RawFd) {
    assert!(
        descriptor_is_closed(descriptor),
        "fd {descriptor} remained open"
    );
}

fn assert_child_succeeded(child: libc::pid_t) {
    let mut status = 0;
    // SAFETY: child is a live direct child and status is writable.
    assert_eq!(unsafe { libc::waitpid(child, &mut status, 0) }, child);
    assert_eq!(status & 0x7f, 0, "child terminated by signal: {status}");
    assert_eq!((status >> 8) & 0xff, 0, "child exit status: {status}");
}
