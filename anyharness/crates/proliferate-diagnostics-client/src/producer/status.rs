use proliferate_diagnostics_protocol::v1::types::ComponentV1;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProducerFailureClassification {
    QueueRecords,
    QueueBytes,
    ProtectedEviction,
    Pressure,
    GenerationChanged,
    TransportTimeout,
    TransportFailure,
    ReceiptInvalid,
    ReceiptRejected,
    FallbackOverflow,
    FallbackWriteFailed,
    ShutdownTimeout,
    FilterInvalid,
    SequenceExhausted,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct BoundedLossCounters {
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

impl BoundedLossCounters {
    pub(crate) fn increment(&mut self, reason: ProducerFailureClassification) {
        use ProducerFailureClassification as Reason;
        let counter = match reason {
            Reason::QueueRecords => &mut self.queue_records,
            Reason::QueueBytes => &mut self.queue_bytes,
            Reason::ProtectedEviction => &mut self.protected_eviction,
            Reason::Pressure => &mut self.pressure,
            Reason::GenerationChanged => &mut self.generation_changed,
            Reason::TransportTimeout => &mut self.transport_timeout,
            Reason::TransportFailure => &mut self.transport_failure,
            Reason::ReceiptInvalid => &mut self.receipt_invalid,
            Reason::ReceiptRejected => &mut self.receipt_rejected,
            Reason::FallbackOverflow => &mut self.fallback_overflow,
            Reason::FallbackWriteFailed => &mut self.fallback_write_failed,
            Reason::ShutdownTimeout => &mut self.shutdown_timeout,
            Reason::FilterInvalid => &mut self.filter_invalid,
            Reason::SequenceExhausted => &mut self.sequence_exhausted,
        };
        *counter = counter
            .saturating_add(1)
            .min(proliferate_diagnostics_protocol::v1::limits::MAX_SAFE_INTEGER);
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum ProducerCollectorState {
    Unavailable,
    Ready {
        collector_boot_id: String,
        generation_number: u64,
    },
    Cooldown,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProducerStatusSnapshot {
    pub component: ComponentV1,
    pub producer_boot_id: String,
    pub last_assigned_sequence: Option<u64>,
    pub next_sequence: Option<u64>,
    pub collector_state: ProducerCollectorState,
    pub resident_records: u16,
    pub resident_bytes: u32,
    pub in_flight: bool,
    pub fallback_active: bool,
    pub fallback_bytes: u32,
    pub fallback_write_failures: u64,
    pub dropped_by_reason: BoundedLossCounters,
    pub fallback_routed: u64,
    pub delivery_fence_eligible: bool,
    pub last_failure: Option<ProducerFailureClassification>,
}
