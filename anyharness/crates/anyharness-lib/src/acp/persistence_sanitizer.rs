use agent_client_protocol as acp;
use anyharness_contract::v1::{
    ContentPart, ItemCompletedEvent, ItemDeltaEvent, ItemStartedEvent, SessionEvent,
    TranscriptItemDeltaPayload, TranscriptItemPayload,
};

const MAX_PERSISTED_OUTPUT_BYTES: usize = 16 * 1024;
const TRUNCATION_MARKER: &str = "\n[truncated for storage]";

pub fn sanitize_session_event_for_sqlite(event: &SessionEvent) -> SessionEvent {
    let mut event = event.clone();
    match &mut event {
        SessionEvent::ItemStarted(ItemStartedEvent { item }) => sanitize_item_payload(item),
        SessionEvent::ItemDelta(ItemDeltaEvent { delta }) => sanitize_item_delta_payload(delta),
        SessionEvent::ItemCompleted(ItemCompletedEvent { item }) => sanitize_item_payload(item),
        _ => {}
    }
    event
}

pub fn sanitize_raw_notification_for_sqlite(
    notification: &acp::SessionNotification,
) -> serde_json::Value {
    let mut value = serde_json::to_value(notification).unwrap_or_else(|_| serde_json::Value::Null);
    sanitize_generated_output_json(&mut value);
    value
}

pub fn sanitize_raw_notification_json_for_sqlite(payload_json: &str) -> String {
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
