//! Proofs for bootstrap-frame parsing (`parse_bootstrap`, `degraded`) and the
//! standalone generation-reacquisition parser
//! (`collector_generation_from_received`). Every malformed/truncated/
//! oversized/wrong-component shape fails closed to the correct
//! classification, and all four collector/fallback ready/unavailable
//! combinations map to the right `InitialCollectorState` plus fallback
//! handle presence.

use std::ffi::CString;
use std::io::Write;
use std::os::fd::{FromRawFd, OwnedFd};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::UnixStream;
use std::time::{Duration, Instant};

use proliferate_diagnostics_protocol::v1::limits::{CURRENT_SCHEMA_VERSION, MAX_SAFE_INTEGER};
use proliferate_diagnostics_protocol::v1::types::{
    ConnectionDescriptorV1, ProtectedTokenReferenceV1, TokenReferenceKindV1,
};
use tempfile::TempDir;

use super::platform::*;
use super::*;
use crate::bridge::framing::ReceivedFrame;
use crate::bridge::wire::{
    BootstrapCollectorState, BootstrapFallbackState, CapabilityFdRole,
    CollectorUnavailableClassification, FallbackFdRole, FallbackUnavailableClassification,
    ParentFrame, WireComponent, CHILD_BRIDGE_PROTOCOL_VERSION,
};

fn context() -> (UnixStream, OwnedFd) {
    let (bridge, _peer) = UnixStream::pair().expect("bridge socketpair");
    let (shutdown_read, _shutdown_write) = pipe_pair();
    (bridge, shutdown_read)
}

fn pipe_pair() -> (OwnedFd, OwnedFd) {
    let mut fds = [0_i32; 2];
    assert_eq!(unsafe { libc::pipe(fds.as_mut_ptr()) }, 0);
    unsafe { (OwnedFd::from_raw_fd(fds[0]), OwnedFd::from_raw_fd(fds[1])) }
}

fn capability_fd(bytes: &[u8]) -> OwnedFd {
    let (read_end, write_end) = pipe_pair();
    let mut writer = std::fs::File::from(write_end);
    writer.write_all(bytes).expect("write capability");
    read_end
}

fn fallback_dir_fd(mode: u32) -> (TempDir, OwnedFd) {
    let directory = tempfile::tempdir().expect("tempdir");
    std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(mode))
        .expect("set mode");
    let raw = unsafe {
        libc::open(
            CString::new(directory.path().to_str().expect("utf8 path"))
                .expect("no NUL")
                .as_ptr(),
            libc::O_DIRECTORY | libc::O_RDONLY,
        )
    };
    assert!(raw >= 0, "open directory failed");
    (directory, unsafe { OwnedFd::from_raw_fd(raw) })
}

fn descriptor() -> ConnectionDescriptorV1 {
    ConnectionDescriptorV1 {
        endpoint: "http://127.0.0.1:9001".into(),
        token_reference: ProtectedTokenReferenceV1 {
            kind: TokenReferenceKindV1::InheritedFileDescriptor,
            reference: "0".into(),
        },
        schema_major: CURRENT_SCHEMA_VERSION.major,
        collector_boot_id: "collector-boot-1".into(),
    }
}

fn received(frame: ParentFrame, descriptors: Vec<OwnedFd>) -> ReceivedFrame<ParentFrame> {
    ReceivedFrame { frame, descriptors }
}

fn bootstrap(
    component: WireComponent,
    initial_state: BootstrapCollectorState,
    fallback_state: BootstrapFallbackState,
) -> ParentFrame {
    ParentFrame::Bootstrap {
        protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
        component,
        initial_state,
        fallback_state,
    }
}

fn unavailable(classification: CollectorUnavailableClassification) -> BootstrapCollectorState {
    BootstrapCollectorState::Unavailable {
        generation: 5,
        classification,
    }
}

fn fallback_unavailable() -> BootstrapFallbackState {
    BootstrapFallbackState::Unavailable {
        classification: FallbackUnavailableClassification::DirectoryUnavailable,
    }
}

