#![cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]

//! Coherent collector identity and closed bridge-response validation.

use proliferate_diagnostics_client::{
    bridge::wire::{BootstrapCollectorState, DeliveryFence},
    BoundedLossCounters, ProducerCollectorState, ProducerStatusSnapshot,
};
use proliferate_diagnostics_protocol::v1::limits::MAX_SAFE_INTEGER;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum CollectorAvailabilityIdentity {
    Ready { collector_boot_id: String },
    Unavailable,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct CollectorIdentity {
    pub(super) generation: u64,
    pub(super) availability: CollectorAvailabilityIdentity,
}

impl CollectorIdentity {
    pub(super) fn unavailable(generation: u64) -> Option<Self> {
        safe(generation).then_some(Self {
            generation,
            availability: CollectorAvailabilityIdentity::Unavailable,
        })
    }

    pub(super) fn ready(generation: u64, collector_boot_id: String) -> Option<Self> {
        (safe(generation) && valid_id(&collector_boot_id)).then_some(Self {
            generation,
            availability: CollectorAvailabilityIdentity::Ready { collector_boot_id },
        })
    }

    pub(super) fn from_bootstrap(state: &BootstrapCollectorState) -> Option<Self> {
        match state {
            BootstrapCollectorState::Ready {
                generation,
                descriptor,
                ..
            } => Self::ready(*generation, descriptor.collector_boot_id.clone()),
            BootstrapCollectorState::Unavailable { generation, .. } => {
                Self::unavailable(*generation)
            }
        }
    }

    pub(super) fn matches_snapshot(&self, snapshot: &ProducerStatusSnapshot) -> bool {
        safe_snapshot(snapshot)
            && match (&self.availability, &snapshot.collector_state) {
                (
                    CollectorAvailabilityIdentity::Ready { collector_boot_id },
                    ProducerCollectorState::Ready {
                        collector_boot_id: snapshot_boot,
                        generation_number,
                    },
                ) => collector_boot_id == snapshot_boot && self.generation == *generation_number,
                (CollectorAvailabilityIdentity::Ready { .. }, ProducerCollectorState::Cooldown) => {
                    true
                }
                (
                    CollectorAvailabilityIdentity::Unavailable,
                    ProducerCollectorState::Unavailable,
                ) => true,
                _ => false,
            }
    }

    pub(super) fn matches_fence(
        &self,
        snapshot: &ProducerStatusSnapshot,
        fence: &DeliveryFence,
    ) -> bool {
        let CollectorAvailabilityIdentity::Ready { collector_boot_id } = &self.availability else {
            return false;
        };
        safe(fence.generation)
            && fence.last_assigned_sequence.is_none_or(safe)
            && valid_id(&fence.producer_boot_id)
            && valid_id(&fence.collector_boot_id)
            && fence.collector_boot_id == *collector_boot_id
            && fence.generation == self.generation
            && fence.producer_boot_id == snapshot.producer_boot_id
            && matches!(
                &snapshot.collector_state,
                ProducerCollectorState::Ready {
                    collector_boot_id: snapshot_boot,
                    generation_number,
                } if snapshot_boot == collector_boot_id && *generation_number == self.generation
            )
    }
}

pub(super) fn valid_id(value: &str) -> bool {
    !value.is_empty() && value.len() <= 128
}

pub(super) fn safe_snapshot(snapshot: &ProducerStatusSnapshot) -> bool {
    valid_id(&snapshot.producer_boot_id)
        && snapshot.last_assigned_sequence.is_none_or(safe)
        && snapshot.next_sequence.is_none_or(safe)
        && collector_numbers_safe(&snapshot.collector_state)
        && safe(u64::from(snapshot.resident_records))
        && safe(u64::from(snapshot.resident_bytes))
        && safe(u64::from(snapshot.fallback_bytes))
        && safe(snapshot.fallback_write_failures)
        && safe(snapshot.fallback_routed)
        && counters_safe(&snapshot.dropped_by_reason)
}

fn collector_numbers_safe(state: &ProducerCollectorState) -> bool {
    match state {
        ProducerCollectorState::Ready {
            collector_boot_id,
            generation_number,
        } => valid_id(collector_boot_id) && safe(*generation_number),
        ProducerCollectorState::Unavailable | ProducerCollectorState::Cooldown => true,
    }
}

fn counters_safe(counters: &BoundedLossCounters) -> bool {
    [
        counters.queue_records,
        counters.queue_bytes,
        counters.protected_eviction,
        counters.pressure,
        counters.generation_changed,
        counters.transport_timeout,
        counters.transport_failure,
        counters.receipt_invalid,
        counters.receipt_rejected,
        counters.fallback_overflow,
        counters.fallback_write_failed,
        counters.shutdown_timeout,
        counters.filter_invalid,
        counters.sequence_exhausted,
    ]
    .into_iter()
    .all(safe)
}

fn safe(value: u64) -> bool {
    value <= MAX_SAFE_INTEGER
}

#[cfg(test)]
mod tests {
    use proliferate_diagnostics_client::bridge::wire::{
        BootstrapCollectorState, CollectorUnavailableClassification,
    };
    use proliferate_diagnostics_protocol::v1::limits::MAX_SAFE_INTEGER;

    use super::CollectorIdentity;

    #[test]
    fn bootstrap_generation_above_safe_integer_is_rejected_not_normalized() {
        let state = BootstrapCollectorState::Unavailable {
            generation: MAX_SAFE_INTEGER + 1,
            classification: CollectorUnavailableClassification::Degraded,
        };
        assert!(CollectorIdentity::from_bootstrap(&state).is_none());
    }
}
