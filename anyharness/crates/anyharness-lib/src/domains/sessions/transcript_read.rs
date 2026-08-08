//! Budgeted, sanitized transcript reads for one session.
//!
//! These are the reads an agent gets over any session it is authorized for.
//! The subagent tools resolve a link first and then land here, so the budgets,
//! the sanitizer and the snippet shape have exactly one implementation: an
//! agent reading a peer sees the same slices it has always seen reading a
//! child.
//!
//! Authorization is the caller's job (`sessions::authorize` for agent ops, the
//! link store for the subagent tools). Nothing in this module checks rights.

use anyharness_contract::v1::{
    ContentPart, SessionEvent, StopReason, TranscriptItemKind, TranscriptItemStatus,
};
use serde_json::json;

use super::model::SessionEventRecord;
use super::store::SessionStore;

pub const READ_EVENTS_DEFAULT_LIMIT: usize = 50;
pub const READ_EVENTS_MAX_LIMIT: usize = 100;
pub const READ_EVENTS_MAX_BYTES: usize = 256 * 1024;
pub const READ_LATEST_TURNS_DEFAULT_LIMIT: usize = 3;
pub const READ_LATEST_TURNS_MAX_LIMIT: usize = 10;
pub const SEARCH_TRANSCRIPT_DEFAULT_LIMIT: usize = 10;
pub const SEARCH_TRANSCRIPT_MAX_LIMIT: usize = 25;
pub const LATEST_TURN_EVENT_BUDGET: i64 = 200;
pub const SEARCH_EVENT_BUDGET: i64 = 500;
const ASSISTANT_TEXT_MAX_CHARS: usize = 4_000;
const SEARCH_SNIPPET_CONTEXT_CHARS: usize = 120;

#[derive(Debug, Clone)]
pub struct SessionEventSlice {
    pub session_id: String,
    pub events: Vec<serde_json::Value>,
    pub next_since_seq: Option<i64>,
    pub truncated: bool,
}

#[derive(Debug, Clone)]
pub struct TranscriptSearchMatch {
    pub seq: i64,
    pub timestamp: String,
    pub turn_id: Option<String>,
    pub item_id: Option<String>,
    pub snippet: String,
}

/// One completed (or still running) turn, summarized off the event log.
///
/// The subagent reads summarize the same turns off `link_completions` instead,
/// because a linked child records a completion row per turn. An arbitrary
/// session has no such rows, so the turn boundaries come from its
/// `turn_started` / `turn_ended` events.
#[derive(Debug, Clone)]
pub struct SessionTurnSummary {
    pub turn_id: String,
    pub outcome: String,
    pub stop_reason: Option<String>,
    pub started_at: String,
    pub last_event_seq: i64,
    pub assistant_text: Option<String>,
    pub tool_errors: Vec<String>,
    pub event_count: usize,
}

pub fn read_session_events(
    session_store: &SessionStore,
    session_id: &str,
    since_seq: Option<i64>,
    limit: Option<usize>,
) -> anyhow::Result<SessionEventSlice> {
    let limit = limit
        .unwrap_or(READ_EVENTS_DEFAULT_LIMIT)
        .min(READ_EVENTS_MAX_LIMIT);
    let after_seq = since_seq.unwrap_or(0);
    let mut records = session_store.list_events_after(session_id, after_seq)?;
    records.truncate(limit);

    let mut total_bytes = 0usize;
    let mut truncated = false;
    let mut events = Vec::with_capacity(records.len());
    let mut next_since_seq = None;
    for record in records {
        let seq = record.seq;
        let oversized_placeholder = oversized_event_placeholder(&record);
        let event = sanitize_event_record(record)?;
        let event_bytes = serde_json::to_vec(&event)?.len();
        if total_bytes.saturating_add(event_bytes) > READ_EVENTS_MAX_BYTES {
            truncated = true;
            if events.is_empty() {
                events.push(oversized_placeholder);
                next_since_seq = Some(seq);
            }
            break;
        }
        total_bytes += event_bytes;
        next_since_seq = Some(seq);
        events.push(event);
    }

    Ok(SessionEventSlice {
        session_id: session_id.to_string(),
        events,
        next_since_seq,
        truncated,
    })
}

pub fn search_session_transcript(
    session_store: &SessionStore,
    session_id: &str,
    query: &str,
    limit: Option<usize>,
) -> anyhow::Result<Vec<TranscriptSearchMatch>> {
    let query = query.trim();
    if query.is_empty() {
        anyhow::bail!("query is required");
    }
    let limit = limit
        .unwrap_or(SEARCH_TRANSCRIPT_DEFAULT_LIMIT)
        .clamp(1, SEARCH_TRANSCRIPT_MAX_LIMIT);
    let needle = query.to_lowercase();
    let records = session_store.list_events_limited(session_id, SEARCH_EVENT_BUDGET)?;
    let mut matches = Vec::new();
    for record in records {
        if matches.len() >= limit {
            break;
        }
        if let Some(entry) = search_match_for_record(record, &needle, query.len()) {
            matches.push(entry);
        }
    }
    Ok(matches)
}

