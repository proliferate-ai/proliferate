//! The macOS control-bridge handshake: claim the inherited descriptor, read
//! the connection descriptor off it, and hand back an activation.
//!
//! Split out of `activation.rs` purely for file size. The stub for every
//! other target still lives inline beside the `mod platform;` declaration.

use std::mem::{size_of, zeroed};
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
use std::os::unix::net::UnixStream;
use std::sync::Arc;
use std::time::Instant;

use proliferate_diagnostics_protocol::v1::limits::MAX_SAFE_INTEGER;
use proliferate_diagnostics_protocol::v1::types::TokenReferenceKindV1;
use proliferate_diagnostics_protocol::v1::validation::validate_connection_descriptor;

use super::*;
use crate::bridge::framing::{receive_frame, FrameError, ReceivedFrame};
use crate::bridge::wire::{
    parent_frame_fd_count, valid_protocol_version, BootstrapCollectorState, BootstrapFallbackState,
    CollectorUnavailableClassification, ParentFrame, CHILD_BOOTSTRAP_READ_DEADLINE,
    CHILD_BRIDGE_RESERVED_FD, CHILD_SHUTDOWN_RESERVED_FD,
};

pub(super) fn take(component: DiagnosticsComponent) -> DesktopDiagnosticsActivation {
    if !descriptor_exists(CHILD_BRIDGE_RESERVED_FD) {
        close_if_open(CHILD_SHUTDOWN_RESERVED_FD);
        return DesktopDiagnosticsActivation::Disabled;
    }
    let bridge_cloexec = set_cloexec(CHILD_BRIDGE_RESERVED_FD);
    let shutdown_cloexec = set_cloexec(CHILD_SHUTDOWN_RESERVED_FD);
    match resolve_descriptor_authority(
        CHILD_BRIDGE_RESERVED_FD,
        CHILD_SHUTDOWN_RESERVED_FD,
        owned_bridge_probe(CHILD_BRIDGE_RESERVED_FD),
        bridge_cloexec && shutdown_cloexec,
    ) {
        DescriptorDisposition::Ready => {}
        DescriptorDisposition::Disabled => return DesktopDiagnosticsActivation::Disabled,
        DescriptorDisposition::Degraded => {
            return degraded(DegradedClassification::DescriptorInvalid, None, None, None)
        }
    }
    let bridge = unsafe { UnixStream::from_raw_fd(CHILD_BRIDGE_RESERVED_FD) };
    if !valid_shutdown_descriptor(CHILD_SHUTDOWN_RESERVED_FD) {
        close_if_open(CHILD_SHUTDOWN_RESERVED_FD);
        return degraded(
            DegradedClassification::DescriptorInvalid,
            Some(bridge),
            None,
            None,
        );
    }
    let shutdown = unsafe { OwnedFd::from_raw_fd(CHILD_SHUTDOWN_RESERVED_FD) };
    let bootstrap_deadline = Instant::now() + CHILD_BOOTSTRAP_READ_DEADLINE;
    let remaining = bootstrap_deadline.saturating_duration_since(Instant::now());
    let _ = bridge.set_read_timeout(Some(remaining));
    let mut reader = match bridge.try_clone() {
        Ok(reader) => reader,
        Err(_) => {
            return degraded(
                DegradedClassification::BridgeUnavailable,
                Some(bridge),
                Some(shutdown),
                None,
            )
        }
    };
    match receive_frame::<ParentFrame>(&mut reader) {
        Ok(received) => {
            parse_bootstrap_until(component, bridge, shutdown, received, bootstrap_deadline)
        }
        Err(FrameError::Closed | FrameError::Io | FrameError::Deadline) => degraded(
            DegradedClassification::BootstrapTimeout,
            Some(bridge),
            Some(shutdown),
            None,
        ),
        Err(FrameError::Invalid) => degraded(
            DegradedClassification::FramingInvalid,
            Some(bridge),
            Some(shutdown),
            None,
        ),
    }
}

