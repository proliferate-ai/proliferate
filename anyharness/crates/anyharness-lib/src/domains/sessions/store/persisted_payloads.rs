use anyharness_contract::v1::{
    ContentPart, GoalStatus, ItemCompletedEvent, ItemDeltaEvent, ItemStartedEvent, SessionEvent,
    TranscriptItemDeltaPayload, TranscriptItemKind, TranscriptItemPayload, TranscriptItemStatus,
};

use crate::domains::sessions::extensions::SessionTurnOutcome;
use crate::domains::sessions::model::bounded_assistant_text;

const MAX_PERSISTED_OUTPUT_BYTES: usize = 16 * 1024;
const TRUNCATION_MARKER: &str = "\n[truncated for storage]";

pub(crate) fn sanitize_session_event_for_sqlite(event: &SessionEvent) -> SessionEvent {
    let mut event = event.clone();
    match &mut event {
        SessionEvent::ItemStarted(ItemStartedEvent { item }) => sanitize_item_payload(item),
        SessionEvent::ItemDelta(ItemDeltaEvent { delta }) => sanitize_item_delta_payload(delta),
        SessionEvent::ItemCompleted(ItemCompletedEvent { item }) => sanitize_item_payload(item),
        _ => {}
    }
    event
}

pub(crate) struct RepairedAssistantCompletion {
    pub item_id: String,
    pub payload_json: String,
}

pub(crate) struct PersistedTurnRepairFacts {
    pub assistant_text: Option<String>,
    pub open_assistant_completions: Vec<RepairedAssistantCompletion>,
    pub prompt_begun: bool,
    pub engine_outcome: Option<SessionTurnOutcome>,
}

struct AssistantItemState {
    item_id: String,
    item: TranscriptItemPayload,
    completed: bool,
}

pub(crate) fn persisted_turn_repair_facts(
    payloads: &[(Option<String>, String)],
) -> Result<PersistedTurnRepairFacts, serde_json::Error> {
    use std::collections::HashMap;

    let mut indexes = HashMap::<String, usize>::new();
    let mut items = Vec::<AssistantItemState>::new();
    let mut prompt_begun = false;
    let mut engine_outcome = None;
    for (item_id, payload) in payloads {
        let Ok(event) = serde_json::from_str::<SessionEvent>(payload) else {
            continue;
        };
        engine_outcome = inferred_engine_outcome(&event).or(engine_outcome);
        prompt_begun |= matches!(
            &event,
            SessionEvent::ItemStarted(started)
                if matches!(started.item.kind, TranscriptItemKind::UserMessage)
        ) || matches!(
            &event,
            SessionEvent::ItemCompleted(completed)
                if matches!(completed.item.kind, TranscriptItemKind::UserMessage)
        );
        let Some(item_id) = item_id.as_ref() else {
            continue;
        };
        match event {
            SessionEvent::ItemStarted(started)
                if matches!(started.item.kind, TranscriptItemKind::AssistantMessage) =>
            {
                if !indexes.contains_key(item_id) {
                    indexes.insert(item_id.clone(), items.len());
                    items.push(AssistantItemState {
                        item_id: item_id.clone(),
                        item: started.item,
                        completed: false,
                    });
                }
            }
            SessionEvent::ItemDelta(delta) => {
                if let Some(index) = indexes.get(item_id).copied() {
                    apply_persisted_delta(&mut items[index].item, delta.delta);
                }
            }
            SessionEvent::ItemCompleted(completed)
                if matches!(completed.item.kind, TranscriptItemKind::AssistantMessage) =>
            {
                if let Some(index) = indexes.get(item_id).copied() {
                    items[index].item = completed.item;
                    items[index].completed = true;
                } else {
                    indexes.insert(item_id.clone(), items.len());
                    items.push(AssistantItemState {
                        item_id: item_id.clone(),
                        item: completed.item,
                        completed: true,
                    });
                }
            }
            _ => {}
        }
    }

    let messages = items
        .iter()
        .map(|state| text_parts(&state.item.content_parts))
        .collect::<Vec<_>>();
    let open_assistant_completions = items
        .into_iter()
        .filter(|state| !state.completed)
        .map(|mut state| {
            state.item.status = TranscriptItemStatus::Completed;
            Ok(RepairedAssistantCompletion {
                item_id: state.item_id,
                payload_json: serde_json::to_string(&SessionEvent::ItemCompleted(
                    ItemCompletedEvent { item: state.item },
                ))?,
            })
        })
        .collect::<Result<Vec<_>, serde_json::Error>>()?;
    Ok(PersistedTurnRepairFacts {
        assistant_text: bounded_assistant_text(&messages),
        open_assistant_completions,
        prompt_begun,
        engine_outcome,
    })
}

