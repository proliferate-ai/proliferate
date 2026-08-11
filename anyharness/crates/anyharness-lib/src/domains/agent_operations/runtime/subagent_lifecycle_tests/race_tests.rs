use super::*;

#[tokio::test]
async fn close_serializes_behind_an_accepted_message_and_rechecks_afterward() {
    let (operations, state, queue, _, _) = fixture(false);
    queue.hold.store(true, Ordering::SeqCst);
    let send_operations = operations.clone();
    let send = tokio::spawn(async move {
        send_operations
            .send_message(
                &send_operations.authenticated_caller("parent"),
                SendMessageInput {
                    target: target("child"),
                    message: "accepted first".into(),
                },
            )
            .await
    });
    queue.started.notified().await;

    let close_operations = operations.clone();
    let close = tokio::spawn(async move {
        close_operations
            .close_subagent(
                &close_operations.authenticated_caller("parent"),
                &target("child"),
            )
            .await
    });
    tokio::task::yield_now().await;
    assert!(
        !state
            .calls
            .lock()
            .unwrap()
            .iter()
            .any(|call| call == "close"),
        "Close must wait for the target session mutation permit"
    );

    queue.release.notify_one();
    send.await.unwrap().expect("message finishes first");
    close.await.unwrap().expect("Close follows message");
    assert!(state
        .calls
        .lock()
        .unwrap()
        .iter()
        .any(|call| call == "close"));
}

#[tokio::test]
async fn message_after_close_wins_is_rejected_without_queueing() {
    let (operations, state, queue, _, _) = fixture(false);
    operations
        .close_subagent(&caller(&operations, "parent"), &target("child"))
        .await
        .expect("Close wins");

    let send = operations
        .send_message(
            &caller(&operations, "parent"),
            SendMessageInput {
                target: target("child"),
                message: "must not queue".into(),
            },
        )
        .await;
    assert!(matches!(
        send,
        Err(AgentOperationsError::SubagentOpenRequired)
    ));
    assert_eq!(state.calls.lock().unwrap().as_slice(), ["close"]);
    assert!(tokio::time::timeout(
        std::time::Duration::from_millis(20),
        queue.started.notified(),
    )
    .await
    .is_err());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn lifecycle_response_projection_stays_inside_the_target_permit() {
    let (operations, state, _, _, _) = fixture(false);
    state.hold_closed_projection.store(true, Ordering::SeqCst);

    let close_operations = operations.clone();
    let close = tokio::spawn(async move {
        close_operations
            .close_subagent_lifecycle(
                &close_operations.authenticated_caller("parent"),
                &target("child"),
            )
            .await
    });
    state.projection_started.notified().await;

    let open_operations = operations.clone();
    let open = tokio::spawn(async move {
        open_operations
            .open_subagent_lifecycle(
                &open_operations.authenticated_caller("parent"),
                &target("child"),
            )
            .await
    });
    tokio::task::yield_now().await;
    assert_eq!(
        state.calls.lock().unwrap().as_slice(),
        ["close"],
        "Open cannot mutate the relationship while Close projects its response"
    );

    state.projection_release.store(true, Ordering::SeqCst);
    let closed = close.await.unwrap().expect("Close response");
    let closed_relationship = closed.relationship.expect("Close relationship");
    assert!(closed_relationship.subagent_closed_at.is_some());
    assert_eq!(
        closed.agent.status.presentation,
        AgentPresentationStatus::Closed
    );

    let opened = open.await.unwrap().expect("Open response");
    let opened_relationship = opened.relationship.expect("Open relationship");
    assert!(opened_relationship.subagent_closed_at.is_none());
    assert_eq!(state.calls.lock().unwrap().as_slice(), ["close", "open"]);
}