pub(super) fn parse_bootstrap_until(
    component: DiagnosticsComponent,
    bridge: UnixStream,
    shutdown: OwnedFd,
    mut received: ReceivedFrame<ParentFrame>,
    bootstrap_deadline: Instant,
) -> DesktopDiagnosticsActivation {
    let expected_descriptor_count = parent_frame_fd_count(&received.frame);
    let ParentFrame::Bootstrap {
        protocol_version,
        component: wire_component,
        initial_state,
        fallback_state,
    } = &mut received.frame
    else {
        return degraded(
            DegradedClassification::FramingInvalid,
            Some(bridge),
            Some(shutdown),
            None,
        );
    };
    if !valid_protocol_version(*protocol_version)
        || expected_descriptor_count != received.descriptors.len()
    {
        return degraded(
            DegradedClassification::FramingInvalid,
            Some(bridge),
            Some(shutdown),
            None,
        );
    }
    if *wire_component != component.wire_name() {
        return degraded(
            DegradedClassification::ComponentMismatch,
            Some(bridge),
            Some(shutdown),
            None,
        );
    }

    // Fallback authority is independent of collector readiness. Detach
    // and validate its final, role-ordered descriptor before touching a
    // capability so a malformed collector cannot discard a usable
    // fallback directory on the degraded path.
    let mut descriptors = received.descriptors;
    let fallback = match fallback_state {
        BootstrapFallbackState::Available { .. } => descriptors.pop().and_then(|fd| {
            valid_fallback_directory(fd.as_raw_fd())
                .then_some(FallbackDirectoryHandle { descriptor: fd })
        }),
        BootstrapFallbackState::Unavailable { .. } => None,
    };
    let mut descriptors = descriptors.into_iter();
    let collector = match initial_state {
        BootstrapCollectorState::Ready {
            generation,
            descriptor,
            ..
        } => {
            let Some(capability_fd) = descriptors.next() else {
                return degraded(
                    DegradedClassification::DescriptorInvalid,
                    Some(bridge),
                    Some(shutdown),
                    fallback,
                );
            };
            if *generation > MAX_SAFE_INTEGER {
                return degraded(
                    DegradedClassification::DescriptorInvalid,
                    Some(bridge),
                    Some(shutdown),
                    fallback,
                );
            }
            descriptor.token_reference.reference = capability_fd.as_raw_fd().to_string();
            if descriptor.token_reference.kind != TokenReferenceKindV1::InheritedFileDescriptor
                || validate_connection_descriptor(descriptor).is_err()
            {
                return degraded(
                    DegradedClassification::DescriptorInvalid,
                    Some(bridge),
                    Some(shutdown),
                    fallback,
                );
            }
            let capability =
                match capability::read_capability_until(capability_fd, bootstrap_deadline) {
                    Ok(value) => value,
                    Err(_) => {
                        return degraded(
                            DegradedClassification::DescriptorInvalid,
                            Some(bridge),
                            Some(shutdown),
                            fallback,
                        )
                    }
                };
            let client = match CollectorClient::new(&descriptor.endpoint, capability) {
                Ok(client) => Arc::new(client),
                Err(_) => {
                    return degraded(
                        DegradedClassification::DescriptorInvalid,
                        Some(bridge),
                        Some(shutdown),
                        fallback,
                    )
                }
            };
            InitialCollectorState::Ready(CollectorGenerationHandle {
                generation: *generation,
                collector_boot_id: descriptor.collector_boot_id.clone(),
                client,
            })
        }
        BootstrapCollectorState::Unavailable {
            generation,
            classification,
        } => {
            if *generation > MAX_SAFE_INTEGER {
                return degraded(
                    DegradedClassification::DescriptorInvalid,
                    Some(bridge),
                    Some(shutdown),
                    fallback,
                );
            }
            InitialCollectorState::Unavailable {
                generation: *generation,
                classification: map_unavailable(*classification),
            }
        }
    };

    if descriptors.next().is_some() {
        return degraded(
            DegradedClassification::FramingInvalid,
            Some(bridge),
            Some(shutdown),
            fallback,
        );
    }
    DesktopDiagnosticsActivation::Bundled(DesktopDiagnosticsBootstrap {
        initial_state: collector,
        fallback,
        bridge,
        shutdown,
    })
}

pub(super) fn degraded(
    classification: DegradedClassification,
    bridge: Option<UnixStream>,
    shutdown: Option<OwnedFd>,
    fallback: Option<FallbackDirectoryHandle>,
) -> DesktopDiagnosticsActivation {
    DesktopDiagnosticsActivation::BundledDegraded(DesktopDiagnosticsDegradedBootstrap {
        classification,
        fallback,
        bridge,
        shutdown,
    })
}

#[cfg(test)]
pub(super) fn parse_bootstrap(
    component: DiagnosticsComponent,
    bridge: UnixStream,
    shutdown: OwnedFd,
    received: ReceivedFrame<ParentFrame>,
) -> DesktopDiagnosticsActivation {
    parse_bootstrap_until(
        component,
        bridge,
        shutdown,
        received,
        Instant::now() + CHILD_BOOTSTRAP_READ_DEADLINE,
    )
}

