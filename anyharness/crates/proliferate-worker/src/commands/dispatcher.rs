use std::path::Path;

use serde_json::{json, Value};
use tokio::time::{sleep, Duration};
use tracing::{debug, info, warn};

use crate::{
    anyharness_client::{
        health as anyharness_health, sessions::AnyHarnessCommandResponse, AnyHarnessClient,
    },
    cloud_client::{
        commands::{
            CloudCommandEnvelope, CommandDeliveryRequest, CommandResultRequest,
            LeaseCommandRequest, SUPPORTED_COMMAND_KINDS,
        },
        CloudClient,
    },
    commands::mapping::{map_cloud_command, AnyHarnessCommand},
    config::WorkerConfig,
    error::WorkerError,
    identity::credentials::WorkerIdentity,
    materialization::{materialize_plan, parse_materialize_environment_payload},
    store::{PendingCommandResult, WorkerStore},
    sync,
};

const EMPTY_LEASE_SLEEP: Duration = Duration::from_secs(2);
const ERROR_LEASE_SLEEP: Duration = Duration::from_secs(5);
const MATERIALIZE_ENVIRONMENT_KIND: &str = "materialize_environment";

pub async fn run_loop(
    config: WorkerConfig,
    cloud: CloudClient,
    identity: WorkerIdentity,
    store: WorkerStore,
) -> Result<(), WorkerError> {
    let anyharness = match config.anyharness_base_url.clone() {
        Some(base_url) => Some(AnyHarnessClient::new(
            base_url,
            config.anyharness_bearer_token.clone(),
        )?),
        None => {
            warn!("worker command loop running in materialization-only mode because anyharness_base_url is not configured");
            None
        }
    };
    let full_supported_kinds = SUPPORTED_COMMAND_KINDS
        .iter()
        .map(|kind| (*kind).to_string())
        .collect::<Vec<_>>();
    let materialization_only_kinds = vec![MATERIALIZE_ENVIRONMENT_KIND.to_string()];
    loop {
        if let Err(error) = flush_pending_command_results(&cloud, &identity, &store).await {
            warn!(?error, "failed to flush pending command results");
        }
        let anyharness_healthy = match &anyharness {
            Some(client) => anyharness_health::probe(client).await,
            None => false,
        };
        let supported_kinds = if anyharness_healthy {
            full_supported_kinds.clone()
        } else {
            materialization_only_kinds.clone()
        };
        let lease = LeaseCommandRequest {
            supported_kinds,
            lease_timeout_seconds: Some(30),
        };
        match cloud.lease_command(&identity.worker_token, &lease).await {
            Ok(response) => {
                if let Some(command) = response.command {
                    if let Err(error) = process_command(
                        &cloud,
                        &identity,
                        anyharness.as_ref(),
                        &store,
                        config.materialization_root.as_deref(),
                        command,
                    )
                    .await
                    {
                        warn!(?error, "worker command processing failed");
                        sleep(ERROR_LEASE_SLEEP).await;
                    }
                } else {
                    debug!(server_time = %response.server_time, "no worker command available");
                    sleep(EMPTY_LEASE_SLEEP).await;
                }
            }
            Err(error) => {
                warn!(?error, "worker command lease failed");
                sleep(ERROR_LEASE_SLEEP).await;
            }
        }
    }
}

