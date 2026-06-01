use super::state::{
    BackgroundWorkMetadata, ParsedMeta, ANYHARNESS_META_KEY, BACKGROUND_WORK_TRACKER_KIND,
};
use super::SessionEventSink;
use crate::domains::sessions::model::SessionBackgroundWorkState;
use anyharness_contract::v1::{
    ContentPart, ItemCompletedEvent, ItemDeltaEvent, SessionEvent, TranscriptItemDeltaPayload,
    TranscriptItemKind, TranscriptItemPayload, TranscriptItemStatus,
};

impl SessionEventSink {
    pub fn resolve_background_tool_call(
        &mut self,
        turn_id: String,
        tool_call_id: String,
        state: SessionBackgroundWorkState,
        agent_id: Option<String>,
        output_file: String,
        result_text: String,
    ) {
        self.tool_items.remove(&tool_call_id);
        let raw_output = Some(background_work_raw_output(
            None,
            BackgroundWorkMetadata {
                state,
                agent_id,
                output_file,
            },
        ));

        let replacement_parts = vec![ContentPart::ToolResultText {
            text: result_text,
            text_truncated: None,
            text_original_bytes: None,
        }];
        self.emit_with_ids(
            SessionEvent::ItemDelta(ItemDeltaEvent {
                delta: TranscriptItemDeltaPayload {
                    is_transient: None,
                    status: Some(TranscriptItemStatus::Completed),
                    title: None,
                    native_tool_name: None,
                    parent_tool_call_id: None,
                    raw_input: None,
                    raw_output: raw_output.clone(),
                    append_text: None,
                    append_reasoning: None,
                    replace_content_parts: Some(replacement_parts.clone()),
                    append_content_parts: None,
                },
            }),
            Some(turn_id.clone()),
            Some(tool_call_id.clone()),
        );

        self.emit_with_ids(
            SessionEvent::ItemCompleted(ItemCompletedEvent {
                item: TranscriptItemPayload {
                    kind: TranscriptItemKind::ToolInvocation,
                    status: TranscriptItemStatus::Completed,
                    source_agent_kind: self.source_agent_kind.clone(),
                    is_transient: false,
                    message_id: None,
                    prompt_id: None,
                    title: None,
                    tool_call_id: Some(tool_call_id.clone()),
                    native_tool_name: None,
                    parent_tool_call_id: None,
                    raw_input: None,
                    raw_output,
                    content_parts: replacement_parts,
                    prompt_provenance: None,
                },
            }),
            Some(turn_id),
            Some(tool_call_id),
        );
    }
}

pub(in crate::live::sessions::event_sink) fn extract_background_work_metadata(
    raw_input: Option<&serde_json::Value>,
    meta: &ParsedMeta,
) -> Option<BackgroundWorkMetadata> {
    if !matches!(
        raw_input,
        Some(value) if value.get("run_in_background").and_then(serde_json::Value::as_bool) == Some(true)
    ) {
        return None;
    }

    let tool_response = meta.claude_code.as_ref()?.tool_response.as_ref()?;
    if meta.claude_code.as_ref()?.tool_name.as_deref() != Some("Agent") {
        return None;
    }
    if tool_response
        .get("isAsync")
        .and_then(serde_json::Value::as_bool)
        != Some(true)
    {
        return None;
    }

    let output_file = tool_response
        .get("outputFile")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?
        .to_string();

    let agent_id = tool_response
        .get("agentId")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(String::from);

    Some(BackgroundWorkMetadata {
        state: SessionBackgroundWorkState::Pending,
        agent_id,
        output_file,
    })
}

pub(in crate::live::sessions::event_sink) fn extract_existing_background_work_metadata(
    raw_output: Option<&serde_json::Value>,
) -> Option<BackgroundWorkMetadata> {
    let raw_output = raw_output?.as_object()?;
    let anyharness = raw_output.get(ANYHARNESS_META_KEY)?.as_object()?;
    let background_work = anyharness.get("backgroundWork")?.as_object()?;

    let state = background_work
        .get("state")
        .and_then(serde_json::Value::as_str)
        .map(SessionBackgroundWorkState::parse)?;
    let output_file = raw_output
        .get("outputFile")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?
        .to_string();
    let agent_id = raw_output
        .get("agentId")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(String::from);

    Some(BackgroundWorkMetadata {
        state,
        agent_id,
        output_file,
    })
}

pub(in crate::live::sessions::event_sink) fn background_work_raw_output(
    existing: Option<serde_json::Value>,
    metadata: BackgroundWorkMetadata,
) -> serde_json::Value {
    let mut base = match existing {
        Some(serde_json::Value::Object(map)) => serde_json::Value::Object(map),
        Some(value) => {
            let mut map = serde_json::Map::new();
            map.insert("value".to_string(), value);
            serde_json::Value::Object(map)
        }
        None => serde_json::Value::Object(serde_json::Map::new()),
    };

    let map = base
        .as_object_mut()
        .expect("background work raw output is always object-backed");
    map.insert("isAsync".to_string(), serde_json::Value::Bool(true));
    map.insert(
        "agentId".to_string(),
        metadata
            .agent_id
            .clone()
            .map(serde_json::Value::String)
            .unwrap_or(serde_json::Value::Null),
    );
    map.insert(
        "outputFile".to_string(),
        serde_json::Value::String(metadata.output_file.clone()),
    );

    let anyharness_meta = map
        .entry(ANYHARNESS_META_KEY.to_string())
        .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()));
    let anyharness_meta = anyharness_meta
        .as_object_mut()
        .expect("_anyharness metadata must be an object");
    anyharness_meta.insert(
        "backgroundWork".to_string(),
        serde_json::json!({
            "trackerKind": BACKGROUND_WORK_TRACKER_KIND,
            "state": metadata.state.as_str(),
        }),
    );

    base
}