pub(super) fn descriptor_exists(fd: RawFd) -> bool {
    (unsafe { libc::fcntl(fd, libc::F_GETFD) }) >= 0
}

pub(super) fn set_cloexec(fd: RawFd) -> bool {
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFD) };
    if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFD, flags | libc::FD_CLOEXEC) } != 0 {
        return false;
    }
    let installed = unsafe { libc::fcntl(fd, libc::F_GETFD) };
    installed >= 0 && installed & libc::FD_CLOEXEC != 0
}

pub(super) fn close_if_open(fd: RawFd) {
    if descriptor_exists(fd) {
        unsafe { libc::close(fd) };
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum DescriptorDisposition {
    Ready,
    Disabled,
    Degraded,
}

pub(super) fn resolve_descriptor_authority(
    bridge_fd: RawFd,
    shutdown_fd: RawFd,
    owned_bridge: bool,
    cloexec_installed: bool,
) -> DescriptorDisposition {
    if owned_bridge && cloexec_installed {
        return DescriptorDisposition::Ready;
    }
    close_if_open(bridge_fd);
    close_if_open(shutdown_fd);
    if owned_bridge {
        DescriptorDisposition::Degraded
    } else {
        DescriptorDisposition::Disabled
    }
}

pub(super) fn owned_bridge_probe(fd: RawFd) -> bool {
    let mut socket_type = 0_i32;
    let mut socket_type_len = size_of::<i32>() as libc::socklen_t;
    let type_ok = unsafe {
        libc::getsockopt(
            fd,
            libc::SOL_SOCKET,
            libc::SO_TYPE,
            (&mut socket_type as *mut i32).cast(),
            &mut socket_type_len,
        )
    } == 0
        && socket_type == libc::SOCK_STREAM;
    if !type_ok {
        return false;
    }
    let mut local: libc::sockaddr_storage = unsafe { zeroed() };
    let mut local_len = size_of::<libc::sockaddr_storage>() as libc::socklen_t;
    if unsafe {
        libc::getsockname(
            fd,
            (&mut local as *mut libc::sockaddr_storage).cast::<libc::sockaddr>(),
            &mut local_len,
        )
    } != 0
        || i32::from(local.ss_family) != libc::AF_UNIX
    {
        return false;
    }
    let mut euid = 0_u32;
    let mut egid = 0_u32;
    if unsafe { libc::getpeereid(fd, &mut euid, &mut egid) } != 0
        || euid != unsafe { libc::geteuid() }
    {
        return false;
    }
    let mut peer_pid = 0_i32;
    let mut peer_pid_len = size_of::<i32>() as libc::socklen_t;
    (unsafe {
        libc::getsockopt(
            fd,
            libc::SOL_LOCAL,
            libc::LOCAL_PEERPID,
            (&mut peer_pid as *mut i32).cast(),
            &mut peer_pid_len,
        )
    }) == 0
        && peer_pid == unsafe { libc::getppid() }
}

pub(super) fn valid_shutdown_descriptor(fd: RawFd) -> bool {
    if !descriptor_exists(fd)
        || (unsafe { libc::fcntl(fd, libc::F_GETFL) }) & libc::O_ACCMODE != libc::O_RDONLY
    {
        return false;
    }
    let mut stat: libc::stat = unsafe { zeroed() };
    (unsafe { libc::fstat(fd, &mut stat) }) == 0 && stat.st_mode & libc::S_IFMT == libc::S_IFIFO
}

pub(super) fn valid_fallback_directory(fd: RawFd) -> bool {
    let mut stat: libc::stat = unsafe { zeroed() };
    (unsafe { libc::fstat(fd, &mut stat) }) == 0
        && stat.st_mode & libc::S_IFMT == libc::S_IFDIR
        && stat.st_uid == unsafe { libc::geteuid() }
        && stat.st_mode & 0o777 == 0o700
}

fn map_unavailable(value: CollectorUnavailableClassification) -> UnavailableClassification {
    match value {
        CollectorUnavailableClassification::Starting => UnavailableClassification::Starting,
        CollectorUnavailableClassification::Degraded => UnavailableClassification::Degraded,
        CollectorUnavailableClassification::Stopped => UnavailableClassification::Stopped,
        CollectorUnavailableClassification::ShuttingDown => UnavailableClassification::ShuttingDown,
        CollectorUnavailableClassification::HandoffUnavailable => {
            UnavailableClassification::HandoffUnavailable
        }
    }
}
