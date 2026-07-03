use std::sync::Arc;

use anyharness_contract::v1::{LoopScheduleKind, LoopStatus, SessionEvent};
use serde_json::json;

use super::service::{LoopEventContext, LoopNativeEventKind, LoopService};
use super::session_observer::LoopSessionObserver;
use super::store::LoopStore;
use super::wire::{LoopScheduleKindWire, LoopScheduleWire, LoopWire, LoopWireStatus};
use crate::app::test_support;
use crate::live::sessions::model::{
    AcpChunkPayload, SessionEventObserver, SessionObservation, SessionObserverContext,
};
use crate::persistence::Db;

fn test_service() -> LoopService {
    let db = Db::open_in_memory().expect("open db");
    test_support::seed_workspace_with_repo_root(&db, "workspace-1", "local", "/tmp/workspace-1");
    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO sessions (
                id, workspace_id, agent_kind, status, created_at, updated_at
             ) VALUES ('session-1', 'workspace-1', 'claude', 'idle', 'now', 'now')",
            [],
        )?;
        Ok(())
    })
    .expect("seed db");
    LoopService::new(LoopStore::new(db))
}

fn context(next_seq: i64) -> LoopEventContext {
    LoopEventContext {
        workspace_id: "workspace-1".to_string(),
        session_id: "session-1".to_string(),
        source_agent_kind: "claude".to_string(),
        turn_id: Some("turn-1".to_string()),
        next_seq,
    }
}

fn wire(loop_id: &str, prompt: &str, status: LoopWireStatus) -> LoopWire {
    LoopWire {
        loop_id: loop_id.to_string(),
        prompt: prompt.to_string(),
        schedule: LoopScheduleWire {
            kind: LoopScheduleKindWire::Cron,
            expr: "*/1 * * * *".to_string(),
        },
        recurring: true,
        status,
        native: true,
        last_fired_at_ms: None,
        fire_count: 0,
        updated_at_ms: 1,
    }
}

