use super::*;
use crate::app::test_support;
use crate::domains::sessions::model::{SessionMcpBindingPolicy, SessionRecord};
use crate::persistence::Db;

fn session_record(id: &str) -> SessionRecord {
    SessionRecord {
        id: id.to_string(),
        workspace_id: "workspace-1".to_string(),
        agent_kind: "claude".to_string(),
        native_session_id: None,
        agent_auth_contexts: None,
        requested_model_id: None,
        current_model_id: None,
        requested_mode_id: None,
        current_mode_id: None,
        title: None,
        thinking_level_id: None,
        thinking_budget_tokens: None,
        status: "idle".to_string(),
        created_at: "2026-08-08T00:00:00Z".to_string(),
        updated_at: "2026-08-08T00:00:00Z".to_string(),
        last_prompt_at: None,
        closed_at: None,
        dismissed_at: None,
        mcp_bindings_ciphertext: None,
        mcp_binding_summaries_json: None,
        mcp_binding_policy: SessionMcpBindingPolicy::InheritWorkspace,
        system_prompt_append: None,
        subagents_enabled: true,
        action_capabilities_json: None,
        origin: None,
    }
}

fn event(
    seq: i64,
    turn_id: &str,
    event_type: &str,
    payload: serde_json::Value,
) -> SessionEventRecord {
    SessionEventRecord {
        id: 0,
        session_id: "peer-1".to_string(),
        seq,
        timestamp: format!("2026-08-08T00:00:{seq:02}Z"),
        event_type: event_type.to_string(),
        turn_id: Some(turn_id.to_string()),
        item_id: Some(format!("item-{seq}")),
        payload_json: payload.to_string(),
    }
}

fn assistant_message(text: &str) -> serde_json::Value {
    json!({
        "type": "item_completed",
        "item": {
            "kind": "assistant_message",
            "status": "completed",
            "sourceAgentKind": "claude",
            "contentParts": [{ "type": "text", "text": text }],
        }
    })
}

fn store_with_two_turns() -> SessionStore {
    let db = Db::open_in_memory().expect("open db");
    test_support::seed_workspace_with_repo_root(&db, "workspace-1", "local", "/tmp/workspace-1");
    let store = SessionStore::new(db);
    store
        .insert(&session_record("peer-1"))
        .expect("insert peer");
    for record in [
        event(
            1,
            "turn-1",
            "turn_started",
            json!({ "type": "turn_started" }),
        ),
        event(
            2,
            "turn-1",
            "item_completed",
            assistant_message("first answer"),
        ),
        event(
            3,
            "turn-1",
            "turn_ended",
            json!({ "type": "turn_ended", "stopReason": "end_turn" }),
        ),
        event(
            4,
            "turn-2",
            "turn_started",
            json!({ "type": "turn_started" }),
        ),
        event(
            5,
            "turn-2",
            "item_completed",
            assistant_message("second answer"),
        ),
    ] {
        store.append_event(&record).expect("append event");
    }
    store
}

fn raw_event(seq: i64, event_type: &str, payload_json: &str) -> SessionEventRecord {
    SessionEventRecord {
        id: 0,
        session_id: "peer-1".to_string(),
        seq,
        timestamp: "2026-08-08T00:01:00Z".to_string(),
        event_type: event_type.to_string(),
        turn_id: Some("turn-1".to_string()),
        item_id: Some("item-1".to_string()),
        payload_json: payload_json.to_string(),
    }
}

#[test]
fn read_event_sanitizer_redacts_streaming_deltas() {
    let sanitized = sanitize_event_record(raw_event(
        7,
        "item_delta",
        r#"{"type":"item_delta","delta":{"appendText":"secret"}}"#,
    ))
    .expect("sanitize event");

    assert_eq!(sanitized["type"], "item_delta_redacted");
    assert!(sanitized.get("event").is_none());
}

