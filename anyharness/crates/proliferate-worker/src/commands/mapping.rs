use serde_json::{json, Map, Value};

use crate::cloud_client::commands::CloudCommand;

pub fn start_session_payload(command: &CloudCommand) -> Value {
    request_payload(command)
}

pub fn prompt_payload(command: &CloudCommand) -> Value {
    if command.payload.get("blocks").is_some() {
        return command.payload.clone();
    }
    if let Some(request) = command.payload.get("request") {
        return request.clone();
    }
    if let Some(text) = command.payload.get("text").and_then(Value::as_str) {
        return json!({
            "promptId": command.idempotency_key,
            "blocks": [{ "type": "text", "text": text }]
        });
    }
    command.payload.clone()
}

pub fn config_payload(command: &CloudCommand) -> Value {
    if let Some(request) = command.payload.get("request") {
        return request.clone();
    }
    let config_id = command
        .payload
        .get("configId")
        .or_else(|| command.payload.get("config_id"))
        .cloned();
    let value = command.payload.get("value").cloned();
    match (config_id, value) {
        (Some(config_id), Some(value)) => json!({ "configId": config_id, "value": value }),
        _ => command.payload.clone(),
    }
}

pub fn interaction_payload(command: &CloudCommand) -> Value {
    if let Some(request) = command.payload.get("request") {
        return request.clone();
    }
    if let Some(resolution) = command.payload.get("resolution") {
        return resolution.clone();
    }
    without_keys(
        &command.payload,
        &["interactionId", "interaction_id", "requestId", "request_id"],
    )
}

pub fn interaction_request_id(command: &CloudCommand) -> Option<String> {
    command
        .payload
        .get("interactionId")
        .or_else(|| command.payload.get("interaction_id"))
        .or_else(|| command.payload.get("requestId"))
        .or_else(|| command.payload.get("request_id"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

fn request_payload(command: &CloudCommand) -> Value {
    command
        .payload
        .get("request")
        .cloned()
        .unwrap_or_else(|| command.payload.clone())
}

fn without_keys(value: &Value, keys: &[&str]) -> Value {
    let Some(object) = value.as_object() else {
        return value.clone();
    };
    let mut output = Map::new();
    for (key, value) in object {
        if !keys.contains(&key.as_str()) {
            output.insert(key.clone(), value.clone());
        }
    }
    Value::Object(output)
}
