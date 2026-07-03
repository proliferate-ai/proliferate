use std::sync::Arc;

use anyharness_contract::v1::{GoalStatus, SessionEvent};
use serde_json::json;

use super::model::GoalPendingOp;
use super::service::{GoalEventContext, GoalNativeEventKind, GoalService};
use super::session_observer::GoalSessionObserver;
use super::store::GoalStore;
use super::wire::{GoalWire, GoalWireStatus};
use crate::app::test_support;
use crate::live::sessions::model::{
    AcpChunkPayload, SessionEventObserver, SessionObservation, SessionObserverContext,
};
use crate::persistence::Db;

fn test_service() -> GoalService {
    let db = Db::open_in_memory().expect("open db");
    test_support::seed_workspace_with_repo_root(&db, "workspace-1", "local", "/tmp/workspace-1");
    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO sessions (
                id, workspace_id, agent_kind, status, created_at, updated_at
             ) VALUES ('session-1', 'workspace-1', 'codex', 'idle', 'now', 'now')",
            [],
        )?;
        Ok(())
    })
    .expect("seed db");
    GoalService::new(GoalStore::new(db))
}

fn context(next_seq: i64) -> GoalEventContext {
    GoalEventContext {
        workspace_id: "workspace-1".to_string(),
        session_id: "session-1".to_string(),
        source_agent_kind: "codex".to_string(),
        turn_id: Some("turn-1".to_string()),
        next_seq,
    }
}

fn wire(objective: &str, status: GoalWireStatus) -> GoalWire {
    GoalWire {
        objective: objective.to_string(),
        status,
        native_status: None,
        token_budget: None,
        tokens_used: None,
        time_used_seconds: None,
        met_reason: None,
        iterations: None,
        native: true,
        updated_at_ms: None,
    }
}

#[test]
fn ingest_updated_creates_the_mirror_and_emits_goal_updated() {
    let service = test_service();

    let batch = service
        .ingest_native_event(
            context(1),
            GoalNativeEventKind::Updated,
            Some(wire("make CI green", GoalWireStatus::Active)),
        )
        .expect("ingest goal");

    let goal = batch.goal.expect("goal record");
    assert_eq!(goal.objective, "make CI green");
    assert_eq!(goal.status, GoalStatus::Active);
    assert_eq!(goal.revision, 1);
    assert_eq!(batch.envelopes.len(), 1);
    assert_eq!(batch.envelopes[0].event.event_type(), "goal_updated");
    let SessionEvent::GoalUpdated(payload) = &batch.envelopes[0].event else {
        panic!("expected goal_updated event");
    };
    assert_eq!(payload.goal.objective, "make CI green");
}

#[test]
fn ingest_updated_edits_in_place_and_bumps_revision() {
    let service = test_service();
    let first = service
        .ingest_native_event(
            context(1),
            GoalNativeEventKind::Updated,
            Some(wire("make CI green", GoalWireStatus::Active)),
        )
        .expect("ingest goal")
        .goal
        .expect("goal record");

    let mut edited = wire("make CI green and lint clean", GoalWireStatus::Active);
    edited.token_budget = Some(50_000);
    let second = service
        .ingest_native_event(context(2), GoalNativeEventKind::Updated, Some(edited))
        .expect("ingest edit")
        .goal
        .expect("goal record");

    assert_eq!(second.id, first.id);
    assert_eq!(second.revision, 2);
    assert_eq!(second.objective, "make CI green and lint clean");
    assert_eq!(second.token_budget, Some(50_000));
    assert_eq!(
        service
            .current_goal("session-1")
            .expect("load current")
            .expect("current goal")
            .id,
        first.id
    );
}

