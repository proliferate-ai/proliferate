#[test]
fn held_session_rejects_interactive_policy_before_live_handle_reuse() {
    let error = super::authorize_session_process_policy_for_hold(
        Some("run-1"),
        "session-1",
        &crate::live::sessions::model::SessionProcessPolicy::Interactive,
    )
    .expect_err("public resume must not reuse a held live handle");
    assert!(matches!(
        error,
        super::SessionProcessPolicyError::WorkflowHeld { ref run_id }
            if run_id == "run-1"
    ));
}

#[test]
fn workflow_policy_must_match_the_exact_held_run_and_session() {
    use crate::live::sessions::model::SessionProcessPolicy;
    use crate::live::workflows::isolation::{
        test_isolation_capability, WorkflowDeliveryIdentity, WorkflowProcessIdentity,
    };

    let delivery = WorkflowDeliveryIdentity::try_new(
        "run-2",
        Some("sha256:1111111111111111111111111111111111111111111111111111111111111111"),
        Some("sha256:2222222222222222222222222222222222222222222222222222222222222222"),
        Some(1),
    )
    .expect("identity");
    let policy = SessionProcessPolicy::Workflow {
        identity: WorkflowProcessIdentity::try_session(
            delivery.clone(),
            "main",
            "session-1",
            "/tmp",
        )
        .expect("process identity"),
        capability: test_isolation_capability(delivery),
    };
    assert!(matches!(
        super::authorize_session_process_policy_for_hold(Some("run-1"), "session-1", &policy,),
        Err(super::SessionProcessPolicyError::WorkflowIdentityMismatch)
    ));
}

#[tokio::test]
async fn session_transition_gate_closes_interactive_resume_hold_race() {
    use std::sync::Arc;

    use crate::live::sessions::model::SessionProcessPolicy;
    use crate::live::workflows::WorkflowOwnedSessions;

    let owned = Arc::new(WorkflowOwnedSessions::new());
    // Simulate public resume holding the transition from its authorization
    // check through handle reuse/process launch.
    let interactive_transition = owned.lock_process_transition("session-1").await;
    let (attempted_tx, attempted_rx) = tokio::sync::oneshot::channel();
    let workflow = {
        let owned = owned.clone();
        tokio::spawn(async move {
            attempted_tx.send(()).expect("signal workflow attempt");
            let transition = owned.lock_process_transition("session-1").await;
            owned.try_acquire(&transition, "session-1", "run-1")
        })
    };
    attempted_rx.await.expect("workflow attempted transition");

    assert!(super::authorize_session_process_policy_for_hold(
        owned.held_run("session-1").as_deref(),
        "session-1",
        &SessionProcessPolicy::Interactive,
    )
    .is_ok());
    drop(interactive_transition);
    workflow
        .await
        .expect("workflow transition task")
        .expect("workflow acquires after interactive launch boundary");

    // A later public resume cannot pass between workflow hold acquisition and
    // workflow relaunch because both use this same per-session transition.
    let _interactive_retry = owned.lock_process_transition("session-1").await;
    assert!(matches!(
        super::authorize_session_process_policy_for_hold(
            owned.held_run("session-1").as_deref(),
            "session-1",
            &SessionProcessPolicy::Interactive,
        ),
        Err(super::SessionProcessPolicyError::WorkflowHeld { .. })
    ));
}
