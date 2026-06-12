use super::super::state::{AcpToolPayload, ParsedMeta};
use anyharness_contract::v1::ContentPart;

pub(in crate::live::sessions::sink) fn extract_text(content: &serde_json::Value) -> String {
    match content {
        serde_json::Value::String(text) => text.clone(),
        serde_json::Value::Object(map) => {
            if map.get("type").and_then(serde_json::Value::as_str) == Some("text") {
                return map
                    .get("text")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default()
                    .to_string();
            }
            String::new()
        }
        _ => String::new(),
    }
}

fn is_subagent_tool(tool_kind: Option<&str>, native_tool_name: Option<&str>) -> bool {
    native_tool_name == Some("Agent") || tool_kind == Some("think")
}

pub(in crate::live::sessions::sink) fn normalize_text_parts(
    payload: &AcpToolPayload,
    tool_kind: Option<&str>,
    native_tool_name: Option<&str>,
    raw_input: Option<&serde_json::Value>,
    raw_output: Option<&serde_json::Value>,
    meta: &ParsedMeta,
) -> Vec<ContentPart> {
    let mut parts = Vec::new();

    if is_subagent_tool(tool_kind, native_tool_name) {
        if let Some(text) = extract_subagent_input_text(meta, raw_input) {
            parts.push(ContentPart::ToolInputText {
                text,
                text_truncated: None,
                text_original_bytes: None,
            });
        }
        if let Some(text) = extract_subagent_result_text(payload, raw_output, meta) {
            parts.push(ContentPart::ToolResultText {
                text,
                text_truncated: None,
                text_original_bytes: None,
            });
        }
        return parts;
    }

    if let Some(text) = extract_result_text(payload, raw_output, raw_input) {
        parts.push(ContentPart::ToolResultText {
            text,
            text_truncated: None,
            text_original_bytes: None,
        });
    }

    parts
}

fn extract_subagent_input_text(
    meta: &ParsedMeta,
    raw_input: Option<&serde_json::Value>,
) -> Option<String> {
    extract_claude_tool_response_field(meta, "prompt").or_else(|| {
        raw_input
            .and_then(|value| value.get("prompt"))
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(String::from)
    })
}

fn extract_subagent_result_text(
    payload: &AcpToolPayload,
    raw_output: Option<&serde_json::Value>,
    meta: &ParsedMeta,
) -> Option<String> {
    if let Some(content) = extract_claude_tool_response_content(meta) {
        return Some(content);
    }

    if payload.status.as_deref() == Some("completed") {
        return extract_result_text_without_input_fallback(payload, raw_output);
    }

    None
}

pub(in crate::live::sessions::sink) fn extract_preview(
    value: Option<&serde_json::Value>,
) -> Option<String> {
    let value = value?;
    match value {
        serde_json::Value::String(text) => Some(text.clone()),
        serde_json::Value::Object(map) => {
            if let Some(text) = map
                .get("aggregated_output")
                .and_then(serde_json::Value::as_str)
            {
                return Some(text.to_string());
            }
            if let Some(text) = map
                .get("formatted_output")
                .and_then(serde_json::Value::as_str)
            {
                return Some(text.to_string());
            }
            if let Some(text) = map.get("stdout").and_then(serde_json::Value::as_str) {
                return Some(text.to_string());
            }
            if let Some(text) = map.get("stderr").and_then(serde_json::Value::as_str) {
                if !text.is_empty() {
                    return Some(text.to_string());
                }
            }
            if let Some(text) = map.get("content").and_then(serde_json::Value::as_str) {
                return Some(text.to_string());
            }
            if let Some(text) = map.get("new_string").and_then(serde_json::Value::as_str) {
                return Some(text.to_string());
            }
            if let Some(text) = map.get("text").and_then(serde_json::Value::as_str) {
                return Some(text.to_string());
            }
            None
        }
        serde_json::Value::Array(items) => {
            let text = items
                .iter()
                .filter_map(extract_preview_value)
                .collect::<Vec<_>>()
                .join("\n");
            (!text.is_empty()).then_some(text)
        }
        _ => None,
    }
}

pub(in crate::live::sessions::sink) fn extract_preview_value(
    value: &serde_json::Value,
) -> Option<String> {
    match value {
        serde_json::Value::String(text) => Some(text.clone()),
        serde_json::Value::Object(map) => {
            if map.get("type").and_then(serde_json::Value::as_str) == Some("text") {
                return map
                    .get("text")
                    .and_then(serde_json::Value::as_str)
                    .map(String::from);
            }
            map.get("content")
                .and_then(|content| content.get("text"))
                .and_then(serde_json::Value::as_str)
                .map(String::from)
        }
        _ => None,
    }
}

fn extract_claude_tool_response_field(meta: &ParsedMeta, key: &str) -> Option<String> {
    meta.claude_code
        .as_ref()
        .and_then(|meta| meta.tool_response.as_ref())
        .and_then(|value| value.get(key))
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(String::from)
}

fn extract_claude_tool_response_content(meta: &ParsedMeta) -> Option<String> {
    meta.claude_code
        .as_ref()
        .and_then(|meta| meta.tool_response.as_ref())
        .and_then(|value| value.get("content"))
        .and_then(|value| extract_preview(Some(value)))
}

fn extract_result_text(
    payload: &AcpToolPayload,
    raw_output: Option<&serde_json::Value>,
    raw_input: Option<&serde_json::Value>,
) -> Option<String> {
    if let Some(content) = &payload.content {
        let text = content
            .iter()
            .filter_map(extract_preview_value)
            .collect::<Vec<_>>()
            .join("\n");
        if !text.is_empty() {
            return Some(text);
        }
    }

    extract_preview(raw_output).or_else(|| extract_preview(raw_input))
}

fn extract_result_text_without_input_fallback(
    payload: &AcpToolPayload,
    raw_output: Option<&serde_json::Value>,
) -> Option<String> {
    if let Some(content) = &payload.content {
        let text = content
            .iter()
            .filter_map(extract_preview_value)
            .collect::<Vec<_>>()
            .join("\n");
        if !text.is_empty() {
            return Some(text);
        }
    }

    extract_preview(raw_output)
}

pub(in crate::live::sessions::sink) fn count_lines(text: &str) -> i64 {
    if text.is_empty() {
        0
    } else {
        text.lines().count() as i64
    }
}