fn fallback_available() -> BootstrapFallbackState {
    BootstrapFallbackState::Available {
        fd_role: FallbackFdRole::DiagnosticsFallbackDirectory,
    }
}

// ---------------------------------------------------------------------
// Malformed / truncated / wrong-component framing
// ---------------------------------------------------------------------

#[test]
fn non_bootstrap_frame_is_framing_invalid() {
    let (bridge, shutdown) = context();
    let frame = ParentFrame::StatusRequest {
        protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
        request_id: 1,
    };
    let outcome = parse_bootstrap(
        DiagnosticsComponent::AnyHarness,
        bridge,
        shutdown,
        received(frame, Vec::new()),
    );
    assert_degraded(outcome, DegradedClassification::FramingInvalid, false);
}

#[test]
fn unknown_protocol_version_is_framing_invalid() {
    let (bridge, shutdown) = context();
    let frame = ParentFrame::Bootstrap {
        protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION + 1,
        component: WireComponent::Anyharness,
        initial_state: unavailable(CollectorUnavailableClassification::Starting),
        fallback_state: fallback_unavailable(),
    };
    let outcome = parse_bootstrap(
        DiagnosticsComponent::AnyHarness,
        bridge,
        shutdown,
        received(frame, Vec::new()),
    );
    assert_degraded(outcome, DegradedClassification::FramingInvalid, false);
}

#[test]
fn declared_descriptor_count_mismatch_is_framing_invalid() {
    let (bridge, shutdown) = context();
    // `Ready` declares exactly one descriptor; sending zero is a mismatch
    // caught by the outer count check before any descriptor is consumed.
    let frame = bootstrap(
        WireComponent::Anyharness,
        BootstrapCollectorState::Ready {
            generation: 1,
            descriptor: descriptor(),
            capability_fd_role: CapabilityFdRole::CollectorCapability,
        },
        fallback_unavailable(),
    );
    let outcome = parse_bootstrap(
        DiagnosticsComponent::AnyHarness,
        bridge,
        shutdown,
        received(frame, Vec::new()),
    );
    assert_degraded(outcome, DegradedClassification::FramingInvalid, false);
}

#[test]
fn wrong_component_is_component_mismatch() {
    let (bridge, shutdown) = context();
    let frame = bootstrap(
        WireComponent::DesktopWorker,
        unavailable(CollectorUnavailableClassification::Degraded),
        fallback_unavailable(),
    );
    let outcome = parse_bootstrap(
        DiagnosticsComponent::AnyHarness,
        bridge,
        shutdown,
        received(frame, Vec::new()),
    );
    assert_degraded(outcome, DegradedClassification::ComponentMismatch, false);
}

// ---------------------------------------------------------------------
// Ready-collector descriptor/content validation
// ---------------------------------------------------------------------

#[test]
fn ready_generation_over_safe_integer_is_descriptor_invalid() {
    let (bridge, shutdown) = context();
    let frame = bootstrap(
        WireComponent::Anyharness,
        BootstrapCollectorState::Ready {
            generation: MAX_SAFE_INTEGER + 1,
            descriptor: descriptor(),
            capability_fd_role: CapabilityFdRole::CollectorCapability,
        },
        fallback_unavailable(),
    );
    let dummy = capability_fd(b"unused");
    let outcome = parse_bootstrap(
        DiagnosticsComponent::AnyHarness,
        bridge,
        shutdown,
        received(frame, vec![dummy]),
    );
    assert_degraded(outcome, DegradedClassification::DescriptorInvalid, false);
}

#[test]
fn ready_wrong_token_reference_kind_is_descriptor_invalid() {
    let (bridge, shutdown) = context();
    let mut bad_descriptor = descriptor();
    bad_descriptor.token_reference.kind = TokenReferenceKindV1::ProcessMemory;
    let frame = bootstrap(
        WireComponent::Anyharness,
        BootstrapCollectorState::Ready {
            generation: 1,
            descriptor: bad_descriptor,
            capability_fd_role: CapabilityFdRole::CollectorCapability,
        },
        fallback_unavailable(),
    );
    let dummy = capability_fd(b"unused");
    let outcome = parse_bootstrap(
        DiagnosticsComponent::AnyHarness,
        bridge,
        shutdown,
        received(frame, vec![dummy]),
    );
    assert_degraded(outcome, DegradedClassification::DescriptorInvalid, false);
}