#[test]
fn read_event_sanitizer_removes_raw_tool_io() {
    let sanitized = sanitize_event_record(raw_event(
        7,
        "item_completed",
        r#"{
            "type": "item_completed",
            "item": {
                "kind": "tool_invocation",
                "status": "completed",
                "sourceAgentKind": "claude",
                "rawInput": { "token": "secret" },
                "rawOutput": { "result": "secret" },
                "contentParts": []
            }
        }"#,
    ))
    .expect("sanitize event");

    let item = &sanitized["event"]["item"];
    assert!(item.get("rawInput").is_none());
    assert!(item.get("rawOutput").is_none());
    assert_eq!(item["kind"], "tool_invocation");
}

#[test]
fn latest_turns_summarize_any_session_off_its_own_turn_events() {
    let store = store_with_two_turns();

    let turns = read_session_latest_turns(&store, "peer-1", None).expect("read latest turns");

    assert_eq!(turns.len(), 2);
    assert_eq!(turns[0].turn_id, "turn-1");
    assert_eq!(turns[0].outcome, "completed");
    assert_eq!(turns[0].stop_reason.as_deref(), Some("end_turn"));
    assert_eq!(turns[0].assistant_text.as_deref(), Some("first answer"));
    assert_eq!(turns[1].turn_id, "turn-2");
    assert_eq!(turns[1].outcome, "running");
    assert_eq!(turns[1].stop_reason, None);
}

#[test]
fn latest_turns_honor_the_requested_and_maximum_budgets() {
    let store = store_with_two_turns();

    let one_turn = read_session_latest_turns(&store, "peer-1", Some(1)).expect("read one turn");
    assert_eq!(one_turn.len(), 1);
    assert_eq!(one_turn[0].turn_id, "turn-2");

    let clamped =
        read_session_latest_turns(&store, "peer-1", Some(usize::MAX)).expect("read clamped turns");
    assert_eq!(clamped.len(), 2);
}

#[test]
fn searching_a_peer_transcript_returns_bounded_snippets() {
    let store = store_with_two_turns();

    let matches =
        search_session_transcript(&store, "peer-1", "SECOND", None).expect("search transcript");

    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].seq, 5);
    assert!(matches[0].snippet.contains("second answer"));

    let error = search_session_transcript(&store, "peer-1", "   ", None)
        .err()
        .expect("blank query is rejected");
    assert!(error.to_string().contains("query is required"));
}

#[test]
fn reading_peer_events_never_scans_past_the_requested_page() {
    let store = store_with_two_turns();

    // The store call is the bounded one (`list_events_after_oldest_limited`),
    // so a small page over a long log reads a small page — it does not load
    // the log and throw most of it away.
    let slice = read_session_events(&store, "peer-1", Some(0), Some(2)).expect("read events");

    assert_eq!(
        slice
            .events
            .iter()
            .map(|event| event["seq"].as_i64().expect("seq"))
            .collect::<Vec<_>>(),
        vec![1, 2],
    );
    assert_eq!(slice.next_since_seq, Some(2));
    assert!(!slice.truncated);

    // Resuming from the cursor returns the rest, so bounding the scan did
    // not bound what an agent can eventually read.
    let rest = read_session_events(&store, "peer-1", slice.next_since_seq, Some(10))
        .expect("read the rest");
    assert_eq!(rest.events.len(), 3);
    assert_eq!(rest.next_since_seq, Some(5));
}

#[test]
fn reading_peer_events_sanitizes_and_cursors_the_same_way_child_reads_do() {
    let store = store_with_two_turns();

    let slice = read_session_events(&store, "peer-1", Some(3), Some(1)).expect("read events");

    assert_eq!(slice.session_id, "peer-1");
    assert_eq!(slice.events.len(), 1);
    assert_eq!(slice.events[0]["seq"], 4);
    assert_eq!(slice.next_since_seq, Some(4));
    assert!(!slice.truncated);
}