pub fn read_session_latest_turns(
    session_store: &SessionStore,
    session_id: &str,
    limit: Option<usize>,
) -> anyhow::Result<Vec<SessionTurnSummary>> {
    let limit = limit
        .unwrap_or(READ_LATEST_TURNS_DEFAULT_LIMIT)
        .clamp(1, READ_LATEST_TURNS_MAX_LIMIT);
    let records = session_store.list_events_for_latest_turns(
        session_id,
        limit as i64,
        LATEST_TURN_EVENT_BUDGET,
    )?;

    let mut turn_ids = Vec::new();
    for record in &records {
        let Some(turn_id) = record.turn_id.as_deref() else {
            continue;
        };
        if !turn_ids.iter().any(|known: &String| known == turn_id) {
            turn_ids.push(turn_id.to_string());
        }
    }
    if turn_ids.len() > limit {
        turn_ids.drain(..turn_ids.len() - limit);
    }

    let mut turns = Vec::with_capacity(turn_ids.len());
    for turn_id in turn_ids {
        let turn_events = records
            .iter()
            .filter(|record| record.turn_id.as_deref() == Some(turn_id.as_str()))
            .cloned()
            .collect::<Vec<_>>();
        let (assistant_text, tool_errors) = summarize_turn_events(&turn_events);
        let stop_reason = turn_events.iter().find_map(turn_stop_reason);
        turns.push(SessionTurnSummary {
            outcome: turn_outcome(stop_reason.as_ref()).to_string(),
            stop_reason: stop_reason.as_ref().map(ToString::to_string),
            started_at: turn_events
                .first()
                .map(|record| record.timestamp.clone())
                .unwrap_or_default(),
            last_event_seq: turn_events
                .last()
                .map(|record| record.seq)
                .unwrap_or_default(),
            assistant_text,
            tool_errors,
            event_count: turn_events.len(),
            turn_id,
        });
    }
    Ok(turns)
}

fn turn_stop_reason(record: &SessionEventRecord) -> Option<StopReason> {
    match serde_json::from_str::<SessionEvent>(&record.payload_json) {
        Ok(SessionEvent::TurnEnded(event)) => Some(event.stop_reason),
        _ => None,
    }
}

fn turn_outcome(stop_reason: Option<&StopReason>) -> &'static str {
    match stop_reason {
        None => "running",
        Some(StopReason::Cancelled) => "cancelled",
        Some(_) => "completed",
    }
}

pub(crate) fn summarize_turn_events(
    events: &[SessionEventRecord],
) -> (Option<String>, Vec<String>) {
    let mut assistant = String::new();
    let mut tool_errors = Vec::new();
    for record in events {
        let Ok(event) = serde_json::from_str::<SessionEvent>(&record.payload_json) else {
            continue;
        };
        if let SessionEvent::ItemCompleted(item_event) = event {
            match item_event.item.kind {
                TranscriptItemKind::AssistantMessage => {
                    append_content_text(&mut assistant, &item_event.item.content_parts);
                }
                TranscriptItemKind::ToolInvocation => {
                    if matches!(item_event.item.status, TranscriptItemStatus::Failed) {
                        let label = item_event
                            .item
                            .title
                            .or(item_event.item.native_tool_name)
                            .unwrap_or_else(|| "tool invocation failed".to_string());
                        tool_errors.push(label);
                    }
                }
                _ => {}
            }
        }
    }
    let assistant_text = if assistant.trim().is_empty() {
        None
    } else {
        Some(trim_chars(assistant.trim(), ASSISTANT_TEXT_MAX_CHARS))
    };
    (assistant_text, tool_errors)
}

pub(crate) fn search_match_for_record(
    record: SessionEventRecord,
    needle: &str,
    query_len: usize,
) -> Option<TranscriptSearchMatch> {
    let text = transcript_search_text(&record);
    if text.is_empty() {
        return None;
    }
    let index = text.to_lowercase().find(needle)?;
    Some(TranscriptSearchMatch {
        seq: record.seq,
        timestamp: record.timestamp,
        turn_id: record.turn_id,
        item_id: record.item_id,
        snippet: make_snippet(&text, index, query_len),
    })
}

pub(crate) fn sanitize_event_record(
    record: SessionEventRecord,
) -> anyhow::Result<serde_json::Value> {
    let event: SessionEvent = serde_json::from_str(&record.payload_json)?;
    if matches!(event, SessionEvent::ItemDelta(_)) {
        return Ok(json!({
            "seq": record.seq,
            "timestamp": record.timestamp,
            "turnId": record.turn_id,
            "itemId": record.item_id,
            "type": "item_delta_redacted",
        }));
    }
    let mut event_value = serde_json::to_value(event)?;
    redact_tool_io(&mut event_value);
    Ok(json!({
        "seq": record.seq,
        "timestamp": record.timestamp,
        "turnId": record.turn_id,
        "itemId": record.item_id,
        "event": event_value,
    }))
}

