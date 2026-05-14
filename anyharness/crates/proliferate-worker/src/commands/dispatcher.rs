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
    store::{PendingCommandResult, WorkerStore},
    sync,
};

const EMPTY_LEASE_SLEEP: Duration = Duration::from_secs(2);
const ERROR_LEASE_SLEEP: Duration = Duration::from_secs(5);

pub async fn run_loop(
    config: WorkerConfig,
    cloud: CloudClient,
    identity: WorkerIdentity,
    store: WorkerStore,
) -> Result<(), WorkerError> {
    let Some(base_url) = config.anyharness_base_url.clone() else {
        warn!("worker command loop disabled because anyharness_base_url is not configured");
        return Ok(());
    };
    let anyharness = AnyHarnessClient::new(base_url, config.anyharness_bearer_token.clone())?;
    let supported_kinds = SUPPORTED_COMMAND_KINDS
        .iter()
        .map(|kind| (*kind).to_string())
        .collect::<Vec<_>>();
    loop {
        if let Err(error) = flush_pending_command_results(&cloud, &identity, &store).await {
            warn!(?error, "failed to flush pending command results");
        }
        if !anyharness_health::probe(&anyharness).await {
            warn!("worker command loop paused because anyharness health check failed");
            sleep(ERROR_LEASE_SLEEP).await;
            continue;
        }
        let lease = LeaseCommandRequest {
            supported_kinds: supported_kinds.clone(),
            lease_timeout_seconds: Some(30),
        };
        match cloud.lease_command(&identity.worker_token, &lease).await {
            Ok(response) => {
                if let Some(command) = response.command {
                    if let Err(error) =
                        process_command(&cloud, &identity, &anyharness, &store, command).await
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
    anyharness: &AnyHarnessClient,
    store: &WorkerStore,
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
        Ok(response) if response.is_success() => CommandResultRequest {
            lease_id: command.lease_id.clone(),
            status: accepted_status(mapped, &response).to_string(),
            error_code: None,
            error_message: None,
            result: Some(json!({
                "anyharnessStatusCode": response.status.as_u16(),
                "body": response.body,
            })),
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
