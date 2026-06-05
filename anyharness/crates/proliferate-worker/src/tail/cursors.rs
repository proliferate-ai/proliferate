use crate::{
    anyharness_client::events::SessionEventEnvelope,
    cloud_client::events::{EventSessionAck, ProjectionGapRequest},
    error::WorkerError,
    store::{TailCursor, WorkerStore},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct EventSequenceGap {
    pub(crate) expected_seq: i64,
    pub(crate) first_observed_seq: i64,
}

pub(crate) fn first_sequence_gap(
    last_uploaded_seq: i64,
    events: &[SessionEventEnvelope],
) -> Option<EventSequenceGap> {
    let mut seqs = events
        .iter()
        .map(|event| event.seq)
        .filter(|seq| *seq > last_uploaded_seq)
        .collect::<Vec<_>>();
    seqs.sort_unstable();
    seqs.dedup();
    let mut expected_seq = last_uploaded_seq + 1;
    for seq in seqs {
        if seq > expected_seq {
            return Some(EventSequenceGap {
                expected_seq,
                first_observed_seq: seq,
            });
        }
        if seq == expected_seq {
            expected_seq += 1;
        }
    }
    None
}

pub(crate) fn projection_gap_request(
    cursor: &TailCursor,
    gap: EventSequenceGap,
) -> ProjectionGapRequest {
    ProjectionGapRequest {
        exposure_id: cursor.exposure_id.clone(),
        session_projection_id: cursor.session_projection_id.clone(),
        session_id: cursor.anyharness_session_id.clone(),
        expected_seq: gap.expected_seq,
        first_observed_seq: gap.first_observed_seq,
        last_uploaded_seq: cursor.last_uploaded_seq,
    }
}

pub(crate) fn record_sequence_gap(
    store: &WorkerStore,
    cursor: &TailCursor,
    gap: EventSequenceGap,
) -> Result<(), WorkerError> {
    store.record_tail_cursor_gap(
        &cursor.session_projection_id,
        gap.expected_seq,
        gap.first_observed_seq,
    )
}

pub(crate) fn apply_session_acks(
    store: &WorkerStore,
    session_acks: Vec<EventSessionAck>,
) -> Result<(), WorkerError> {
    for ack in session_acks {
        store.advance_tail_cursor_ack(&ack.session_id, ack.last_contiguous_seq)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{first_sequence_gap, EventSequenceGap};
    use crate::anyharness_client::events::SessionEventEnvelope;

    #[test]
    fn detects_first_sequence_gap() {
        let events = vec![
            event("session-1", 5),
            event("session-1", 7),
            event("session-1", 8),
        ];
        assert_eq!(
            first_sequence_gap(4, &events),
            Some(EventSequenceGap {
                expected_seq: 6,
                first_observed_seq: 7,
            })
        );
    }

    #[test]
    fn contiguous_sequences_have_no_gap() {
        let events = vec![
            event("session-1", 5),
            event("session-1", 6),
            event("session-1", 6),
            event("session-1", 7),
        ];
        assert_eq!(first_sequence_gap(4, &events), None);
    }

    fn event(session_id: &str, seq: i64) -> SessionEventEnvelope {
        SessionEventEnvelope {
            session_id: session_id.to_string(),
            seq,
            timestamp: None,
            turn_id: None,
            item_id: None,
            event: json!({ "type": "session_updated" }),
        }
    }
}
