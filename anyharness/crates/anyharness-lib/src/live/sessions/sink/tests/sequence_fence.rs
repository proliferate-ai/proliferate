//! Event-sequence relinquishment regression coverage.

use super::*;
use anyharness_contract::v1::{SessionEventEnvelope, SessionInfoUpdatePayload};

#[test]
fn sealed_event_sequence_rejects_every_publish_path() {
    let store = seeded_store();
    let (tx, mut rx) = broadcast::channel(32);
    let mut sink = SessionEventSink::new(
        "session-1".to_string(),
        "claude".to_string(),
        PathBuf::from("/tmp/workspace"),
        tx,
        Arc::new(store.clone()),
    );

    sink.seal_event_sequence();
    sink.session_info_update(SessionInfoUpdatePayload {
        title: Some("late actor event".to_string()),
        updated_at: None,
    });
    sink.publish_persisted_events(vec![SessionEventEnvelope {
        session_id: "session-1".to_string(),
        seq: 9,
        timestamp: "2026-08-17T00:00:00Z".to_string(),
        turn_id: None,
        item_id: None,
        event: SessionEvent::SessionInfoUpdate(SessionInfoUpdatePayload {
            title: Some("late observer event".to_string()),
            updated_at: None,
        }),
    }]);
    let strict_error = sink
        .inject_runtime_event(RuntimeInjectedSessionEvent::SessionInfoUpdate {
            title: Some("late runtime event".to_string()),
            updated_at: None,
        })
        .expect_err("strict injection must reject a relinquished sequence");

    assert!(matches!(
        strict_error,
        RuntimeEventInjectionError::PersistenceFailed(_)
    ));
    assert_eq!(sink.next_seq(), 1);
    assert!(!sink.event_mutations_admitted());
    assert!(!sink.inbound_event_mutations_admitted());
    assert!(store
        .list_events("session-1")
        .expect("list events")
        .is_empty());
    assert!(matches!(
        rx.try_recv(),
        Err(broadcast::error::TryRecvError::Empty)
    ));
}
