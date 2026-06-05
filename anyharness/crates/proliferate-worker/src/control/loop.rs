use std::path::PathBuf;

use reqwest::StatusCode;
use tokio::{
    task::JoinHandle,
    time::{sleep, Duration},
};
use tracing::{debug, warn};

use crate::{
    anyharness_client::{health as anyharness_health, AnyHarnessClient},
    cloud_client::{
        commands::{CloudCommandEnvelope, LeaseCommandRequest, SUPPORTED_COMMAND_KINDS},
        control::WorkerControlWaitRequest,
        CloudClient,
    },
    config::WorkerConfig,
    control::{
        commands::executor,
        reconcile::handlers::{exposures, revoked_jti},
    },
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
    let initial_control_state = store.load_worker_control_state()?;
    let mut control_cursor = if initial_control_state.exposure_cache_initialized {
        initial_control_state.control_cursor
    } else {
        None
    };
    let mut command_task: Option<JoinHandle<()>> = None;
    let mut legacy_revoked_jti = revoked_jti::LegacyRevokedJtiPoll::default();
    loop {
        if let Some(task) = command_task.take() {
            if task.is_finished() {
                if let Err(error) = task.await {
                    warn!(?error, "worker command task failed to join");
                }
            } else {
                command_task = Some(task);
            }
        }
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
        let active_anyharness = if anyharness_healthy {
            anyharness.as_ref()
        } else {
            None
        };
        let command_in_flight = command_task.is_some();
        let supported_kinds = if command_in_flight {
            Vec::new()
        } else if anyharness_healthy {
            full_supported_kinds.clone()
        } else {
            materialization_only_kinds.clone()
        };
        let revoked_jti_cursor = store.load_worker_control_state()?.revoked_jti_cursor;
        let control_wait = WorkerControlWaitRequest {
            supported_kinds: supported_kinds.clone(),
            lease_timeout_seconds: Some(300),
            control_cursor: control_cursor.clone(),
            revoked_jti_cursor,
            lease_commands: !command_in_flight,
            wait_seconds: Some(CONTROL_WAIT_SECONDS),
        };
        match cloud
            .wait_worker_control(&identity.worker_token, &control_wait)
            .await
        {
            Ok(response) => {
                let response_cursor = response.control_cursor.clone();
                let desired_revoked_jti_revision =
                    revoked_jti_revision_from_control_cursor(&response_cursor);
                let mut can_save_control_cursor = true;
                if let Some(exposure_snapshots) = response.exposures.as_ref() {
                    match exposures::reconcile_exposure_snapshots(
                        &store,
                        exposure_snapshots.as_slice(),
                    ) {
                        Ok(()) => {
                            debug!(
                                reason = %response.reason,
                                server_time = %response.server_time,
                                exposure_count = exposure_snapshots.len(),
                                "worker control wait returned exposures"
                            );
                        }
                        Err(error) => {
                            warn!(?error, "worker failed to reconcile control wait exposures");
                            can_save_control_cursor = false;
                        }
                    }
                }
                if let Some(revoked_jtis) = response.revoked_jtis.as_ref() {
                    match revoked_jti::apply_control_bundle(
                        active_anyharness,
                        &store,
                        revoked_jtis,
                        desired_revoked_jti_revision,
                    )
                    .await
                    {
                        Ok(true) => {}
                        Ok(false) => can_save_control_cursor = false,
                        Err(error) => {
                            warn!(?error, "worker failed to apply revoked-jti control bundle");
                            can_save_control_cursor = false;
                        }
                    }
                }
                if can_save_control_cursor {
                    store.save_control_cursor(&response_cursor)?;
                    control_cursor = Some(response_cursor.clone());
                    store.set_legacy_exposure_polling_enabled(false)?;
                }
                if let Some(command) = response.command {
                    if command_task.is_some() {
                        warn!(
                            command_id = %command.command_id,
                            kind = %command.kind,
                            "worker received command while another command is in flight"
                        );
                    } else {
                        command_task = Some(spawn_command_processing(
                            cloud.clone(),
                            identity.clone(),
                            active_anyharness.cloned(),
                            store.clone(),
                            config.materialization_root.clone(),
                            command,
                        ));
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
                if let Err(error) = revoked_jti::poll_legacy_if_due(
                    active_anyharness,
                    &cloud,
                    &identity,
                    &store,
                    &mut legacy_revoked_jti,
                )
                .await
                {
                    warn!(?error, "worker legacy revoked-jti poll failed");
                }
                if command_in_flight {
                    sleep(EMPTY_LEASE_SLEEP).await;
                    continue;
                }
                let lease = LeaseCommandRequest {
                    supported_kinds,
                    lease_timeout_seconds: Some(300),
                };
                match cloud.lease_command(&identity.worker_token, &lease).await {
                    Ok(response) => {
                        if let Some(command) = response.command {
                            command_task = Some(spawn_command_processing(
                                cloud.clone(),
                                identity.clone(),
                                active_anyharness.cloned(),
                                store.clone(),
                                config.materialization_root.clone(),
                                command,
                            ));
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

fn spawn_command_processing(
    cloud: CloudClient,
    identity: WorkerIdentity,
    anyharness: Option<AnyHarnessClient>,
    store: WorkerStore,
    materialization_root: Option<PathBuf>,
    command: CloudCommandEnvelope,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        if let Err(error) = executor::process_command(
            &cloud,
            &identity,
            anyharness.as_ref(),
            &store,
            materialization_root.as_deref(),
            command,
        )
        .await
        {
            warn!(?error, "worker command processing failed");
        }
    })
}

fn revoked_jti_revision_from_control_cursor(control_cursor: &str) -> i64 {
    let mut parts = control_cursor.split(':');
    match (
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
    ) {
        (Some("v2"), Some(_target_id), Some(_control), Some(_exposure), Some(revoked), None) => {
            revoked.parse::<i64>().unwrap_or(0)
        }
        _ => 0,
    }
}

fn is_terminal_cloud_error(status: StatusCode) -> bool {
    status == StatusCode::UNAUTHORIZED
        || status == StatusCode::FORBIDDEN
        || status == StatusCode::CONFLICT
}