fn apply_persisted_delta(item: &mut TranscriptItemPayload, delta: TranscriptItemDeltaPayload) {
    if let Some(value) = delta.is_transient {
        item.is_transient = value;
    }
    if let Some(value) = delta.status {
        item.status = value;
    }
    if let Some(value) = delta.title {
        item.title = Some(value);
    }
    if let Some(value) = delta.native_tool_name {
        item.native_tool_name = Some(value);
    }
    if let Some(value) = delta.parent_tool_call_id {
        item.parent_tool_call_id = Some(value);
    }
    if let Some(value) = delta.raw_input {
        item.raw_input = Some(value);
    }
    if let Some(value) = delta.raw_output {
        item.raw_output = Some(value);
    }
    if let Some(parts) = delta.replace_content_parts {
        item.content_parts = parts;
    }
    if let Some(text) = delta.append_text {
        match item.content_parts.last_mut() {
            Some(ContentPart::Text { text: current }) => current.push_str(&text),
            _ => item.content_parts.push(ContentPart::Text { text }),
        }
    }
    if let Some(parts) = delta.append_content_parts {
        item.content_parts.extend(parts);
    }
}

fn inferred_engine_outcome(event: &SessionEvent) -> Option<SessionTurnOutcome> {
    match event {
        SessionEvent::GoalMet(_) => Some(SessionTurnOutcome::Completed),
        SessionEvent::GoalCleared(_) => Some(SessionTurnOutcome::Cancelled),
        SessionEvent::GoalUpdated(updated) => match updated.goal.status {
            GoalStatus::Active => None,
            GoalStatus::Met => Some(SessionTurnOutcome::Completed),
            GoalStatus::Failed | GoalStatus::Blocked => Some(SessionTurnOutcome::Failed),
            GoalStatus::Cleared | GoalStatus::Paused => Some(SessionTurnOutcome::Cancelled),
        },
        _ => None,
    }
}

