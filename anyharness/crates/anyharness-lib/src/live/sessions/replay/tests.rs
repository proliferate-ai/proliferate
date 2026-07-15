use super::*;
use crate::domains::sessions::runtime_event::RuntimeInjectedSessionEvent;

fn ts(value: &str) -> chrono::DateTime<chrono::FixedOffset> {
    chrono::DateTime::parse_from_rfc3339(value).expect("valid timestamp")
}

#[test]
fn replay_delay_caps_negative_deltas_and_zero_speed() {
    let first = ts("2026-04-16T18:00:00Z");
    let later = ts("2026-04-16T18:00:10Z");
    let earlier = ts("2026-04-16T17:59:59Z");

    assert_eq!(replay_delay(None, first, 1.0), Duration::ZERO);
    assert_eq!(replay_delay(Some(first), later, 1.0), MAX_REPLAY_GAP);
    assert_eq!(
        replay_delay(Some(first), later, 2.0),
        Duration::from_millis(750)
    );
    assert_eq!(replay_delay(Some(first), earlier, 1.0), Duration::ZERO);
    assert_eq!(replay_delay(Some(first), later, 0.0), Duration::ZERO);
}

#[test]
fn remap_event_rewrites_session_started_native_id() {
    let remapped = remap_event(
        SessionEvent::SessionStarted(SessionStartedEvent {
            native_session_id: "native-old".to_string(),
            source_agent_kind: "codex".to_string(),
        }),
        "session-new",
    );

    match remapped {
        SessionEvent::SessionStarted(event) => {
            assert_eq!(event.native_session_id, "replay:session-new");
            assert_eq!(event.source_agent_kind, "codex");
        }
        _ => panic!("expected session_started"),
    }
}

#[tokio::test]
async fn replay_actor_rejects_runtime_event_injection() {
    let (tx, rx) = tokio::sync::oneshot::channel();

    let disposition = handle_non_replay_command(
        SessionCommand::InjectRuntimeEvent {
            event: RuntimeInjectedSessionEvent::SessionInfoUpdate {
                title: Some("Renamed".to_string()),
                updated_at: None,
            },
            respond_to: tx,
        },
        false,
    )
    .await;

    assert!(disposition.is_none());
    let error = rx
        .await
        .expect("response")
        .expect_err("replay should reject injection");
    assert!(matches!(
        error,
        RuntimeEventInjectionError::SessionReplaying
    ));
}

#[tokio::test]
async fn replay_actor_rejects_pending_prompt_reorder_and_steer() {
    let (reorder_tx, reorder_rx) = tokio::sync::oneshot::channel();
    let reorder_disposition = handle_non_replay_command(
        SessionCommand::ReorderPendingPrompts {
            expected_seqs: vec![1, 2],
            desired_seqs: vec![2, 1],
            respond_to: reorder_tx,
        },
        false,
    )
    .await;
    assert!(reorder_disposition.is_none());
    assert!(matches!(
        reorder_rx
            .await
            .expect("reorder response")
            .expect_err("replay should reject reorder"),
        QueueMutationError::NotFound,
    ));

    let (steer_tx, steer_rx) = tokio::sync::oneshot::channel();
    let steer_disposition = handle_non_replay_command(
        SessionCommand::SteerPendingPrompt {
            seq: 1,
            respond_to: steer_tx,
        },
        false,
    )
    .await;
    assert!(steer_disposition.is_none());
    assert!(matches!(
        steer_rx
            .await
            .expect("steer response")
            .expect_err("replay should reject steer"),
        QueueMutationError::NotFound,
    ));
}
