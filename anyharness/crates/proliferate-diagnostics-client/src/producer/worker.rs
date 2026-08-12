use std::{
    sync::{Arc, Weak},
    time::Instant,
};
use tokio::time::Instant as TokioInstant;

use proliferate_diagnostics_protocol::v1::types::IngestBatchV1;

use super::{
    transport::{
        CollectorClient, DispatchObservation, TransportError, TransportFailure, TRANSPORT_DEADLINE,
    },
    CollectorAvailability, ProducerFailureClassification, ProducerInner, ResidentRecord,
    CIRCUIT_INTERVAL, FLUSH_INTERVAL, MAX_BATCH_BODY_BYTES, MAX_BATCH_RECORDS,
};
use crate::fallback::FallbackReason;

/// Leaves a small portion of the one parent-owned terminal window for the
/// synchronous, bounded fallback writes that close whatever cannot start
/// another collector request. It is a reserve within the caller's deadline,
/// never an additional wait.
pub(super) const TERMINAL_FALLBACK_ALLOWANCE: std::time::Duration =
    std::time::Duration::from_millis(25);

pub(crate) async fn run(inner: Arc<ProducerInner>) {
    crate::tracing_layer::with_task_suppression(run_suppressed(inner)).await;
}

async fn run_suppressed(inner: Arc<ProducerInner>) {
    loop {
        tokio::select! {
            _ = inner.notify.notified() => {}
            _ = tokio::time::sleep(FLUSH_INTERVAL) => {}
        }
        loop {
            inner.maybe_emit_loss_summary();
            let Some(work) = take_work(&inner) else {
                break;
            };
            match work {
                Work::Fallback { records, deadline } => route_fallback(&inner, records, deadline),
                Work::Ingest {
                    generation,
                    mut records,
                    deadline,
                } => {
                    let dispatch_deadline =
                        deadline.map(|deadline| deadline - TERMINAL_FALLBACK_ALLOWANCE);
                    if dispatch_deadline.is_some_and(|deadline| TokioInstant::now() >= deadline) {
                        for record in &mut records {
                            record
                                .fallback_reason
                                .get_or_insert(FallbackReason::FinalTeardown);
                        }
                        route_fallback(&inner, records, deadline);
                        continue;
                    }
                    let generation_identity = GenerationIdentity::capture(&generation);
                    if !generation_is_current(&inner, &generation_identity) {
                        drop(generation);
                        finish_ingest(
                            &inner,
                            &generation_identity,
                            records,
                            Err(TransportFailure::cancelled(false)),
                        );
                        continue;
                    }
                    let payload = records.iter().map(|record| record.record.clone()).collect();
                    let request_started_at = TokioInstant::now();
                    let request_deadline =
                        dispatch_deadline.unwrap_or(request_started_at + TRANSPORT_DEADLINE);
                    let dispatch = DispatchObservation::new();
                    let result = {
                        let request = generation.client.ingest_observed(
                            payload,
                            dispatch_deadline,
                            &dispatch,
                        );
                        tokio::pin!(request);
                        loop {
                            tokio::select! {
                                biased;
                                _ = inner.notify.notified() => {
                                    let (generation_current, parent_window) = {
                                        let state = inner.state.lock()
                                            .unwrap_or_else(|error| error.into_inner());
                                        (
                                            generation_matches(
                                                &state.collector,
                                                &generation_identity,
                                            ),
                                            state.parent_shutdown_observed
                                                .then_some(state.terminal_deadline),
                                        )
                                    };
                                    if !generation_current {
                                        break Err(TransportFailure::cancelled(dispatch.observed()));
                                    }
                                    if TokioInstant::now() >= request_deadline {
                                        break Err(deadline_failure(&dispatch));
                                    }
                                    if let Some(parent_deadline) = parent_window {
                                        let revised = parent_deadline.map(|deadline| {
                                            deadline - TERMINAL_FALLBACK_ALLOWANCE
                                        });
                                        if revised.map_or(true, |deadline| deadline < request_deadline) {
                                            break Err(deadline_failure(&dispatch));
                                        }
                                    }
                                }
                                _ = tokio::time::sleep_until(request_deadline) => {
                                    break Err(deadline_failure(&dispatch));
                                }
                                result = &mut request => break result,
                            }
                        }
                    };
                    // Drop the cancelled future and generation handle before
                    // fallback I/O or another generation's dispatch begins.
                    drop(generation);
                    finish_ingest(&inner, &generation_identity, records, result);
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

fn deadline_failure(dispatch: &DispatchObservation) -> TransportFailure {
    TransportFailure {
        error: TransportError::Deadline,
        dispatched: dispatch.observed(),
    }
}

struct GenerationIdentity {
    generation: u64,
    client: Weak<CollectorClient>,
}

impl GenerationIdentity {
    fn capture(generation: &Arc<crate::bridge::activation::CollectorGenerationHandle>) -> Self {
        Self {
            generation: generation.generation,
            client: Arc::downgrade(&generation.client),
        }
    }
}

fn generation_is_current(inner: &ProducerInner, observed: &GenerationIdentity) -> bool {
    let state = inner
        .state
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    generation_matches(&state.collector, observed)
}

fn generation_matches(availability: &CollectorAvailability, observed: &GenerationIdentity) -> bool {
    match availability {
        CollectorAvailability::Ready(current)
        | CollectorAvailability::Cooldown {
            generation: current,
            ..
        } => {
            current.generation == observed.generation
                && Arc::as_ptr(&current.client) == observed.client.as_ptr()
        }
        CollectorAvailability::Unavailable { .. } => false,
    }
}

pub(super) enum Work {
    Fallback {
        records: Vec<ResidentRecord>,
        deadline: Option<TokioInstant>,
    },
    Ingest {
        generation: Arc<crate::bridge::activation::CollectorGenerationHandle>,
        records: Vec<ResidentRecord>,
        deadline: Option<TokioInstant>,
    },
}

pub(super) fn take_work(inner: &ProducerInner) -> Option<Work> {
    let mut state = inner
        .state
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    if !state.in_flight.is_empty() || state.queue.is_empty() {
        return None;
    }
    // The shutdown byte deliberately carries no time value. Once it is seen,
    // no fixed transport timeout may start; dispatch resumes only when the
    // matching flush request installs the parent's remaining absolute window.
    if state.parent_shutdown_observed && state.terminal_deadline.is_none() {
        return None;
    }
    let terminal_deadline = state.terminal_deadline;
    if terminal_deadline.is_some_and(|deadline| {
        deadline.saturating_duration_since(TokioInstant::now()) <= TERMINAL_FALLBACK_ALLOWANCE
    }) {
        for record in &mut state.queue {
            record
                .fallback_reason
                .get_or_insert(FallbackReason::FinalTeardown);
        }
    }
    // Reason assignment happens before batch collection so a record tagged
    // here routes in this same pass. `get_or_insert` preserves an earlier
    // assignment: at most one fallback reason per record, ever.
    let generation = match &state.collector {
        CollectorAvailability::Ready(generation) => Some(Arc::clone(generation)),
        CollectorAvailability::Cooldown { generation, until } if Instant::now() >= *until => {
            Some(Arc::clone(generation))
        }
        CollectorAvailability::Cooldown { .. } => {
            for record in &mut state.queue {
                record
                    .fallback_reason
                    .get_or_insert(FallbackReason::TransportCooldown);
            }
            None
        }
        CollectorAvailability::Unavailable { .. } => {
            for record in &mut state.queue {
                record
                    .fallback_reason
                    .get_or_insert(FallbackReason::CollectorUnavailable);
            }
            None
        }
    };
    if state.terminal && generation.is_none() {
        for record in &mut state.queue {
            record
                .fallback_reason
                .get_or_insert(FallbackReason::FinalTeardown);
        }
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
        return Some(Work::Fallback {
            records,
            deadline: terminal_deadline,
        });
    }
    let generation = generation?;
    let should_flush = state.terminal
        || state.queue.len() >= MAX_BATCH_RECORDS
        || state.queue.iter().any(|record| record.protected)
        || state
            .queue
            .front()
            .is_some_and(|record| record.admitted_at.elapsed() >= FLUSH_INTERVAL);
    if !should_flush {
        return None;
    }
    let envelope_bytes = empty_batch_envelope_bytes();
    let mut records: Vec<ResidentRecord> = Vec::new();
    let mut body_bytes = envelope_bytes;
    while records.len() < MAX_BATCH_RECORDS {
        let Some(candidate) = state.queue.front() else {
            break;
        };
        if candidate.fallback_reason.is_some() {
            break;
        }
        let candidate_bytes = candidate.serialized_bytes + usize::from(!records.is_empty());
        if body_bytes + candidate_bytes > MAX_BATCH_BODY_BYTES {
            break;
        }
        body_bytes += candidate_bytes;
        if let Some(record) = state.queue.pop_front() {
            records.push(record);
        }
    }
    if records.is_empty() {
        return None;
    }
    state.account_in_flight(&records);
    Some(Work::Ingest {
        generation,
        records,
        deadline: terminal_deadline,
    })
}

fn empty_batch_envelope_bytes() -> usize {
    static BYTES: std::sync::OnceLock<usize> = std::sync::OnceLock::new();
    *BYTES.get_or_init(|| {
        serde_json::to_vec(&IngestBatchV1 {
            schema_version: proliferate_diagnostics_protocol::v1::limits::CURRENT_SCHEMA_VERSION,
            records: Vec::new(),
        })
        .map(|body| body.len())
        .unwrap_or(MAX_BATCH_BODY_BYTES)
    })
}

fn finish_ingest(
    inner: &ProducerInner,
    generation_identity: &GenerationIdentity,
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
            } => {
                current.generation == generation_identity.generation
                    && Arc::as_ptr(&current.client) == generation_identity.client.as_ptr()
            }
            CollectorAvailability::Unavailable { .. } => false,
        };
        if !generation_current {
            // A strictly newer generation invalidated this staged batch. If
            // the request left the process the old collector may have stored
            // it; otherwise the invalidation itself is the routing cause.
            let dispatched = match &result {
                Ok(_) => true,
                Err(failure) => failure.dispatched,
            };
            let reason = generation_change_reason(dispatched);
            if dispatched {
                state.delivery_fence_eligible = false;
            }
            for record in &mut records {
                record.fallback_reason = Some(reason);
            }
            fallback = Some((records, state.terminal_deadline));
        } else {
            match result {
                Ok(receipt) => {
                    let expected_boot = match &state.collector {
                        CollectorAvailability::Ready(current)
                        | CollectorAvailability::Cooldown {
                            generation: current,
                            ..
                        } => current.collector_boot_id.clone(),
                        CollectorAvailability::Unavailable { .. } => String::new(),
                    };
                    if receipt.collector_boot_id != expected_boot {
                        // A boot mismatch latches this generation unusable
                        // until a strictly newer one arrives; delivery of the
                        // dispatched batch is unknowable.
                        state.record_loss(ProducerFailureClassification::ReceiptInvalid);
                        state.delivery_fence_eligible = false;
                        state.collector = CollectorAvailability::Unavailable {
                            generation: generation_identity.generation,
                        };
                        for record in &mut records {
                            record.fallback_reason = Some(FallbackReason::DeliveryUnknown);
                        }
                        fallback = Some((records, state.terminal_deadline));
                    } else {
                        // A coherent receipt closes the transient circuit:
                        // the probe succeeded, so the generation is ready.
                        if let CollectorAvailability::Cooldown { generation, .. } = &state.collector
                        {
                            state.collector = CollectorAvailability::Ready(Arc::clone(generation));
                        }
                        state.apply_pressure(receipt.pressure);
                        let mut summary_rejected = false;
                        for rejection in &receipt.rejections {
                            if let Some(record) = records.get(usize::from(rejection.index)) {
                                summary_rejected |= record.is_loss_summary;
                                state.record_loss_with_sequence(
                                    ProducerFailureClassification::ReceiptRejected,
                                    Some(record.record.producer_sequence),
                                );
                            }
                        }
                        for record in &records {
                            if record.is_loss_summary {
                                if summary_rejected {
                                    state.return_loss_snapshot();
                                } else {
                                    // The only outcome that subtracts the
                                    // closed snapshot: a coherent same-boot,
                                    // current-generation receipt that did not
                                    // reject the summary index.
                                    state.open_loss_snapshot = None;
                                }
                            }
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
                    if let CollectorAvailability::Ready(current)
                    | CollectorAvailability::Cooldown {
                        generation: current,
                        ..
                    } = &state.collector
                    {
                        let current = Arc::clone(current);
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
                    }
                    // There is no automatic record retry: the detached batch
                    // routes at most once to fallback as delivery_unknown.
                    // Only a failure after dispatch poisons the death fence.
                    if failure.dispatched {
                        state.delivery_fence_eligible = false;
                    }
                    for record in &mut records {
                        record.fallback_reason = Some(FallbackReason::DeliveryUnknown);
                    }
                    fallback = Some((records, state.terminal_deadline));
                }
            }
        }
    }
    if let Some((records, deadline)) = fallback {
        route_fallback(inner, records, deadline);
    }
}

fn generation_change_reason(dispatched: bool) -> FallbackReason {
    if dispatched {
        FallbackReason::DeliveryUnknown
    } else {
        FallbackReason::GenerationChanged
    }
}

enum FallbackWriteOutcome {
    Written,
    Failed { overflow: bool },
    Deadline,
}

fn route_fallback(
    inner: &ProducerInner,
    records: Vec<ResidentRecord>,
    deadline: Option<TokioInstant>,
) {
    // A shutdown byte can cancel an older request before the matching frame
    // supplies the parent's time window. Retain the detached records and
    // their honest delivery-unknown reason until that frame arrives; starting
    // fallback under an invented clock would be another observability wait.
    let waiting_for_parent_deadline = {
        let state = inner
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        state.parent_shutdown_observed && state.terminal_deadline.is_none()
    };
    if waiting_for_parent_deadline {
        let mut state = inner
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        for record in records.into_iter().rev() {
            state.queue.push_front(record);
        }
        state.clear_in_flight();
        drop(state);
        inner.notify.notify_one();
        return;
    }
    let mut outcomes = Vec::with_capacity(records.len());
    {
        let mut writer = inner
            .fallback
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        for record in &records {
            if deadline.is_some_and(|deadline| TokioInstant::now() >= deadline) {
                outcomes.push(FallbackWriteOutcome::Deadline);
                continue;
            }
            let reason = record
                .fallback_reason
                .unwrap_or(FallbackReason::CollectorUnavailable);
            let outcome = match writer.as_mut() {
                None => FallbackWriteOutcome::Failed { overflow: false },
                Some(writer) => writer
                    .write(reason, &record.record)
                    .map(|_| FallbackWriteOutcome::Written)
                    .unwrap_or_else(|error| FallbackWriteOutcome::Failed {
                        overflow: error.is_overflow(),
                    }),
            };
            outcomes.push(outcome);
        }
    }
    let mut state = inner
        .state
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    for (record, outcome) in records.iter().zip(outcomes) {
        // Fallback storage subtracts nothing from the loss ledger: a summary
        // routed here returns its snapshot to the pending pool either way.
        if record.is_loss_summary {
            state.return_loss_snapshot();
        }
        match outcome {
            FallbackWriteOutcome::Written => {
                state.fallback_routed = state
                    .fallback_routed
                    .saturating_add(1)
                    .min(proliferate_diagnostics_protocol::v1::limits::MAX_SAFE_INTEGER);
            }
            FallbackWriteOutcome::Failed { overflow } => {
                state.record_loss_with_sequence(
                    if overflow {
                        ProducerFailureClassification::FallbackOverflow
                    } else {
                        ProducerFailureClassification::FallbackWriteFailed
                    },
                    Some(record.record.producer_sequence),
                );
            }
            FallbackWriteOutcome::Deadline => state.record_loss_with_sequence(
                ProducerFailureClassification::ShutdownTimeout,
                Some(record.record.producer_sequence),
            ),
        }
        state.release_record(record);
    }
    state.clear_in_flight();
}

#[cfg(test)]
mod generation_change_tests {
    use super::{deadline_failure, generation_change_reason, DispatchObservation, FallbackReason};

    #[test]
    fn deadline_preserves_pre_dispatch_observation() {
        let dispatch = DispatchObservation::new();
        assert!(!deadline_failure(&dispatch).dispatched);
    }

    #[test]
    fn dispatch_boundary_controls_generation_change_fallback_reason() {
        assert_eq!(
            generation_change_reason(false),
            FallbackReason::GenerationChanged
        );
        assert_eq!(
            generation_change_reason(true),
            FallbackReason::DeliveryUnknown
        );
    }
}
