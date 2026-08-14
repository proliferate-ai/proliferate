use std::collections::BTreeSet;
use std::sync::Arc;

use proliferate_diagnostics_protocol::v1::limits::{CURRENT_SCHEMA_VERSION, MAX_HEALTH_PRODUCERS};
use proliferate_diagnostics_protocol::v1::sequence::{
    LifecycleSequenceValidatorV1, SequenceDispositionV1,
};
use proliferate_diagnostics_protocol::v1::types::{
    AcceptedOrderRangeV1, GapReasonV1, GapV1, IngestReceiptV1, IngestRejectionV1, ProducerHealthV1,
    ProducerLivenessV1, ProducerRecordV1, RejectionReasonV1, TerminalOutcomeV1,
};
use proliferate_diagnostics_protocol::v1::validation::{
    validate_ingest_receipt, validate_producer_record,
};

use super::{
    CollectorCore, CoreError, LifecycleTracker, ProducerState, RecordOrigin, StoredRecord,
};

pub(crate) struct IngestCandidate {
    pub(crate) index: u16,
    pub(crate) parsed: Result<PreparedRecord, RejectionReasonV1>,
}

pub(crate) struct PreparedRecord {
    pub(crate) component: proliferate_diagnostics_protocol::v1::types::ComponentV1,
    pub(crate) producer_boot_id: String,
    pub(crate) schema_version: proliferate_diagnostics_protocol::v1::types::SchemaVersionV1,
    pub(crate) encoded: Box<[u8]>,
}

impl PreparedRecord {
    pub(crate) fn decode(&self) -> Result<ProducerRecordV1, CoreError> {
        serde_json::from_slice(&self.encoded).map_err(|_| CoreError::Serialization)
    }
}

#[derive(Debug, Clone)]
pub struct IngestResult {
    pub receipt: IngestReceiptV1,
}

pub(super) enum AcceptDisposition {
    Accepted(u64),
    Duplicate,
}

impl CollectorCore {
    pub(crate) fn ingest_candidates(
        &self,
        candidates: Vec<IngestCandidate>,
    ) -> Result<IngestResult, CoreError> {
        let mut inner = self.lock();
        let mut new_producers = Vec::new();
        let mut seen = BTreeSet::new();
        for prepared in candidates
            .iter()
            .filter_map(|candidate| candidate.parsed.as_ref().ok())
        {
            let key = (prepared.component, prepared.producer_boot_id.clone());
            if !inner.producers.contains_key(&key) && seen.insert(key.clone()) {
                new_producers.push((key, prepared.schema_version));
            }
        }

        let mut refused_producers = BTreeSet::new();
        for (key, schema_version) in new_producers {
            if inner.producers.len() == MAX_HEALTH_PRODUCERS {
                self.record_producer_attach_locked(&mut inner, TerminalOutcomeV1::Rejected);
                refused_producers.insert(key);
                continue;
            }
            inner.producers.insert(
                key.clone(),
                ProducerState {
                    health: ProducerHealthV1 {
                        component: key.0,
                        producer_boot_id: key.1.clone(),
                        schema_version,
                        last_sequence: None,
                        gap_count: 0,
                        liveness: ProducerLivenessV1::Attached,
                    },
                },
            );
            self.record_producer_attach_locked(&mut inner, TerminalOutcomeV1::Succeeded);
            if let Some(producer) = inner.producers.get_mut(&key) {
                producer.health.liveness = ProducerLivenessV1::Alive;
            }
        }

        let mut accepted_orders = Vec::new();
        let mut duplicate_count = 0_u16;
        let mut rejections = Vec::new();
        for candidate in candidates {
            let prepared = match candidate.parsed {
                Ok(prepared) => prepared,
                Err(reason) => {
                    self.note_record_rejection_locked(&mut inner, reason);
                    rejections.push(IngestRejectionV1 {
                        index: candidate.index,
                        reason,
                    });
                    continue;
                }
            };
            let producer_key = (prepared.component, prepared.producer_boot_id.clone());
            if refused_producers.contains(&producer_key) {
                self.note_record_rejection_locked(&mut inner, RejectionReasonV1::LimitExceeded);
                rejections.push(IngestRejectionV1 {
                    index: candidate.index,
                    reason: RejectionReasonV1::LimitExceeded,
                });
                continue;
            }
            let record = prepared.decode()?;
            self.track_producer_sequence_locked(&mut inner, &record);
            match self.accept_record_locked(&mut inner, record, RecordOrigin::Producer) {
                Ok(AcceptDisposition::Accepted(order)) => accepted_orders.push(order),
                Ok(AcceptDisposition::Duplicate) => {
                    duplicate_count = duplicate_count.saturating_add(1);
                }
                Err(reason) => {
                    self.note_record_rejection_locked(&mut inner, reason);
                    rejections.push(IngestRejectionV1 {
                        index: candidate.index,
                        reason,
                    });
                }
            }
        }

        let receipt = IngestReceiptV1 {
            schema_version: CURRENT_SCHEMA_VERSION,
            collector_boot_id: self.boot_id.clone(),
            accepted_range: accepted_orders.first().zip(accepted_orders.last()).map(
                |(first, last)| AcceptedOrderRangeV1 {
                    first: *first,
                    last: *last,
                },
            ),
            accepted_count: accepted_orders.len() as u16,
            duplicate_count,
            rejections,
            pressure: self.pressure_locked(&inner),
        };
        validate_ingest_receipt(&receipt).map_err(|_| CoreError::Serialization)?;
        Ok(IngestResult { receipt })
    }

