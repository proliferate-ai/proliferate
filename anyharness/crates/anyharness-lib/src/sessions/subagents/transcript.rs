use anyharness_contract::v1::{
    ContentPart, SessionEvent, TranscriptItemKind, TranscriptItemStatus,
};

use super::model::SubagentTranscriptSearchMatch;

pub(super) const READ_LATEST_TURNS_DEFAULT_LIMIT: usize = 3;
pub(super) const READ_LATEST_TURNS_MAX_LIMIT: usize = 10;
pub(super) const SEARCH_TRANSCRIPT_DEFAULT_LIMIT: usize = 10;
pub(super) const SEARCH_TRANSCRIPT_MAX_LIMIT: usize = 25;
pub(super) const LATEST_TURN_EVENT_BUDGET: i64 = 200;
pub(super) const SEARCH_EVENT_BUDGET: i64 = 500;
const ASSISTANT_TEXT_MAX_CHARS: usize = 4_000;
const SEARCH_SNIPPET_CONTEXT_CHARS: usize = 120;

pub(super) fn summarize_turn_events(
    events: &[crate::sessions::model::SessionEventRecord],
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

pub(super) fn search_match_for_record(
    record: crate::sessions::model::SessionEventRecord,
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

fn transcript_search_text(record: &crate::sessions::model::SessionEventRecord) -> String {
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
