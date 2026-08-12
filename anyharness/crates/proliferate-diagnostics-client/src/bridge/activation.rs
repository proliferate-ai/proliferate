use std::sync::atomic::{AtomicBool, Ordering};

use super::wire::DegradedClassification;
use crate::{producer::transport::CollectorClient, DiagnosticsComponent};

static ACTIVATION_TAKEN: AtomicBool = AtomicBool::new(false);

pub enum DesktopDiagnosticsActivation {
    Disabled,
    Bundled(DesktopDiagnosticsBootstrap),
    BundledDegraded(DesktopDiagnosticsDegradedBootstrap),
}

pub enum BundledDesktopDiagnosticsBootstrap {
    Ready(DesktopDiagnosticsBootstrap),
    Degraded(DesktopDiagnosticsDegradedBootstrap),
}

impl From<DesktopDiagnosticsBootstrap> for BundledDesktopDiagnosticsBootstrap {
    fn from(value: DesktopDiagnosticsBootstrap) -> Self {
        Self::Ready(value)
    }
}

impl From<DesktopDiagnosticsDegradedBootstrap> for BundledDesktopDiagnosticsBootstrap {
    fn from(value: DesktopDiagnosticsDegradedBootstrap) -> Self {
        Self::Degraded(value)
    }
}

