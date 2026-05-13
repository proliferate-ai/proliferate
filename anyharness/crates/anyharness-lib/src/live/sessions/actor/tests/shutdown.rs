use super::*;

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
        InteractionResolution::Cancelled,
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
            &[acp::PermissionOption::new(
                acp::PermissionOptionId::new("allow"),
                "Allow",
                acp::PermissionOptionKind::AllowOnce,
            )],
        )
        .await;

    resolve_pending_interactions(
        &handle,
        &event_sink,
        &interaction_broker,
        "session-1",
        InteractionResolution::Cancelled,
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
