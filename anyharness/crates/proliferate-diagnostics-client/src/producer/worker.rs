use std::{sync::Arc, time::Instant};

use proliferate_diagnostics_protocol::v1::types::IngestBatchV1;

use super::{
    transport::{TransportError, TransportFailure},
    AdmissionState, CollectorAvailability, ProducerFailureClassification, ProducerInner,
    ResidentRecord, CIRCUIT_INTERVAL, FLUSH_INTERVAL, MAX_BATCH_BODY_BYTES, MAX_BATCH_RECORDS,
};
use crate::fallback::FallbackReason;

pub(crate) async fn run(inner: Arc<ProducerInner>) {
    loop {
        tokio::select! {
            _ = inner.notify.notified() => {}
            _ = tokio::time::sleep(FLUSH_INTERVAL) => {}
        }
        while let Some(work) = take_work(&inner) {
            match work {
                Work::Fallback(records) => route_fallback(&inner, records),
                Work::Ingest {
                    generation,
                    records,
                } => {
                    let payload = records.iter().map(|record| record.record.clone()).collect();
                    let result = generation.client.ingest(payload).await;
                    finish_ingest(&inner, generation.generation, records, result);
                }
            }
        }
        let terminal_and_empty = {
            let state = inner
                .state
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            state.terminal && state.queue.is_empty() && state.in_flight.is_empty()
        };
        if terminal_and_empty {
            return;
        }
    }
}

enum Work {
    Fallback(Vec<ResidentRecord>),
    Ingest {
        generation: Arc<crate::bridge::activation::CollectorGenerationHandle>,
        records: Vec<ResidentRecord>,
    },
}

fn take_work(inner: &ProducerInner) -> Option<Work> {
    let mut state = inner
        .state
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    if !state.in_flight.is_empty() || state.queue.is_empty() {
        return None;
    }
    if state
        .queue
        .front()
        .is_some_and(|record| record.fallback_reason.is_some())
    {
        let mut records = Vec::new();
        while records.len() < MAX_BATCH_RECORDS
            && state
                .queue
                .front()
                .is_some_and(|record| record.fallback_reason.is_some())
        {
            if let Some(record) = state.queue.pop_front() {
                records.push(record);
            }
        }
        state.account_in_flight(&records);
        return Some(Work::Fallback(records));
    }
    let generation = match &state.collector {
        CollectorAvailability::Ready(generation) => Arc::clone(generation),
        CollectorAvailability::Cooldown { generation, until } if Instant::now() >= *until => {
            Arc::clone(generation)
        }
        CollectorAvailability::Cooldown { .. } | CollectorAvailability::Unavailable { .. } => {
            for record in &mut state.queue {
                record.fallback_reason = Some(FallbackReason::CollectorUnavailable);
            }
            return None;
        }
    };
    let should_flush = state.queue.len() >= MAX_BATCH_RECORDS
        || state.queue.iter().any(|record| record.protected)
        || state
            .queue
            .front()
            .is_some_and(|record| record.admitted_at.elapsed() >= FLUSH_INTERVAL);
    if !should_flush {
        return None;
    }
    let mut records = Vec::new();
    while records.len() < MAX_BATCH_RECORDS {
        let Some(candidate) = state.queue.pop_front() else {
            break;
        };
        let mut proposed: Vec<_> = records
            .iter()
            .map(|record: &ResidentRecord| record.record.clone())
            .collect();
        proposed.push(candidate.record.clone());
        let size = serde_json::to_vec(&IngestBatchV1 {
            schema_version: proliferate_diagnostics_protocol::v1::limits::CURRENT_SCHEMA_VERSION,
            records: proposed,
        })
        .map(|body| body.len())
        .unwrap_or(MAX_BATCH_BODY_BYTES + 1);
        if size > MAX_BATCH_BODY_BYTES {
            state.queue.push_front(candidate);
            break;
        }
        records.push(candidate);
    }
    if records.is_empty() {
        return None;
    }
    state.account_in_flight(&records);
    Some(Work::Ingest {
        generation,
        records,
    })
}