    pub fn note_request_rejection(&self, reason: RejectionReasonV1) {
        let mut inner = self.lock();
        *inner
            .counters
            .rejections_by_reason
            .entry(reason)
            .or_default() += 1;
        if matches!(
            reason,
            RejectionReasonV1::RecordTooLarge | RejectionReasonV1::BatchTooLarge
        ) {
            inner.counters.oversized_records += 1;
        }
    }

    pub fn reset_profile_counters(&self) {
        let mut inner = self.lock();
        inner.counters = super::Counters::default();
        inner.gaps.clear();
        for producer in inner.producers.values_mut() {
            producer.health.gap_count = 0;
        }
    }

    fn note_record_rejection_locked(&self, inner: &mut super::Inner, reason: RejectionReasonV1) {
        inner.counters.rejected_records += 1;
        *inner
            .counters
            .rejections_by_reason
            .entry(reason)
            .or_default() += 1;
        if reason == RejectionReasonV1::RecordTooLarge {
            inner.counters.oversized_records += 1;
        }
    }

    fn track_producer_sequence_locked(&self, inner: &mut super::Inner, record: &ProducerRecordV1) {
        let key = (record.component, record.producer_boot_id.clone());
        let mut gap = None;
        if let Some(producer) = inner.producers.get_mut(&key) {
            if let Some(previous) = producer.health.last_sequence {
                if record.producer_sequence > previous.saturating_add(1) {
                    producer.health.gap_count += 1;
                    gap = Some(GapV1 {
                        reason: GapReasonV1::ProducerSequence,
                        from_cursor: None,
                        to_cursor: None,
                        component: Some(record.component),
                        producer_boot_id: Some(record.producer_boot_id.clone()),
                        missing_sequence_from: Some(previous.saturating_add(1)),
                        missing_sequence_to: Some(record.producer_sequence - 1),
                        dropped_records: record
                            .producer_sequence
                            .saturating_sub(previous)
                            .saturating_sub(1),
                    });
                } else if record.producer_sequence < previous {
                    producer.health.gap_count += 1;
                }
            }
            producer.health.last_sequence = Some(
                producer
                    .health
                    .last_sequence
                    .map_or(record.producer_sequence, |previous| {
                        previous.max(record.producer_sequence)
                    }),
            );
            producer.health.schema_version = record.schema_version;
            producer.health.liveness = ProducerLivenessV1::Alive;
        }
        if let Some(gap) = gap {
            self.push_gap_locked(inner, gap);
        }
    }

    pub(super) fn accept_record_locked(
        &self,
        inner: &mut super::Inner,
        record: ProducerRecordV1,
        origin: RecordOrigin,
    ) -> Result<AcceptDisposition, RejectionReasonV1> {
        validate_producer_record(&record)?;
        if record.lifecycle.is_some() {
            let operation_id = record.operation_id.clone();
            if !inner.lifecycle.contains_key(&operation_id) {
                if inner.lifecycle.len() == self.limits.lifecycle_operations {
                    let position = self.reclaim_lifecycle_slot_locked(inner, origin)?;
                    if let Some(expired) = inner.lifecycle_order.remove(position) {
                        inner.lifecycle.remove(&expired);
                    }
                }
                let mut validator = LifecycleSequenceValidatorV1::default();
                let decision = validator.apply(record.clone())?;
                let open = decision.disposition == SequenceDispositionV1::AcceptedStart;
                inner.lifecycle.insert(
                    operation_id.clone(),
                    LifecycleTracker {
                        validator,
                        open,
                        producer_boot_id: record.producer_boot_id.clone(),
                        start_record: open.then(|| record.clone()),
                    },
                );
                inner.lifecycle_order.push_back(operation_id);
                if decision.requires_gap_or_health_violation {
                    self.note_orphan_locked(inner, &record);
                }
            } else {
                let decision_result = {
                    let tracker = inner
                        .lifecycle
                        .get_mut(&operation_id)
                        .expect("checked lifecycle tracker");
                    tracker.validator.apply(record.clone())
                };
                let decision = match decision_result {
                    Ok(decision) => decision,
                    Err(reason) => {
                        if reason == RejectionReasonV1::ConflictingTerminal {
                            inner.counters.conflicting_terminals += 1;
                        }
                        return Err(reason);
                    }
                };
                if decision.disposition == SequenceDispositionV1::Duplicate {
                    if record
                        .lifecycle
                        .as_ref()
                        .is_some_and(|lifecycle| lifecycle.outcome.is_some())
                    {
                        inner.counters.duplicate_terminals += 1;
                    }
                    return Ok(AcceptDisposition::Duplicate);
                }
                if let Some(tracker) = inner.lifecycle.get_mut(&operation_id) {
                    tracker.open = decision.disposition == SequenceDispositionV1::AcceptedStart;
                    tracker.start_record = tracker.open.then(|| record.clone());
                }
                if decision.requires_gap_or_health_violation {
                    self.note_orphan_locked(inner, &record);
                }
            }
        }

        let order = inner.next_order;
        inner.next_order = inner.next_order.saturating_add(1);
        let accepted = proliferate_diagnostics_protocol::v1::types::CollectorAcceptedRecordV1 {
            record,
            accepted_timestamp: super::query::timestamp_now(),
            accepted_order: order,
            retention_cursor: order,
        };
        let encoded = serde_json::to_vec(&accepted).map_err(|_| RejectionReasonV1::InvalidShape)?;
        let encoded: Arc<[u8]> = encoded.into();
        let stored = StoredRecord {
            cursor: order,
            version: accepted.record.schema_version,
            record_class: accepted.record.record_class,
            component: accepted.record.component,
            encoded: Arc::clone(&encoded),
        };
        self.retain_locked(inner, stored);
        inner.newest_accepted_cursor = Some(order);
        let _ = self.tail_tx.send(encoded);
        Ok(AcceptDisposition::Accepted(order))
    }

