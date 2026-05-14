use serde_json::{json, Map, Value};

use crate::cloud_client::commands::CloudCommandEnvelope;

#[derive(Debug)]
pub enum AnyHarnessCommand {
    StartSession {
        body: Value,
    },
    SendPrompt {
        session_id: String,
        body: Value,
    },
    ResolveInteraction {
        session_id: String,
        request_id: String,
        body: Value,
    },
    UpdateSessionConfig {
        session_id: String,
        body: Value,
    },
    UpdateNormalizedSessionConfig {
        session_id: String,
        control_id: String,
        value: String,
    },
    CancelTurn {
        session_id: String,
    },
    CloseSession {
        session_id: String,
    },
}

#[derive(Debug)]
pub struct CommandMappingError {
    pub code: &'static str,
    pub message: String,
}

impl CommandMappingError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

pub fn map_cloud_command(
    command: &CloudCommandEnvelope,
) -> Result<AnyHarnessCommand, CommandMappingError> {
    match command.kind.as_str() {
        "start_session" => Ok(AnyHarnessCommand::StartSession {
            body: start_session_body(command)?,
        }),
        "send_prompt" => Ok(AnyHarnessCommand::SendPrompt {
            session_id: require_session_id(command)?,
            body: prompt_body(command)?,
        }),
        "resolve_interaction" => {
            let (request_id, body) = interaction_resolution_body(&command.payload)?;
            Ok(AnyHarnessCommand::ResolveInteraction {
                session_id: require_session_id(command)?,
                request_id,
                body,
            })
        }
        "update_session_config" => {
            let config = config_body(&command.payload)?;
            let session_id = require_session_id(command)?;
            match config {
                ConfigCommandBody::Raw(body) => {
                    Ok(AnyHarnessCommand::UpdateSessionConfig { session_id, body })
                }
                ConfigCommandBody::Normalized { control_id, value } => {
                    Ok(AnyHarnessCommand::UpdateNormalizedSessionConfig {
                        session_id,
                        control_id,
                        value,
                    })
                }
            }
        }
        "cancel_turn" => Ok(AnyHarnessCommand::CancelTurn {
            session_id: require_session_id(command)?,
        }),
        "close_session" => Ok(AnyHarnessCommand::CloseSession {
            session_id: require_session_id(command)?,
        }),
        kind => Err(CommandMappingError::new(
            "unsupported_command_kind",
            format!("Unsupported command kind: {kind}"),
        )),
    }
}

fn start_session_body(command: &CloudCommandEnvelope) -> Result<Value, CommandMappingError> {
    let Some(object) = command.payload.as_object() else {
        return Err(CommandMappingError::new(
            "invalid_start_session_payload",
            "start_session payload must be a JSON object.",
        ));
    };
    let workspace_id = string_field(object, "workspaceId", "workspace_id")
        .or_else(|| {
            command
                .workspace_id
                .clone()
                .filter(|value| !value.trim().is_empty())
        })
        .ok_or_else(|| {
            CommandMappingError::new(
                "missing_workspace_id",
                "start_session payload must contain workspaceId.",
            )
        })?;
    let agent_kind = string_field(object, "agentKind", "agent_kind").ok_or_else(|| {
        CommandMappingError::new(
            "missing_agent_kind",
            "start_session payload must contain agentKind.",
        )
    })?;
    let mut body = object.clone();
    body.insert("workspaceId".to_string(), Value::String(workspace_id));
    body.insert("agentKind".to_string(), Value::String(agent_kind));
    body.entry("origin".to_string())
        .or_insert_with(|| json!({ "kind": "system", "entrypoint": "cloud" }));
    Ok(Value::Object(body))
}

fn require_session_id(command: &CloudCommandEnvelope) -> Result<String, CommandMappingError> {
    command
        .session_id
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            CommandMappingError::new(
                "missing_session_id",
                format!("Command {} requires sessionId.", command.command_id),
            )
        })
}

fn prompt_body(command: &CloudCommandEnvelope) -> Result<Value, CommandMappingError> {
    let Some(object) = command.payload.as_object() else {
        return Err(CommandMappingError::new(
            "invalid_prompt_payload",
            "send_prompt payload must be a JSON object.",
        ));
    };
    let mut body = object.clone();
    if !body.contains_key("promptId") && !body.contains_key("prompt_id") {
        body.insert(
            "promptId".to_string(),
            Value::String(command.command_id.clone()),
        );
    }
    if object.get("blocks").is_some() {
        return Ok(Value::Object(body));
    }
    let Some(text) = string_field(object, "text", "prompt") else {
        return Err(CommandMappingError::new(
            "invalid_prompt_payload",
            "send_prompt payload must contain blocks or text.",
        ));
    };
    body.insert(
        "blocks".to_string(),
        json!([{ "type": "text", "text": text }]),
    );
    Ok(Value::Object(body))
}

fn interaction_resolution_body(payload: &Value) -> Result<(String, Value), CommandMappingError> {
    let Some(object) = payload.as_object() else {
        return Err(CommandMappingError::new(
            "invalid_interaction_payload",
            "resolve_interaction payload must be a JSON object.",
        ));
    };
    let Some(request_id) = string_field(object, "requestId", "request_id") else {
        return Err(CommandMappingError::new(
            "missing_interaction_request_id",
            "resolve_interaction payload must contain requestId.",
        ));
    };
    if let Some(resolution) = object.get("resolution") {
        return Ok((request_id, resolution.clone()));
    }
    let mut body = object.clone();
    body.remove("requestId");
    body.remove("request_id");
    Ok((request_id, Value::Object(body)))
}

enum ConfigCommandBody {
    Raw(Value),
    Normalized { control_id: String, value: String },
}

fn config_body(payload: &Value) -> Result<ConfigCommandBody, CommandMappingError> {
    let Some(object) = payload.as_object() else {
        return Err(CommandMappingError::new(
            "invalid_config_payload",
            "update_session_config payload must be a JSON object.",
        ));
    };
    if let Some(control_id) = string_field(object, "normalizedControl", "normalized_control") {
        let Some(value) = string_field(object, "value", "value") else {
            return Err(CommandMappingError::new(
                "missing_config_value",
                "update_session_config payload must contain value.",
            ));
        };
        return Ok(ConfigCommandBody::Normalized { control_id, value });
    }
    let Some(config_id) = string_field(object, "configId", "config_id") else {
        return Err(CommandMappingError::new(
            "missing_config_id",
            "update_session_config payload must contain configId or normalizedControl.",
        ));
    };
    let Some(value) = string_field(object, "value", "value") else {
        return Err(CommandMappingError::new(
            "missing_config_value",
            "update_session_config payload must contain value.",
        ));
    };
    Ok(ConfigCommandBody::Raw(
        json!({ "configId": config_id, "value": value }),
    ))
}

fn string_field(object: &Map<String, Value>, primary: &str, fallback: &str) -> Option<String> {
    object
        .get(primary)
        .or_else(|| object.get(fallback))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}