async fn process_command(
    cloud: &CloudClient,
    identity: &WorkerIdentity,
    anyharness: Option<&AnyHarnessClient>,
    store: &WorkerStore,
    materialization_root: Option<&Path>,
    command: CloudCommandEnvelope,
) -> Result<(), WorkerError> {
    info!(
        command_id = %command.command_id,
        idempotency_key = %command.idempotency_key,
        kind = %command.kind,
        session_id = command.session_id.as_deref(),
        target_id = %command.target_id,
        workspace_id = command.workspace_id.as_deref(),
        observed_event_seq = command.observed_event_seq,
        has_preconditions = command.preconditions.is_some(),
        lease_expires_at = %command.lease_expires_at,
        "processing cloud command"
    );
    if command.kind == MATERIALIZE_ENVIRONMENT_KIND {
        return process_materialize_environment_command(
            cloud,
            identity,
            store,
            materialization_root,
            command,
        )
        .await;
    }
    let Some(anyharness) = anyharness else {
        let result = CommandResultRequest {
            lease_id: command.lease_id.clone(),
            status: "failed_delivery".to_string(),
            error_code: Some("anyharness_unavailable".to_string()),
            error_message: Some("AnyHarness is not configured or healthy.".to_string()),
            result: None,
        };
        report_command_result(cloud, identity, store, &command.command_id, &result).await?;
        return Ok(());
    };
    if command.kind == "sync_existing_workspace" {
        return process_sync_existing_workspace_command(
            cloud, identity, anyharness, store, command,
        )
        .await;
    }
    let mapped = match map_cloud_command(&command) {
        Ok(mapped) => mapped,
        Err(error) => {
            let result = CommandResultRequest {
                lease_id: command.lease_id.clone(),
                status: "rejected".to_string(),
                error_code: Some(error.code.to_string()),
                error_message: Some(error.message),
                result: None,
            };
            report_command_result(cloud, identity, store, &command.command_id, &result).await?;
            return Ok(());
        }
    };

    cloud
        .report_command_delivery(
            &identity.worker_token,
            &command.command_id,
            &CommandDeliveryRequest {
                lease_id: command.lease_id.clone(),
                status: "delivered".to_string(),
                error_code: None,
                error_message: None,
            },
        )
        .await?;

    let response = dispatch_anyharness(anyharness, &mapped).await;
    if let Ok(response) = &response {
        if response.is_success() {
            if let Err(error) = register_session_for_sync(store, &command, &mapped, response) {
                warn!(?error, "failed to register session for cloud event sync");
            }
        }
    }
    let result = command_result(&command, &mapped, response);
    report_command_result(cloud, identity, store, &command.command_id, &result).await
}

async fn process_materialize_environment_command(
    cloud: &CloudClient,
    identity: &WorkerIdentity,
    store: &WorkerStore,
    materialization_root: Option<&Path>,
    command: CloudCommandEnvelope,
) -> Result<(), WorkerError> {
    let payload = match parse_materialize_environment_payload(&command.payload) {
        Ok(payload) => payload,
        Err(error) => {
            let result = CommandResultRequest {
                lease_id: command.lease_id.clone(),
                status: "rejected".to_string(),
                error_code: Some("invalid_materialize_environment_payload".to_string()),
                error_message: Some(error.to_string()),
                result: None,
            };
            report_command_result(cloud, identity, store, &command.command_id, &result).await?;
            return Ok(());
        }
    };
    let _ = cloud
        .report_target_config_status(
            &identity.worker_token,
            &payload.target_config_id,
            &crate::cloud_client::target_config::TargetConfigStatusRequest {
                status: "materializing".to_string(),
                command_id: command.command_id.clone(),
                config_version: payload.config_version,
                lease_id: command.lease_id.clone(),
                error_code: None,
                error_message: None,
            },
        )
        .await;
    let response = async {
        let plan = cloud
            .fetch_target_config_materialization(
                &identity.worker_token,
                &payload.target_config_id,
                &command.command_id,
                payload.config_version,
                &command.lease_id,
            )
            .await?;
        materialize_plan(materialization_root, payload.config_version, &plan)
    }
    .await;
    let result = match response {
        Ok(outcome) => {
            cloud
                .report_target_config_status(
                    &identity.worker_token,
                    &payload.target_config_id,
                    &crate::cloud_client::target_config::TargetConfigStatusRequest {
                        status: "applied".to_string(),
                        command_id: command.command_id.clone(),
                        config_version: payload.config_version,
                        lease_id: command.lease_id.clone(),
                        error_code: None,
                        error_message: None,
                    },
                )
                .await
                .ok();
            CommandResultRequest {
                lease_id: command.lease_id.clone(),
                status: "accepted".to_string(),
                error_code: None,
                error_message: None,
                result: Some(serde_json::to_value(outcome)?),
            }
        }
        Err(error) => {
            let message = error.to_string();
            let _ = cloud
                .report_target_config_status(
                    &identity.worker_token,
                    &payload.target_config_id,
                    &crate::cloud_client::target_config::TargetConfigStatusRequest {
                        status: "failed".to_string(),
                        command_id: command.command_id.clone(),
                        config_version: payload.config_version,
                        lease_id: command.lease_id.clone(),
                        error_code: Some("target_materialization_failed".to_string()),
                        error_message: Some(message.clone()),
                    },
                )
                .await;
            CommandResultRequest {
                lease_id: command.lease_id.clone(),
                status: "failed_delivery".to_string(),
                error_code: Some("target_materialization_failed".to_string()),
                error_message: Some(message),
                result: None,
            }
        }
    };
    report_command_result(cloud, identity, store, &command.command_id, &result).await
}

