use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};

use crate::domains::sessions::runtime_event::RuntimeInjectedSessionEvent;
use crate::live::sessions::driver::inbound::InboundDoor;
use crate::live::sessions::model::{
    PermissionAdvice, PermissionAdvisor, PermissionQuestionView, SessionObserverContext,
};

struct RecordingParkAdvisor {
    calls: Arc<AtomicUsize>,
}

impl PermissionAdvisor for RecordingParkAdvisor {
    fn advise(
        &self,
        _ctx: &SessionObserverContext,
        _question: &PermissionQuestionView<'_>,
    ) -> PermissionAdvice {
        self.calls.fetch_add(1, Ordering::SeqCst);
        PermissionAdvice::Park {
            pending_interaction: None,
        }
    }
}

#[tokio::test]
async fn finalize_error_exit_cancels_pending_permission_and_marks_session_errored() {
    let (store, event_sink, interaction_broker, handle) =
        actor_exit_test_context(Some(pending_interaction_summary())).await;

    finalize_established_actor_exit(
        &handle,
        &event_sink,
        &interaction_broker,
        &store,
        "session-1",
        ActorExitDisposition::Error {
            message: "server shut down unexpectedly".to_string(),
            code: None,
        },
    )
    .await;

    let events = store.list_events("session-1").expect("list events");
    let event_types = events
        .iter()
        .map(|event| event.event_type.as_str())
        .collect::<Vec<_>>();
    assert_eq!(
        event_types,
        vec!["interaction_resolved", "error", "session_ended"]
    );

    let payload: serde_json::Value =
        serde_json::from_str(&events[0].payload_json).expect("deserialize interaction resolved");
    assert_eq!(payload["requestId"], "perm-1");
    assert_eq!(payload["outcome"]["outcome"], "cancelled");

    let snapshot = handle.execution_snapshot().await;
    assert_eq!(snapshot.phase, SessionExecutionPhase::Errored);
    assert!(snapshot.pending_interactions.is_empty());

    let record = store
        .find_by_id("session-1")
        .expect("fetch session")
        .expect("session exists");
    assert_eq!(record.status, "errored");
}

#[tokio::test]
async fn finalize_close_exit_cancels_pending_permission_and_emits_closed_event() {
    let (store, event_sink, interaction_broker, handle) =
        actor_exit_test_context(Some(pending_interaction_summary())).await;

    finalize_established_actor_exit(
        &handle,
        &event_sink,
        &interaction_broker,
        &store,
        "session-1",
        ActorExitDisposition::Close,
    )
    .await;

    let events = store.list_events("session-1").expect("list events");
    let event_types = events
        .iter()
        .map(|event| event.event_type.as_str())
        .collect::<Vec<_>>();
    assert_eq!(event_types, vec!["interaction_resolved", "session_ended"]);

    let snapshot = handle.execution_snapshot().await;
    assert_eq!(snapshot.phase, SessionExecutionPhase::Closed);
    assert!(snapshot.pending_interactions.is_empty());

    let record = store
        .find_by_id("session-1")
        .expect("fetch session")
        .expect("session exists");
    assert_eq!(record.status, "idle");
}

#[tokio::test]
async fn finalize_dismiss_exit_cancels_pending_permission_without_terminal_event() {
    let (store, event_sink, interaction_broker, handle) =
        actor_exit_test_context(Some(pending_interaction_summary())).await;

    finalize_established_actor_exit(
        &handle,
        &event_sink,
        &interaction_broker,
        &store,
        "session-1",
        ActorExitDisposition::Dismiss,
    )
    .await;

    let events = store.list_events("session-1").expect("list events");
    let event_types = events
        .iter()
        .map(|event| event.event_type.as_str())
        .collect::<Vec<_>>();
    assert_eq!(event_types, vec!["interaction_resolved"]);

    let snapshot = handle.execution_snapshot().await;
    assert_eq!(snapshot.phase, SessionExecutionPhase::Idle);
    assert!(snapshot.pending_interactions.is_empty());
}