fn finish_ingest(
    inner: &ProducerInner,
    generation_number: u64,
    mut records: Vec<ResidentRecord>,
    result: Result<proliferate_diagnostics_protocol::v1::types::IngestReceiptV1, TransportFailure>,
) {
    let mut fallback = None;
    {
        let mut state = inner
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let generation_current = match &state.collector {
            CollectorAvailability::Ready(current)
            | CollectorAvailability::Cooldown {
                generation: current,
                ..
            } => current.generation == generation_number,
            CollectorAvailability::Unavailable { .. } => false,
        };
        if !generation_current {
            for record in &mut records {
                record.fallback_reason = Some(FallbackReason::DeliveryUnknown);
            }
            state.delivery_fence_eligible = false;
            fallback = Some(records);
        } else {
            match result {
                Ok(receipt) => {
                    let expected_boot = match &state.collector {
                        CollectorAvailability::Ready(current)
                        | CollectorAvailability::Cooldown {
                            generation: current,
                            ..
                        } => &current.collector_boot_id,
                        CollectorAvailability::Unavailable { .. } => "",
                    };
                    if receipt.collector_boot_id != expected_boot {
                        for record in &mut records {
                            record.fallback_reason = Some(FallbackReason::DeliveryUnknown);
                        }
                        state.record_loss(ProducerFailureClassification::ReceiptInvalid);
                        state.delivery_fence_eligible = false;
                        fallback = Some(records);
                    } else {
                        state.apply_pressure(receipt.pressure);
                        for rejection in &receipt.rejections {
                            if let Some(record) = records.get(usize::from(rejection.index)) {
                                let _ = record;
                                state.record_loss(ProducerFailureClassification::ReceiptRejected);
                            }
                        }
                        for record in &records {
                            state.release_record(record);
                        }
                        state.clear_in_flight();
                    }
                }
                Err(failure) => {
                    let reason = match failure.error {
                        TransportError::Deadline => ProducerFailureClassification::TransportTimeout,
                        TransportError::Protocol => ProducerFailureClassification::ReceiptInvalid,
                        _ => ProducerFailureClassification::TransportFailure,
                    };
                    state.record_loss(reason);
                    if failure.dispatched {
                        state.delivery_fence_eligible = false;
                    }
                    let current = match &state.collector {
                        CollectorAvailability::Ready(current)
                        | CollectorAvailability::Cooldown {
                            generation: current,
                            ..
                        } => Arc::clone(current),
                        CollectorAvailability::Unavailable { .. } => unreachable!(),
                    };
                    state.collector = match failure.error {
                        TransportError::Authentication
                        | TransportError::Rejected
                        | TransportError::Protocol => CollectorAvailability::Unavailable {
                            generation: current.generation,
                        },
                        TransportError::Unavailable | TransportError::Deadline => {
                            CollectorAvailability::Cooldown {
                                generation: current,
                                until: Instant::now() + CIRCUIT_INTERVAL,
                            }
                        }
                    };
                    for record in &mut records {
                        record.fallback_reason = Some(FallbackReason::DeliveryUnknown);
                    }
                    fallback = Some(records);
                }
            }
        }
    }
    if let Some(records) = fallback {
        route_fallback(inner, records);
    }
}

fn route_fallback(inner: &ProducerInner, records: Vec<ResidentRecord>) {
    let mut outcomes = Vec::with_capacity(records.len());
    {
        let mut writer = inner
            .fallback
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        for record in &records {
            let reason = record
                .fallback_reason
                .unwrap_or(FallbackReason::CollectorUnavailable);
            let outcome = writer.as_mut().ok_or(()).and_then(|writer| {
                writer
                    .write(reason, &record.record)
                    .map(|_| ())
                    .map_err(|_| ())
            });
            outcomes.push(outcome.is_ok());
        }
    }
    let mut state = inner
        .state
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    for (record, succeeded) in records.iter().zip(outcomes) {
        if succeeded {
            state.fallback_routed = state
                .fallback_routed
                .saturating_add(1)
                .min(proliferate_diagnostics_protocol::v1::limits::MAX_SAFE_INTEGER);
        } else {
            state.record_loss(ProducerFailureClassification::FallbackWriteFailed);
        }
        state.release_record(record);
    }
    state.clear_in_flight();
}
