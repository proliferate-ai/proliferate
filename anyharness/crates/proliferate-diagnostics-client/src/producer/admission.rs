use std::time::Instant;

use proliferate_diagnostics_protocol::v1::types::{PressureV1, SeverityV1};

use super::{
    AdmissionState, CollectorAvailability, PressureSuppression, ProducerFailureClassification,
    ResidentAccounting, ResidentRecord, ORDINARY_BYTE_LIMIT, ORDINARY_RECORD_LIMIT,
    PRESSURE_INTERVAL, TOTAL_BYTE_LIMIT, TOTAL_RECORD_LIMIT,
};
use crate::fallback::FallbackReason;

impl AdmissionState {
    pub(super) fn record_loss(&mut self, reason: ProducerFailureClassification) {
        self.dropped.increment(reason);
        self.last_failure = Some(reason);
    }

    pub(super) fn pressure_suppresses(
        &mut self,
        severity: SeverityV1,
        now: Instant,
        protected: bool,
    ) -> bool {
        if protected {
            return false;
        }
        match &mut self.pressure {
            PressureSuppression::Normal => false,
            PressureSuppression::Elevated { until, probe_used } => {
                if now >= *until && !*probe_used {
                    *probe_used = true;
                    false
                } else {
                    matches!(severity, SeverityV1::Trace | SeverityV1::Debug)
                }
            }
            PressureSuppression::Critical { until, probe_used } => {
                if now >= *until && !*probe_used {
                    *probe_used = true;
                    false
                } else {
                    !matches!(severity, SeverityV1::Warn | SeverityV1::Error)
                }
            }
        }
    }

    pub(super) fn route_for_current_collector(&self) -> Option<FallbackReason> {
        match &self.collector {
            CollectorAvailability::Ready(_) => None,
            CollectorAvailability::Unavailable { .. } => Some(FallbackReason::CollectorUnavailable),
            CollectorAvailability::Cooldown { until, .. } if Instant::now() < *until => {
                Some(FallbackReason::TransportCooldown)
            }
            CollectorAvailability::Cooldown { .. } => None,
        }
    }

    pub(super) fn make_capacity(
        &mut self,
        bytes: usize,
        protected: bool,
    ) -> Result<(), ProducerFailureClassification> {
        if !protected
            && (self.ordinary_records + 1 > ORDINARY_RECORD_LIMIT
                || self.ordinary_bytes.saturating_add(bytes) > ORDINARY_BYTE_LIMIT)
        {
            return Err(if self.ordinary_records + 1 > ORDINARY_RECORD_LIMIT {
                ProducerFailureClassification::QueueRecords
            } else {
                ProducerFailureClassification::QueueBytes
            });
        }
        while protected
            && (self.queue.len() + self.in_flight.len() + 1 > TOTAL_RECORD_LIMIT
                || self.resident_bytes.saturating_add(bytes) > TOTAL_BYTE_LIMIT)
        {
            let index = self
                .queue
                .iter()
                .position(|record| !record.protected)
                .or_else(|| (!self.queue.is_empty()).then_some(0));
            let Some(index) = index else {
                break;
            };
            if let Some(evicted) = self.queue.remove(index) {
                self.release_record(&evicted);
                self.record_loss(ProducerFailureClassification::ProtectedEviction);
            }
        }
        if self.queue.len() + self.in_flight.len() + 1 > TOTAL_RECORD_LIMIT {
            return Err(ProducerFailureClassification::QueueRecords);
        }
        if self.resident_bytes.saturating_add(bytes) > TOTAL_BYTE_LIMIT {
            return Err(ProducerFailureClassification::QueueBytes);
        }
        Ok(())
    }

    pub(crate) fn release_record(&mut self, record: &ResidentRecord) {
        self.resident_bytes = self.resident_bytes.saturating_sub(record.serialized_bytes);
        if !record.protected {
            self.ordinary_records = self.ordinary_records.saturating_sub(1);
            self.ordinary_bytes = self.ordinary_bytes.saturating_sub(record.serialized_bytes);
        }
    }

    pub(crate) fn account_in_flight(&mut self, records: &[ResidentRecord]) {
        self.in_flight = records
            .iter()
            .map(|record| ResidentAccounting {
                serialized_bytes: record.serialized_bytes,
            })
            .collect();
    }

    pub(crate) fn clear_in_flight(&mut self) {
        self.in_flight.clear();
    }

    pub(crate) fn apply_pressure(&mut self, pressure: PressureV1) {
        self.pressure = match pressure {
            PressureV1::Normal => PressureSuppression::Normal,
            PressureV1::Elevated => PressureSuppression::Elevated {
                until: Instant::now() + PRESSURE_INTERVAL,
                probe_used: false,
            },
            PressureV1::Critical => PressureSuppression::Critical {
                until: Instant::now() + PRESSURE_INTERVAL,
                probe_used: false,
            },
        };
    }
}
