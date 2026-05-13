use anyharness_contract::v1::SessionEventEnvelope;
use serde_json::Value;

use crate::cloud_client::events::CloudEvent;
use crate::error::Result;

pub fn map_session_event(
    target_id: &str,
    workspace_id: Option<&str>,
    envelope: &SessionEventEnvelope,
) -> Result<CloudEvent> {
    let payload = serde_json::to_value(&envelope.event)?;
    let payload_size_bytes = serde_json::to_vec(&payload)?.len();
    Ok(CloudEvent {
        target_id: target_id.to_string(),
        workspace_id: workspace_id.map(ToOwned::to_owned),
        session_id: envelope.session_id.clone(),
        anyharness_event_id: format!("{}:{}", envelope.session_id, envelope.seq),
        anyharness_sequence: envelope.seq,
        event_type: envelope.event.event_type().to_string(),
        schema_version: 1,
        source_kind: source_kind(&payload).to_string(),
        created_at: envelope.timestamp.clone(),
        payload: Some(Value::Object(
            [
                ("event".to_string(), payload),
                (
                    "turnId".to_string(),
                    envelope
                        .turn_id
                        .clone()
                        .map(Value::String)
                        .unwrap_or(Value::Null),
                ),
                (
                    "itemId".to_string(),
                    envelope
                        .item_id
                        .clone()
                        .map(Value::String)
                        .unwrap_or(Value::Null),
                ),
            ]
            .into_iter()
            .collect(),
        )),
        payload_size_bytes,
        dedupe_key: format!("{}:{}:{}", target_id, envelope.session_id, envelope.seq),
    })
}

fn source_kind(payload: &Value) -> &'static str {
    match payload.get("type").and_then(Value::as_str) {
        Some("item_delta") => "assistant",
        Some("item_completed") => "assistant",
        Some("pending_prompt_added") => "user",
        _ => "target",
    }
}
