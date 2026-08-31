//! Actor-level proof of the seat usage-limit observation seam
//! (`turn/finish.rs`): the REAL turn loop receives a provider error carrying
//! limit prose, and the serving-seat gate decides whether that becomes a
//! cooling record plus the typed `seat_usage_limit` error event — or stays an
//! ordinary unclassified turn error on a non-seat (gateway) session.
//!
//! Drives `SessionActor::run_turn` end to end over the module's duplex fake
//! agent, resolving the held prompt with an ERROR response instead of a stop
//! reason — the same wire shape a real harness produces when Claude.ai
//! refuses the request on a plan limit.

use anyharness_contract::v1::ErrorEventDetails;

use super::*;
use crate::domains::agents::seat_cooling::SeatCoolingStore;
use crate::integrations::acp::provider_errors::SEAT_USAGE_LIMIT_CODE;

const SERVING_SEAT_ID: &str = "30000000-0000-4000-8000-0000000000aa";

/// Run one turn whose prompt resolves with `error_message` as a provider
/// error, on an actor whose `serving_seat_id` is `serving_seat`. Returns the
/// store (for events + cooling assertions).
async fn run_failing_turn(serving_seat: Option<&str>, error_message: String) -> SessionStore {
    let mut harness = spawn_harness().await;
    harness.actor.serving_seat_id = serving_seat.map(str::to_string);
    let store = harness._store.clone();

    let (_handle, _turn_id, responder, _cancel_rx, actor_task) = start_turn(harness).await;
    responder
        .respond_with_result(Err(acp::Error::new(-32603, error_message)))
        .expect("resolve the held prompt with a provider error");
    tokio::time::timeout(Duration::from_secs(5), actor_task)
        .await
        .expect("actor turn task finished")
        .expect("actor turn task joined");
    store
}

fn error_receipt(store: &SessionStore) -> anyharness_contract::v1::ErrorEvent {
    let events = store.list_events(SESSION_ID).expect("events");
    let error_row = events
        .iter()
        .find(|event| event.event_type == "error")
        .expect("the failed turn persists an error event");
    let SessionEvent::Error(receipt) =
        serde_json::from_str(&error_row.payload_json).expect("error payload")
    else {
        panic!("expected an error event payload");
    };
    receipt
}

/// (i) A seat-launched session (actor state `serving_seat_id = Some(..)`)
/// whose turn dies with the classic limit prose: the `seat_cooling` table
/// holds that seat with exactly the carried reset, and the persisted error
/// event is the typed `seat_usage_limit` with `SeatUsageLimit` details.
#[tokio::test]
async fn seat_limit_turn_error_cools_the_serving_seat_and_emits_typed_event() {
    let local = tokio::task::LocalSet::new();
    local
        .run_until(async move {
            let reset_epoch_s = chrono::Utc::now().timestamp() + 3_600;
            let store = run_failing_turn(
                Some(SERVING_SEAT_ID),
                format!("Claude AI usage limit reached|{reset_epoch_s}"),
            )
            .await;

            // The cooling record: exactly the reset the error carried.
            let cooling = SeatCoolingStore::new(store.db());
            assert_eq!(
                cooling.cooling_until(SERVING_SEAT_ID, chrono::Utc::now().timestamp()),
                Some(reset_epoch_s),
                "the serving seat must cool until the carried reset"
            );

            // The typed turn error, with the structured details.
            let receipt = error_receipt(&store);
            assert_eq!(receipt.code.as_deref(), Some(SEAT_USAGE_LIMIT_CODE));
            match receipt.details {
                Some(ErrorEventDetails::SeatUsageLimit {
                    ref seat_id,
                    ref window,
                    ref reset_at,
                }) => {
                    assert_eq!(seat_id, SERVING_SEAT_ID);
                    assert_eq!(window, "five_hour");
                    let parsed = chrono::DateTime::parse_from_rfc3339(reset_at)
                        .expect("reset_at is RFC3339");
                    assert_eq!(parsed.timestamp(), reset_epoch_s);
                }
                ref other => panic!("expected SeatUsageLimit details, got {other:?}"),
            }
            // The session errored, not idled.
            assert_eq!(
                store
                    .find_by_id(SESSION_ID)
                    .expect("read session")
                    .expect("session exists")
                    .status,
                "errored"
            );
        })
        .await;
}

/// (ii) The SAME limit prose on a session with no serving seat (a gateway
/// route): the gate must hold — no cooling row appears, and the error is
/// classified exactly as it was before this slice (no `seat_usage_limit`
/// code, no seat details).
#[tokio::test]
async fn seat_limit_prose_on_a_non_seat_session_marks_nothing() {
    let local = tokio::task::LocalSet::new();
    local
        .run_until(async move {
            let reset_epoch_s = chrono::Utc::now().timestamp() + 3_600;
            let store = run_failing_turn(
                None,
                format!("Claude AI usage limit reached|{reset_epoch_s}"),
            )
            .await;

            // No seat cooled — the table stays empty.
            let cooling_rows: i64 = store
                .db()
                .with_conn(|conn| {
                    conn.query_row("SELECT COUNT(*) FROM seat_cooling", [], |row| row.get(0))
                })
                .expect("count seat_cooling rows");
            assert_eq!(cooling_rows, 0, "a non-seat session must never cool a seat");

            // The turn error persists, classified as before this slice.
            let receipt = error_receipt(&store);
            assert_ne!(receipt.code.as_deref(), Some(SEAT_USAGE_LIMIT_CODE));
            assert_eq!(receipt.code, None, "limit prose alone classifies nothing");
            assert!(receipt.details.is_none());
            assert!(receipt.message.contains("usage limit reached"));
        })
        .await;
}
