use std::sync::Arc;

use anyharness_contract::v1::{GoalSourceKind, GoalStatus, SessionEvent};
use serde_json::json;

use super::model::{GoalFailReason, GoalGuardDecision, GoalPendingOp};
use super::service::{GoalArming, GoalEventContext, GoalNativeEventKind, GoalService};
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
fn accounting_identical_update_while_pending_does_not_bump_revision() {
    // Regression: a codex accounting-only goal_updated tick arriving while
    // pending_op=Set must NOT bump revision or emit an event. The pending_op
    // should be cleared (the ingest confirmation proves native state matches).
    let service = test_service();
    service
        .ingest_native_event(
            context(1),
            GoalNativeEventKind::Updated,
            Some(wire("make CI green", GoalWireStatus::Active)),
        )
        .expect("ingest goal");

    // Simulate: user issues a set (mark pending) but the confirmation hasn't
    // landed yet. Meanwhile an accounting tick arrives with identical content.
    service
        .mark_pending("session-1", GoalPendingOp::Set)
        .expect("mark pending set");
    let pending = service
        .current_goal("session-1")
        .expect("load current")
        .expect("current goal");
    assert_eq!(pending.pending_op, Some(GoalPendingOp::Set));
    assert_eq!(pending.revision, 1);

    // Ingest an identical update (same objective, same status, same counters).
    let batch = service
        .ingest_native_event(
            context(2),
            GoalNativeEventKind::Updated,
            Some(wire("make CI green", GoalWireStatus::Active)),
        )
        .expect("ingest identical while pending");

    // Must NOT bump revision or emit events.
    assert!(batch.envelopes.is_empty(), "no event emitted");
    let goal = batch.goal.expect("goal returned");
    assert_eq!(goal.revision, 1, "revision unchanged");

    // But pending_op must be cleared (the confirmation resolves the pending state).
    let reloaded = service
        .current_goal("session-1")
        .expect("load current")
        .expect("current goal");
    assert_eq!(reloaded.pending_op, None, "pending_op cleared");
    assert_eq!(reloaded.revision, 1, "revision still 1 after reload");
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
// Caps + provenance + the cap guard
// ---------------------------------------------------------------------------

fn armed_active_goal(service: &GoalService, arming: GoalArming) {
    service
        .ingest_native_event(
            context(1),
            GoalNativeEventKind::Updated,
            Some(wire("make CI green", GoalWireStatus::Active)),
        )
        .expect("ingest goal");
    service
        .stamp_arming("session-1", arming)
        .expect("stamp arming");
}

#[test]
fn caps_and_provenance_round_trip_through_the_store() {
    let service = test_service();
    armed_active_goal(
        &service,
        GoalArming {
            source_kind: Some(GoalSourceKind::Workflow),
            source_run_id: Some("run-7".to_string()),
            max_turns: Some(12),
            max_wall_secs: Some(600),
        },
    );

    let goal = service
        .current_goal("session-1")
        .expect("load current")
        .expect("current goal");
    assert_eq!(goal.source_kind, GoalSourceKind::Workflow);
    assert_eq!(goal.source_run_id.as_deref(), Some("run-7"));
    assert_eq!(goal.max_turns, Some(12));
    assert_eq!(goal.max_wall_secs, Some(600));
    // Stamping caps/provenance is bookkeeping, never a mirror-state edit.
    assert_eq!(goal.revision, 1);
    // The contract projection carries the same values.
    let contract = goal.to_contract();
    assert_eq!(contract.max_turns, Some(12));
    assert_eq!(contract.max_wall_secs, Some(600));
    assert_eq!(contract.source_kind, GoalSourceKind::Workflow);
    assert_eq!(contract.source_run_id.as_deref(), Some("run-7"));
}

#[test]
fn fresh_goal_defaults_to_user_provenance_and_no_caps() {
    let service = test_service();
    service
        .ingest_native_event(
            context(1),
            GoalNativeEventKind::Updated,
            Some(wire("make CI green", GoalWireStatus::Active)),
        )
        .expect("ingest goal");

    let goal = service
        .current_goal("session-1")
        .expect("load current")
        .expect("current goal");
    assert_eq!(goal.source_kind, GoalSourceKind::User);
    assert_eq!(goal.source_run_id, None);
    assert_eq!(goal.max_turns, None);
    assert_eq!(goal.max_wall_secs, None);
}

#[test]
fn stamp_arming_preserves_omitted_fields_across_edits() {
    let service = test_service();
    armed_active_goal(
        &service,
        GoalArming {
            source_kind: Some(GoalSourceKind::Workflow),
            source_run_id: Some("run-7".to_string()),
            max_turns: Some(12),
            max_wall_secs: None,
        },
    );

    // A later stamp that only lowers max_turns must keep the provenance intact.
    service
        .stamp_arming(
            "session-1",
            GoalArming {
                max_turns: Some(3),
                ..GoalArming::default()
            },
        )
        .expect("re-stamp");
    let goal = service
        .current_goal("session-1")
        .expect("load current")
        .expect("current goal");
    assert_eq!(goal.max_turns, Some(3));
    assert_eq!(goal.source_kind, GoalSourceKind::Workflow);
    assert_eq!(goal.source_run_id.as_deref(), Some("run-7"));
}

#[test]
fn record_turn_is_a_noop_without_caps() {
    let service = test_service();
    service
        .ingest_native_event(
            context(1),
            GoalNativeEventKind::Updated,
            Some(wire("make CI green", GoalWireStatus::Active)),
        )
        .expect("ingest goal");

    // No caps: the guard neither counts nor fires (existing behavior unchanged).
    for _ in 0..5 {
        assert_eq!(service.record_turn("session-1").expect("record turn"), None);
    }
    let goal = service
        .current_goal("session-1")
        .expect("load current")
        .expect("current goal");
    assert_eq!(goal.guard_turns_used, 0);
    assert_eq!(goal.status, GoalStatus::Active);
    assert_eq!(goal.revision, 1);
}

#[test]
fn record_turn_breaches_on_max_turns() {
    let service = test_service();
    armed_active_goal(
        &service,
        GoalArming {
            max_turns: Some(2),
            ..GoalArming::default()
        },
    );

    // Turn 1: counted, under the cap.
    assert_eq!(service.record_turn("session-1").expect("turn 1"), None);
    assert_eq!(
        service
            .current_goal("session-1")
            .expect("load")
            .expect("goal")
            .guard_turns_used,
        1
    );
    // Turn 2: hits the cap.
    assert_eq!(
        service.record_turn("session-1").expect("turn 2"),
        Some(GoalGuardDecision::Breached(
            GoalFailReason::MaxTurnsExhausted
        ))
    );
}

#[test]
fn record_turn_breaches_on_wall_clock() {
    let service = test_service();
    armed_active_goal(
        &service,
        GoalArming {
            max_wall_secs: Some(60),
            ..GoalArming::default()
        },
    );
    // Backdate the cap window so a single turn crosses the wall-clock cap.
    let past = (chrono::Utc::now() - chrono::Duration::seconds(120)).to_rfc3339();
    service
        .store()
        .with_tx_anyhow(|tx| {
            tx.execute(
                "UPDATE goals SET guard_started_at = ?2 WHERE session_id = ?1",
                rusqlite::params!["session-1", past],
            )?;
            Ok(())
        })
        .expect("backdate guard window");

    assert_eq!(
        service.record_turn("session-1").expect("record turn"),
        Some(GoalGuardDecision::Breached(
            GoalFailReason::MaxWallSecsExhausted
        ))
    );
}

#[test]
fn objective_change_resets_the_turn_counter() {
    let service = test_service();
    armed_active_goal(
        &service,
        GoalArming {
            max_turns: Some(5),
            ..GoalArming::default()
        },
    );
    service.record_turn("session-1").expect("turn 1");
    assert_eq!(
        service
            .current_goal("session-1")
            .expect("load")
            .expect("goal")
            .guard_turns_used,
        1
    );

    // Editing the objective reopens the cap window: counter back to zero, caps
    // preserved. A bare status/accounting edit would keep the count.
    service
        .ingest_native_event(
            context(2),
            GoalNativeEventKind::Updated,
            Some(wire("make CI green and fast", GoalWireStatus::Active)),
        )
        .expect("ingest objective edit");
    let goal = service
        .current_goal("session-1")
        .expect("load")
        .expect("goal");
    assert_eq!(goal.guard_turns_used, 0);
    assert_eq!(goal.max_turns, Some(5));
}

#[test]
fn bare_edit_keeps_the_turn_counter() {
    let service = test_service();
    armed_active_goal(
        &service,
        GoalArming {
            max_turns: Some(5),
            ..GoalArming::default()
        },
    );
    service.record_turn("session-1").expect("turn 1");

    // Same objective, only accounting moves: the counter must survive.
    let mut edited = wire("make CI green", GoalWireStatus::Active);
    edited.tokens_used = Some(42);
    service
        .ingest_native_event(context(2), GoalNativeEventKind::Updated, Some(edited))
        .expect("ingest accounting edit");
    assert_eq!(
        service
            .current_goal("session-1")
            .expect("load")
            .expect("goal")
            .guard_turns_used,
        1
    );
}

#[test]
fn fail_current_goal_transitions_failed_with_reason_and_emits_goal_updated() {
    let service = test_service();
    armed_active_goal(
        &service,
        GoalArming {
            max_turns: Some(1),
            ..GoalArming::default()
        },
    );

    let batch = service
        .fail_current_goal(context(2), GoalFailReason::MaxTurnsExhausted)
        .expect("fail goal");
    let goal = batch.goal.expect("goal record");
    assert_eq!(goal.status, GoalStatus::Failed);
    assert_eq!(goal.failed_reason.as_deref(), Some("max_turns_exhausted"));
    assert_eq!(goal.revision, 2);
    assert_eq!(batch.envelopes.len(), 1);
    assert_eq!(batch.envelopes[0].event.event_type(), "goal_updated");
    let SessionEvent::GoalUpdated(payload) = &batch.envelopes[0].event else {
        panic!("expected goal_updated event carrying the failure");
    };
    assert_eq!(payload.goal.status, GoalStatus::Failed);
    assert_eq!(
        payload.goal.failed_reason.as_deref(),
        Some("max_turns_exhausted")
    );

    // The failed result is sticky: the guard's own native clear echo (a
    // goal_cleared notification) must not clobber it back to cleared.
    let echo = service
        .ingest_native_event(context(3), GoalNativeEventKind::Cleared, None)
        .expect("ingest guard clear echo");
    assert!(echo.envelopes.is_empty());
    assert_eq!(
        service
            .current_goal("session-1")
            .expect("load current")
            .expect("current goal")
            .status,
        GoalStatus::Failed
    );
}

#[test]
fn fail_current_goal_is_a_noop_without_a_goal() {
    let service = test_service();
    let batch = service
        .fail_current_goal(context(1), GoalFailReason::MaxWallSecsExhausted)
        .expect("fail with no goal");
    assert!(batch.envelopes.is_empty());
    assert!(batch.goal.is_none());
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