fn text_parts(parts: &[ContentPart]) -> String {
    parts
        .iter()
        .filter_map(|part| match part {
            ContentPart::Text { text } => Some(text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub(crate) fn sanitize_raw_notification_json_for_sqlite(payload_json: &str) -> String {
    let Ok(mut value) = serde_json::from_str::<serde_json::Value>(payload_json) else {
        return payload_json.to_string();
    };
    sanitize_generated_output_json(&mut value);
    serde_json::to_string(&value).unwrap_or_else(|_| payload_json.to_string())
}

fn sanitize_item_payload(payload: &mut TranscriptItemPayload) {
    if let Some(raw_input) = payload.raw_input.as_mut() {
        sanitize_generated_output_json(raw_input);
    }
    if let Some(raw_output) = payload.raw_output.as_mut() {
        sanitize_generated_output_json(raw_output);
    }
    for part in &mut payload.content_parts {
        sanitize_content_part(part);
    }
}

fn sanitize_item_delta_payload(payload: &mut TranscriptItemDeltaPayload) {
    if let Some(raw_input) = payload.raw_input.as_mut() {
        sanitize_generated_output_json(raw_input);
    }
    if let Some(raw_output) = payload.raw_output.as_mut() {
        sanitize_generated_output_json(raw_output);
    }
    if let Some(parts) = payload.replace_content_parts.as_mut() {
        for part in parts {
            sanitize_content_part(part);
        }
    }
    if let Some(parts) = payload.append_content_parts.as_mut() {
        for part in parts {
            sanitize_content_part(part);
        }
    }
}

fn sanitize_content_part(part: &mut ContentPart) {
    match part {
        ContentPart::Resource {
            preview,
            preview_truncated,
            preview_original_bytes,
            ..
        }
        | ContentPart::FileRead {
            preview,
            preview_truncated,
            preview_original_bytes,
            ..
        } => truncate_optional_string(preview, preview_truncated, preview_original_bytes),
        ContentPart::TerminalOutput {
            data,
            data_truncated,
            data_original_bytes,
            ..
        } => truncate_optional_string(data, data_truncated, data_original_bytes),
        ContentPart::FileChange {
            patch,
            patch_truncated,
            patch_original_bytes,
            preview,
            preview_truncated,
            preview_original_bytes,
            ..
        } => {
            truncate_optional_string(patch, patch_truncated, patch_original_bytes);
            truncate_optional_string(preview, preview_truncated, preview_original_bytes);
        }
        ContentPart::ToolInputText {
            text,
            text_truncated,
            text_original_bytes,
        }
        | ContentPart::ToolResultText {
            text,
            text_truncated,
            text_original_bytes,
        } => truncate_string(text, text_truncated, text_original_bytes),
        _ => {}
    }
}

fn sanitize_generated_output_json(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(map) => {
            let keys = map.keys().cloned().collect::<Vec<_>>();
            for key in keys {
                let already_truncated = map
                    .get(&format!("{key}_truncated"))
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false);
                if let Some(child) = map.get_mut(&key) {
                    if should_truncate_json_leaf(&key) {
                        if already_truncated {
                            continue;
                        }
                        if let serde_json::Value::String(text) = child {
                            let mut truncated = None;
                            let mut original_bytes = None;
                            truncate_string(text, &mut truncated, &mut original_bytes);
                            if truncated == Some(true) {
                                map.entry(format!("{key}_truncated"))
                                    .or_insert(serde_json::Value::Bool(true));
                                if let Some(bytes) = original_bytes {
                                    map.entry(format!("{key}_original_bytes")).or_insert(
                                        serde_json::Value::Number(serde_json::Number::from(bytes)),
                                    );
                                }
                            }
                        }
                    } else if !is_preserved_control_key(&key) {
                        sanitize_generated_output_json(child);
                    }
                }
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                sanitize_generated_output_json(item);
            }
        }
        _ => {}
    }
}

fn truncate_optional_string(
    value: &mut Option<String>,
    truncated: &mut Option<bool>,
    original_bytes: &mut Option<u64>,
) {
    if let Some(value) = value.as_mut() {
        truncate_string(value, truncated, original_bytes);
    }
}

fn truncate_string(
    value: &mut String,
    truncated: &mut Option<bool>,
    original_bytes: &mut Option<u64>,
) {
    if truncated == &Some(true) {
        return;
    }
    let len = value.len();
    if len <= MAX_PERSISTED_OUTPUT_BYTES {
        return;
    }
    let content_cap = MAX_PERSISTED_OUTPUT_BYTES.saturating_sub(TRUNCATION_MARKER.len());
    let cutoff = value
        .char_indices()
        .map(|(index, _)| index)
        .take_while(|index| *index <= content_cap)
        .last()
        .unwrap_or(0);
    let mut next = value[..cutoff].to_string();
    next.push_str(TRUNCATION_MARKER);
    *value = next;
    *truncated = Some(true);
    *original_bytes = Some(original_bytes.unwrap_or(len as u64));
}

fn should_truncate_json_leaf(key: &str) -> bool {
    matches!(
        key,
        "aggregated_output"
            | "aggregatedOutput"
            | "output"
            | "result"
            | "error"
            | "full_output"
            | "fullOutput"
            | "data"
            | "preview"
            | "patch"
    )
}

fn is_preserved_control_key(key: &str) -> bool {
    matches!(
        key,
        "_anyharness"
            | "plan"
            | "plans"
            | "bodyMarkdown"
            | "canonicalPlan"
            | "id"
            | "ids"
            | "status"
            | "state"
            | "title"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncation_is_idempotent() {
        let mut text = "x".repeat(MAX_PERSISTED_OUTPUT_BYTES + 128);
        let mut truncated = None;
        let mut original_bytes = None;

        truncate_string(&mut text, &mut truncated, &mut original_bytes);
        let first = text.clone();

        truncate_string(&mut text, &mut truncated, &mut original_bytes);

        assert_eq!(text, first);
        assert_eq!(truncated, Some(true));
        assert_eq!(
            original_bytes,
            Some((MAX_PERSISTED_OUTPUT_BYTES + 128) as u64)
        );
        assert!(text.len() <= MAX_PERSISTED_OUTPUT_BYTES);
    }

    #[test]
    fn raw_json_preserves_control_metadata() {
        let mut value = serde_json::json!({
            "_anyharness": {
                "aggregated_output": "x".repeat(MAX_PERSISTED_OUTPUT_BYTES + 128),
            },
            "aggregated_output": "x".repeat(MAX_PERSISTED_OUTPUT_BYTES + 128),
        });

        sanitize_generated_output_json(&mut value);
        sanitize_generated_output_json(&mut value);

        let control = value["_anyharness"]["aggregated_output"].as_str().unwrap();
        let output = value["aggregated_output"].as_str().unwrap();
        assert_eq!(control.len(), MAX_PERSISTED_OUTPUT_BYTES + 128);
        assert!(output.len() <= MAX_PERSISTED_OUTPUT_BYTES);
        assert_eq!(value["aggregated_output_truncated"], true);
        assert_eq!(
            value["aggregated_output_original_bytes"],
            (MAX_PERSISTED_OUTPUT_BYTES + 128) as u64,
        );
    }
}