async fn process_sync_existing_workspace_command(
    cloud: &CloudClient,
    identity: &WorkerIdentity,
    anyharness: &AnyHarnessClient,
    store: &WorkerStore,
    command: CloudCommandEnvelope,
) -> Result<(), WorkerError> {
    cloud
        .report_command_delivery(
            &identity.worker_token,
            &command.command_id,
            &CommandDeliveryRequest {
                lease_id: command.lease_id.clone(),
                status: "delivered".to_string(),
                error_code: None,
                error_message: None,
            },
        )
        .await?;
    let response = sync::backfill::sync_existing_workspace(
        store,
        anyharness,
        cloud,
        identity,
        command.workspace_id.as_deref(),
    )
    .await;
    let result = match response {
        Ok(result) => CommandResultRequest {
            lease_id: command.lease_id.clone(),
            status: "accepted".to_string(),
            error_code: None,
            error_message: None,
            result: Some(json!({
                "mappedWorkspaceCount": result.mapped_workspace_count,
                "mappedSessionCount": result.mapped_session_count,
            })),
        },
        Err(error) => CommandResultRequest {
            lease_id: command.lease_id.clone(),
            status: "failed_delivery".to_string(),
            error_code: Some("backfill_failed".to_string()),
            error_message: Some(error.to_string()),
            result: None,
        },
    };
    report_command_result(cloud, identity, store, &command.command_id, &result).await
}

async fn flush_pending_command_results(
    cloud: &CloudClient,
    identity: &WorkerIdentity,
    store: &WorkerStore,
) -> Result<(), WorkerError> {
    for pending in store.list_pending_command_results()? {
        let request = CommandResultRequest {
            lease_id: pending.lease_id,
            status: pending.status,
            error_code: pending.error_code,
            error_message: pending.error_message,
            result: pending.result,
        };
        cloud
            .report_command_result(&identity.worker_token, &pending.command_id, &request)
            .await?;
        store.delete_pending_command_result(&pending.command_id)?;
    }
    Ok(())
}

async fn report_command_result(
    cloud: &CloudClient,
    identity: &WorkerIdentity,
    store: &WorkerStore,
    command_id: &str,
    result: &CommandResultRequest,
) -> Result<(), WorkerError> {
    let pending = PendingCommandResult {
        command_id: command_id.to_string(),
        lease_id: result.lease_id.clone(),
        status: result.status.clone(),
        error_code: result.error_code.clone(),
        error_message: result.error_message.clone(),
        result: result.result.clone(),
    };
    store.save_pending_command_result(&pending)?;
    cloud
        .report_command_result(&identity.worker_token, command_id, result)
        .await?;
    store.delete_pending_command_result(command_id)?;
    Ok(())
}

