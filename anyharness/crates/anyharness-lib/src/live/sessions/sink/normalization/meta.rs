use super::super::state::{
    ParsedMeta, ANYHARNESS_TRANSCRIPT_EVENT_KEY, ANYHARNESS_TRANSCRIPT_META_KEY,
    ASSISTANT_MESSAGE_COMPLETED_EVENT, TRANSIENT_STATUS_EVENT,
};

pub(in crate::live::sessions::sink) fn parse_meta(
    meta: Option<&serde_json::Value>,
) -> ParsedMeta {
    meta.and_then(|value| serde_json::from_value(value.clone()).ok())
        .unwrap_or_default()
}

pub(in crate::live::sessions::sink) fn is_assistant_message_completed_marker(
    meta: Option<&serde_json::Value>,
) -> bool {
    meta.and_then(|value| value.get(ANYHARNESS_TRANSCRIPT_META_KEY))
        .and_then(|value| value.get(ANYHARNESS_TRANSCRIPT_EVENT_KEY))
        .and_then(serde_json::Value::as_str)
        == Some(ASSISTANT_MESSAGE_COMPLETED_EVENT)
}

pub(in crate::live::sessions::sink) fn is_transient_status_marker(
    meta: Option<&serde_json::Value>,
) -> bool {
    parse_meta(meta)
        .anyharness
        .and_then(|meta| meta.transcript_event)
        .as_deref()
        == Some(TRANSIENT_STATUS_EVENT)
}
