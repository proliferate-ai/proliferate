//! Tests for [`super::agent_turn`], split into a sibling file for line budget
//! (matching the repo's `*_tests.rs` convention, e.g.
//! `domains/workflows/service_tests.rs`).

use crate::domains::workflows::engine::StepOutcome;
use anyharness_contract::v1::{
    ContentPart, ItemCompletedEvent, SessionEvent, TranscriptItemKind, TranscriptItemPayload,
    TranscriptItemStatus,
};

use super::agent_turn::{
    finalize_prepared_session_rollback, validate_bind_target, PreparedSessionRollbackEvidence,
};
use super::exec_policy::WorkflowOwnedSessions;
use super::gateway::{workflow_gateway_server, WorkflowGatewaySessions};
use super::isolation::TrustedLocalGatewayBinding;
use super::turn::collect_tool_names;

fn outcome_code(outcome: &StepOutcome) -> &str {
    match outcome {
        StepOutcome::Failed { code, .. } => code,
        _ => panic!("expected Failed outcome"),
    }
}

#[test]
fn bind_target_ok_when_harness_matches_and_not_held() {
    assert!(validate_bind_target("sess-1", "claude", "claude").is_ok());
}

#[test]
fn bind_target_harness_mismatch_is_hard_plan_error() {
    let err = validate_bind_target("sess-1", "codex", "claude")
        .expect_err("harness mismatch must be a hard error");
    assert_eq!(outcome_code(&err), "plan_malformed");
}

async fn prepared_rollback_fence() -> (
    WorkflowOwnedSessions,
    WorkflowGatewaySessions,
    super::exec_policy::SessionProcessTransitionGuard,
) {
    let owned = WorkflowOwnedSessions::new();
    let transition = owned.lock_process_transition("session-1").await;
    owned
        .try_acquire(&transition, "session-1", "run-1")
        .expect("acquire rollback fence");
    let gateways = WorkflowGatewaySessions::new();
    let binding = TrustedLocalGatewayBinding::try_new(
        "http://127.0.0.1:43891/mcp",
        "session-1",
        7,
        11,
        "rollback-test-capability",
    )
    .expect("binding");
    gateways.set("session-1", workflow_gateway_server(&binding));
    (owned, gateways, transition)
}

#[tokio::test]
async fn rollback_close_timeout_retains_binding_and_ownership_fence() {
    let (owned, gateways, transition) = prepared_rollback_fence().await;
    let result = finalize_prepared_session_rollback(
        &owned,
        &gateways,
        "session-1",
        "run-1",
        PreparedSessionRollbackEvidence {
            broker_revoked: true,
            actor_quiesced: false,
            durable_state_safe: false,
        },
        true,
        &transition,
    );
    assert!(result.is_err());
    assert_eq!(owned.held_run("session-1").as_deref(), Some("run-1"));
    assert!(gateways.get("session-1").is_some());
}

#[tokio::test]
async fn rollback_durable_failure_removes_prepared_binding_but_retains_ownership_fence() {
    let (owned, gateways, transition) = prepared_rollback_fence().await;
    let result = finalize_prepared_session_rollback(
        &owned,
        &gateways,
        "session-1",
        "run-1",
        PreparedSessionRollbackEvidence {
            broker_revoked: true,
            actor_quiesced: true,
            durable_state_safe: false,
        },
        true,
        &transition,
    );
    assert!(result.is_err());
    assert_eq!(owned.held_run("session-1").as_deref(), Some("run-1"));
    assert!(
        gateways.get("session-1").is_none(),
        "no prepared capability may survive proven broker and actor quiescence"
    );
}

#[test]
fn collect_tool_names_pulls_from_item_events() {
    let item = TranscriptItemPayload {
        kind: TranscriptItemKind::ToolInvocation,
        status: TranscriptItemStatus::Completed,
        source_agent_kind: "claude".to_string(),
        is_transient: false,
        message_id: None,
        prompt_id: None,
        title: None,
        tool_call_id: None,
        native_tool_name: None,
        parent_tool_call_id: None,
        raw_input: None,
        raw_output: None,
        content_parts: vec![ContentPart::ToolCall {
            tool_call_id: "tc1".to_string(),
            title: "Update status".to_string(),
            tool_kind: None,
            native_tool_name: Some("mcp__linear__update_status".to_string()),
        }],
        prompt_provenance: None,
    };
    let mut out = Vec::new();
    collect_tool_names(
        &SessionEvent::ItemCompleted(ItemCompletedEvent { item }),
        &mut out,
    );
    assert_eq!(out, vec!["mcp__linear__update_status".to_string()]);
}
