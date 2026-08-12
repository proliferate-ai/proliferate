use std::time::Instant;

use proliferate_diagnostics_protocol::v1::limits::MAX_SAFE_INTEGER;
use proliferate_diagnostics_protocol::v1::types::{PressureV1, SeverityV1};

use super::{
    status::BoundedLossCounters, AdmissionState, CollectorAvailability, PressureSuppression,
    ProducerFailureClassification, ResidentAccounting, ResidentRecord, ORDINARY_BYTE_LIMIT,
    ORDINARY_RECORD_LIMIT, PRESSURE_INTERVAL, TOTAL_BYTE_LIMIT, TOTAL_RECORD_LIMIT,
};
use crate::fallback::FallbackReason;

/// A closed loss snapshot owned by exactly one in-queue/in-flight summary
/// record. Construction closes it; only a coherent accepted-or-duplicate
/// receipt subtracts it, every other outcome returns it to the pending pool.
pub(crate) struct LossSnapshot {
    pub(crate) counters: BoundedLossCounters,
    pub(crate) total: u64,
    pub(crate) range: Option<(u64, u64)>,
}

/// Assigned-sequence coverage of the pending loss pool. A summary reports
/// bounds only for one exact contiguous assigned interval; any unsequenced
/// or non-contiguous loss removes the range without inventing one.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PendingLossRange {
    Empty,
    Exact { first: u64, last: u64 },
    Broken,
}

impl PendingLossRange {
    fn merge(&mut self, sequence: Option<u64>) {
        *self = match (*self, sequence) {
            (Self::Empty, Some(sequence)) => Self::Exact {
                first: sequence,
                last: sequence,
            },
            (Self::Exact { first, last }, Some(sequence)) if sequence == last + 1 => Self::Exact {
                first,
                last: sequence,
            },
            _ => Self::Broken,
        };
    }

    fn bounds(self) -> Option<(u64, u64)> {
        match self {
            Self::Exact { first, last } => Some((first, last)),
            Self::Empty | Self::Broken => None,
        }
    }
}

impl AdmissionState {
    pub(super) fn record_loss(&mut self, reason: ProducerFailureClassification) {
        self.record_loss_with_sequence(reason, None);
    }

    pub(super) fn record_loss_with_sequence(
        &mut self,
        reason: ProducerFailureClassification,
        sequence: Option<u64>,
    ) {
        self.dropped.increment(reason);
        self.last_failure = Some(reason);
        self.pending_loss.increment(reason);
        self.pending_loss_total = self
            .pending_loss_total
            .saturating_add(1)
            .min(MAX_SAFE_INTEGER);
        self.pending_loss_range.merge(sequence);
    }

    /// Atomically closes the pending pool into one snapshot. New losses start
    /// a fresh pool and never mutate the closed snapshot.
    pub(super) fn close_loss_snapshot(&mut self) -> LossSnapshot {
        let snapshot = LossSnapshot {
            counters: std::mem::take(&mut self.pending_loss),
            total: self.pending_loss_total,
            range: self.pending_loss_range.bounds(),
        };
        self.pending_loss_total = 0;
        self.pending_loss_range = PendingLossRange::Empty;
        snapshot
    }

    /// Returns an undelivered closed snapshot to the pending pool so a later
    /// summary (with a new sequence) covers it. The consumed summary sequence
    /// breaks any exact interval claim.
    pub(super) fn return_loss_snapshot(&mut self) {
        let Some(snapshot) = self.open_loss_snapshot.take() else {
            return;
        };
        self.pending_loss.merge(&snapshot.counters);
        self.pending_loss_total = self
            .pending_loss_total
            .saturating_add(snapshot.total)
            .min(MAX_SAFE_INTEGER);
        self.pending_loss_range = match (self.pending_loss_range, snapshot.range) {
            (PendingLossRange::Empty, Some((first, last))) => {
                PendingLossRange::Exact { first, last }
            }
            (PendingLossRange::Empty, None) if snapshot.total == 0 => PendingLossRange::Empty,
            _ => PendingLossRange::Broken,
        };
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
                if evicted.is_loss_summary {
                    self.return_loss_snapshot();
                }
                self.record_loss_with_sequence(
                    ProducerFailureClassification::ProtectedEviction,
                    Some(evicted.record.producer_sequence),
                );
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
                producer_sequence: record.record.producer_sequence,
                is_loss_summary: record.is_loss_summary,
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
