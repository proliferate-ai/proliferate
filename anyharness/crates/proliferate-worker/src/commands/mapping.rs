use serde_json::{json, Map, Value};

use crate::{
    anyharness_client::workspaces::MaterializeWorkspaceRequest,
    cloud_client::commands::CloudCommandEnvelope,
};

#[derive(Debug)]
pub enum AnyHarnessCommand {
    StartSession {
        body: Value,
    },
    MaterializeWorkspace {
        request: MaterializeWorkspaceRequest,
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
        "materialize_workspace" => Ok(AnyHarnessCommand::MaterializeWorkspace {
            request: materialize_workspace_request(&command.payload)?,
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
    if !body.contains_key("agentAuthScope") {
        if let Some(sandbox_profile_id) =
            string_field(object, "sandboxProfileId", "sandbox_profile_id")
        {
            body.insert(
                "agentAuthScope".to_string(),
                json!({
                    "provider": "proliferate-cloud",
                    "id": sandbox_profile_id,
                    "targetId": command.target_id,
                }),
            );
        }
    }
    if !body.contains_key("requiredAgentAuthRevision") {
        if let Some(revision) = integer_field(
            object,
            "requiredAgentAuthRevision",
            "required_agent_auth_revision",
        ) {
            body.insert(
                "requiredAgentAuthRevision".to_string(),
                Value::Number(revision.into()),
            );
        }
    }
    map_runtime_config_preflight(&mut body, &command.target_id)?;
    body.entry("origin".to_string())
        .or_insert_with(|| json!({ "kind": "system", "entrypoint": "cloud" }));
    Ok(Value::Object(body))
}

fn materialize_workspace_request(
    payload: &Value,
) -> Result<MaterializeWorkspaceRequest, CommandMappingError> {
    let request: MaterializeWorkspaceRequest =
        serde_json::from_value(payload.clone()).map_err(|error| {
            CommandMappingError::new(
                "invalid_materialize_workspace_payload",
                format!("materialize_workspace payload is invalid: {error}"),
            )
        })?;
    match &request {
        MaterializeWorkspaceRequest::ExistingPath { path, .. } => {
            require_non_empty(path, "path", "invalid_materialize_workspace_payload")?;
        }
        MaterializeWorkspaceRequest::Worktree {
            repo_root_id,
            target_path,
            new_branch_name,
            ..
        } => {
            require_non_empty(
                repo_root_id,
                "repoRootId",
                "invalid_materialize_workspace_payload",
            )?;
            require_non_empty(
                target_path,
                "targetPath",
                "invalid_materialize_workspace_payload",
            )?;
            require_non_empty(
                new_branch_name,
                "newBranchName",
                "invalid_materialize_workspace_payload",
            )?;
        }
    }
    Ok(request)
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
    strip_preflight_fields(&mut body);
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

fn map_runtime_config_preflight(
    body: &mut Map<String, Value>,
    target_id: &str,
) -> Result<(), CommandMappingError> {
    let existing_expected = body.get("expectedRuntimeConfigRevision").cloned();
    let revision_id = body
        .remove("requiredRuntimeConfigRevisionId")
        .and_then(|value| value.as_str().map(str::to_string));
    let sequence = body
        .remove("requiredRuntimeConfigSequence")
        .and_then(|value| value.as_i64());
    let content_hash = body
        .remove("requiredRuntimeConfigContentHash")
        .and_then(|value| value.as_str().map(str::to_string));
    let sandbox_profile_id = body
        .remove("sandboxProfileId")
        .and_then(|value| value.as_str().map(str::to_string));
    if existing_expected.is_some() {
        return Ok(());
    }
    if revision_id.is_none() && sequence.is_none() && content_hash.is_none() {
        return Ok(());
    }
    let (Some(revision_id), Some(sequence), Some(content_hash)) =
        (revision_id, sequence, content_hash)
    else {
        return Err(CommandMappingError::new(
            "invalid_runtime_config_preflight",
            "runtime config preflight requires revision id, sequence, and content hash.",
        ));
    };
    body.insert(
        "expectedRuntimeConfigRevision".to_string(),
        json!({
            "revisionId": revision_id,
            "sequence": sequence,
            "contentHash": content_hash,
            "externalScope": sandbox_profile_id.map(|id| json!({
                "provider": "proliferate-cloud",
                "id": id,
                "targetId": target_id,
            })),
        }),
    );
    Ok(())
}

fn strip_preflight_fields(body: &mut Map<String, Value>) {
    body.remove("agentAuthScope");
    body.remove("sandboxProfileId");
    body.remove("requiredAgentAuthRevision");
    body.remove("requiredRuntimeConfigRevisionId");
    body.remove("requiredRuntimeConfigSequence");
    body.remove("requiredRuntimeConfigContentHash");
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

fn integer_field(object: &Map<String, Value>, primary: &str, fallback: &str) -> Option<i64> {
    object
        .get(primary)
        .or_else(|| object.get(fallback))
        .and_then(Value::as_i64)
}

fn require_non_empty(
    value: &str,
    field: &str,
    code: &'static str,
) -> Result<(), CommandMappingError> {
    if value.trim().is_empty() {
        return Err(CommandMappingError::new(
            code,
            format!("materialize_workspace payload must contain non-empty {field}."),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::cloud_client::commands::CloudCommandEnvelope;

    use super::{map_cloud_command, AnyHarnessCommand};

    #[test]
    fn maps_existing_path_workspace_materialization() {
        let command = test_command(json!({
            "mode": "existing_path",
            "path": "/workspace/proliferate",
            "displayName": "Proliferate",
            "origin": { "kind": "api", "entrypoint": "cloud" },
            "creatorContext": { "kind": "human", "label": "Pablo" }
        }));
        let mapped = map_cloud_command(&command).expect("mapped");
        let AnyHarnessCommand::MaterializeWorkspace { request } = mapped else {
            panic!("expected materialize workspace");
        };
        assert_eq!(request.mode(), "existing_path");
        let result = request
            .materialized_result(&json!({
                "repoRoot": { "id": "repo-root-1" },
                "workspace": {
                    "id": "workspace-1",
                    "repoRootId": "repo-root-1",
                    "path": "/workspace/proliferate",
                    "kind": "local",
                    "displayName": "Proliferate"
                }
            }))
            .expect("result");
        assert_eq!(result.display_name.as_deref(), Some("Proliferate"));
    }

    #[test]
    fn maps_worktree_workspace_materialization() {
        let command = test_command(json!({
            "mode": "worktree",
            "repoRootId": "repo-root-1",
            "targetPath": "/workspace/feature",
            "newBranchName": "feature",
            "baseBranch": "main",
            "setupScript": "pnpm install"
        }));
        let mapped = map_cloud_command(&command).expect("mapped");
        let AnyHarnessCommand::MaterializeWorkspace { request } = mapped else {
            panic!("expected materialize workspace");
        };
        assert_eq!(request.mode(), "worktree");
        let result = request
            .materialized_result(&json!({
                "workspace": {
                    "id": "workspace-2",
                    "path": "/workspace/feature",
                    "kind": "worktree"
                }
            }))
            .expect("result");
        assert_eq!(result.repo_root_id, "repo-root-1");
    }

    #[test]
    fn rejects_invalid_workspace_materialization_payload() {
        let command = test_command(json!({
            "mode": "worktree",
            "repoRootId": "repo-root-1",
            "targetPath": "/workspace/feature"
        }));
        let error = map_cloud_command(&command).expect_err("error");
        assert_eq!(error.code, "invalid_materialize_workspace_payload");
    }

    #[test]
    fn maps_runtime_config_preflight_to_anyharness_expected_revision() {
        let mut command = test_command(json!({
            "workspaceId": "workspace-1",
            "agentKind": "claude",
            "sandboxProfileId": "profile-1",
            "requiredRuntimeConfigRevisionId": "rev-1",
            "requiredRuntimeConfigSequence": 7,
            "requiredRuntimeConfigContentHash": "sha256:abc"
        }));
        command.kind = "start_session".to_string();
        let mapped = map_cloud_command(&command).expect("mapped");
        let AnyHarnessCommand::StartSession { body } = mapped else {
            panic!("expected start session");
        };
        assert!(body.get("sandboxProfileId").is_none());
        assert!(body.get("requiredRuntimeConfigRevisionId").is_none());
        assert_eq!(
            body.pointer("/expectedRuntimeConfigRevision/revisionId")
                .and_then(serde_json::Value::as_str),
            Some("rev-1")
        );
        assert_eq!(
            body.pointer("/expectedRuntimeConfigRevision/sequence")
                .and_then(serde_json::Value::as_i64),
            Some(7)
        );
        assert_eq!(
            body.pointer("/expectedRuntimeConfigRevision/externalScope/targetId")
                .and_then(serde_json::Value::as_str),
            Some("target-1")
        );
    }

    #[test]
    fn maps_start_session_agent_auth_scope_from_preflight_payload() {
        let mut command = test_command(json!({
            "workspaceId": "workspace-1",
            "agentKind": "claude",
            "sandboxProfileId": "profile-1",
            "requiredAgentAuthRevision": 9
        }));
        command.kind = "start_session".to_string();

        let mapped = map_cloud_command(&command).expect("mapped");
        let AnyHarnessCommand::StartSession { body } = mapped else {
            panic!("expected start session");
        };
        assert_eq!(body["agentAuthScope"]["provider"], "proliferate-cloud");
        assert_eq!(body["agentAuthScope"]["id"], "profile-1");
        assert_eq!(body["agentAuthScope"]["targetId"], "target-1");
        assert_eq!(body["requiredAgentAuthRevision"], 9);
    }

    #[test]
    fn strips_preflight_fields_from_prompt_payload() {
        let mut command = test_command(json!({
            "text": "continue",
            "agentAuthScope": {
                "provider": "proliferate-cloud",
                "id": "profile-1",
                "targetId": "target-1"
            },
            "sandboxProfileId": "profile-1",
            "requiredAgentAuthRevision": 9,
            "requiredRuntimeConfigRevisionId": "rev-1",
            "requiredRuntimeConfigSequence": 7,
            "requiredRuntimeConfigContentHash": "sha256:abc"
        }));
        command.kind = "send_prompt".to_string();
        command.session_id = Some("session-1".to_string());

        let mapped = map_cloud_command(&command).expect("mapped");
        let AnyHarnessCommand::SendPrompt { body, .. } = mapped else {
            panic!("expected send prompt");
        };
        assert!(body.get("agentAuthScope").is_none());
        assert!(body.get("sandboxProfileId").is_none());
        assert!(body.get("requiredAgentAuthRevision").is_none());
        assert!(body.get("requiredRuntimeConfigRevisionId").is_none());
        assert!(body.get("blocks").is_some());
    }

    fn test_command(payload: serde_json::Value) -> CloudCommandEnvelope {
        CloudCommandEnvelope {
            command_id: "command-1".to_string(),
            idempotency_key: "key-1".to_string(),
            target_id: "target-1".to_string(),
            workspace_id: None,
            cloud_workspace_id: None,
            sandbox_profile_id: None,
            slot_generation: None,
            session_id: None,
            kind: "materialize_workspace".to_string(),
            payload,
            observed_event_seq: None,
            preconditions: None,
            lease_id: "lease-1".to_string(),
            lease_expires_at: "2026-05-14T00:00:00Z".to_string(),
        }
    }
}
