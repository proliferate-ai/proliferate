//! Tests for [`super::agent_turn`], split into a sibling file for line budget
//! (matching the repo's `*_tests.rs` convention, e.g.
//! `domains/workflows/service_tests.rs`).

use anyharness_contract::v1::{
    ContentPart, ItemCompletedEvent, SessionEvent, TranscriptItemKind, TranscriptItemPayload,
    TranscriptItemStatus,
};
use crate::domains::workflows::engine::StepOutcome;
use crate::domains::workflows::plan::PlanGateway;

use super::agent_turn::{gateway_functions_unsupported, validate_bind_target};
use super::turn::collect_tool_names;

fn plan_gateway(integrations: Vec<String>) -> PlanGateway {
    PlanGateway {
        url: "https://cloud.test/mcp".to_string(),
        authorization: "Bearer per-run".to_string(),
        ping_url: "https://cloud.test/ping".to_string(),
        integrations,
    }
}

#[test]
fn functions_unsupported_only_when_grants_lack_a_usable_gateway() {
    // No gateway at all → supported (nothing granted).
    assert!(!gateway_functions_unsupported(None));
    // Gateway with no integration grants → supported (ping-only token).
    assert!(!gateway_functions_unsupported(Some(&plan_gateway(Vec::new()))));
    // Grants + a usable gateway → supported.
    assert!(!gateway_functions_unsupported(Some(&plan_gateway(vec![
        "issues".to_string()
    ]))));
    // Grants but empty authorization → unsupported (local lane).
    let mut gw = plan_gateway(vec!["issues".to_string()]);
    gw.authorization = "  ".to_string();
    assert!(gateway_functions_unsupported(Some(&gw)));
    // Grants but empty URL → unsupported.
    let mut gw = plan_gateway(vec!["issues".to_string()]);
    gw.url = String::new();
    assert!(gateway_functions_unsupported(Some(&gw)));
}

fn outcome_code(outcome: &StepOutcome) -> &str {
    match outcome {
        StepOutcome::Failed { code, .. } => code,
        _ => panic!("expected Failed outcome"),
    }
}

#[test]
fn bind_target_ok_when_harness_matches_and_not_held() {
    assert!(validate_bind_target("sess-1", "run-a", "claude", "claude", None).is_ok());
}

#[test]
fn bind_target_rebinding_own_run_is_idempotent() {
    // A session already held by THIS run may be re-bound (idempotent).
    assert!(
        validate_bind_target("sess-1", "run-a", "claude", "claude", Some("run-a")).is_ok()
    );
}

#[test]
fn bind_target_harness_mismatch_is_hard_plan_error() {
    let err = validate_bind_target("sess-1", "run-a", "codex", "claude", None)
        .expect_err("harness mismatch must be a hard error");
    assert_eq!(outcome_code(&err), "plan_malformed");
}

#[test]
fn bind_target_rejects_session_held_by_a_different_run() {
    // The double-owner hole: without this guard, run-b would silently re-own a
    // session run-a holds, and run-a's release would no longer drop it.
    let err = validate_bind_target("sess-1", "run-b", "claude", "claude", Some("run-a"))
        .expect_err("a session held by another live run cannot be bound");
    assert_eq!(outcome_code(&err), "session_bind_held");
}

#[test]
fn bind_target_harness_mismatch_takes_precedence_over_held() {
    // Even when also held elsewhere, a harness mismatch is the malformed-plan
    // error (checked first).
    let err = validate_bind_target("sess-1", "run-b", "codex", "claude", Some("run-a"))
        .expect_err("mismatch must error");
    assert_eq!(outcome_code(&err), "plan_malformed");
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
    collect_tool_names(&SessionEvent::ItemCompleted(ItemCompletedEvent { item }), &mut out);
    assert_eq!(out, vec!["mcp__linear__update_status".to_string()]);
}