pub enum InitialCollectorState {
    Ready(CollectorGenerationHandle),
    Unavailable {
        generation: u64,
        classification: UnavailableClassification,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UnavailableClassification {
    Starting,
    Degraded,
    Stopped,
    ShuttingDown,
    HandoffUnavailable,
}

pub struct CollectorGenerationHandle {
    pub(crate) generation: u64,
    pub(crate) collector_boot_id: String,
    pub(crate) client: std::sync::Arc<CollectorClient>,
}

pub struct DesktopDiagnosticsBootstrap {
    pub(crate) initial_state: InitialCollectorState,
    pub(crate) fallback: Option<FallbackDirectoryHandle>,
    #[cfg(unix)]
    pub(crate) bridge: std::os::unix::net::UnixStream,
    #[cfg(unix)]
    pub(crate) shutdown: std::os::fd::OwnedFd,
}

pub struct DesktopDiagnosticsDegradedBootstrap {
    pub(crate) classification: DegradedClassification,
    pub(crate) fallback: Option<FallbackDirectoryHandle>,
    #[cfg(unix)]
    pub(crate) bridge: Option<std::os::unix::net::UnixStream>,
    #[cfg(unix)]
    pub(crate) shutdown: Option<std::os::fd::OwnedFd>,
}

pub(crate) struct FallbackDirectoryHandle {
    #[cfg(unix)]
    pub(crate) descriptor: std::os::fd::OwnedFd,
}

#[cfg(unix)]
pub(crate) fn collector_generation_from_received(
    generation: u64,
    mut descriptor: proliferate_diagnostics_protocol::v1::types::ConnectionDescriptorV1,
    capability_fd: std::os::fd::OwnedFd,
) -> Result<CollectorGenerationHandle, ()> {
    use std::fs::File;
    use std::io::Read;
    use std::os::fd::AsRawFd;

    use proliferate_diagnostics_protocol::v1::{
        limits::MAX_SAFE_INTEGER, types::TokenReferenceKindV1,
        validation::validate_connection_descriptor,
    };
    use zeroize::Zeroize;

    if generation > MAX_SAFE_INTEGER {
        return Err(());
    }
    descriptor.token_reference.reference = capability_fd.as_raw_fd().to_string();
    if descriptor.token_reference.kind != TokenReferenceKindV1::InheritedFileDescriptor
        || validate_connection_descriptor(&descriptor).is_err()
    {
        return Err(());
    }
    let mut file = File::from(capability_fd);
    let mut bytes = Vec::new();
    file.by_ref()
        .take(257)
        .read_to_end(&mut bytes)
        .map_err(|_| ())?;
    while matches!(bytes.last(), Some(b'\n' | b'\r')) {
        bytes.pop();
    }
    if bytes.is_empty() || bytes.len() > 256 || !bytes.iter().all(|byte| byte.is_ascii_graphic()) {
        bytes.zeroize();
        return Err(());
    }
    let capability = String::from_utf8(bytes).map_err(|_| ())?;
    let client = CollectorClient::new(&descriptor.endpoint, capability).map_err(|_| ())?;
    Ok(CollectorGenerationHandle {
        generation,
        collector_boot_id: descriptor.collector_boot_id,
        client: std::sync::Arc::new(client),
    })
}

pub fn take_desktop_activation(component: DiagnosticsComponent) -> DesktopDiagnosticsActivation {
    if ACTIVATION_TAKEN.swap(true, Ordering::AcqRel) {
        return DesktopDiagnosticsActivation::Disabled;
    }
    platform::take(component)
}

#[cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
mod platform {
    use std::fs::File;
    use std::io::Read;
    use std::mem::{size_of, zeroed};
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
    use std::os::unix::net::UnixStream;
    use std::sync::Arc;

    use proliferate_diagnostics_protocol::v1::limits::MAX_SAFE_INTEGER;
    use proliferate_diagnostics_protocol::v1::types::TokenReferenceKindV1;
    use proliferate_diagnostics_protocol::v1::validation::validate_connection_descriptor;

    use super::*;
    use crate::bridge::framing::{receive_frame, FrameError, ReceivedFrame};
    use crate::bridge::wire::{
        parent_frame_fd_count, valid_protocol_version, BootstrapCollectorState,
        BootstrapFallbackState, CollectorUnavailableClassification, ParentFrame,
        CHILD_BOOTSTRAP_READ_DEADLINE, CHILD_BRIDGE_RESERVED_FD, CHILD_SHUTDOWN_RESERVED_FD,
    };

    pub(super) fn take(component: DiagnosticsComponent) -> DesktopDiagnosticsActivation {
        if !descriptor_exists(CHILD_BRIDGE_RESERVED_FD) {
            close_if_open(CHILD_SHUTDOWN_RESERVED_FD);
            return DesktopDiagnosticsActivation::Disabled;
        }
        set_cloexec(CHILD_BRIDGE_RESERVED_FD);
        set_cloexec(CHILD_SHUTDOWN_RESERVED_FD);
        if !owned_bridge_probe(CHILD_BRIDGE_RESERVED_FD) {
            close_if_open(CHILD_BRIDGE_RESERVED_FD);
            close_if_open(CHILD_SHUTDOWN_RESERVED_FD);
            return DesktopDiagnosticsActivation::Disabled;
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
        let _ = bridge.set_read_timeout(Some(CHILD_BOOTSTRAP_READ_DEADLINE));
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
            Ok(received) => parse_bootstrap(component, bridge, shutdown, received),
            Err(FrameError::Closed | FrameError::Io) => degraded(
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

    fn parse_bootstrap(
        component: DiagnosticsComponent,
        bridge: UnixStream,
        shutdown: OwnedFd,
        mut received: ReceivedFrame<ParentFrame>,
    ) -> DesktopDiagnosticsActivation {
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
            || parent_frame_fd_count(&received.frame) != received.descriptors.len()
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
                        None,
                    );
                }
                let capability = match read_capability(capability_fd) {
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
            } => InitialCollectorState::Unavailable {
                generation: (*generation).min(MAX_SAFE_INTEGER),
                classification: map_unavailable(*classification),
            },
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

    fn degraded(
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

    fn read_capability(descriptor: OwnedFd) -> Result<String, ()> {
        let mut file = File::from(descriptor);
        let mut bytes = Vec::new();
        file.by_ref()
            .take(257)
            .read_to_end(&mut bytes)
            .map_err(|_| ())?;
        while matches!(bytes.last(), Some(b'\n' | b'\r')) {
            bytes.pop();
        }
        if bytes.is_empty()
            || bytes.len() > 256
            || !bytes.iter().all(|byte| byte.is_ascii_graphic())
        {
            bytes.fill(0);
            return Err(());
        }
        String::from_utf8(bytes).map_err(|_| ())
    }

    fn descriptor_exists(fd: RawFd) -> bool {
        (unsafe { libc::fcntl(fd, libc::F_GETFD) }) >= 0
    }

    fn set_cloexec(fd: RawFd) {
        let flags = unsafe { libc::fcntl(fd, libc::F_GETFD) };
        if flags >= 0 {
            unsafe { libc::fcntl(fd, libc::F_SETFD, flags | libc::FD_CLOEXEC) };
        }
    }

    fn close_if_open(fd: RawFd) {
        if descriptor_exists(fd) {
            unsafe { libc::close(fd) };
        }
    }

    fn owned_bridge_probe(fd: RawFd) -> bool {
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
        if unsafe { libc::getsockname(fd, (&mut local as *mut _).cast(), &mut local_len) } != 0
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

    fn valid_shutdown_descriptor(fd: RawFd) -> bool {
        if !descriptor_exists(fd)
            || (unsafe { libc::fcntl(fd, libc::F_GETFL) }) & libc::O_ACCMODE != libc::O_RDONLY
        {
            return false;
        }
        let mut stat: libc::stat = unsafe { zeroed() };
        (unsafe { libc::fstat(fd, &mut stat) }) == 0 && stat.st_mode & libc::S_IFMT == libc::S_IFIFO
    }

    fn valid_fallback_directory(fd: RawFd) -> bool {
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
            CollectorUnavailableClassification::ShuttingDown => {
                UnavailableClassification::ShuttingDown
            }
            CollectorUnavailableClassification::HandoffUnavailable => {
                UnavailableClassification::HandoffUnavailable
            }
        }
    }
}

#[cfg(not(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
)))]
mod platform {
    use super::*;

    pub(super) fn take(_: DiagnosticsComponent) -> DesktopDiagnosticsActivation {
        DesktopDiagnosticsActivation::Disabled
    }
}

#[cfg(all(
    test,
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
#[path = "activation_tests.rs"]
mod tests;

#[cfg(all(
    test,
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
#[path = "activation_parse_tests.rs"]
mod parse_tests;