#[tokio::test]
async fn finalize_unload_exit_is_nonterminal_and_preserves_native_identity() {
    let (store, event_sink, interaction_broker, handle) =
        actor_exit_test_context(Some(pending_interaction_summary())).await;

    finalize_established_actor_exit(
        &handle,
        &event_sink,
        &interaction_broker,
        &store,
        "session-1",
        ActorExitDisposition::Unload,
    )
    .await;

    let events = store.list_events("session-1").expect("list events");
    let event_types = events
        .iter()
        .map(|event| event.event_type.as_str())
        .collect::<Vec<_>>();
    assert_eq!(event_types, vec!["interaction_resolved"]);

    let snapshot = handle.execution_snapshot().await;
    assert_eq!(snapshot.phase, SessionExecutionPhase::Idle);
    assert!(snapshot.pending_interactions.is_empty());
    let record = store
        .find_by_id("session-1")
        .expect("fetch session")
        .expect("session exists");
    assert_eq!(record.status, "idle");
    assert_eq!(record.native_session_id.as_deref(), Some("native-1"));
    assert!(record.closed_at.is_none());
    assert!(record.dismissed_at.is_none());
}

#[tokio::test]
async fn finalize_exit_without_pending_interaction_skips_interaction_resolved_event() {
    let (store, event_sink, interaction_broker, handle) = actor_exit_test_context(None).await;

    finalize_established_actor_exit(
        &handle,
        &event_sink,
        &interaction_broker,
        &store,
        "session-1",
        ActorExitDisposition::Error {
            message: "server shut down unexpectedly".to_string(),
            code: None,
        },
    )
    .await;

    let event_types = store
        .list_events("session-1")
        .expect("list events")
        .into_iter()
        .map(|event| event.event_type)
        .collect::<Vec<_>>();
    assert_eq!(event_types, vec!["error", "session_ended"]);
}

#[tokio::test]
async fn cleanup_resolves_pending_permission_immediately_and_finalizes_once() {
    let (store, event_sink, interaction_broker, handle) =
        actor_exit_test_context(Some(pending_interaction_summary())).await;

    resolve_pending_interactions(
        &handle,
        &event_sink,
        &interaction_broker,
        "session-1",
        Resolution::Cancelled,
    )
    .await;

    let events = store.list_events("session-1").expect("list events");
    let event_types = events
        .iter()
        .map(|event| event.event_type.as_str())
        .collect::<Vec<_>>();
    assert_eq!(event_types, vec!["interaction_resolved"]);

    let snapshot = handle.execution_snapshot().await;
    assert_eq!(snapshot.phase, SessionExecutionPhase::Running);
    assert!(snapshot.pending_interactions.is_empty());

    finalize_established_actor_exit(
        &handle,
        &event_sink,
        &interaction_broker,
        &store,
        "session-1",
        ActorExitDisposition::Close,
    )
    .await;

    let event_types = store
        .list_events("session-1")
        .expect("list events")
        .into_iter()
        .map(|event| event.event_type)
        .collect::<Vec<_>>();
    assert_eq!(event_types, vec!["interaction_resolved", "session_ended"]);
}

#[tokio::test]
async fn cleanup_cancels_registered_permission_not_yet_in_summary() {
    let (store, event_sink, interaction_broker, handle) = actor_exit_test_context(None).await;
    let wait = interaction_broker
        .register_permission(
            "session-1",
            "hidden-perm",
            &[acp::schema::PermissionOption::new(
                acp::schema::PermissionOptionId::new("allow"),
                "Allow",
                acp::schema::PermissionOptionKind::AllowOnce,
            )],
        )
        .await;

    resolve_pending_interactions(
        &handle,
        &event_sink,
        &interaction_broker,
        "session-1",
        Resolution::Cancelled,
    )
    .await;

    assert_eq!(wait.wait().await, PermissionOutcome::Cancelled);

    let events = store.list_events("session-1").expect("list events");
    let event_types = events
        .iter()
        .map(|event| event.event_type.as_str())
        .collect::<Vec<_>>();
    assert_eq!(event_types, vec!["interaction_resolved"]);

    let payload: serde_json::Value =
        serde_json::from_str(&events[0].payload_json).expect("deserialize interaction resolved");
    assert_eq!(payload["requestId"], "hidden-perm");
    assert_eq!(payload["outcome"]["outcome"], "cancelled");

    let snapshot = handle.execution_snapshot().await;
    assert!(snapshot.pending_interactions.is_empty());
}

