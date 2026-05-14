use serde_json::{json, Value};
use tokio::time::{sleep, Duration};
use tracing::{debug, info, warn};

use crate::{
    anyharness_client::{sessions::AnyHarnessCommandResponse, AnyHarnessClient},
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
};

const EMPTY_LEASE_SLEEP: Duration = Duration::from_secs(2);
const ERROR_LEASE_SLEEP: Duration = Duration::from_secs(5);

pub async fn run_loop(
    config: WorkerConfig,
    cloud: CloudClient,
    identity: WorkerIdentity,
) -> Result<(), WorkerError> {
    let Some(base_url) = config.anyharness_base_url.clone() else {
        warn!("worker command loop disabled because anyharness_base_url is not configured");
        return Ok(());
    };
    let anyharness = AnyHarnessClient::new(base_url)?;
    let supported_kinds = SUPPORTED_COMMAND_KINDS
        .iter()
        .map(|kind| (*kind).to_string())
        .collect::<Vec<_>>();
    loop {
        let lease = LeaseCommandRequest {
            supported_kinds: supported_kinds.clone(),
            lease_timeout_seconds: Some(30),
            max_wait_seconds: Some(30),
        };
        match cloud.lease_command(&identity.worker_token, &lease).await {
            Ok(response) => {
                if let Some(command) = response.command {
                    if let Err(error) =
                        process_command(&cloud, &identity, &anyharness, command).await
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
            cloud
                .report_command_result(&identity.worker_token, &command.command_id, &result)
                .await?;
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
    let result = command_result(&command, &mapped, response);
    cloud
        .report_command_result(&identity.worker_token, &command.command_id, &result)
        .await
}

async fn dispatch_anyharness(
    anyharness: &AnyHarnessClient,
    command: &AnyHarnessCommand,
) -> Result<AnyHarnessCommandResponse, WorkerError> {
    match command {
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
        AnyHarnessCommand::CancelTurn { session_id } => anyharness.cancel_turn(session_id).await,
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
        Ok(response) => CommandResultRequest {
            lease_id: command.lease_id.clone(),
            status: "rejected".to_string(),
            error_code: Some("anyharness_rejected".to_string()),
            error_message: Some(format!("AnyHarness returned HTTP {}", response.status)),
            result: Some(json!({
                "anyharnessStatusCode": response.status.as_u16(),
                "body": response.body,
            })),
        },
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
    if matches!(command, AnyHarnessCommand::UpdateSessionConfig { .. })
        && response.body.get("applyState").and_then(Value::as_str) == Some("queued")
    {
        return "accepted_but_queued";
    }
    "accepted"
}
