//! Supervisor, desktop health, and producer health model pieces.

use serde::{Deserialize, Serialize};

use proliferate_diagnostics_protocol::v1::types::{FallbackHealthV1, HealthResponseV1};

use super::super::enums::{
    DesktopDiagnosticsFailureClassV1, SupportChildComponentV1, SupportChildOmissionReasonV1,
    SupportLaunchKindV1, SupportLossReasonV1, SupportOmittedStateV1,
    SupportProducerStatusUnavailableV1,
};

/// Desktop collector supervisor state as captured for support.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum DesktopDiagnosticsSupervisorStateV1 {
    #[serde(rename_all = "camelCase")]
    Unsupported {
        classification: DesktopDiagnosticsFailureClassV1,
    },
    #[serde(rename_all = "camelCase")]
    Starting {
        launch_kind: SupportLaunchKindV1,
        attempt: u64,
        restart_count: u64,
    },
    #[serde(rename_all = "camelCase")]
    Ready {
        collector_boot_id: String,
        /// Pinned literal 1.
        schema_major: u16,
        restart_count: u64,
    },
    #[serde(rename_all = "camelCase")]
    Degraded {
        classification: DesktopDiagnosticsFailureClassV1,
        restart_count: u64,
        retry_exhausted: bool,
    },
    #[serde(rename_all = "camelCase")]
    Stopped { orderly: bool },
}

/// Desktop-side diagnostics health wrapper around accepted protocol health.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopDiagnosticsHealthV1 {
    pub supervisor: DesktopDiagnosticsSupervisorStateV1,
    pub fallback: FallbackHealthV1,
    pub collector: Option<HealthResponseV1>,
}

/// Fixed-cardinality loss-reason counter map: all fourteen keys are always
/// serialized, in `SupportLossReasonV1` declaration order, including zeros.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct SupportLossCountsV1 {
    pub queue_records: u64,
    pub queue_bytes: u64,
    pub protected_eviction: u64,
    pub pressure: u64,
    pub generation_changed: u64,
    pub transport_timeout: u64,
    pub transport_failure: u64,
    pub receipt_invalid: u64,
    pub receipt_rejected: u64,
    pub fallback_overflow: u64,
    pub fallback_write_failed: u64,
    pub shutdown_timeout: u64,
    pub filter_invalid: u64,
    pub sequence_exhausted: u64,
}

impl SupportLossCountsV1 {
    /// Read the counter for one loss reason.
    pub fn get(&self, reason: SupportLossReasonV1) -> u64 {
        match reason {
            SupportLossReasonV1::QueueRecords => self.queue_records,
            SupportLossReasonV1::QueueBytes => self.queue_bytes,
            SupportLossReasonV1::ProtectedEviction => self.protected_eviction,
            SupportLossReasonV1::Pressure => self.pressure,
            SupportLossReasonV1::GenerationChanged => self.generation_changed,
            SupportLossReasonV1::TransportTimeout => self.transport_timeout,
            SupportLossReasonV1::TransportFailure => self.transport_failure,
            SupportLossReasonV1::ReceiptInvalid => self.receipt_invalid,
            SupportLossReasonV1::ReceiptRejected => self.receipt_rejected,
            SupportLossReasonV1::FallbackOverflow => self.fallback_overflow,
            SupportLossReasonV1::FallbackWriteFailed => self.fallback_write_failed,
            SupportLossReasonV1::ShutdownTimeout => self.shutdown_timeout,
            SupportLossReasonV1::FilterInvalid => self.filter_invalid,
            SupportLossReasonV1::SequenceExhausted => self.sequence_exhausted,
        }
    }
}

/// Child producer collector-connection state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SupportChildCollectorStateV1 {
    Unavailable,
    Cooldown,
    #[serde(rename_all = "camelCase")]
    Ready {
        collector_boot_id: String,
        generation_number: u64,
    },
}

/// Exact PR 5 child producer status snapshot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SupportChildProducerSnapshotV1 {
    pub component: SupportChildComponentV1,
    pub producer_boot_id: String,
    pub last_assigned_sequence: Option<u64>,
    pub next_sequence: Option<u64>,
    pub collector_state: SupportChildCollectorStateV1,
    pub resident_records: u64,
    pub resident_bytes: u64,
    pub in_flight: bool,
    pub fallback_active: bool,
    pub fallback_bytes: u64,
    pub fallback_write_failures: u64,
    pub dropped_by_reason: SupportLossCountsV1,
    pub fallback_routed: u64,
    pub delivery_fence_eligible: bool,
    pub last_failure: Option<SupportLossReasonV1>,
}

/// Child producer status: a concrete snapshot or an honest omission.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum SupportChildProducerStatusV1 {
    #[serde(rename_all = "camelCase")]
    Available {
        captured_at: String,
        snapshot: SupportChildProducerSnapshotV1,
    },
    #[serde(rename_all = "camelCase")]
    Omitted {
        captured_at: String,
        reason: SupportChildOmissionReasonV1,
    },
}

/// Fixed honest producer-status omission (renderer, and Tauri's inner
/// producer status): both literals are pinned single-variant enums.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SupportOmittedProducerStatusV1 {
    pub state: SupportOmittedStateV1,
    pub reason: SupportProducerStatusUnavailableV1,
}

impl Default for SupportOmittedProducerStatusV1 {
    fn default() -> Self {
        Self {
            state: SupportOmittedStateV1::Omitted,
            reason: SupportProducerStatusUnavailableV1::ProducerStatusUnavailable,
        }
    }
}

/// Tauri producer health: supervisor wrapper only, or an honest omission.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum SupportTauriProducerHealthV1 {
    #[serde(rename_all = "camelCase")]
    SupervisorOnly {
        desktop_health: DesktopDiagnosticsHealthV1,
        producer_status: SupportOmittedProducerStatusV1,
    },
    #[serde(rename_all = "camelCase")]
    Omitted {
        reason: SupportProducerStatusUnavailableV1,
    },
}

/// Producer health across all four components.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SupportProducerHealthV1 {
    pub renderer: SupportOmittedProducerStatusV1,
    pub tauri: SupportTauriProducerHealthV1,
    pub anyharness: SupportChildProducerStatusV1,
    pub desktop_worker: SupportChildProducerStatusV1,
}
