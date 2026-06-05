use reqwest::StatusCode;
use tokio::time::{sleep, Duration};
use tracing::{debug, warn};

use crate::{
    anyharness_client::{health as anyharness_health, AnyHarnessClient},
    cloud_client::{
        commands::{LeaseCommandRequest, SUPPORTED_COMMAND_KINDS},
        control::WorkerControlWaitRequest,
        CloudClient,
    },
    config::WorkerConfig,
    control::{commands::executor, reconcile::handlers::exposures},
    error::WorkerError,
    identity::credentials::WorkerIdentity,
    store::WorkerStore,
};

const EMPTY_LEASE_SLEEP: Duration = Duration::from_secs(10);
const ERROR_LEASE_SLEEP: Duration = Duration::from_secs(5);
const CONTROL_WAIT_SECONDS: u64 = 20;

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
    let materialization_only_kinds = executor::materialization_only_kinds();
    let mut control_cursor = store.load_worker_control_state()?.control_cursor;
    loop {
        if let Err(error) = executor::flush_pending_command_results(&cloud, &identity, &store).await
        {
            warn!(?error, "failed to flush pending command results");
            sleep(ERROR_LEASE_SLEEP).await;
            continue;
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
        let control_wait = WorkerControlWaitRequest {
            supported_kinds: supported_kinds.clone(),
            lease_timeout_seconds: Some(300),
            control_cursor: control_cursor.clone(),
            wait_seconds: Some(CONTROL_WAIT_SECONDS),
        };
        match cloud
            .wait_worker_control(&identity.worker_token, &control_wait)
            .await
        {
            Ok(response) => {
                let response_cursor = response.control_cursor.clone();
                let mut cursor_saved = false;
                if let Some(exposure_snapshots) = response.exposures.as_ref() {
                    match exposures::reconcile_exposure_snapshots(
                        &store,
                        exposure_snapshots.as_slice(),
                    ) {
                        Ok(()) => {
                            store.save_control_cursor(&response_cursor)?;
                            control_cursor = Some(response_cursor.clone());
                            cursor_saved = true;
                            debug!(
                                reason = %response.reason,
                                server_time = %response.server_time,
                                exposure_count = exposure_snapshots.len(),
                                "worker control wait returned exposures"
                            );
                        }
                        Err(error) => {
                            warn!(?error, "worker failed to reconcile control wait exposures");
                        }
                    }
                }
                if response.exposures.is_none() {
                    store.save_control_cursor(&response_cursor)?;
                    control_cursor = Some(response_cursor.clone());
                    cursor_saved = true;
                }
                if cursor_saved {
                    store.set_legacy_exposure_polling_enabled(false)?;
                }
                if let Some(command) = response.command {
                    if let Err(error) = executor::process_command(
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
                    debug!(
                        reason = %response.reason,
                        server_time = %response.server_time,
                        "no worker command available"
                    );
                }
            }
            Err(WorkerError::Cloud { status, body })
                if status == StatusCode::NOT_FOUND || status == StatusCode::METHOD_NOT_ALLOWED =>
            {
                warn!(
                    %status,
                    body = %body,
                    "worker control wait unavailable; falling back to legacy command lease"
                );
                store.set_legacy_exposure_polling_enabled(true)?;
                let lease = LeaseCommandRequest {
                    supported_kinds,
                    lease_timeout_seconds: Some(300),
                };
                match cloud.lease_command(&identity.worker_token, &lease).await {
                    Ok(response) => {
                        if let Some(command) = response.command {
                            if let Err(error) = executor::process_command(
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
                            debug!(
                                server_time = %response.server_time,
                                "no worker command available"
                            );
                            sleep(EMPTY_LEASE_SLEEP).await;
                        }
                    }
                    Err(error) => {
                        warn!(?error, "worker command lease failed");
                        sleep(ERROR_LEASE_SLEEP).await;
                    }
                }
            }
            Err(error @ WorkerError::Cloud { status, .. }) if is_terminal_cloud_error(status) => {
                return Err(error);
            }
            Err(error) => {
                warn!(?error, "worker control wait failed");
                sleep(ERROR_LEASE_SLEEP).await;
            }
        }
    }
}

fn is_terminal_cloud_error(status: StatusCode) -> bool {
    status == StatusCode::UNAUTHORIZED
        || status == StatusCode::FORBIDDEN
        || status == StatusCode::CONFLICT
}