#[test]
fn ready_empty_or_oversized_capability_is_descriptor_invalid() {
    for capability in [Vec::new(), vec![b'a'; 300]] {
        let (bridge, shutdown) = context();
        let frame = bootstrap(
            WireComponent::Anyharness,
            BootstrapCollectorState::Ready {
                generation: 1,
                descriptor: descriptor(),
                capability_fd_role: CapabilityFdRole::CollectorCapability,
            },
            fallback_unavailable(),
        );
        let fd = capability_fd(&capability);
        let outcome = parse_bootstrap(
            DiagnosticsComponent::AnyHarness,
            bridge,
            shutdown,
            received(frame, vec![fd]),
        );
        assert_degraded(outcome, DegradedClassification::DescriptorInvalid, false);
    }
}

#[test]
fn invalid_collector_capability_retains_independent_valid_fallback() {
    for capability in [Vec::new(), vec![b'a'; 300]] {
        let (bridge, shutdown) = context();
        let frame = bootstrap(
            WireComponent::Anyharness,
            BootstrapCollectorState::Ready {
                generation: 1,
                descriptor: descriptor(),
                capability_fd_role: CapabilityFdRole::CollectorCapability,
            },
            fallback_available(),
        );
        let capability = capability_fd(&capability);
        let (_directory, fallback) = fallback_dir_fd(0o700);
        let outcome = parse_bootstrap(
            DiagnosticsComponent::AnyHarness,
            bridge,
            shutdown,
            received(frame, vec![capability, fallback]),
        );
        assert_degraded(outcome, DegradedClassification::DescriptorInvalid, true);
    }
}

#[test]
fn timed_out_collector_capability_retains_independent_valid_fallback() {
    let (bridge, shutdown) = context();
    let frame = bootstrap(
        WireComponent::Anyharness,
        BootstrapCollectorState::Ready {
            generation: 1,
            descriptor: descriptor(),
            capability_fd_role: CapabilityFdRole::CollectorCapability,
        },
        fallback_available(),
    );
    let (capability, capability_write) = pipe_pair();
    let mut writer = std::fs::File::from(capability_write);
    writer
        .write_all(b"partial-token")
        .expect("write capability");
    let (_directory, fallback) = fallback_dir_fd(0o700);
    let started = Instant::now();
    let deadline = started + Duration::from_millis(50);
    let outcome = parse_bootstrap_until(
        DiagnosticsComponent::AnyHarness,
        bridge,
        shutdown,
        received(frame, vec![capability, fallback]),
        deadline,
    );

    assert_degraded(outcome, DegradedClassification::DescriptorInvalid, true);
    assert!(started.elapsed() < Duration::from_millis(750));
    drop(writer);
}

// ---------------------------------------------------------------------
// The four collector/fallback ready/unavailable combinations
// ---------------------------------------------------------------------

#[test]
fn ready_collector_with_fallback_ready_is_bundled_with_both_descriptors() {
    let (bridge, shutdown) = context();
    let frame = bootstrap(
        WireComponent::Anyharness,
        BootstrapCollectorState::Ready {
            generation: 7,
            descriptor: descriptor(),
            capability_fd_role: CapabilityFdRole::CollectorCapability,
        },
        fallback_available(),
    );
    let capability = capability_fd(b"capability-token");
    let (_directory, fallback) = fallback_dir_fd(0o700);
    let outcome = parse_bootstrap(
        DiagnosticsComponent::AnyHarness,
        bridge,
        shutdown,
        received(frame, vec![capability, fallback]),
    );
    match outcome {
        DesktopDiagnosticsActivation::Bundled(bootstrap) => {
            match bootstrap.initial_state {
                InitialCollectorState::Ready(handle) => {
                    assert_eq!(handle.generation, 7);
                    assert_eq!(handle.collector_boot_id, "collector-boot-1");
                }
                InitialCollectorState::Unavailable { .. } => panic!("expected ready collector"),
            }
            assert!(bootstrap.fallback.is_some());
        }
        other => panic!(
            "expected Bundled, got a different activation: {other}",
            other = debug_kind(&other)
        ),
    }
}

