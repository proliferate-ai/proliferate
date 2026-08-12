//! Wire-schema proofs: every frame round-trips, unknown JSON fields are
//! denied, wire strings are exact, and the safe-generation boundary encodes
//! without drift. `wire.rs` itself enforces none of the accepted-protocol
//! numeric bounds (that is `activation.rs`'s job, covered separately); this
//! file only asserts what the serde derives on this module actually do.

use proliferate_diagnostics_protocol::v1::limits::{CURRENT_SCHEMA_VERSION, MAX_SAFE_INTEGER};
use proliferate_diagnostics_protocol::v1::types::{
    ComponentV1, ConnectionDescriptorV1, ProtectedTokenReferenceV1, TokenReferenceKindV1,
};
use serde_json::Value;

use super::*;
use crate::producer::status::ProducerCollectorState;
use crate::ProducerStatusSnapshot;

fn descriptor(reference: &str) -> ConnectionDescriptorV1 {
    ConnectionDescriptorV1 {
        endpoint: "http://127.0.0.1:9001".into(),
        token_reference: ProtectedTokenReferenceV1 {
            kind: TokenReferenceKindV1::InheritedFileDescriptor,
            reference: reference.into(),
        },
        schema_major: CURRENT_SCHEMA_VERSION.major,
        collector_boot_id: "collector-boot-1".into(),
    }
}

fn snapshot() -> ProducerStatusSnapshot {
    ProducerStatusSnapshot {
        component: ComponentV1::Anyharness,
        producer_boot_id: "producer-boot-1".into(),
        last_assigned_sequence: Some(4),
        next_sequence: Some(5),
        collector_state: ProducerCollectorState::Ready {
            collector_boot_id: "collector-boot-1".into(),
            generation_number: 1,
        },
        resident_records: 0,
        resident_bytes: 0,
        in_flight: false,
        fallback_active: false,
        fallback_bytes: 0,
        fallback_write_failures: 0,
        dropped_by_reason: Default::default(),
        fallback_routed: 0,
        delivery_fence_eligible: true,
        last_failure: None,
    }
}

fn round_trips<T>(value: &T)
where
    T: serde::Serialize + serde::de::DeserializeOwned + PartialEq + std::fmt::Debug,
{
    let text = serde_json::to_string(value).expect("serializable");
    let decoded: T = serde_json::from_str(&text).expect("round-trip parses");
    assert_eq!(&decoded, value);
}

#[test]
fn bootstrap_ready_with_fallback_available_round_trips_and_declares_two_descriptors() {
    let frame = ParentFrame::Bootstrap {
        protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
        component: WireComponent::Anyharness,
        initial_state: BootstrapCollectorState::Ready {
            generation: 42,
            descriptor: descriptor("7"),
            capability_fd_role: CapabilityFdRole::CollectorCapability,
        },
        fallback_state: BootstrapFallbackState::Available {
            fd_role: FallbackFdRole::DiagnosticsFallbackDirectory,
        },
    };
    round_trips(&frame);
    assert_eq!(parent_frame_fd_count(&frame), 2);
}

#[test]
fn bootstrap_ready_with_fallback_unavailable_declares_one_descriptor() {
    let frame = ParentFrame::Bootstrap {
        protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
        component: WireComponent::DesktopWorker,
        initial_state: BootstrapCollectorState::Ready {
            generation: 1,
            descriptor: descriptor("9"),
            capability_fd_role: CapabilityFdRole::CollectorCapability,
        },
        fallback_state: BootstrapFallbackState::Unavailable {
            classification: FallbackUnavailableClassification::DirectoryUnavailable,
        },
    };
    round_trips(&frame);
    assert_eq!(parent_frame_fd_count(&frame), 1);
}

#[test]
fn bootstrap_unavailable_with_fallback_available_declares_one_descriptor() {
    let frame = ParentFrame::Bootstrap {
        protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
        component: WireComponent::Anyharness,
        initial_state: BootstrapCollectorState::Unavailable {
            generation: 3,
            classification: CollectorUnavailableClassification::Degraded,
        },
        fallback_state: BootstrapFallbackState::Available {
            fd_role: FallbackFdRole::DiagnosticsFallbackDirectory,
        },
    };
    round_trips(&frame);
    assert_eq!(parent_frame_fd_count(&frame), 1);
}