#[test]
fn ingest_upserted_creates_the_mirror_and_emits_loop_upserted() {
    let service = test_service();

    let batch = service
        .ingest_native_event(
            context(1),
            LoopNativeEventKind::Upserted,
            Some(wire("cron-1", "ping", LoopWireStatus::Active)),
            None,
        )
        .expect("ingest loop");

    let record = batch.r#loop.expect("loop record");
    assert_eq!(record.loop_id, "cron-1");
    assert_eq!(record.status, LoopStatus::Active);
    assert_eq!(record.schedule_kind, LoopScheduleKind::Cron);
    assert_eq!(batch.envelopes.len(), 1);
    assert_eq!(batch.envelopes[0].event.event_type(), "loop_upserted");
    let SessionEvent::LoopUpserted(payload) = &batch.envelopes[0].event else {
        panic!("expected loop_upserted event");
    };
    assert_eq!(payload.r#loop.loop_id, "cron-1");
}

#[test]
fn ingest_upserted_edits_in_place() {
    let service = test_service();
    service
        .ingest_native_event(
            context(1),
            LoopNativeEventKind::Upserted,
            Some(wire("cron-1", "ping", LoopWireStatus::Active)),
            None,
        )
        .expect("ingest loop");

    let mut edited = wire("cron-1", "ping twice", LoopWireStatus::Active);
    edited.updated_at_ms = 2;
    service
        .ingest_native_event(context(2), LoopNativeEventKind::Upserted, Some(edited), None)
        .expect("ingest edit");

    let current = service
        .current_loops("session-1")
        .expect("load current")
        .into_iter()
        .find(|record| record.loop_id == "cron-1")
        .expect("loop present");
    assert_eq!(current.prompt, "ping twice");
}

#[test]
fn ingest_duplicate_upsert_is_idempotent() {
    let service = test_service();
    service
        .ingest_native_event(
            context(1),
            LoopNativeEventKind::Upserted,
            Some(wire("cron-1", "ping", LoopWireStatus::Active)),
            None,
        )
        .expect("ingest loop");

    let repeat = service
        .ingest_native_event(
            context(2),
            LoopNativeEventKind::Upserted,
            Some(wire("cron-1", "ping", LoopWireStatus::Active)),
            None,
        )
        .expect("ingest duplicate");

    assert!(repeat.envelopes.is_empty());
}

#[test]
fn multiple_loops_coexist_per_session() {
    let service = test_service();
    service
        .ingest_native_event(
            context(1),
            LoopNativeEventKind::Upserted,
            Some(wire("cron-1", "ping", LoopWireStatus::Active)),
            None,
        )
        .expect("ingest loop 1");
    service
        .ingest_native_event(
            context(2),
            LoopNativeEventKind::Upserted,
            Some(wire("cron-2", "pong", LoopWireStatus::Active)),
            None,
        )
        .expect("ingest loop 2");

    let mut current = service
        .current_loops("session-1")
        .expect("load current");
    current.sort_by(|a, b| a.loop_id.cmp(&b.loop_id));
    assert_eq!(current.len(), 2);
    assert_eq!(current[0].loop_id, "cron-1");
    assert_eq!(current[1].loop_id, "cron-2");
}

#[test]
fn ingest_fired_updates_counters_and_emits_loop_fired() {
    let service = test_service();
    service
        .ingest_native_event(
            context(1),
            LoopNativeEventKind::Upserted,
            Some(wire("cron-1", "ping", LoopWireStatus::Active)),
            None,
        )
        .expect("ingest loop");

    let mut fired = wire("cron-1", "ping", LoopWireStatus::Active);
    fired.fire_count = 1;
    fired.last_fired_at_ms = Some(1_780_000_000_000);
    fired.updated_at_ms = 1_780_000_000_000;
    let batch = service
        .ingest_native_event(context(2), LoopNativeEventKind::Fired, Some(fired), None)
        .expect("ingest fired");

    assert_eq!(batch.envelopes.len(), 1);
    assert_eq!(batch.envelopes[0].event.event_type(), "loop_fired");
    let SessionEvent::LoopFired(payload) = &batch.envelopes[0].event else {
        panic!("expected loop_fired event");
    };
    assert_eq!(payload.fired_at_ms, 1_780_000_000_000);
    assert_eq!(payload.turn_id.as_deref(), Some("turn-1"));
    assert_eq!(
        service
            .current_loops("session-1")
            .expect("load current")
            .into_iter()
            .find(|record| record.loop_id == "cron-1")
            .expect("loop present")
            .fire_count,
        1
    );
}

#[test]
fn ingest_removed_transitions_and_emits_loop_removed() {
    let service = test_service();
    service
        .ingest_native_event(
            context(1),
            LoopNativeEventKind::Upserted,
            Some(wire("cron-1", "ping", LoopWireStatus::Active)),
            None,
        )
        .expect("ingest loop");

    let batch = service
        .ingest_native_event(
            context(2),
            LoopNativeEventKind::Removed,
            None,
            Some("cron-1".to_string()),
        )
        .expect("ingest removed");

    assert_eq!(batch.envelopes.len(), 1);
    assert_eq!(batch.envelopes[0].event.event_type(), "loop_removed");
    assert!(service
        .current_loops("session-1")
        .expect("load current")
        .is_empty());

    let repeat = service
        .ingest_native_event(
            context(3),
            LoopNativeEventKind::Removed,
            None,
            Some("cron-1".to_string()),
        )
        .expect("ingest duplicate removal");
    assert!(repeat.envelopes.is_empty());
}

#[test]
fn removing_unknown_loop_is_a_noop() {
    let service = test_service();
    let batch = service
        .ingest_native_event(
            context(1),
            LoopNativeEventKind::Removed,
            None,
            Some("cron-missing".to_string()),
        )
        .expect("ingest removal of unknown loop");
    assert!(batch.envelopes.is_empty());
    assert!(batch.r#loop.is_none());
}

#[test]
fn missing_wire_payload_on_upsert_is_an_error() {
    let service = test_service();
    let error = service
        .ingest_native_event(context(1), LoopNativeEventKind::Upserted, None, None)
        .expect_err("upsert without loop payload must fail");
    assert!(error.to_string().contains("missing its loop"));
}

#[test]
fn missing_loop_id_on_removed_is_an_error() {
    let service = test_service();
    let error = service
        .ingest_native_event(context(1), LoopNativeEventKind::Removed, None, None)
        .expect_err("removed without loopId must fail");
    assert!(error.to_string().contains("missing its loopId"));
}

// ---------------------------------------------------------------------------
// Observer ingestion (fixture chunks)
// ---------------------------------------------------------------------------

fn observer_context(next_seq: i64) -> SessionObserverContext {
    SessionObserverContext {
        session_id: "session-1".to_string(),
        workspace_id: "workspace-1".to_string(),
        agent_kind: "claude".to_string(),
        turn_id: Some("turn-1".to_string()),
        next_seq,
    }
}

fn loop_chunk(meta: serde_json::Value) -> AcpChunkPayload {
    AcpChunkPayload {
        content: json!({ "type": "text", "text": "" }),
        meta: Some(meta),
        message_id: None,
    }
}

#[test]
fn observer_ingests_loop_upserted_chunk() {
    let service = Arc::new(test_service());
    let observer = LoopSessionObserver::new(service.clone());

    let payload = loop_chunk(json!({
        "anyharness": {
            "schemaVersion": 1,
            "transcriptEvent": "loop_upserted",
            "loop": {
                "loopId": "cron-1",
                "prompt": "append ping + timestamp to PING.log",
                "schedule": { "kind": "cron", "expr": "*/1 * * * *" },
                "recurring": true,
                "status": "active",
                "native": true,
                "lastFiredAtMs": null,
                "fireCount": 0,
                "updatedAtMs": 1
            }
        }
    }));
    let effects = observer.observe(
        &observer_context(1),
        SessionObservation::NonTranscriptChunk(&payload),
    );

    assert_eq!(effects.persisted_events.len(), 1);
    assert_eq!(effects.persisted_events[0].event.event_type(), "loop_upserted");
    let loops = service.current_loops("session-1").expect("load current");
    assert_eq!(loops.len(), 1);
    assert_eq!(loops[0].loop_id, "cron-1");
}

#[test]
fn observer_ingests_loop_fired_and_removed_chunks() {
    let service = Arc::new(test_service());
    let observer = LoopSessionObserver::new(service.clone());

    let upserted = loop_chunk(json!({
        "anyharness": {
            "schemaVersion": 1,
            "transcriptEvent": "loop_upserted",
            "loop": {
                "loopId": "cron-1",
                "prompt": "ping",
                "schedule": { "kind": "cron", "expr": "*/1 * * * *" },
                "recurring": true,
                "status": "active",
                "native": true,
                "fireCount": 0,
                "updatedAtMs": 1
            }
        }
    }));
    observer.observe(
        &observer_context(1),
        SessionObservation::NonTranscriptChunk(&upserted),
    );

    let fired = loop_chunk(json!({
        "anyharness": {
            "schemaVersion": 1,
            "transcriptEvent": "loop_fired",
            "loop": {
                "loopId": "cron-1",
                "prompt": "ping",
                "schedule": { "kind": "cron", "expr": "*/1 * * * *" },
                "recurring": true,
                "status": "active",
                "native": true,
                "lastFiredAtMs": 2,
                "fireCount": 1,
                "updatedAtMs": 2
            }
        }
    }));
    let effects = observer.observe(
        &observer_context(2),
        SessionObservation::NonTranscriptChunk(&fired),
    );
    assert_eq!(effects.persisted_events.len(), 1);
    assert_eq!(effects.persisted_events[0].event.event_type(), "loop_fired");

    let removed = loop_chunk(json!({
        "anyharness": {
            "schemaVersion": 1,
            "transcriptEvent": "loop_removed",
            "loopId": "cron-1"
        }
    }));
    let effects = observer.observe(
        &observer_context(3),
        SessionObservation::NonTranscriptChunk(&removed),
    );
    assert_eq!(effects.persisted_events.len(), 1);
    assert_eq!(effects.persisted_events[0].event.event_type(), "loop_removed");
    assert!(service
        .current_loops("session-1")
        .expect("load current")
        .is_empty());
}

#[test]
fn observer_ignores_unrelated_and_malformed_chunks() {
    let service = Arc::new(test_service());
    let observer = LoopSessionObserver::new(service.clone());

    let plan_chunk = loop_chunk(json!({
        "anyharness": { "transcriptEvent": "proposed_plan_completed" }
    }));
    let effects = observer.observe(
        &observer_context(1),
        SessionObservation::NonTranscriptChunk(&plan_chunk),
    );
    assert!(effects.persisted_events.is_empty());

    let malformed = loop_chunk(json!({
        "anyharness": {
            "schemaVersion": 1,
            "transcriptEvent": "loop_upserted",
            "loop": { "loopId": "cron-1", "status": "paused" }
        }
    }));
    let effects = observer.observe(
        &observer_context(1),
        SessionObservation::NonTranscriptChunk(&malformed),
    );
    assert!(effects.persisted_events.is_empty());
    assert!(service
        .current_loops("session-1")
        .expect("load current")
        .is_empty());
}

fn emulated_spec(loop_id: &str, max_fires: Option<i64>, next_fire_at_ms: i64) -> super::service::EmulatedLoopSpec {
    super::service::EmulatedLoopSpec {
        loop_id: loop_id.to_string(),
        prompt: "ping".to_string(),
        schedule: anyharness_contract::v1::LoopSchedule {
            kind: LoopScheduleKind::Interval,
            expr: "1m".to_string(),
        },
        recurring: true,
        max_fires,
        next_fire_at_ms,
    }
}

#[test]
fn arm_emulated_loop_creates_native_false_record_and_emits_upserted() {
    let service = test_service();
    let batch = service
        .arm_emulated_loop(context(1), emulated_spec("loop-1", Some(2), 1_000))
        .expect("arm");
    let record = batch.r#loop.expect("record");
    assert!(!record.native);
    assert_eq!(record.status, LoopStatus::Active);
    assert_eq!(record.next_fire_at_ms, Some(1_000));
    assert_eq!(batch.envelopes.len(), 1);
    assert!(matches!(
        batch.envelopes[0].event,
        SessionEvent::LoopUpserted(_)
    ));
    // The scheduler re-arm read sees it.
    assert_eq!(
        service.active_emulated_loops("session-1").expect("list").len(),
        1
    );
}

#[test]
fn record_emulated_fire_reschedules_then_caps_at_max_fires() {
    let service = test_service();
    service
        .arm_emulated_loop(context(1), emulated_spec("loop-1", Some(2), 1_000))
        .expect("arm");

    // Fire 1: still armed, next fire advanced, LoopFired only.
    let out1 = service
        .record_emulated_fire(context(2), "loop-1".to_string(), 10_000)
        .expect("fire1")
        .expect("outcome1");
    assert!(out1.still_armed);
    assert!(out1.next_fire_at_ms.is_some());
    assert_eq!(out1.batch.envelopes.len(), 1);
    assert!(matches!(
        out1.batch.envelopes[0].event,
        SessionEvent::LoopFired(_)
    ));

    // Fire 2: hits the cap -> retired (LoopFired + LoopRemoved), disarmed.
    let out2 = service
        .record_emulated_fire(context(3), "loop-1".to_string(), 20_000)
        .expect("fire2")
        .expect("outcome2");
    assert!(!out2.still_armed);
    assert!(out2.next_fire_at_ms.is_none());
    assert_eq!(out2.batch.envelopes.len(), 2);
    assert!(matches!(
        out2.batch.envelopes[1].event,
        SessionEvent::LoopRemoved(_)
    ));
    assert!(service
        .active_emulated_loops("session-1")
        .expect("list")
        .is_empty());
}

#[test]
fn record_emulated_fire_ignores_native_loops() {
    let service = test_service();
    // A native loop must never be fired by the emulated scheduler.
    service
        .ingest_native_event(
            context(1),
            LoopNativeEventKind::Upserted,
            Some(wire("cron-1", "ping", LoopWireStatus::Active)),
            None,
        )
        .expect("ingest native");
    let outcome = service
        .record_emulated_fire(context(2), "cron-1".to_string(), 10_000)
        .expect("call");
    assert!(outcome.is_none());
}

#[test]
fn reconcile_native_loops_marks_missing_as_cleared() {
    let service = test_service();
    service
        .ingest_native_event(
            context(1),
            LoopNativeEventKind::Upserted,
            Some(wire("cron-1", "ping", LoopWireStatus::Active)),
            None,
        )
        .expect("c1");
    service
        .ingest_native_event(
            context(2),
            LoopNativeEventKind::Upserted,
            Some(wire("cron-2", "pong", LoopWireStatus::Active)),
            None,
        )
        .expect("c2");
    assert_eq!(service.current_loops("session-1").expect("list").len(), 2);

    // The harness now only lists cron-1 -> cron-2 is gone.
    let envelopes = service
        .reconcile_native_loops(
            context(3),
            vec![wire("cron-1", "ping", LoopWireStatus::Active)],
        )
        .expect("reconcile");
    assert!(envelopes
        .iter()
        .any(|envelope| matches!(envelope.event, SessionEvent::LoopRemoved(_))));
    let active = service.current_loops("session-1").expect("list");
    assert_eq!(active.len(), 1);
    assert_eq!(active[0].loop_id, "cron-1");
}