#[test]
fn ready_collector_with_fallback_unavailable_is_bundled_with_no_fallback() {
    let (bridge, shutdown) = context();
    let frame = bootstrap(
        WireComponent::Anyharness,
        BootstrapCollectorState::Ready {
            generation: 3,
            descriptor: descriptor(),
            capability_fd_role: CapabilityFdRole::CollectorCapability,
        },
        fallback_unavailable(),
    );
    let capability = capability_fd(b"capability-token");
    let outcome = parse_bootstrap(
        DiagnosticsComponent::AnyHarness,
        bridge,
        shutdown,
        received(frame, vec![capability]),
    );
    match outcome {
        DesktopDiagnosticsActivation::Bundled(bootstrap) => {
            assert!(matches!(
                bootstrap.initial_state,
                InitialCollectorState::Ready(_)
            ));
            assert!(bootstrap.fallback.is_none());
        }
        other => panic!("expected Bundled, got {other}", other = debug_kind(&other)),
    }
}

#[test]
fn unavailable_collector_with_fallback_ready_is_bundled_with_fallback_only() {
    let (bridge, shutdown) = context();
    let frame = bootstrap(
        WireComponent::DesktopWorker,
        unavailable(CollectorUnavailableClassification::Stopped),
        fallback_available(),
    );
    let (_directory, fallback) = fallback_dir_fd(0o700);
    let outcome = parse_bootstrap(
        DiagnosticsComponent::DesktopWorker,
        bridge,
        shutdown,
        received(frame, vec![fallback]),
    );
    match outcome {
        DesktopDiagnosticsActivation::Bundled(bootstrap) => {
            match bootstrap.initial_state {
                InitialCollectorState::Unavailable {
                    generation,
                    classification,
                } => {
                    assert_eq!(generation, 5);
                    assert_eq!(classification, UnavailableClassification::Stopped);
                }
                InitialCollectorState::Ready(_) => panic!("expected unavailable collector"),
            }
            assert!(bootstrap.fallback.is_some());
        }
        other => panic!("expected Bundled, got {other}", other = debug_kind(&other)),
    }
}

#[test]
fn unavailable_collector_with_fallback_unavailable_is_bundled_with_neither() {
    let (bridge, shutdown) = context();
    let frame = bootstrap(
        WireComponent::Anyharness,
        unavailable(CollectorUnavailableClassification::ShuttingDown),
        fallback_unavailable(),
    );
    let outcome = parse_bootstrap(
        DiagnosticsComponent::AnyHarness,
        bridge,
        shutdown,
        received(frame, Vec::new()),
    );
    match outcome {
        DesktopDiagnosticsActivation::Bundled(bootstrap) => {
            assert!(matches!(
                bootstrap.initial_state,
                InitialCollectorState::Unavailable { .. }
            ));
            assert!(bootstrap.fallback.is_none());
        }
        other => panic!("expected Bundled, got {other}", other = debug_kind(&other)),
    }
}

#[test]
fn every_collector_unavailable_classification_maps_across_the_bridge() {
    let pairs = [
        (
            CollectorUnavailableClassification::Starting,
            UnavailableClassification::Starting,
        ),
        (
            CollectorUnavailableClassification::Degraded,
            UnavailableClassification::Degraded,
        ),
        (
            CollectorUnavailableClassification::Stopped,
            UnavailableClassification::Stopped,
        ),
        (
            CollectorUnavailableClassification::ShuttingDown,
            UnavailableClassification::ShuttingDown,
        ),
        (
            CollectorUnavailableClassification::HandoffUnavailable,
            UnavailableClassification::HandoffUnavailable,
        ),
    ];
    for (wire, expected) in pairs {
        let (bridge, shutdown) = context();
        let frame = bootstrap(
            WireComponent::Anyharness,
            unavailable(wire),
            fallback_unavailable(),
        );
        let outcome = parse_bootstrap(
            DiagnosticsComponent::AnyHarness,
            bridge,
            shutdown,
            received(frame, Vec::new()),
        );
        let DesktopDiagnosticsActivation::Bundled(bootstrap) = outcome else {
            panic!("expected Bundled");
        };
        let InitialCollectorState::Unavailable { classification, .. } = bootstrap.initial_state
        else {
            panic!("expected unavailable collector");
        };
        assert_eq!(classification, expected);
    }
}