#[test]
fn bootstrap_both_unavailable_is_a_valid_zero_descriptor_bundled_bootstrap() {
    let frame = ParentFrame::Bootstrap {
        protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
        component: WireComponent::DesktopWorker,
        initial_state: BootstrapCollectorState::Unavailable {
            generation: 0,
            classification: CollectorUnavailableClassification::Starting,
        },
        fallback_state: BootstrapFallbackState::Unavailable {
            classification: FallbackUnavailableClassification::SecurityRejected,
        },
    };
    round_trips(&frame);
    assert_eq!(parent_frame_fd_count(&frame), 0);
}

#[test]
fn generation_ready_round_trips_and_declares_one_descriptor() {
    let frame = ParentFrame::GenerationReady {
        protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
        generation: 5,
        descriptor: descriptor("11"),
        capability_fd_role: CapabilityFdRole::CollectorCapability,
    };
    round_trips(&frame);
    assert_eq!(parent_frame_fd_count(&frame), 1);
}

#[test]
fn generation_unavailable_round_trips_and_declares_no_descriptor() {
    let frame = ParentFrame::GenerationUnavailable {
        protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
        generation: 6,
        classification: CollectorUnavailableClassification::HandoffUnavailable,
    };
    round_trips(&frame);
    assert_eq!(parent_frame_fd_count(&frame), 0);
}

#[test]
fn status_and_flush_requests_round_trip_and_declare_no_descriptor() {
    let status = ParentFrame::StatusRequest {
        protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
        request_id: 1,
    };
    round_trips(&status);
    assert_eq!(parent_frame_fd_count(&status), 0);

    let flush = ParentFrame::FlushRequest {
        protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
        request_id: 2,
        remaining_deadline_ms: 250,
    };
    round_trips(&flush);
    assert_eq!(parent_frame_fd_count(&flush), 0);
}

#[test]
fn child_frames_round_trip_including_optional_delivery_fence() {
    round_trips(&ChildFrame::BootstrapAck {
        protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
        component: WireComponent::Anyharness,
        producer_boot_id: "producer-boot-1".into(),
    });
    round_trips(&ChildFrame::StatusResponse {
        protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
        request_id: 3,
        snapshot: snapshot(),
    });

    let fence = DeliveryFence {
        producer_boot_id: "producer-boot-1".into(),
        collector_boot_id: "collector-boot-1".into(),
        generation: 4,
        last_assigned_sequence: Some(9),
    };
    let with_fence = ChildFrame::FlushResponse {
        protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
        request_id: 4,
        snapshot: snapshot(),
        delivery_fence: Some(fence.clone()),
    };
    round_trips(&with_fence);
    let without_fence = ChildFrame::FlushResponse {
        protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
        request_id: 4,
        snapshot: snapshot(),
        delivery_fence: None,
    };
    round_trips(&without_fence);
    let text = serde_json::to_string(&without_fence).expect("serializable");
    assert!(
        !text.contains("delivery_fence"),
        "absent fence must be omitted, not null: {text}"
    );

    round_trips(&ChildFrame::TerminalStatus {
        protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
        component: WireComponent::DesktopWorker,
        producer_boot_id: "producer-boot-1".into(),
        snapshot: snapshot(),
        delivery_fence: Some(fence),
    });
}

#[test]
fn parent_frame_rejects_unknown_top_level_field() {
    let frame = ParentFrame::StatusRequest {
        protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
        request_id: 1,
    };
    let mut value = serde_json::to_value(&frame).expect("serializable");
    value["extra"] = Value::Bool(true);
    assert!(serde_json::from_value::<ParentFrame>(value).is_err());
}

#[test]
fn child_frame_rejects_unknown_top_level_field() {
    let frame = ChildFrame::StatusResponse {
        protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
        request_id: 1,
        snapshot: snapshot(),
    };
    let mut value = serde_json::to_value(&frame).expect("serializable");
    value["not_declared"] = Value::String("nope".into());
    assert!(serde_json::from_value::<ChildFrame>(value).is_err());
}

#[test]
fn child_frame_rejects_unknown_fields_in_every_nested_status_dto() {
    let fence = DeliveryFence {
        producer_boot_id: "producer-boot-1".into(),
        collector_boot_id: "collector-boot-1".into(),
        generation: 1,
        last_assigned_sequence: Some(4),
    };
    let frame = ChildFrame::FlushResponse {
        protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
        request_id: 7,
        snapshot: snapshot(),
        delivery_fence: Some(fence),
    };
    let baseline = serde_json::to_value(&frame).expect("serializable");

    for path in [
        &["snapshot"][..],
        &["snapshot", "dropped_by_reason"][..],
        &["snapshot", "collector_state"][..],
        &["delivery_fence"][..],
    ] {
        let mut value = baseline.clone();
        let mut target = &mut value;
        for segment in path {
            target = &mut target[*segment];
        }
        target["unexpected"] = Value::Bool(true);
        assert!(
            serde_json::from_value::<ChildFrame>(value).is_err(),
            "nested DTO accepted unknown field at {path:?}"
        );
    }
}