#[test]
fn ingest_duplicate_update_is_idempotent() {
    let service = test_service();
    service
        .ingest_native_event(
            context(1),
            GoalNativeEventKind::Updated,
            Some(wire("make CI green", GoalWireStatus::Active)),
        )
        .expect("ingest goal");

    let repeat = service
        .ingest_native_event(
            context(2),
            GoalNativeEventKind::Updated,
            Some(wire("make CI green", GoalWireStatus::Active)),
        )
        .expect("ingest duplicate");

    assert!(repeat.envelopes.is_empty());
    assert_eq!(repeat.goal.expect("goal record").revision, 1);
}

#[test]
fn ingest_met_transitions_with_reason_and_emits_goal_met() {
    let service = test_service();
    service
        .ingest_native_event(
            context(1),
            GoalNativeEventKind::Updated,
            Some(wire("DONE.txt exists", GoalWireStatus::Active)),
        )
        .expect("ingest goal");

    let mut met = wire("DONE.txt exists", GoalWireStatus::Met);
    met.met_reason = Some("DONE.txt exists containing done".to_string());
    let batch = service
        .ingest_native_event(context(2), GoalNativeEventKind::Met, Some(met))
        .expect("ingest met");

    let goal = batch.goal.expect("goal record");
    assert_eq!(goal.status, GoalStatus::Met);
    assert_eq!(
        goal.met_reason.as_deref(),
        Some("DONE.txt exists containing done")
    );
    assert_eq!(goal.revision, 2);
    assert_eq!(batch.envelopes.len(), 1);
    assert_eq!(batch.envelopes[0].event.event_type(), "goal_met");
    // The met record stays current — the sticky result state.
    assert_eq!(
        service
            .current_goal("session-1")
            .expect("load current")
            .expect("current goal")
            .status,
        GoalStatus::Met
    );
}

#[test]
fn ingest_cleared_transitions_and_emits_goal_cleared() {
    let service = test_service();
    service
        .ingest_native_event(
            context(1),
            GoalNativeEventKind::Updated,
            Some(wire("make CI green", GoalWireStatus::Active)),
        )
        .expect("ingest goal");

    let batch = service
        .ingest_native_event(context(2), GoalNativeEventKind::Cleared, None)
        .expect("ingest cleared");

    assert_eq!(
        batch.goal.expect("goal record").status,
        GoalStatus::Cleared
    );
    assert_eq!(batch.envelopes.len(), 1);
    assert_eq!(batch.envelopes[0].event.event_type(), "goal_cleared");
    assert!(service
        .current_goal("session-1")
        .expect("load current")
        .is_none());

    let repeat = service
        .ingest_native_event(context(3), GoalNativeEventKind::Cleared, None)
        .expect("ingest duplicate clear");
    assert!(repeat.envelopes.is_empty());
}

#[test]
fn new_goal_after_terminal_creates_a_new_record() {
    let service = test_service();
    let first = service
        .ingest_native_event(
            context(1),
            GoalNativeEventKind::Updated,
            Some(wire("first objective", GoalWireStatus::Active)),
        )
        .expect("ingest goal")
        .goal
        .expect("goal record");
    service
        .ingest_native_event(
            context(2),
            GoalNativeEventKind::Met,
            Some(wire("first objective", GoalWireStatus::Met)),
        )
        .expect("ingest met");

    let second = service
        .ingest_native_event(
            context(3),
            GoalNativeEventKind::Updated,
            Some(wire("second objective", GoalWireStatus::Active)),
        )
        .expect("ingest replacement")
        .goal
        .expect("goal record");

    assert_ne!(second.id, first.id);
    assert_eq!(second.revision, 1);
    assert_eq!(
        service
            .current_goal("session-1")
            .expect("load current")
            .expect("current goal")
            .objective,
        "second objective"
    );
}