async fn dispatch_anyharness(
    anyharness: &AnyHarnessClient,
    command: &AnyHarnessCommand,
) -> Result<AnyHarnessCommandResponse, WorkerError> {
    match command {
        AnyHarnessCommand::StartSession { body } => anyharness.start_session(body).await,
        AnyHarnessCommand::MaterializeWorkspace { request } => {
            anyharness.materialize_workspace(request).await
        }
        AnyHarnessCommand::SendPrompt { session_id, body } => {
            anyharness.send_prompt(session_id, body).await
        }
        AnyHarnessCommand::ResolveInteraction {
            session_id,
            request_id,
            body,
        } => {
            anyharness
                .resolve_interaction(session_id, request_id, body)
                .await
        }
        AnyHarnessCommand::UpdateSessionConfig { session_id, body } => {
            anyharness.update_session_config(session_id, body).await
        }
        AnyHarnessCommand::UpdateNormalizedSessionConfig {
            session_id,
            control_id,
            value,
        } => {
            anyharness
                .update_normalized_session_config(session_id, control_id, value)
                .await
        }
        AnyHarnessCommand::CancelTurn { session_id } => anyharness.cancel_turn(session_id).await,
        AnyHarnessCommand::CloseSession { session_id } => {
            anyharness.close_session(session_id).await
        }
    }
}

fn command_result(
    command: &CloudCommandEnvelope,
    mapped: &AnyHarnessCommand,
    response: Result<AnyHarnessCommandResponse, WorkerError>,
) -> CommandResultRequest {
    match response {
        Ok(response) if response.is_success() => match success_result(mapped, &response) {
            Ok(result) => CommandResultRequest {
                lease_id: command.lease_id.clone(),
                status: accepted_status(mapped, &response).to_string(),
                error_code: None,
                error_message: None,
                result: Some(result),
            },
            Err(error) => CommandResultRequest {
                lease_id: command.lease_id.clone(),
                status: "rejected".to_string(),
                error_code: Some(error.code),
                error_message: Some(error.message),
                result: Some(error.result),
            },
        },
        Ok(response) => {
            let status_code = response.status.as_u16();
            let (status, error_code) = if status_code == 401 || status_code == 403 {
                ("failed_delivery", "anyharness_auth_failed")
            } else if response.status.is_server_error()
                || status_code == 408
                || status_code == 409
                || status_code == 429
            {
                ("failed_delivery", "anyharness_temporarily_unavailable")
            } else {
                ("rejected", "anyharness_rejected")
            };
            CommandResultRequest {
                lease_id: command.lease_id.clone(),
                status: status.to_string(),
                error_code: Some(error_code.to_string()),
                error_message: Some(format!("AnyHarness returned HTTP {}", response.status)),
                result: Some(json!({
                    "anyharnessStatusCode": response.status.as_u16(),
                    "body": response.body,
                })),
            }
        }
        Err(error) => CommandResultRequest {
            lease_id: command.lease_id.clone(),
            status: "failed_delivery".to_string(),
            error_code: Some("anyharness_delivery_failed".to_string()),
            error_message: Some(error.to_string()),
            result: None,
        },
    }
}

struct SuccessResultError {
    code: String,
    message: String,
    result: Value,
}

fn success_result(
    command: &AnyHarnessCommand,
    response: &AnyHarnessCommandResponse,
) -> Result<Value, SuccessResultError> {
    match command {
        AnyHarnessCommand::MaterializeWorkspace { request } => {
            match request.materialized_result(&response.body) {
                Ok(result) => {
                    let mut value = serde_json::to_value(result).unwrap_or_else(|_| json!({}));
                    if let Value::Object(object) = &mut value {
                        object.insert(
                            "anyharnessStatusCode".to_string(),
                            Value::from(response.status.as_u16()),
                        );
                        object.insert("body".to_string(), response.body.clone());
                    }
                    Ok(value)
                }
                Err(message) => Err(SuccessResultError {
                    code: "invalid_anyharness_workspace_response".to_string(),
                    message: message.clone(),
                    result: json!({
                        "anyharnessStatusCode": response.status.as_u16(),
                        "resultExtractionError": message,
                        "body": response.body.clone(),
                    }),
                }),
            }
        }
        _ => Ok(json!({
            "anyharnessStatusCode": response.status.as_u16(),
            "body": response.body.clone(),
        })),
    }
}

