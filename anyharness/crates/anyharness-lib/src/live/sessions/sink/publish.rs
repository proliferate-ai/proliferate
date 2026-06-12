use tokio::sync::broadcast;

use super::SessionEventSink;
use crate::domains::sessions::model::SessionEventRecord;
use crate::domains::sessions::runtime_event::RuntimeEventInjectionError;
use crate::domains::sessions::store::SessionStore;
use crate::observability::transcript_phase::record_transcript_phase_event;
use anyharness_contract::v1::{SessionEvent, SessionEventEnvelope};

impl SessionEventSink {
    pub(super) fn emit_with_ids(
        &mut self,
        event: SessionEvent,
        turn_id: Option<String>,
        item_id: Option<String>,
    ) {
        let envelope = publish_session_event(
            &self.session_id,
            &mut self.next_seq,
            &self.event_tx,
            &self.store,
            event,
            turn_id,
            item_id,
        );
        record_transcript_phase_event(&mut self.transcript_phase_debug, &envelope);
    }
}

pub(crate) fn publish_session_event(
    session_id: &str,
    next_seq: &mut i64,
    event_tx: &broadcast::Sender<SessionEventEnvelope>,
    store: &SessionStore,
    event: SessionEvent,
    turn_id: Option<String>,
    item_id: Option<String>,
) -> SessionEventEnvelope {
    let seq = *next_seq;
    *next_seq += 1;
    let timestamp = chrono::Utc::now().to_rfc3339();
    let event_type = event.event_type().to_string();
    tracing::info!(
        session_id = %session_id,
        seq = seq,
        event_type = %event_type,
        "event_sink: emitting event"
    );

    let envelope = SessionEventEnvelope {
        session_id: session_id.to_string(),
        seq,
        timestamp: timestamp.clone(),
        turn_id: turn_id.clone(),
        item_id: item_id.clone(),
        event,
    };

    let payload_json = serde_json::to_string(&envelope.event).unwrap_or_default();
    tracing::debug!(session_id = %session_id, seq = seq, "event_sink: event persisted");
    let record = SessionEventRecord {
        id: 0,
        session_id: session_id.to_string(),
        seq,
        timestamp,
        event_type,
        turn_id,
        item_id,
        payload_json,
    };
    if let Err(e) = store.append_event(&record) {
        tracing::warn!(error = %e, "failed to persist session event");
    }

    let _ = event_tx.send(envelope.clone());
    envelope
}

pub(super) fn publish_session_event_strict(
    session_id: &str,
    next_seq: &mut i64,
    event_tx: &broadcast::Sender<SessionEventEnvelope>,
    store: &SessionStore,
    event: SessionEvent,
    turn_id: Option<String>,
    item_id: Option<String>,
    touch_session_activity: bool,
) -> Result<SessionEventEnvelope, RuntimeEventInjectionError> {
    let seq = *next_seq;
    let timestamp = chrono::Utc::now().to_rfc3339();
    let event_type = event.event_type().to_string();
    let envelope = SessionEventEnvelope {
        session_id: session_id.to_string(),
        seq,
        timestamp: timestamp.clone(),
        turn_id: turn_id.clone(),
        item_id: item_id.clone(),
        event,
    };
    let payload_json = serde_json::to_string(&envelope.event)
        .map_err(|error| RuntimeEventInjectionError::PersistenceFailed(error.to_string()))?;
    let record = SessionEventRecord {
        id: 0,
        session_id: session_id.to_string(),
        seq,
        timestamp,
        event_type,
        turn_id,
        item_id,
        payload_json,
    };
    if touch_session_activity {
        store
            .append_event_and_touch_session(&record)
            .map_err(|error| RuntimeEventInjectionError::PersistenceFailed(error.to_string()))?;
    } else {
        store
            .append_event(&record)
            .map_err(|error| RuntimeEventInjectionError::PersistenceFailed(error.to_string()))?;
    }
    *next_seq += 1;
    let _ = event_tx.send(envelope.clone());
    Ok(envelope)
}
