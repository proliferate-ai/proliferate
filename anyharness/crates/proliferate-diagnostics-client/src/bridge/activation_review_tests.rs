//! Accepted integrated-review regressions for bootstrap ownership.

use std::ffi::CString;
use std::io::Write;
use std::os::fd::{FromRawFd, OwnedFd};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::UnixStream;

use proliferate_diagnostics_protocol::v1::limits::{CURRENT_SCHEMA_VERSION, MAX_SAFE_INTEGER};
use proliferate_diagnostics_protocol::v1::types::{
    ConnectionDescriptorV1, ProtectedTokenReferenceV1, TokenReferenceKindV1,
};

use super::platform::*;
use super::*;
use crate::bridge::framing::ReceivedFrame;
use crate::bridge::wire::{
    BootstrapCollectorState, BootstrapFallbackState, CapabilityFdRole,
    CollectorUnavailableClassification, FallbackFdRole, ParentFrame, WireComponent,
    CHILD_BRIDGE_PROTOCOL_VERSION,
};

#[test]
fn malformed_ready_token_kind_retains_independently_validated_fallback() {
    let mut invalid = descriptor();
    invalid.token_reference.kind = TokenReferenceKindV1::ProcessMemory;
    assert_ready_descriptor_degrades_with_fallback(invalid);
}

#[test]
fn malformed_ready_connection_descriptor_retains_independently_validated_fallback() {
    let mut invalid = descriptor();
    invalid.endpoint = "https://127.0.0.1:9001".to_owned();
    assert_ready_descriptor_degrades_with_fallback(invalid);
}

#[test]
fn unavailable_generation_over_safe_integer_degrades_without_clamping() {
    let (bridge, shutdown) = context();
    let frame = bootstrap(BootstrapCollectorState::Unavailable {
        generation: MAX_SAFE_INTEGER + 1,
        classification: CollectorUnavailableClassification::Starting,
    });
    let (_directory, fallback) = fallback_dir_fd();
    let outcome = parse_bootstrap(
        DiagnosticsComponent::AnyHarness,
        bridge,
        shutdown,
        ReceivedFrame {
            frame,
            descriptors: vec![fallback],
        },
    );
    assert_degraded_with_fallback(outcome);
}

fn assert_ready_descriptor_degrades_with_fallback(descriptor: ConnectionDescriptorV1) {
    let (bridge, shutdown) = context();
    let frame = bootstrap(BootstrapCollectorState::Ready {
        generation: 1,
        descriptor,
        capability_fd_role: CapabilityFdRole::CollectorCapability,
    });
    let capability = capability_fd(b"unused-capability");
    let (_directory, fallback) = fallback_dir_fd();
    let outcome = parse_bootstrap(
        DiagnosticsComponent::AnyHarness,
        bridge,
        shutdown,
        ReceivedFrame {
            frame,
            descriptors: vec![capability, fallback],
        },
    );
    assert_degraded_with_fallback(outcome);
}

fn assert_degraded_with_fallback(outcome: DesktopDiagnosticsActivation) {
    let DesktopDiagnosticsActivation::BundledDegraded(degraded) = outcome else {
        panic!("expected bundled degraded activation");
    };
    assert_eq!(
        degraded.classification,
        DegradedClassification::DescriptorInvalid
    );
    assert!(degraded.fallback.is_some());
}

fn bootstrap(initial_state: BootstrapCollectorState) -> ParentFrame {
    ParentFrame::Bootstrap {
        protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
        component: WireComponent::Anyharness,
        initial_state,
        fallback_state: BootstrapFallbackState::Available {
            fd_role: FallbackFdRole::DiagnosticsFallbackDirectory,
        },
    }
}

fn descriptor() -> ConnectionDescriptorV1 {
    ConnectionDescriptorV1 {
        endpoint: "http://127.0.0.1:9001".to_owned(),
        token_reference: ProtectedTokenReferenceV1 {
            kind: TokenReferenceKindV1::InheritedFileDescriptor,
            reference: "0".to_owned(),
        },
        schema_major: CURRENT_SCHEMA_VERSION.major,
        collector_boot_id: "collector-boot-1".to_owned(),
    }
}

fn context() -> (UnixStream, OwnedFd) {
    let (bridge, _peer) = UnixStream::pair().expect("bridge socketpair");
    let (shutdown, _writer) = pipe_pair();
    (bridge, shutdown)
}

fn pipe_pair() -> (OwnedFd, OwnedFd) {
    let mut fds = [0_i32; 2];
    assert_eq!(unsafe { libc::pipe(fds.as_mut_ptr()) }, 0);
    unsafe { (OwnedFd::from_raw_fd(fds[0]), OwnedFd::from_raw_fd(fds[1])) }
}

fn capability_fd(bytes: &[u8]) -> OwnedFd {
    let (read, write) = pipe_pair();
    let mut write = std::fs::File::from(write);
    write.write_all(bytes).expect("write capability");
    read
}

fn fallback_dir_fd() -> (tempfile::TempDir, OwnedFd) {
    let directory = tempfile::tempdir().expect("tempdir");
    std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o700))
        .expect("fallback mode");
    let raw = unsafe {
        libc::open(
            CString::new(directory.path().to_str().expect("utf8 path"))
                .expect("no NUL")
                .as_ptr(),
            libc::O_DIRECTORY | libc::O_RDONLY,
        )
    };
    assert!(raw >= 0, "open fallback directory");
    (directory, unsafe { OwnedFd::from_raw_fd(raw) })
}
