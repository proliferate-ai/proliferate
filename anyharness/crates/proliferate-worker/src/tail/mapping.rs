use crate::{
    anyharness_client::events::SessionEventEnvelope,
    cloud_client::events::{EventBatchRequest, WorkerSessionEventEnvelope},
    store::TailCursor,
};

pub(crate) fn event_batch_request(
    cursor: &TailCursor,
    events: Vec<SessionEventEnvelope>,
) -> EventBatchRequest {
    EventBatchRequest {
        events: events
            .into_iter()
            .map(|event| worker_event(cursor, event))
            .collect(),
    }
}

fn worker_event(cursor: &TailCursor, event: SessionEventEnvelope) -> WorkerSessionEventEnvelope {
    WorkerSessionEventEnvelope {
        workspace_id: Some(cursor.anyharness_workspace_id.clone()),
        session_id: event.session_id,
        seq: event.seq,
        timestamp: event.timestamp,
        turn_id: event.turn_id,
        item_id: event.item_id,
        event: event.event,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::event_batch_request;
    use crate::{anyharness_client::events::SessionEventEnvelope, store::TailCursor};

    #[test]
    fn worker_event_uses_tail_cursor_workspace() {
        let cursor = tail_cursor("session-1", "workspace-1", 4);
        let event = SessionEventEnvelope {
            session_id: "session-1".to_string(),
            seq: 5,
            timestamp: None,
            turn_id: None,
            item_id: None,
            event: json!({ "type": "session_updated" }),
        };

        let request = event_batch_request(&cursor, vec![event]);
        assert_eq!(request.events.len(), 1);
        assert_eq!(
            request.events[0].workspace_id.as_deref(),
            Some("workspace-1")
        );
        assert_eq!(request.events[0].session_id, "session-1");
        assert_eq!(request.events[0].seq, 5);
    }

    fn tail_cursor(session_id: &str, workspace_id: &str, last_uploaded_seq: i64) -> TailCursor {
        TailCursor {
            exposure_id: "exposure-1".to_string(),
            session_projection_id: "projection-1".to_string(),
            anyharness_workspace_id: workspace_id.to_string(),
            anyharness_session_id: session_id.to_string(),
            projection_level: "live".to_string(),
            commandable: true,
            last_uploaded_seq,
            last_ack_seq: last_uploaded_seq,
        }
    }
}
