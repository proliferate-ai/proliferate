use std::path::PathBuf;
use std::sync::Arc;

use agent_client_protocol as acp;
use anyharness_contract::v1::{SessionEvent, SessionEventEnvelope, StopReason};
use serde::Deserialize;
use tokio::sync::broadcast;

use super::super::SessionEventSink;
use super::support::{drain_events, seeded_store};

const CLAUDE_FIXTURE: &str = include_str!(
    "../../../../../../../../fixtures/contracts/native-subagent-transcript/claude.json"
);
const CODEX_FIXTURE: &str = include_str!(
    "../../../../../../../../fixtures/contracts/native-subagent-transcript/codex.json"
);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeSubagentFixture {
    provider: String,
    parent_id: String,
    parent_terminal_before_turn_end: bool,
    acp_notifications: Vec<acp::schema::SessionNotification>,
    events: Vec<SessionEventEnvelope>,
}

#[test]
fn native_subagent_fixtures_preserve_live_and_replay_attribution() {
    for fixture_json in [CLAUDE_FIXTURE, CODEX_FIXTURE] {
        let fixture: NativeSubagentFixture =
            serde_json::from_str(fixture_json).expect("native subagent fixture parses");
        let store = seeded_store();
        let (tx, mut rx) = broadcast::channel(64);
        let mut sink = SessionEventSink::new(
            "session-1".to_string(),
            fixture.provider.clone(),
            PathBuf::from("/tmp/workspace"),
            tx,
            Arc::new(store.clone()),
        );

        for notification in &fixture.acp_notifications {
            let _ = sink.ingest(notification);
        }
        let before_turn_end = store
            .list_events("session-1")
            .expect("pre-turn-boundary replay");
        let parent_was_terminal = before_turn_end.iter().any(|record| {
            record.item_id.as_deref() == Some(fixture.parent_id.as_str())
                && serde_json::from_str::<SessionEvent>(&record.payload_json)
                    .is_ok_and(|event| matches!(event, SessionEvent::ItemCompleted(_)))
        });
        assert_eq!(
            parent_was_terminal, fixture.parent_terminal_before_turn_end,
            "{} parent terminal causality",
            fixture.provider,
        );
        sink.turn_ended(StopReason::EndTurn);

        let live = drain_events(&mut rx);
        let persisted = store.list_events("session-1").expect("persisted replay");
        assert_eq!(
            persisted.len(),
            live.len(),
            "{} event count",
            fixture.provider
        );
        for (record, envelope) in persisted.iter().zip(&live) {
            assert_eq!(
                record.seq, envelope.seq,
                "{} replay sequence",
                fixture.provider
            );
            assert_eq!(
                record.turn_id, envelope.turn_id,
                "{} replay turn",
                fixture.provider
            );
            assert_eq!(
                record.item_id, envelope.item_id,
                "{} replay item",
                fixture.provider
            );
            let replay_event: SessionEvent =
                serde_json::from_str(&record.payload_json).expect("persisted event parses");
            assert_eq!(
                serde_json::to_value(replay_event).expect("serialize replay event"),
                serde_json::to_value(&envelope.event).expect("serialize live event"),
                "{} replay payload",
                fixture.provider,
            );
        }

        assert_eq!(
            live.len(),
            fixture.events.len(),
            "{} fixture count",
            fixture.provider
        );
        for (actual, expected) in live.iter().zip(&fixture.events) {
            assert_eq!(
                actual.seq, expected.seq,
                "{} fixture sequence",
                fixture.provider
            );
            let message_item_has_runtime_envelope_id = match &expected.event {
                SessionEvent::ItemStarted(event) => event.item.message_id.is_some(),
                SessionEvent::ItemCompleted(event) => event.item.message_id.is_some(),
                _ => false,
            };
            if !message_item_has_runtime_envelope_id {
                assert_eq!(
                    actual.item_id, expected.item_id,
                    "{} fixture item identity at seq {}",
                    fixture.provider, actual.seq,
                );
            }
            assert_eq!(
                serde_json::to_value(&actual.event).expect("serialize actual event"),
                serde_json::to_value(&expected.event).expect("serialize fixture event"),
                "{} normalized event payload at seq {}",
                fixture.provider,
                actual.seq,
            );
        }
    }
}