#[test]
fn invalid_fallback_descriptor_yields_bundled_with_fallback_none_never_degraded() {
    let (bridge, shutdown) = context();
    let frame = bootstrap(
        WireComponent::Anyharness,
        unavailable(CollectorUnavailableClassification::Starting),
        fallback_available(),
    );
    // A regular file instead of a directory: `valid_fallback_directory`
    // fails, but a bad fallback authority never fails the bundled bootstrap.
    let file_backed = tempfile::NamedTempFile::new().expect("tempfile");
    let raw = unsafe {
        libc::open(
            CString::new(file_backed.path().to_str().expect("utf8 path"))
                .expect("no NUL")
                .as_ptr(),
            libc::O_RDONLY,
        )
    };
    assert!(raw >= 0);
    let regular_file_as_fallback = unsafe { OwnedFd::from_raw_fd(raw) };
    let outcome = parse_bootstrap(
        DiagnosticsComponent::AnyHarness,
        bridge,
        shutdown,
        received(frame, vec![regular_file_as_fallback]),
    );
    match outcome {
        DesktopDiagnosticsActivation::Bundled(bootstrap) => {
            assert!(bootstrap.fallback.is_none());
        }
        other => panic!("expected Bundled, got {other}", other = debug_kind(&other)),
    }
}

// ---------------------------------------------------------------------
// collector_generation_from_received (standalone reacquisition parser)
// ---------------------------------------------------------------------

#[test]
fn collector_generation_from_received_accepts_a_valid_descriptor_and_capability() {
    let capability = capability_fd(b"capability-token");
    let handle = collector_generation_from_received(11, descriptor(), capability)
        .expect("valid generation handle");
    assert_eq!(handle.generation, 11);
    assert_eq!(handle.collector_boot_id, "collector-boot-1");
}

#[test]
fn collector_generation_from_received_rejects_generation_over_safe_integer() {
    let capability = capability_fd(b"capability-token");
    assert!(
        collector_generation_from_received(MAX_SAFE_INTEGER + 1, descriptor(), capability).is_err()
    );
}

#[test]
fn collector_generation_from_received_rejects_wrong_token_kind() {
    let mut bad_descriptor = descriptor();
    bad_descriptor.token_reference.kind = TokenReferenceKindV1::ProcessMemory;
    let capability = capability_fd(b"capability-token");
    assert!(collector_generation_from_received(1, bad_descriptor, capability).is_err());
}

// ---------------------------------------------------------------------
// Shared assertion helper
// ---------------------------------------------------------------------

fn assert_degraded(
    outcome: DesktopDiagnosticsActivation,
    expected: DegradedClassification,
    expect_fallback: bool,
) {
    match outcome {
        DesktopDiagnosticsActivation::BundledDegraded(degraded) => {
            assert_eq!(degraded.classification, expected);
            assert_eq!(degraded.fallback.is_some(), expect_fallback);
        }
        other => panic!(
            "expected BundledDegraded({expected:?}), got {other}",
            other = debug_kind(&other)
        ),
    }
}

fn debug_kind(activation: &DesktopDiagnosticsActivation) -> &'static str {
    match activation {
        DesktopDiagnosticsActivation::Disabled => "Disabled",
        DesktopDiagnosticsActivation::Bundled(_) => "Bundled",
        DesktopDiagnosticsActivation::BundledDegraded(_) => "BundledDegraded",
    }
}
