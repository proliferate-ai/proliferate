use proliferate_diagnostics_protocol::v1::types::ProducerRecordV1;

use super::{
    ProducerState, QueuedRecord, PRODUCER_LIFECYCLE_RESERVED_BYTES, PRODUCER_QUEUE_MAX_BYTES,
    PRODUCER_QUEUE_MAX_RECORDS,
};

pub(super) fn fits(state: &ProducerState, bytes: usize) -> bool {
    state.queued.len().saturating_add(state.in_flight_records) < PRODUCER_QUEUE_MAX_RECORDS
        && state
            .queued_bytes
            .saturating_add(state.in_flight_bytes)
            .saturating_add(bytes)
            <= PRODUCER_QUEUE_MAX_BYTES
}

pub(super) fn finish_in_flight(state: &mut ProducerState, batch: &[QueuedRecord]) {
    state.in_flight_records = state.in_flight_records.saturating_sub(batch.len());
    for item in batch {
        state.in_flight_bytes = state.in_flight_bytes.saturating_sub(item.bytes);
        if !item.lifecycle {
            state.in_flight_detail_bytes = state.in_flight_detail_bytes.saturating_sub(item.bytes);
        }
    }
}

pub(super) fn push_back(
    state: &mut ProducerState,
    record: ProducerRecordV1,
    bytes: usize,
    lifecycle: bool,
) {
    state.queued_bytes = state.queued_bytes.saturating_add(bytes);
    if !lifecycle {
        state.detail_bytes = state.detail_bytes.saturating_add(bytes);
    }
    state.queued.push_back(QueuedRecord {
        record,
        bytes,
        lifecycle,
        attempts: 0,
    });
}

/// Reinsert a failed item without ever exceeding the frozen queue bounds.
/// Returns the exact number of records lost, including detail evicted to make
/// room for a lifecycle record.
pub(super) fn requeue_front_bounded(state: &mut ProducerState, item: QueuedRecord) -> u64 {
    let mut lost = 0_u64;
    if item.lifecycle {
        while !fits(state, item.bytes) && drop_oldest_detail(state) {
            lost = lost.saturating_add(1);
        }
        if !fits(state, item.bytes) {
            state.dropped_lifecycle = state.dropped_lifecycle.saturating_add(1);
            return lost.saturating_add(1);
        }
    } else {
        let detail_limit = PRODUCER_QUEUE_MAX_BYTES - PRODUCER_LIFECYCLE_RESERVED_BYTES;
        while (state
            .detail_bytes
            .saturating_add(state.in_flight_detail_bytes)
            .saturating_add(item.bytes)
            > detail_limit
            || !fits(state, item.bytes))
            && drop_oldest_detail(state)
        {
            lost = lost.saturating_add(1);
        }
        if state
            .detail_bytes
            .saturating_add(state.in_flight_detail_bytes)
            .saturating_add(item.bytes)
            > detail_limit
            || !fits(state, item.bytes)
        {
            state.dropped_detail = state.dropped_detail.saturating_add(1);
            return lost.saturating_add(1);
        }
    }
    state.queued_bytes = state.queued_bytes.saturating_add(item.bytes);
    if !item.lifecycle {
        state.detail_bytes = state.detail_bytes.saturating_add(item.bytes);
    }
    state.queued.push_front(item);
    lost
}

pub(super) fn drop_oldest_detail(state: &mut ProducerState) -> bool {
    let Some(index) = state.queued.iter().position(|item| !item.lifecycle) else {
        return false;
    };
    if let Some(item) = state.queued.remove(index) {
        state.queued_bytes = state.queued_bytes.saturating_sub(item.bytes);
        state.detail_bytes = state.detail_bytes.saturating_sub(item.bytes);
        state.dropped_detail = state.dropped_detail.saturating_add(1);
        true
    } else {
        false
    }
}

pub(super) fn truncate_utf8(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_string();
    }
    let mut end = max_bytes;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].to_string()
}