#[test]
fn bootstrap_collector_state_denies_unknown_fields() {
    let state = BootstrapCollectorState::Ready {
        generation: 1,
        descriptor: descriptor("1"),
        capability_fd_role: CapabilityFdRole::CollectorCapability,
    };
    let mut value = serde_json::to_value(&state).expect("serializable");
    value["unexpected"] = Value::from(1);
    assert!(serde_json::from_value::<BootstrapCollectorState>(value).is_err());
}

#[test]
fn bootstrap_fallback_state_denies_unknown_fields() {
    let state = BootstrapFallbackState::Available {
        fd_role: FallbackFdRole::DiagnosticsFallbackDirectory,
    };
    let mut value = serde_json::to_value(&state).expect("serializable");
    value["unexpected"] = Value::from("nope");
    assert!(serde_json::from_value::<BootstrapFallbackState>(value).is_err());
}

#[test]
fn wire_component_serializes_to_exact_strings() {
    assert_eq!(
        serde_json::to_value(WireComponent::Anyharness).expect("serializable"),
        Value::String("anyharness".into())
    );
    assert_eq!(
        serde_json::to_value(WireComponent::DesktopWorker).expect("serializable"),
        Value::String("desktop_worker".into())
    );
}

#[test]
fn collector_unavailable_classification_wire_strings_are_closed() {
    let pairs = [
        (CollectorUnavailableClassification::Starting, "starting"),
        (CollectorUnavailableClassification::Degraded, "degraded"),
        (CollectorUnavailableClassification::Stopped, "stopped"),
        (
            CollectorUnavailableClassification::ShuttingDown,
            "shutting_down",
        ),
        (
            CollectorUnavailableClassification::HandoffUnavailable,
            "handoff_unavailable",
        ),
    ];
    for (value, expected) in pairs {
        assert_eq!(
            serde_json::to_value(value).expect("serializable"),
            Value::String(expected.into())
        );
    }
}

#[test]
fn fallback_unavailable_classification_wire_strings_are_closed() {
    assert_eq!(
        serde_json::to_value(FallbackUnavailableClassification::DirectoryUnavailable)
            .expect("serializable"),
        Value::String("directory_unavailable".into())
    );
    assert_eq!(
        serde_json::to_value(FallbackUnavailableClassification::SecurityRejected)
            .expect("serializable"),
        Value::String("security_rejected".into())
    );
}

#[test]
fn degraded_classification_wire_strings_are_closed() {
    let pairs = [
        (
            DegradedClassification::BootstrapTimeout,
            "bootstrap_timeout",
        ),
        (DegradedClassification::FramingInvalid, "framing_invalid"),
        (
            DegradedClassification::ComponentMismatch,
            "component_mismatch",
        ),
        (
            DegradedClassification::DescriptorInvalid,
            "descriptor_invalid",
        ),
        (
            DegradedClassification::BridgeUnavailable,
            "bridge_unavailable",
        ),
    ];
    for (value, expected) in pairs {
        assert_eq!(
            serde_json::to_value(value).expect("serializable"),
            Value::String(expected.into())
        );
    }
}

#[test]
fn fd_role_wire_strings_are_exact() {
    assert_eq!(
        serde_json::to_value(CapabilityFdRole::CollectorCapability).expect("serializable"),
        Value::String("collector_capability".into())
    );
    assert_eq!(
        serde_json::to_value(FallbackFdRole::DiagnosticsFallbackDirectory).expect("serializable"),
        Value::String("diagnostics_fallback_directory".into())
    );
}

#[test]
fn valid_protocol_version_only_accepts_the_current_version() {
    assert!(valid_protocol_version(CHILD_BRIDGE_PROTOCOL_VERSION));
    assert!(!valid_protocol_version(0));
    assert!(!valid_protocol_version(CHILD_BRIDGE_PROTOCOL_VERSION + 1));
}

#[test]
fn safe_generation_boundary_round_trips_without_drift() {
    let frame = ParentFrame::GenerationUnavailable {
        protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
        generation: MAX_SAFE_INTEGER,
        classification: CollectorUnavailableClassification::Stopped,
    };
    round_trips(&frame);
    let text = serde_json::to_string(&frame).expect("serializable");
    assert!(
        text.contains(&MAX_SAFE_INTEGER.to_string()),
        "exact safe-integer boundary must serialize verbatim: {text}"
    );
}
