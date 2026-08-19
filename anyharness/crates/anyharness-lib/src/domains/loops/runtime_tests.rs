use super::*;
use anyharness_contract::v1::{
    Loop, LoopFiredPayload, LoopSchedule, LoopScheduleKind, LoopStatus, LoopUpsertedPayload,
    SessionEvent,
};

const LOOP_EVENT_TYPES: &[&str] = &["loop_upserted", "loop_fired"];

fn loop_upserted_envelope(loop_id: &str) -> SessionEventEnvelope {
    SessionEventEnvelope {
        session_id: "session-1".to_string(),
        seq: 1,
        timestamp: "now".to_string(),
        turn_id: None,
        item_id: None,
        event: SessionEvent::LoopUpserted(LoopUpsertedPayload {
            r#loop: Loop {
                loop_id: loop_id.to_string(),
                prompt: "ping".to_string(),
                schedule: LoopSchedule {
                    kind: LoopScheduleKind::Cron,
                    expr: "*/1 * * * *".to_string(),
                },
                recurring: true,
                status: LoopStatus::Active,
                native: true,
                last_fired_at_ms: None,
                fire_count: 0,
                updated_at_ms: 1,
            },
        }),
    }
}

fn loop_fired_envelope(loop_id: &str) -> SessionEventEnvelope {
    SessionEventEnvelope {
        session_id: "session-1".to_string(),
        seq: 2,
        timestamp: "now".to_string(),
        turn_id: None,
        item_id: None,
        event: SessionEvent::LoopFired(LoopFiredPayload {
            r#loop: Loop {
                loop_id: loop_id.to_string(),
                prompt: "ping".to_string(),
                schedule: LoopSchedule {
                    kind: LoopScheduleKind::Cron,
                    expr: "*/1 * * * *".to_string(),
                },
                recurring: true,
                status: LoopStatus::Active,
                native: true,
                last_fired_at_ms: Some(2),
                fire_count: 1,
                updated_at_ms: 2,
            },
            fired_at_ms: 2,
            turn_id: None,
        }),
    }
}

#[test]
fn uncorrelated_match_accepts_any_loop_event_type() {
    let envelope = loop_upserted_envelope("loop-A");
    assert!(loop_event_matches(&envelope, LOOP_EVENT_TYPES, None));
    assert!(!loop_event_matches(&envelope, &["loop_removed"], None));
}

#[test]
fn loop_id_correlation_skips_unrelated_loop_events() {
    // Two native loops on the same session: setting loop-B must not be
    // confirmed by loop-A's event (the bug this fix addresses).
    let loop_a_event = loop_upserted_envelope("loop-A");
    let loop_b_event = loop_upserted_envelope("loop-B");
    // A stale accounting echo for loop-A must NOT confirm a set of loop-B.
    assert!(!loop_event_matches(
        &loop_a_event,
        LOOP_EVENT_TYPES,
        Some("loop-B")
    ));
    // Only loop-B's own echo confirms.
    assert!(loop_event_matches(
        &loop_b_event,
        LOOP_EVENT_TYPES,
        Some("loop-B")
    ));
}

#[test]
fn loop_id_correlation_works_across_event_types() {
    // A loop_fired event for loop-B also confirms if we are waiting for
    // loop-B (the set can trigger an immediate fire on the native side).
    let fired = loop_fired_envelope("loop-B");
    assert!(loop_event_matches(&fired, LOOP_EVENT_TYPES, Some("loop-B")));
    assert!(!loop_event_matches(
        &fired,
        LOOP_EVENT_TYPES,
        Some("loop-A")
    ));
}
