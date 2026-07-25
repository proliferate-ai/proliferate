use super::service_tests::test_service;

#[test]
fn credential_bearing_gateway_plan_is_rejected_without_sqlite_side_effects() {
    let service = test_service();
    let plan = r#"{
        "run_id": "run-private-canary",
        "plan_hash": "sha256:1111111111111111111111111111111111111111111111111111111111111111",
        "binding_hash": "sha256:2222222222222222222222222222222222222222222222222222222222222222",
        "execution_generation": 1,
        "sessions": {"main": {"harness": "claude", "session_binding": "fresh"}},
        "gateway": {
            "integrations": ["slack"],
            "authorization": "Bearer WORKFLOW_PRIVATE_MATERIAL_CANARY"
        },
        "steps": [{"kind": "agent.prompt", "prompt": "hi"}]
    }"#;
    let error = service
        .create_run_idempotent(plan, "workspace-1")
        .expect_err("private gateway material must reject");
    assert!(matches!(
        error,
        super::service::WorkflowServiceError::InvalidPlan(super::plan::PlanError::PrivateMaterial(
            "gateway"
        ))
    ));
    assert!(service
        .get_run("run-private-canary")
        .expect("query run")
        .is_none());
}
