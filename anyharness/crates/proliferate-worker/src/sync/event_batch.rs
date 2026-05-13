use uuid::Uuid;

use crate::cloud_client::events::{CloudEvent, EventBatch};

pub const MAX_EVENTS_PER_BATCH: usize = 100;
pub const MAX_BYTES_PER_BATCH: usize = 512 * 1024;

pub fn build_batches(
    target_id: &str,
    session_id: &str,
    events: Vec<CloudEvent>,
) -> Vec<EventBatch> {
    let mut batches = Vec::new();
    let mut current = Vec::new();
    let mut current_bytes = 0usize;

    for event in events {
        let event_bytes = event.payload_size_bytes;
        if !current.is_empty()
            && (current.len() >= MAX_EVENTS_PER_BATCH
                || current_bytes.saturating_add(event_bytes) > MAX_BYTES_PER_BATCH)
        {
            batches.push(finish_batch(
                target_id,
                session_id,
                std::mem::take(&mut current),
            ));
            current_bytes = 0;
        }
        current_bytes = current_bytes.saturating_add(event_bytes);
        current.push(event);
    }

    if !current.is_empty() {
        batches.push(finish_batch(target_id, session_id, current));
    }

    batches
}

fn finish_batch(target_id: &str, session_id: &str, events: Vec<CloudEvent>) -> EventBatch {
    let seq_start = events
        .first()
        .map(|event| event.anyharness_sequence)
        .unwrap_or(0);
    let seq_end = events
        .last()
        .map(|event| event.anyharness_sequence)
        .unwrap_or(0);
    EventBatch {
        batch_id: Uuid::new_v4().to_string(),
        target_id: target_id.to_string(),
        session_id: session_id.to_string(),
        seq_start,
        seq_end,
        events,
    }
}