fn accepted_status(
    command: &AnyHarnessCommand,
    response: &AnyHarnessCommandResponse,
) -> &'static str {
    if matches!(command, AnyHarnessCommand::SendPrompt { .. })
        && response.body.get("status").and_then(Value::as_str) == Some("queued")
    {
        return "accepted_but_queued";
    }
    if matches!(
        command,
        AnyHarnessCommand::UpdateSessionConfig { .. }
            | AnyHarnessCommand::UpdateNormalizedSessionConfig { .. }
    ) && response.body.get("applyState").and_then(Value::as_str) == Some("queued")
    {
        return "accepted_but_queued";
    }
    "accepted"
}

fn register_session_for_sync(
    store: &WorkerStore,
    command: &CloudCommandEnvelope,
    mapped: &AnyHarnessCommand,
    response: &AnyHarnessCommandResponse,
) -> Result<(), WorkerError> {
    let session_id = match mapped {
        AnyHarnessCommand::StartSession { .. } => response
            .body
            .get("id")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        AnyHarnessCommand::MaterializeWorkspace { .. } => None,
        AnyHarnessCommand::SendPrompt { session_id, .. }
        | AnyHarnessCommand::ResolveInteraction { session_id, .. }
        | AnyHarnessCommand::UpdateSessionConfig { session_id, .. }
        | AnyHarnessCommand::UpdateNormalizedSessionConfig { session_id, .. }
        | AnyHarnessCommand::CancelTurn { session_id }
        | AnyHarnessCommand::CloseSession { session_id } => Some(session_id.clone()),
    };
    let Some(session_id) = session_id else {
        return Ok(());
    };
    let workspace_id = command
        .workspace_id
        .as_deref()
        .or_else(|| response.body.get("workspaceId").and_then(Value::as_str));
    store.upsert_sync_session(&session_id, workspace_id)
}

#[cfg(test)]
mod tests {
    use reqwest::StatusCode;
    use serde_json::json;

    use crate::{
        anyharness_client::{
            sessions::AnyHarnessCommandResponse, workspaces::MaterializeWorkspaceRequest,
        },
        cloud_client::commands::CloudCommandEnvelope,
        commands::mapping::AnyHarnessCommand,
    };

    use super::command_result;

    #[test]
    fn materialize_workspace_result_extraction_failure_rejects_command() {
        let command = test_command();
        let mapped = AnyHarnessCommand::MaterializeWorkspace {
            request: MaterializeWorkspaceRequest::ExistingPath {
                path: "/workspace/proliferate".to_string(),
                display_name: None,
                origin: None,
                creator_context: None,
            },
        };
        let result = command_result(
            &command,
            &mapped,
            Ok(AnyHarnessCommandResponse {
                status: StatusCode::OK,
                body: json!({
                    "workspace": {
                        "path": "/workspace/proliferate",
                        "kind": "local"
                    }
                }),
            }),
        );
        assert_eq!(result.status, "rejected");
        assert_eq!(
            result.error_code.as_deref(),
            Some("invalid_anyharness_workspace_response")
        );
        assert_eq!(
            result
                .result
                .as_ref()
                .and_then(|value| value.get("resultExtractionError"))
                .and_then(serde_json::Value::as_str),
            Some("AnyHarness response must contain id.")
        );
    }

    fn test_command() -> CloudCommandEnvelope {
        CloudCommandEnvelope {
            command_id: "command-1".to_string(),
            idempotency_key: "key-1".to_string(),
            target_id: "target-1".to_string(),
            workspace_id: None,
            session_id: None,
            kind: "materialize_workspace".to_string(),
            payload: json!({}),
            observed_event_seq: None,
            preconditions: None,
            lease_id: "lease-1".to_string(),
            lease_expires_at: "2026-05-14T00:00:00Z".to_string(),
        }
    }
}
