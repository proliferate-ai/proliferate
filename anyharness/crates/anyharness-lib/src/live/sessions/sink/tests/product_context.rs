use std::path::PathBuf;
use std::sync::Arc;

use anyharness_contract::v1::SessionEvent;
use tokio::sync::broadcast;

use super::support::{empty_store, seeded_store};
use crate::domains::sessions::prompt::{
    AGENT_PRODUCT_CONTEXT_UNAVAILABLE_CODE, AGENT_PRODUCT_CONTEXT_UNAVAILABLE_DETAIL,
};
use crate::live::sessions::sink::SessionEventSink;

#[test]
fn queued_failure_is_one_strict_bounded_incident_receipt() {
    let store = seeded_store();
    let (tx, mut rx) = broadcast::channel(32);
    let mut sink = SessionEventSink::new(
        "session-1".to_string(),
        "claude".to_string(),
        PathBuf::from("/tmp/workspace"),
        tx,
        Arc::new(store.clone()),
    );
    let incident_id = uuid::Uuid::new_v4().to_string();

    let envelope = sink
        .product_context_unavailable(incident_id.clone())
        .expect("persist incident receipt");

    assert_eq!(envelope.turn_id, None);
    assert_eq!(envelope.item_id.as_deref(), Some(incident_id.as_str()));
    let SessionEvent::Error(error) = envelope.event else {
        panic!("expected error event");
    };
    assert_eq!(
        error.code.as_deref(),
        Some(AGENT_PRODUCT_CONTEXT_UNAVAILABLE_CODE)
    );
    assert_eq!(error.message, AGENT_PRODUCT_CONTEXT_UNAVAILABLE_DETAIL);
    assert!(error.details.is_none());
    let events = store.list_events("session-1").expect("persisted events");
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].event_type, "error");
    assert_eq!(events[0].item_id.as_deref(), Some(incident_id.as_str()));
    assert_eq!(rx.try_recv().expect("broadcast receipt").seq, envelope.seq);
    assert!(matches!(
        rx.try_recv(),
        Err(broadcast::error::TryRecvError::Empty)
    ));
}

#[test]
fn receipt_is_not_broadcast_when_persistence_fails() {
    let store = empty_store();
    let (tx, mut rx) = broadcast::channel(32);
    let mut sink = SessionEventSink::new(
        "missing-session".to_string(),
        "claude".to_string(),
        PathBuf::from("/tmp/workspace"),
        tx,
        Arc::new(store),
    );

    assert!(sink
        .product_context_unavailable(uuid::Uuid::new_v4().to_string())
        .is_err());
    assert_eq!(sink.next_seq(), 1);
    assert!(matches!(
        rx.try_recv(),
        Err(broadcast::error::TryRecvError::Empty)
    ));
}