    /// Pick the lifecycle slot a new operation may take over. Closed trackers
    /// are always preferred. When every tracker is still open a producer record
    /// keeps its stable `LimitExceeded` rejection, but the collector's own
    /// bookkeeping displaces the oldest tracker instead: the ADR represents that
    /// loss with a counter and a gap, never with a failed caller request.
    fn reclaim_lifecycle_slot_locked(
        &self,
        inner: &mut super::Inner,
        origin: RecordOrigin,
    ) -> Result<usize, RejectionReasonV1> {
        let removable = inner.lifecycle_order.iter().position(|candidate| {
            inner
                .lifecycle
                .get(candidate)
                .is_some_and(|tracker| !tracker.open)
        });
        if let Some(position) = removable {
            return Ok(position);
        }
        if origin == RecordOrigin::Producer {
            return Err(RejectionReasonV1::LimitExceeded);
        }
        let displaced = inner
            .lifecycle_order
            .front()
            .and_then(|operation_id| inner.lifecycle.get(operation_id))
            .and_then(|tracker| tracker.start_record.clone());
        inner.counters.lifecycle_displacements += 1;
        *inner
            .counters
            .evictions_by_reason
            .entry(GapReasonV1::Evicted)
            .or_default() += 1;
        if let Some(start) = displaced {
            self.push_gap_locked(
                inner,
                GapV1 {
                    reason: GapReasonV1::Evicted,
                    from_cursor: None,
                    to_cursor: None,
                    component: Some(start.component),
                    producer_boot_id: Some(start.producer_boot_id),
                    missing_sequence_from: None,
                    missing_sequence_to: None,
                    dropped_records: 0,
                },
            );
        }
        Ok(0)
    }

    fn note_orphan_locked(&self, inner: &mut super::Inner, record: &ProducerRecordV1) {
        if let Some(producer) = inner
            .producers
            .get_mut(&(record.component, record.producer_boot_id.clone()))
        {
            producer.health.gap_count += 1;
        }
        self.push_gap_locked(
            inner,
            GapV1 {
                reason: GapReasonV1::ProducerSequence,
                from_cursor: None,
                to_cursor: None,
                component: Some(record.component),
                producer_boot_id: Some(record.producer_boot_id.clone()),
                missing_sequence_from: None,
                missing_sequence_to: None,
                dropped_records: 0,
            },
        );
    }

    fn retain_locked(&self, inner: &mut super::Inner, stored: StoredRecord) {
        let bytes = stored.encoded.len() as u64;
        while inner.retained_bytes.saturating_add(bytes) > self.limits.retained_bytes {
            let Some(evicted) = inner.records.pop_front() else {
                break;
            };
            inner.retained_bytes = inner
                .retained_bytes
                .saturating_sub(evicted.encoded.len() as u64);
            self.note_eviction_locked(inner, &evicted);
        }
        if bytes > self.limits.retained_bytes {
            self.note_eviction_locked(inner, &stored);
            return;
        }
        inner.retained_bytes += bytes;
        inner.records.push_back(stored);
    }

    fn note_eviction_locked(&self, inner: &mut super::Inner, record: &StoredRecord) {
        inner.evicted_through_cursor = Some(record.cursor);
        *inner
            .counters
            .evictions_by_class
            .entry(record.record_class)
            .or_default() += 1;
        *inner
            .counters
            .evictions_by_component
            .entry(record.component)
            .or_default() += 1;
        *inner
            .counters
            .evictions_by_reason
            .entry(GapReasonV1::Evicted)
            .or_default() += 1;
    }
}
