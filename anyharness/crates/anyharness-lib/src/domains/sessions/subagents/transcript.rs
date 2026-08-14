use anyharness_contract::v1::{
    ContentPart, PendingPromptRemovalReason, PromptProvenance, SessionEvent, TranscriptItemKind,
    TranscriptItemPayload, TranscriptItemStatus,
};

use super::model::SubagentTranscriptSearchMatch;
use crate::domains::sessions::model::bounded_assistant_text;

pub(super) const READ_LATEST_TURNS_DEFAULT_LIMIT: usize = 3;
pub(super) const READ_LATEST_TURNS_MAX_LIMIT: usize = 10;
pub(super) const SEARCH_TRANSCRIPT_DEFAULT_LIMIT: usize = 10;
pub(super) const SEARCH_TRANSCRIPT_MAX_LIMIT: usize = 25;
pub(super) const LATEST_TURN_EVENT_BUDGET: i64 = 200;
pub(super) const SEARCH_EVENT_BUDGET: i64 = 500;
const SEARCH_SNIPPET_CONTEXT_CHARS: usize = 120;

pub(in crate::domains::sessions) struct CompletionWakeEventExpectation<'a> {
    pub prompt_id: String,
    pub notification_text: &'a str,
    pub session_link_id: &'a str,
    pub delivery_id: &'a str,
    pub label: Option<&'a str>,
}

pub(in crate::domains::sessions) enum PersistedCompletionWakeEvent {
    TurnStarted,
    ItemStarted {
        item_value: serde_json::Value,
    },
    ItemCompleted {
        item_value: serde_json::Value,
    },
    PendingPromptRemoved {
        seq: i64,
        prompt_id: Option<String>,
        executed: bool,
    },
}

pub(in crate::domains::sessions) fn persisted_completion_wake_event(
    event_type: &str,
    payload_json: &str,
    expected: &CompletionWakeEventExpectation<'_>,
) -> Option<PersistedCompletionWakeEvent> {
    let event = serde_json::from_str::<SessionEvent>(payload_json).ok()?;
    if event.event_type() != event_type {
        return None;
    }
    match event {
        SessionEvent::TurnStarted(_) => Some(PersistedCompletionWakeEvent::TurnStarted),
        SessionEvent::ItemStarted(started)
            if completion_wake_item_matches(&started.item, expected) =>
        {
            Some(PersistedCompletionWakeEvent::ItemStarted {
                item_value: serde_json::to_value(started.item).ok()?,
            })
        }
        SessionEvent::ItemCompleted(completed)
            if completion_wake_item_matches(&completed.item, expected) =>
        {
            Some(PersistedCompletionWakeEvent::ItemCompleted {
                item_value: serde_json::to_value(completed.item).ok()?,
            })
        }
        SessionEvent::PendingPromptRemoved(removed) => {
            Some(PersistedCompletionWakeEvent::PendingPromptRemoved {
                seq: removed.seq,
                prompt_id: removed.prompt_id,
                executed: removed.reason == PendingPromptRemovalReason::Executed,
            })
        }
        _ => None,
    }
}

fn completion_wake_item_matches(
    item: &TranscriptItemPayload,
    expected: &CompletionWakeEventExpectation<'_>,
) -> bool {
    let provenance_matches = matches!(
        item.prompt_provenance.as_ref(),
        Some(PromptProvenance::SubagentWake {
            session_link_id,
            completion_id,
            label,
        }) if session_link_id == expected.session_link_id
            && completion_id == expected.delivery_id
            && label.as_deref() == expected.label
    );
    matches!(item.kind, TranscriptItemKind::UserMessage)
        && matches!(item.status, TranscriptItemStatus::Completed)
        && !item.is_transient
        && item.message_id.is_none()
        && item.prompt_id.as_deref() == Some(expected.prompt_id.as_str())
        && item.title.is_none()
        && item.tool_call_id.is_none()
        && item.native_tool_name.is_none()
        && item.parent_tool_call_id.is_none()
        && item.raw_input.is_none()
        && item.raw_output.is_none()
        && matches!(
            item.content_parts.as_slice(),
            [ContentPart::Text { text }] if text == expected.notification_text
        )
        && provenance_matches
}

pub(super) fn summarize_turn_events(
    events: &[crate::domains::sessions::model::SessionEventRecord],
) -> (Option<String>, Vec<String>) {
    let mut assistant_parts = Vec::new();
    let mut tool_errors = Vec::new();
    for record in events {
        let Ok(event) = serde_json::from_str::<SessionEvent>(&record.payload_json) else {
            continue;
        };
        if let SessionEvent::ItemCompleted(item_event) = event {
            match item_event.item.kind {
                TranscriptItemKind::AssistantMessage => {
                    for part in &item_event.item.content_parts {
                        if let ContentPart::Text { text } = part {
                            assistant_parts.push(text.clone());
                        }
                    }
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
    let assistant_text = bounded_assistant_text(&assistant_parts);
    (assistant_text, tool_errors)
}

pub(super) fn search_match_for_record(
    record: crate::domains::sessions::model::SessionEventRecord,
    needle: &str,
    query_len: usize,
) -> Option<SubagentTranscriptSearchMatch> {
    let text = transcript_search_text(&record);
    if text.is_empty() {
        return None;
    }
    let index = text.to_lowercase().find(needle)?;
    Some(SubagentTranscriptSearchMatch {
        seq: record.seq,
        timestamp: record.timestamp,
        turn_id: record.turn_id,
        item_id: record.item_id,
        snippet: make_snippet(&text, index, query_len),
    })
}

fn transcript_search_text(record: &crate::domains::sessions::model::SessionEventRecord) -> String {
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