#[test]
fn clearing_second_goal_does_not_resurrect_first_terminal_goal() {
    let service = test_service();
    // Goal A runs and reaches met (a terminal, never-cleared record).
    service
        .ingest_native_event(
            context(1),
            GoalNativeEventKind::Updated,
            Some(wire("first objective", GoalWireStatus::Active)),
        )
        .expect("ingest goal A");
    service
        .ingest_native_event(
            context(2),
            GoalNativeEventKind::Met,
            Some(wire("first objective", GoalWireStatus::Met)),
        )
        .expect("ingest goal A met");
    // Goal B is set (a different objective) and then cleared.
    service
        .ingest_native_event(
            context(3),
            GoalNativeEventKind::Updated,
            Some(wire("second objective", GoalWireStatus::Active)),
        )
        .expect("ingest goal B");
    service
        .ingest_native_event(context(4), GoalNativeEventKind::Cleared, None)
        .expect("clear goal B");

    // Clearing B must not fall back to A: the session has no current goal.
    assert!(service
        .current_goal("session-1")
        .expect("load current")
        .is_none());
}

#[test]
fn stale_goal_update_after_clear_does_not_resurrect() {
    let service = test_service();
    service
        .ingest_native_event(
            context(1),
            GoalNativeEventKind::Updated,
            Some(wire("make CI green", GoalWireStatus::Active)),
        )
        .expect("ingest goal");
    service
        .ingest_native_event(context(2), GoalNativeEventKind::Cleared, None)
        .expect("clear goal");

    // A late accounting goal_updated for the just-cleared goal arrives on the
    // notification path with no set in flight: it must be dropped, leaving the
    // mirror cleared (no envelope, no resurrected active row).
    let stale = service
        .ingest_native_event(
            context(3),
            GoalNativeEventKind::Updated,
            Some(wire("make CI green", GoalWireStatus::Active)),
        )
        .expect("ingest stale update");
    assert!(stale.envelopes.is_empty());
    assert!(service
        .current_goal("session-1")
        .expect("load current")
        .is_none());
}

#[test]
fn set_after_clear_creates_a_new_goal() {
    let service = test_service();
    service
        .ingest_native_event(
            context(1),
            GoalNativeEventKind::Updated,
            Some(wire("make CI green", GoalWireStatus::Active)),
        )
        .expect("ingest goal");
    service
        .ingest_native_event(context(2), GoalNativeEventKind::Cleared, None)
        .expect("clear goal");

    // A set issued after the clear stamps the cleared head with pending Set;
    // the set's own native echo then mints a fresh goal instead of dropping.
    service
        .mark_pending("session-1", GoalPendingOp::Set)
        .expect("mark pending set");
    let batch = service
        .ingest_native_event(
            context(3),
            GoalNativeEventKind::Updated,
            Some(wire("make CI green", GoalWireStatus::Active)),
        )
        .expect("ingest re-armed goal");
    assert_eq!(batch.envelopes.len(), 1);
    let goal = service
        .current_goal("session-1")
        .expect("load current")
        .expect("current goal");
    assert_eq!(goal.objective, "make CI green");
    assert_eq!(goal.status, GoalStatus::Active);
    assert_eq!(goal.revision, 1);
}

#[test]
fn re_arm_same_objective_after_met_starts_fresh_record() {
    let service = test_service();
    service
        .ingest_native_event(
            context(1),
            GoalNativeEventKind::Updated,
            Some(wire("DONE.txt exists", GoalWireStatus::Active)),
        )
        .expect("ingest goal");
    let mut met = wire("DONE.txt exists", GoalWireStatus::Met);
    met.met_reason = Some("file created".to_string());
    let first = service
        .ingest_native_event(context(2), GoalNativeEventKind::Met, Some(met))
        .expect("ingest met")
        .goal
        .expect("goal record");
    assert_eq!(first.met_reason.as_deref(), Some("file created"));

    // Re-arming the same objective is a new pursuit, not a continuation of the
    // completed goal: a fresh record with no stale met_reason carried forward.
    let rearmed = service
        .ingest_native_event(
            context(3),
            GoalNativeEventKind::Updated,
            Some(wire("DONE.txt exists", GoalWireStatus::Active)),
        )
        .expect("ingest re-arm")
        .goal
        .expect("goal record");
    assert_ne!(rearmed.id, first.id);
    assert_eq!(rearmed.revision, 1);
    assert_eq!(rearmed.status, GoalStatus::Active);
    assert_eq!(rearmed.met_reason, None);
}

