use super::*;

#[tokio::test]
async fn interrupt_uses_cancel_owner_without_resuming_and_closed_output_remains_readable() {
    let fixture = fixture(true);
    let interrupted = fixture
        .operations
        .interrupt_agent(&caller(&fixture.operations, "parent"), &target("peer"))
        .await
        .expect("interrupt");
    assert_eq!(interrupted.identity.session_id, "peer");
    assert_eq!(
        fixture.mutations.calls.lock().unwrap().as_slice(),
        ["interrupt:peer"]
    );

    let page = fixture
        .operations
        .get_task_output(
            &caller(&fixture.operations, "parent"),
            &target("child"),
            None,
            10,
        )
        .expect("owned relationship-Closed output remains readable");
    assert_eq!(page.messages[0].text, "done");
    assert!(matches!(
        fixture
            .operations
            .interrupt_agent(&caller(&fixture.operations, "parent"), &target("child"))
            .await,
        Err(AgentOperationsError::SubagentOpenRequired)
    ));
}