fn redact_tool_io(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(map) => {
            map.remove("rawInput");
            map.remove("rawOutput");
            for value in map.values_mut() {
                redact_tool_io(value);
            }
        }
        serde_json::Value::Array(items) => {
            for value in items {
                redact_tool_io(value);
            }
        }
        _ => {}
    }
}

fn oversized_event_placeholder(record: &SessionEventRecord) -> serde_json::Value {
    json!({
        "seq": record.seq,
        "timestamp": record.timestamp.clone(),
        "turnId": record.turn_id.clone(),
        "itemId": record.item_id.clone(),
        "eventType": record.event_type.clone(),
        "type": "event_oversized_redacted",
    })
}

fn transcript_search_text(record: &SessionEventRecord) -> String {
    let Ok(event) = serde_json::from_str::<SessionEvent>(&record.payload_json) else {
        return String::new();
    };
    match event {
        SessionEvent::ItemCompleted(item_event) => {
            let mut text = String::new();
            if let Some(title) = item_event.item.title {
                text.push_str(&title);
                text.push('\n');
            }
            if let Some(tool) = item_event.item.native_tool_name {
                text.push_str(&tool);
                text.push('\n');
            }
            append_content_text(&mut text, &item_event.item.content_parts);
            text
        }
        SessionEvent::ItemStarted(item_event) => {
            let mut text = String::new();
            if let Some(title) = item_event.item.title {
                text.push_str(&title);
                text.push('\n');
            }
            if let Some(tool) = item_event.item.native_tool_name {
                text.push_str(&tool);
                text.push('\n');
            }
            append_content_text(&mut text, &item_event.item.content_parts);
            text
        }
        SessionEvent::Error(error) => format!("{:?}", error.details),
        _ => String::new(),
    }
}

fn append_content_text(target: &mut String, parts: &[ContentPart]) {
    for part in parts {
        if let ContentPart::Text { text } = part {
            if !target.is_empty() {
                target.push('\n');
            }
            target.push_str(text);
        }
    }
}

fn make_snippet(text: &str, index: usize, needle_len: usize) -> String {
    let start = text[..index]
        .char_indices()
        .rev()
        .nth(SEARCH_SNIPPET_CONTEXT_CHARS)
        .map(|(idx, _)| idx)
        .unwrap_or(0);
    let raw_end = index.saturating_add(needle_len);
    let end = text[raw_end.min(text.len())..]
        .char_indices()
        .nth(SEARCH_SNIPPET_CONTEXT_CHARS)
        .map(|(idx, _)| raw_end.min(text.len()) + idx)
        .unwrap_or(text.len());
    let mut snippet = text[start..end].replace('\n', " ");
    if start > 0 {
        snippet.insert_str(0, "...");
    }
    if end < text.len() {
        snippet.push_str("...");
    }
    snippet
}

fn trim_chars(text: &str, max_chars: usize) -> String {
    let mut iter = text.chars();
    let trimmed = iter.by_ref().take(max_chars).collect::<String>();
    if iter.next().is_some() {
        format!("{trimmed}...")
    } else {
        trimmed
    }
}

#[cfg(test)]
mod tests {
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

    fn event(seq: i64, turn_id: &str, event_type: &str, payload: serde_json::Value) -> SessionEventRecord {
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
        store.insert(&session_record("peer-1")).expect("insert peer");
        for record in [
            event(1, "turn-1", "turn_started", json!({ "type": "turn_started" })),
            event(2, "turn-1", "item_completed", assistant_message("first answer")),
            event(
                3,
                "turn-1",
                "turn_ended",
                json!({ "type": "turn_ended", "stopReason": "end_turn" }),
            ),
            event(4, "turn-2", "turn_started", json!({ "type": "turn_started" })),
            event(5, "turn-2", "item_completed", assistant_message("second answer")),
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

        let clamped = read_session_latest_turns(&store, "peer-1", Some(usize::MAX))
            .expect("read clamped turns");
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
    fn reading_peer_events_sanitizes_and_cursors_the_same_way_child_reads_do() {
        let store = store_with_two_turns();

        let slice = read_session_events(&store, "peer-1", Some(3), Some(1)).expect("read events");

        assert_eq!(slice.session_id, "peer-1");
        assert_eq!(slice.events.len(), 1);
        assert_eq!(slice.events[0]["seq"], 4);
        assert_eq!(slice.next_since_seq, Some(4));
        assert!(!slice.truncated);
    }
}
