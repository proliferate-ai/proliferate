//! Private Desktop-child bridge schema.

use proliferate_diagnostics_protocol::v1::types::ConnectionDescriptorV1;
use serde::{Deserialize, Serialize};

use crate::ProducerStatusSnapshot;

pub const CHILD_BRIDGE_PROTOCOL_VERSION: u16 = 1;
pub const CHILD_BRIDGE_RESERVED_FD: i32 = 198;
pub const CHILD_SHUTDOWN_RESERVED_FD: i32 = 199;
pub const MAX_CHILD_BRIDGE_FRAME_BYTES: usize = 16_384;
pub const MAX_CHILD_BRIDGE_ANCILLARY_FDS: usize = 2;
pub const CHILD_BOOTSTRAP_READ_DEADLINE: std::time::Duration = std::time::Duration::from_secs(1);
pub const CHILD_STATUS_RESPONSE_DEADLINE: std::time::Duration =
    std::time::Duration::from_millis(100);
pub const MAX_OUTSTANDING_STATUS_REQUESTS: usize = 1;
pub const MAX_OUTSTANDING_FLUSH_REQUESTS: usize = 1;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WireComponent {
    Anyharness,
    DesktopWorker,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CollectorUnavailableClassification {
    Starting,
    Degraded,
    Stopped,
    ShuttingDown,
    HandoffUnavailable,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FallbackUnavailableClassification {
    DirectoryUnavailable,
    SecurityRejected,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DegradedClassification {
    BootstrapTimeout,
    FramingInvalid,
    ComponentMismatch,
    DescriptorInvalid,
    BridgeUnavailable,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityFdRole {
    CollectorCapability,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FallbackFdRole {
    DiagnosticsFallbackDirectory,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
pub enum BootstrapCollectorState {
    Ready {
        generation: u64,
        descriptor: ConnectionDescriptorV1,
        capability_fd_role: CapabilityFdRole,
    },
    Unavailable {
        generation: u64,
        classification: CollectorUnavailableClassification,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
pub enum BootstrapFallbackState {
    Available {
        fd_role: FallbackFdRole,
    },
    Unavailable {
        classification: FallbackUnavailableClassification,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum ParentFrame {
    Bootstrap {
        protocol_version: u16,
        component: WireComponent,
        initial_state: BootstrapCollectorState,
        fallback_state: BootstrapFallbackState,
    },
    GenerationReady {
        protocol_version: u16,
        generation: u64,
        descriptor: ConnectionDescriptorV1,
        capability_fd_role: CapabilityFdRole,
    },
    GenerationUnavailable {
        protocol_version: u16,
        generation: u64,
        classification: CollectorUnavailableClassification,
    },
    StatusRequest {
        protocol_version: u16,
        request_id: u64,
    },
    FlushRequest {
        protocol_version: u16,
        request_id: u64,
        remaining_deadline_ms: u64,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeliveryFence {
    pub producer_boot_id: String,
    pub collector_boot_id: String,
    pub generation: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_assigned_sequence: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum ChildFrame {
    BootstrapAck {
        protocol_version: u16,
        component: WireComponent,
        producer_boot_id: String,
    },
    StatusResponse {
        protocol_version: u16,
        request_id: u64,
        snapshot: ProducerStatusSnapshot,
    },
    FlushResponse {
        protocol_version: u16,
        request_id: u64,
        snapshot: ProducerStatusSnapshot,
        #[serde(skip_serializing_if = "Option::is_none")]
        delivery_fence: Option<DeliveryFence>,
    },
    TerminalStatus {
        protocol_version: u16,
        component: WireComponent,
        producer_boot_id: String,
        snapshot: ProducerStatusSnapshot,
        #[serde(skip_serializing_if = "Option::is_none")]
        delivery_fence: Option<DeliveryFence>,
    },
}

pub fn parent_frame_fd_count(frame: &ParentFrame) -> usize {
    match frame {
        ParentFrame::Bootstrap {
            initial_state,
            fallback_state,
            ..
        } => {
            usize::from(matches!(
                initial_state,
                BootstrapCollectorState::Ready { .. }
            )) + usize::from(matches!(
                fallback_state,
                BootstrapFallbackState::Available { .. }
            ))
        }
        ParentFrame::GenerationReady { .. } => 1,
        ParentFrame::GenerationUnavailable { .. }
        | ParentFrame::StatusRequest { .. }
        | ParentFrame::FlushRequest { .. } => 0,
    }
}

pub fn valid_protocol_version(version: u16) -> bool {
    version == CHILD_BRIDGE_PROTOCOL_VERSION
}