#[test]
fn reconcile_null_clears_non_terminal_but_preserves_met() {
    let service = test_service();
    service
        .ingest_native_event(
            context(1),
            GoalNativeEventKind::Updated,
            Some(wire("make CI green", GoalWireStatus::Active)),
        )
        .expect("ingest goal");

    let cleared = service
        .reconcile_native_state(context(2), None)
        .expect("reconcile null");
    assert_eq!(
        cleared.goal.expect("goal record").status,
        GoalStatus::Cleared
    );
    assert_eq!(cleared.envelopes.len(), 1);
    assert_eq!(cleared.envelopes[0].event.event_type(), "goal_cleared");

    // A met mirror stays sticky when the harness (claude auto-clear) reports
    // no goal on the reconcile read.
    let mut met = wire("DONE.txt exists", GoalWireStatus::Met);
    met.met_reason = Some("done".to_string());
    service
        .reconcile_native_state(context(3), Some(met))
        .expect("reconcile met");
    let untouched = service
        .reconcile_native_state(context(4), None)
        .expect("reconcile null after met");
    assert!(untouched.envelopes.is_empty());
    assert_eq!(
        untouched.goal.expect("goal record").status,
        GoalStatus::Met
    );
}

#[test]
fn reconcile_met_wire_emits_goal_met() {
    let service = test_service();
    service
        .ingest_native_event(
            context(1),
            GoalNativeEventKind::Updated,
            Some(wire("objective", GoalWireStatus::Active)),
        )
        .expect("ingest goal");

    let batch = service
        .reconcile_native_state(context(2), Some(wire("objective", GoalWireStatus::Met)))
        .expect("reconcile met");
    assert_eq!(batch.envelopes.len(), 1);
    assert_eq!(batch.envelopes[0].event.event_type(), "goal_met");
}

#[test]
fn pending_marker_is_thin_and_cleared_by_ingest() {
    let service = test_service();
    service
        .ingest_native_event(
            context(1),
            GoalNativeEventKind::Updated,
            Some(wire("make CI green", GoalWireStatus::Active)),
        )
        .expect("ingest goal");

    service
        .mark_pending("session-1", GoalPendingOp::Set)
        .expect("mark pending");
    let pending = service
        .current_goal("session-1")
        .expect("load current")
        .expect("current goal");
    assert_eq!(pending.pending_op, Some(GoalPendingOp::Set));
    // The marker never moves status or revision.
    assert_eq!(pending.status, GoalStatus::Active);
    assert_eq!(pending.revision, 1);

    let mut edited = wire("make CI green", GoalWireStatus::Paused);
    edited.native_status = Some("paused".to_string());
    let batch = service
        .ingest_native_event(context(2), GoalNativeEventKind::Updated, Some(edited))
        .expect("ingest edit");
    assert_eq!(batch.goal.expect("goal record").pending_op, None);
}

#[test]
fn missing_wire_payload_on_update_is_an_error() {
    let service = test_service();
    let error = service
        .ingest_native_event(context(1), GoalNativeEventKind::Updated, None)
        .expect_err("update without goal payload must fail");
    assert!(error.to_string().contains("missing its goal"));
}

// ---------------------------------------------------------------------------
// Observer ingestion (fixture chunks)
// ---------------------------------------------------------------------------

fn observer_context(next_seq: i64) -> SessionObserverContext {
    SessionObserverContext {
        session_id: "session-1".to_string(),
        workspace_id: "workspace-1".to_string(),
        agent_kind: "codex".to_string(),
        turn_id: Some("turn-1".to_string()),
        next_seq,
    }
}