#[tokio::test]
async fn finalize_exit_fences_inbound_writers_before_sequence_handoff() {
    let (store, event_sink, interaction_broker, handle) = actor_exit_test_context(None).await;
    // A real permission request owns the sink while it registers with the
    // broker and then waits on this execution lock to publish its summary.
    let execution_guard = handle.execution.write().await;
    let advisor_calls = Arc::new(AtomicUsize::new(0));
    let (notification_tx, _notification_rx) = mpsc::unbounded_channel();
    let inbound = Arc::new(InboundDoor::new(
        "session-1".to_string(),
        notification_tx,
        interaction_broker.clone(),
        event_sink.clone(),
        handle.clone(),
        "workspace-1".to_string(),
        "claude".to_string(),
        Some(Arc::new(RecordingParkAdvisor {
            calls: advisor_calls.clone(),
        })),
    ));
    let request_inbound = inbound.clone();
    let parked_request = tokio::spawn(async move {
        request_inbound
            .handle_request_permission(acp::schema::RequestPermissionRequest::new(
                "native-1",
                acp::schema::ToolCallUpdate::new(
                    "tool-active",
                    acp::schema::ToolCallUpdateFields::new().title("Active permission"),
                ),
                vec![acp::schema::PermissionOption::new(
                    acp::schema::PermissionOptionId::new("allow-active"),
                    "Allow active",
                    acp::schema::PermissionOptionKind::AllowOnce,
                )],
            ))
            .await
    });
    tokio::time::timeout(Duration::from_secs(1), async {
        while interaction_broker.pending_count_for_test("session-1").await != 1 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("permission did not register with broker");
    assert_eq!(advisor_calls.load(Ordering::SeqCst), 1);
    assert!(!parked_request.is_finished());

    let (finalizer_started_tx, finalizer_started_rx) = tokio::sync::oneshot::channel();
    let finalizer_store = store.clone();
    let finalizer_sink = event_sink.clone();
    let finalizer_broker = interaction_broker.clone();
    let finalizer_handle = handle.clone();
    let finalizer = tokio::spawn(async move {
        let _ = finalizer_started_tx.send(());
        finalize_established_actor_exit(
            &finalizer_handle,
            &finalizer_sink,
            &finalizer_broker,
            &finalizer_store,
            "session-1",
            ActorExitDisposition::Close,
        )
        .await;
        finalizer_sink.lock().await.seal_event_sequence();
        finalizer_handle.relinquish_event_sequence();
    });

    finalizer_started_rx.await.expect("finalizer started");
    tokio::task::yield_now().await;
    tokio::select! {
        _ = handle.wait_for_event_sequence_relinquishment() => {
            panic!("sequence handoff passed the registered inbound writer");
        }
        _ = tokio::task::yield_now() => {}
    }

    drop(execution_guard);
    let response = tokio::time::timeout(Duration::from_secs(1), parked_request)
        .await
        .expect("permission response timeout")
        .expect("permission task")
        .expect("permission response");
    assert!(matches!(
        response.outcome,
        acp::schema::RequestPermissionOutcome::Cancelled
    ));
    tokio::time::timeout(Duration::from_secs(1), finalizer)
        .await
        .expect("finalizer timeout")
        .expect("finalizer task");
    handle.wait_for_event_sequence_relinquishment().await;

    let late_request = inbound
        .handle_request_permission(acp::schema::RequestPermissionRequest::new(
            "native-1",
            acp::schema::ToolCallUpdate::new(
                "tool-late",
                acp::schema::ToolCallUpdateFields::new().title("Late permission"),
            ),
            vec![acp::schema::PermissionOption::new(
                acp::schema::PermissionOptionId::new("allow-late"),
                "Allow late",
                acp::schema::PermissionOptionKind::AllowOnce,
            )],
        ))
        .await;
    assert!(late_request.is_err());
    assert_eq!(advisor_calls.load(Ordering::SeqCst), 1);
    assert!(interaction_broker
        .cancel_session(
            "session-1",
            crate::live::sessions::rendezvous::broker::InteractionCancelOutcome::Cancelled,
        )
        .await
        .is_empty());

    let events_before_pin = store.list_events("session-1").expect("list exit events");
    assert_eq!(
        events_before_pin
            .iter()
            .map(|event| (event.seq, event.event_type.as_str()))
            .collect::<Vec<_>>(),
        vec![
            (1, "interaction_requested"),
            (2, "interaction_resolved"),
            (3, "session_ended"),
        ]
    );
    let pin = store
        .append_event_with_next_seq(
            "session-1",
            RuntimeInjectedSessionEvent::WorkspacePinIntent {
                request_id: "pin-request-1".to_string(),
                runtime_id: "runtime-1".to_string(),
                source_session_id: "session-1".to_string(),
                workspace_id: "workspace-1".to_string(),
                pinned: true,
            }
            .into_session_event(),
            false,
        )
        .expect("append offline pin intent");
    assert_eq!(pin.seq, 4);
}