fn goal_chunk(meta: serde_json::Value) -> AcpChunkPayload {
    AcpChunkPayload {
        content: json!({ "type": "text", "text": "" }),
        meta: Some(meta),
        message_id: None,
    }
}

#[test]
fn observer_ingests_goal_updated_chunk() {
    let service = Arc::new(test_service());
    let observer = GoalSessionObserver::new(service.clone());

    let payload = goal_chunk(json!({
        "anyharness": {
            "schemaVersion": 1,
            "transcriptEvent": "goal_updated",
            "goal": {
                "objective": "make CI green",
                "status": "active",
                "nativeStatus": "active",
                "tokenBudget": null,
                "tokensUsed": 0,
                "timeUsedSeconds": 0,
                "metReason": null,
                "iterations": null,
                "native": true,
                "updatedAtMs": 1
            }
        }
    }));
    let effects = observer.observe(
        &observer_context(1),
        SessionObservation::NonTranscriptChunk(&payload),
    );

    assert_eq!(effects.persisted_events.len(), 1);
    assert_eq!(
        effects.persisted_events[0].event.event_type(),
        "goal_updated"
    );
    let goal = service
        .current_goal("session-1")
        .expect("load current")
        .expect("current goal");
    assert_eq!(goal.objective, "make CI green");
    assert_eq!(goal.status, GoalStatus::Active);
}

#[test]
fn observer_ingests_goal_met_and_cleared_chunks() {
    let service = Arc::new(test_service());
    let observer = GoalSessionObserver::new(service.clone());

    let met = goal_chunk(json!({
        "anyharness": {
            "schemaVersion": 1,
            "transcriptEvent": "goal_met",
            "goal": {
                "objective": "make CI green",
                "status": "met",
                "nativeStatus": "complete",
                "metReason": "checks passed",
                "native": true,
                "updatedAtMs": 2
            }
        }
    }));
    let effects = observer.observe(
        &observer_context(1),
        SessionObservation::NonTranscriptChunk(&met),
    );
    assert_eq!(effects.persisted_events.len(), 1);
    assert_eq!(effects.persisted_events[0].event.event_type(), "goal_met");
    assert_eq!(
        service
            .current_goal("session-1")
            .expect("load current")
            .expect("current goal")
            .met_reason
            .as_deref(),
        Some("checks passed")
    );

    let cleared = goal_chunk(json!({
        "anyharness": { "schemaVersion": 1, "transcriptEvent": "goal_cleared" }
    }));
    let effects = observer.observe(
        &observer_context(2),
        SessionObservation::NonTranscriptChunk(&cleared),
    );
    assert_eq!(effects.persisted_events.len(), 1);
    assert_eq!(
        effects.persisted_events[0].event.event_type(),
        "goal_cleared"
    );
    assert!(service
        .current_goal("session-1")
        .expect("load current")
        .is_none());
}

#[test]
fn observer_ignores_unrelated_and_malformed_chunks() {
    let service = Arc::new(test_service());
    let observer = GoalSessionObserver::new(service.clone());

    let plan_chunk = goal_chunk(json!({
        "anyharness": { "transcriptEvent": "proposed_plan_completed" }
    }));
    let effects = observer.observe(
        &observer_context(1),
        SessionObservation::NonTranscriptChunk(&plan_chunk),
    );
    assert!(effects.persisted_events.is_empty());

    let malformed = goal_chunk(json!({
        "anyharness": {
            "schemaVersion": 1,
            "transcriptEvent": "goal_updated",
            "goal": { "objective": "x", "status": "usageLimited" }
        }
    }));
    let effects = observer.observe(
        &observer_context(1),
        SessionObservation::NonTranscriptChunk(&malformed),
    );
    assert!(effects.persisted_events.is_empty());
    assert!(service
        .current_goal("session-1")
        .expect("load current")
        .is_none());
}
