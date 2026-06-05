use anyharness_contract::v1::{
    ApplyRuntimeConfigRequest, RuntimeArtifactPayload, RuntimeConfigExternalScope,
    RuntimeConfigRevision, RuntimeConfigSource, RuntimeCredentialValue,
};
use reqwest::StatusCode;
use serde_json::{json, Value};
use std::path::Path;
use tokio::time::{sleep, Duration};
use tracing::{debug, info, warn};

use crate::{
    anyharness_client::{
        health as anyharness_health, sessions::AnyHarnessCommandResponse, AnyHarnessClient,
    },
    cloud_client::{
        agent_auth::AgentAuthStatusRequest,
        commands::{
            CloudCommandEnvelope, CommandDeliveryRequest, CommandResultRequest,
            LeaseCommandRequest, MaterializationReportRequest, SUPPORTED_COMMAND_KINDS,
        },
        control::WorkerControlWaitRequest,
        CloudClient,
    },
    commands::mapping::{map_cloud_command, AnyHarnessCommand},
    config::WorkerConfig,
    error::WorkerError,
    identity::credentials::WorkerIdentity,
    materialization::{
        agent_auth::{
            build_anyharness_agent_auth_request, parse_refresh_agent_auth_config_payload,
        },
        git_identity::{parse_configure_git_identity_payload, write_target_git_identity},
        materialize_plan, parse_materialize_environment_payload,
        repo_checkout::{ensure_repo_checkout, parse_ensure_repo_checkout_payload},
        runtime_config::{
            manifest_credential_refs, validate_runtime_artifact_payload,
            RuntimeConfigMaterializationFragment,
        },
    },
    store::{PendingCommandResult, WorkerStore},
    sync,
};

const EMPTY_LEASE_SLEEP: Duration = Duration::from_secs(10);
const ERROR_LEASE_SLEEP: Duration = Duration::from_secs(5);
const CONTROL_WAIT_SECONDS: u64 = 20;
const CONFIGURE_GIT_IDENTITY_KIND: &str = "configure_git_identity";
const ENSURE_REPO_CHECKOUT_KIND: &str = "ensure_repo_checkout";
const PRUNE_WORKSPACE_WORKTREE_KIND: &str = "prune_workspace_worktree";
const MATERIALIZE_ENVIRONMENT_KIND: &str = "materialize_environment";
const REFRESH_AGENT_AUTH_CONFIG_KIND: &str = "refresh_agent_auth_config";
const SAFE_AGENT_AUTH_REFRESH_ERROR: &str = "Agent auth config refresh failed.";

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
    let materialization_only_kinds = vec![
        CONFIGURE_GIT_IDENTITY_KIND.to_string(),
        ENSURE_REPO_CHECKOUT_KIND.to_string(),
        MATERIALIZE_ENVIRONMENT_KIND.to_string(),
    ];
    let mut control_cursor = store.load_worker_control_state()?.control_cursor;
    loop {
        if let Err(error) = flush_pending_command_results(&cloud, &identity, &store).await {
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
                if let Some(exposures) = response.exposures.as_ref() {
                    match sync::tailer::reconcile_exposure_snapshots(&store, exposures.as_slice()) {
                        Ok(()) => {
                            store.save_control_cursor(&response_cursor)?;
                            control_cursor = Some(response_cursor.clone());
                            cursor_saved = true;
                            debug!(
                                reason = %response.reason,
                                server_time = %response.server_time,
                                exposure_count = exposures.len(),
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
        sandbox_profile_id = command.sandbox_profile_id.as_deref(),
        cloud_workspace_id = command.cloud_workspace_id.as_deref(),
        workspace_id = command.workspace_id.as_deref(),
        observed_event_seq = command.observed_event_seq,
        has_preconditions = command.preconditions.is_some(),
        lease_expires_at = %command.lease_expires_at,
        "processing cloud command"
    );
    if command.kind == CONFIGURE_GIT_IDENTITY_KIND {
        return process_configure_git_identity_command(
            cloud,
            identity,
            store,
            materialization_root,
            command,
        )
        .await;
    }
    if command.kind == ENSURE_REPO_CHECKOUT_KIND {
        return process_ensure_repo_checkout_command(
            cloud,
            identity,
            store,
            materialization_root,
            command,
        )
        .await;
    }
    if command.kind == MATERIALIZE_ENVIRONMENT_KIND {
        return process_materialize_environment_command(
            cloud,
            identity,
            anyharness,
            store,
            materialization_root,
            command,
        )
        .await;
    }
    let Some(anyharness) = anyharness else {
        let result = command_result_request(
            &command,
            "failed_delivery",
            Some("anyharness_unavailable".to_string()),
            Some("AnyHarness is not configured or healthy.".to_string()),
            None,
        );
        report_command_result(cloud, identity, store, &command.command_id, &result).await?;
        return Ok(());
    };
    if command.kind == "backfill_exposed_workspace" {
        return process_backfill_exposed_workspace_command(
            cloud, identity, anyharness, store, command,
        )
        .await;
    }
    if command.kind == PRUNE_WORKSPACE_WORKTREE_KIND {
        return process_prune_workspace_worktree_command(
            cloud, identity, anyharness, store, command,
        )
        .await;
    }
    if command.kind == REFRESH_AGENT_AUTH_CONFIG_KIND {
        return process_refresh_agent_auth_config_command(
            cloud,
            identity,
            anyharness,
            store,
            materialization_root,
            command,
        )
        .await;
    }
    let mapped = match map_cloud_command(&command) {
        Ok(mapped) => mapped,
        Err(error) => {
            let result = command_result_request(
                &command,
                "rejected",
                Some(error.code.to_string()),
                Some(error.message),
                None,
            );
            report_command_result(cloud, identity, store, &command.command_id, &result).await?;
            return Ok(());
        }
    };

    cloud
        .report_command_delivery(
            &identity.worker_token,
            &command.command_id,
            &command_delivery_request(&command, "delivered", None, None),
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

async fn process_refresh_agent_auth_config_command(
    cloud: &CloudClient,
    identity: &WorkerIdentity,
    anyharness: &AnyHarnessClient,
    store: &WorkerStore,
    materialization_root: Option<&Path>,
    command: CloudCommandEnvelope,
) -> Result<(), WorkerError> {
    let payload = match parse_refresh_agent_auth_config_payload(&command.payload) {
        Ok(payload) => payload,
        Err(error) => {
            let result = command_result_request(
                &command,
                "rejected",
                Some("invalid_refresh_agent_auth_config_payload".to_string()),
                Some(error.to_string()),
                None,
            );
            report_command_result(cloud, identity, store, &command.command_id, &result).await?;
            return Ok(());
        }
    };
    debug!(
        sandbox_profile_id = %payload.sandbox_profile_id,
        revision = payload.revision,
        reason = %payload.reason,
        force_restart = payload.force_restart,
        "refreshing agent auth config"
    );
    let _ = cloud
        .report_agent_auth_status(
            &identity.worker_token,
            &payload.sandbox_profile_id,
            &AgentAuthStatusRequest {
                status: "materializing".to_string(),
                command_id: command.command_id.clone(),
                revision: payload.revision,
                lease_id: command.lease_id.clone(),
                applied_revision: None,
                current_revision: None,
                error_code: None,
                error_message: None,
                applied_cleanup_paths: Vec::new(),
            },
        )
        .await;
    let response = async {
        let plan = cloud
            .fetch_agent_auth_materialization(
                &identity.worker_token,
                &payload.sandbox_profile_id,
                &command.command_id,
                payload.revision,
                &command.lease_id,
            )
            .await?;
        let (request, outcome) = build_anyharness_agent_auth_request(
            materialization_root,
            &payload.sandbox_profile_id,
            &command.target_id,
            payload.revision,
            &plan,
        )?;
        if outcome.applied {
            let apply_response = anyharness.apply_agent_auth_config(&request).await?;
            if apply_response.applied && apply_response.revision == outcome.revision {
                cloud
                    .report_agent_auth_status(
                        &identity.worker_token,
                        &payload.sandbox_profile_id,
                        &AgentAuthStatusRequest {
                            status: "applied".to_string(),
                            command_id: command.command_id.clone(),
                            revision: payload.revision,
                            lease_id: command.lease_id.clone(),
                            applied_revision: Some(outcome.revision),
                            current_revision: outcome.current_revision,
                            error_code: None,
                            error_message: None,
                            applied_cleanup_paths: outcome.applied_cleanup_paths.clone(),
                        },
                    )
                    .await
                    .ok();
            } else if !apply_response.applied && apply_response.status == "stale" {
                cloud
                    .report_agent_auth_status(
                        &identity.worker_token,
                        &payload.sandbox_profile_id,
                        &AgentAuthStatusRequest {
                            status: "superseded".to_string(),
                            command_id: command.command_id.clone(),
                            revision: payload.revision,
                            lease_id: command.lease_id.clone(),
                            applied_revision: None,
                            current_revision: Some(apply_response.revision),
                            error_code: None,
                            error_message: None,
                            applied_cleanup_paths: Vec::new(),
                        },
                    )
                    .await
                    .ok();
            } else {
                return Err(WorkerError::AnyHarness {
                    status: StatusCode::CONFLICT,
                    body: format!(
                        "agent auth apply did not accept revision {}: applied={}, revision={}, status={}",
                        outcome.revision,
                        apply_response.applied,
                        apply_response.revision,
                        apply_response.status
                    ),
                });
            }
        } else {
            cloud
                .report_agent_auth_status(
                    &identity.worker_token,
                    &payload.sandbox_profile_id,
                    &AgentAuthStatusRequest {
                        status: "superseded".to_string(),
                        command_id: command.command_id.clone(),
                        revision: payload.revision,
                        lease_id: command.lease_id.clone(),
                        applied_revision: None,
                        current_revision: outcome.current_revision,
                        error_code: None,
                        error_message: None,
                        applied_cleanup_paths: Vec::new(),
                    },
                )
                .await
                .ok();
        }
        Ok::<_, WorkerError>(outcome)
    }
    .await;
    let result = match response {
        Ok(outcome) => command_result_request(
            &command,
            "accepted",
            None,
            None,
            Some(serde_json::to_value(outcome)?),
        ),
        Err(error) => {
            warn!(
                ?error,
                command_id = %command.command_id,
                sandbox_profile_id = %payload.sandbox_profile_id,
                revision = payload.revision,
                "agent auth config refresh failed"
            );
            let _ = cloud
                .report_agent_auth_status(
                    &identity.worker_token,
                    &payload.sandbox_profile_id,
                    &AgentAuthStatusRequest {
                        status: "failed".to_string(),
                        command_id: command.command_id.clone(),
                        revision: payload.revision,
                        lease_id: command.lease_id.clone(),
                        applied_revision: None,
                        current_revision: None,
                        error_code: Some("agent_auth_materialization_failed".to_string()),
                        error_message: Some(SAFE_AGENT_AUTH_REFRESH_ERROR.to_string()),
                        applied_cleanup_paths: Vec::new(),
                    },
                )
                .await;
            command_result_request(
                &command,
                "failed_delivery",
                Some("agent_auth_materialization_failed".to_string()),
                Some(SAFE_AGENT_AUTH_REFRESH_ERROR.to_string()),
                None,
            )
        }
    };
    report_command_result(cloud, identity, store, &command.command_id, &result).await
}

async fn process_configure_git_identity_command(
    cloud: &CloudClient,
    identity: &WorkerIdentity,
    store: &WorkerStore,
    materialization_root: Option<&Path>,
    command: CloudCommandEnvelope,
) -> Result<(), WorkerError> {
    let payload = match parse_configure_git_identity_payload(&command.payload) {
        Ok(payload) => payload,
        Err(error) => {
            let result = command_result_request(
                &command,
                "rejected",
                Some("invalid_configure_git_identity_payload".to_string()),
                Some(error.to_string()),
                None,
            );
            report_command_result(cloud, identity, store, &command.command_id, &result).await?;
            return Ok(());
        }
    };
    let _ = cloud
        .report_target_git_identity_status(
            &identity.worker_token,
            &payload.target_git_identity_id,
            &crate::cloud_client::target_git_identity::TargetGitIdentityStatusRequest {
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
            .fetch_target_git_identity_materialization(
                &identity.worker_token,
                &payload.target_git_identity_id,
                &command.command_id,
                payload.config_version,
                &command.lease_id,
            )
            .await?;
        write_target_git_identity(materialization_root, payload.config_version, &plan)
    }
    .await;
    let result = match response {
        Ok(outcome) => {
            cloud
                .report_target_git_identity_status(
                    &identity.worker_token,
                    &payload.target_git_identity_id,
                    &crate::cloud_client::target_git_identity::TargetGitIdentityStatusRequest {
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
            command_result_request(
                &command,
                "accepted",
                None,
                None,
                Some(serde_json::to_value(outcome)?),
            )
        }
        Err(error) => {
            let message = error.to_string();
            let _ = cloud
                .report_target_git_identity_status(
                    &identity.worker_token,
                    &payload.target_git_identity_id,
                    &crate::cloud_client::target_git_identity::TargetGitIdentityStatusRequest {
                        status: "failed".to_string(),
                        command_id: command.command_id.clone(),
                        config_version: payload.config_version,
                        lease_id: command.lease_id.clone(),
                        error_code: Some("target_git_identity_failed".to_string()),
                        error_message: Some(message.clone()),
                    },
                )
                .await;
            command_result_request(
                &command,
                "failed_delivery",
                Some("target_git_identity_failed".to_string()),
                Some(message),
                None,
            )
        }
    };
    report_command_result(cloud, identity, store, &command.command_id, &result).await
}

async fn process_ensure_repo_checkout_command(
    cloud: &CloudClient,
    identity: &WorkerIdentity,
    store: &WorkerStore,
    materialization_root: Option<&Path>,
    command: CloudCommandEnvelope,
) -> Result<(), WorkerError> {
    let payload = match parse_ensure_repo_checkout_payload(&command.payload) {
        Ok(payload) => payload,
        Err(error) => {
            let result = command_result_request(
                &command,
                "rejected",
                Some("invalid_ensure_repo_checkout_payload".to_string()),
                Some(error.to_string()),
                None,
            );
            report_command_result(cloud, identity, store, &command.command_id, &result).await?;
            return Ok(());
        }
    };
    let response = ensure_repo_checkout(materialization_root, &payload);
    let result = match response {
        Ok(outcome) => command_result_request(
            &command,
            "accepted",
            None,
            None,
            Some(serde_json::to_value(outcome)?),
        ),
        Err(error) => {
            let message = error.to_string();
            let error_code = if message.contains("target_git_not_ready") {
                "target_git_not_ready"
            } else if message.contains("repo_access_denied") {
                "repo_access_denied"
            } else if message.contains("repo_mismatch") {
                "repo_mismatch"
            } else {
                "repo_clone_failed"
            };
            command_result_request(
                &command,
                "failed_delivery",
                Some(error_code.to_string()),
                Some(message),
                None,
            )
        }
    };
    report_command_result(cloud, identity, store, &command.command_id, &result).await
}

async fn process_materialize_environment_command(
    cloud: &CloudClient,
    identity: &WorkerIdentity,
    anyharness: Option<&AnyHarnessClient>,
    store: &WorkerStore,
    materialization_root: Option<&Path>,
    command: CloudCommandEnvelope,
) -> Result<(), WorkerError> {
    let payload = match parse_materialize_environment_payload(&command.payload) {
        Ok(payload) => payload,
        Err(error) => {
            let result = command_result_request(
                &command,
                "rejected",
                Some("invalid_materialize_environment_payload".to_string()),
                Some(error.to_string()),
                None,
            );
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
        let outcome = materialize_plan(materialization_root, payload.config_version, &plan)?;
        let mut should_report_runtime_config_applied = false;
        if let Some(runtime_config) = plan.runtime_config.as_ref() {
            let Some(anyharness) = anyharness else {
                return Err(WorkerError::Materialization(
                    "AnyHarness is required to apply runtime config.".to_string(),
                ));
            };
            let runtime_config_applied = match apply_runtime_config_to_anyharness(
                cloud,
                anyharness,
                &identity.worker_token,
                &command.target_id,
                runtime_config,
            )
            .await
            {
                Ok(applied) => applied,
                Err(error) => {
                    let missing_credentials = match &error {
                        WorkerError::MissingRuntimeConfigCredentials(refs) => refs.clone(),
                        _ => Vec::new(),
                    };
                    let error_code = match &error {
                        WorkerError::MissingRuntimeConfigCredentials(_) => {
                            "runtime_config_credentials_missing"
                        }
                        _ => "anyharness_runtime_config_apply_failed",
                    };
                    cloud
                        .report_runtime_config_status(
                            &identity.worker_token,
                            &runtime_config.revision_id,
                            &crate::cloud_client::target_config::RuntimeConfigStatusRequest {
                                status: "failed".to_string(),
                                missing_artifacts: Vec::new(),
                                missing_credentials,
                                error_code: Some(error_code.to_string()),
                                error_message: Some(error.to_string()),
                            },
                        )
                        .await
                        .ok();
                    return Err(error);
                }
            };
            if !runtime_config_applied {
                return Ok((outcome, false));
            }
            should_report_runtime_config_applied = true;
        }
        Ok((outcome, should_report_runtime_config_applied))
    }
    .await;
    let result = match response {
        Ok((outcome, should_report_runtime_config_applied)) => {
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
            if should_report_runtime_config_applied {
                let runtime_config = outcome.runtime_config.as_ref().ok_or_else(|| {
                    WorkerError::Materialization(
                        "Runtime config apply succeeded without runtime config outcome."
                            .to_string(),
                    )
                })?;
                cloud
                    .report_runtime_config_status(
                        &identity.worker_token,
                        &runtime_config.revision_id,
                        &crate::cloud_client::target_config::RuntimeConfigStatusRequest {
                            status: "applied".to_string(),
                            missing_artifacts: Vec::new(),
                            missing_credentials: Vec::new(),
                            error_code: None,
                            error_message: None,
                        },
                    )
                    .await
                    .ok();
            }
            command_result_request(
                &command,
                "accepted",
                None,
                None,
                Some(serde_json::to_value(outcome)?),
            )
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
            command_result_request(
                &command,
                "failed_delivery",
                Some("target_materialization_failed".to_string()),
                Some(message),
                None,
            )
        }
    };
    report_command_result(cloud, identity, store, &command.command_id, &result).await
}

async fn apply_runtime_config_to_anyharness(
    cloud: &CloudClient,
    anyharness: &AnyHarnessClient,
    worker_token: &str,
    target_id: &str,
    runtime_config: &RuntimeConfigMaterializationFragment,
) -> Result<bool, WorkerError> {
    if runtime_config.target_id.as_deref() != Some(target_id) {
        return Err(WorkerError::Materialization(
            "Runtime config target does not match leased command target.".to_string(),
        ));
    }
    let credential_refs = manifest_credential_refs(&runtime_config.manifest);
    let credential_values = if credential_refs.is_empty() {
        Vec::new()
    } else {
        let response = cloud
            .fetch_runtime_config_credentials(
                worker_token,
                &runtime_config.revision_id,
                credential_refs,
            )
            .await?;
        if !response.missing_credential_refs.is_empty() {
            return Err(WorkerError::MissingRuntimeConfigCredentials(
                response.missing_credential_refs,
            ));
        }
        response
            .credentials
            .into_iter()
            .map(|credential| RuntimeCredentialValue {
                credential_ref: credential.credential_ref,
                value: credential.value,
            })
            .collect::<Vec<_>>()
    };
    let mut artifact_payloads = Vec::with_capacity(runtime_config.artifact_refs.len());
    for artifact in &runtime_config.artifact_refs {
        let payload = cloud
            .fetch_runtime_config_artifact(
                worker_token,
                &runtime_config.revision_id,
                &artifact.hash,
            )
            .await?;
        let payload = RuntimeArtifactPayload {
            hash: payload.hash,
            content_type: payload.content_type,
            byte_size: payload.byte_size,
            source_ref: payload.source_ref,
            resource_id: payload.resource_id,
            display_name: payload.display_name,
            content: payload.content,
        };
        validate_runtime_artifact_payload(artifact, &payload)?;
        artifact_payloads.push(payload);
    }
    let request = ApplyRuntimeConfigRequest {
        revision: RuntimeConfigRevision {
            id: runtime_config.revision_id.clone(),
            sequence: runtime_config.sequence,
            content_hash: runtime_config.content_hash.clone(),
            external_scope: Some(RuntimeConfigExternalScope {
                provider: "proliferate-cloud".to_string(),
                id: runtime_config.sandbox_profile_id.clone(),
                target_id: runtime_config.target_id.clone(),
            }),
        },
        manifest: runtime_config.manifest.clone(),
        artifact_payloads,
        credential_values,
        source: RuntimeConfigSource::Worker,
    };
    let response = anyharness.apply_runtime_config(&request).await?;
    if response.status.is_success() {
        if response
            .body
            .get("applied")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            return Ok(true);
        }
        if response.body.get("status").and_then(Value::as_str) == Some("stale") {
            return Ok(false);
        }
    }
    Err(WorkerError::AnyHarness {
        status: response.status,
        body: response.body.to_string(),
    })
}

async fn process_backfill_exposed_workspace_command(
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
            &command_delivery_request(&command, "delivered", None, None),
        )
        .await?;
    let response = sync::backfill::backfill_exposed_workspace(
        store,
        anyharness,
        cloud,
        identity,
        command.workspace_id.as_deref(),
    )
    .await;
    let result = match response {
        Ok(result) => command_result_request(
            &command,
            "accepted",
            None,
            None,
            Some(json!({
                "mappedWorkspaceCount": result.mapped_workspace_count,
                "mappedSessionCount": result.mapped_session_count,
            })),
        ),
        Err(error) => command_result_request(
            &command,
            "failed_delivery",
            Some("backfill_failed".to_string()),
            Some(error.to_string()),
            None,
        ),
    };
    report_command_result(cloud, identity, store, &command.command_id, &result).await
}

async fn process_prune_workspace_worktree_command(
    cloud: &CloudClient,
    identity: &WorkerIdentity,
    anyharness: &AnyHarnessClient,
    store: &WorkerStore,
    command: CloudCommandEnvelope,
) -> Result<(), WorkerError> {
    let Some(workspace_id) = command.workspace_id.clone().or_else(|| {
        command
            .payload
            .get("workspaceId")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    }) else {
        let result = command_result_request(
            &command,
            "rejected",
            Some("workspace_id_required".to_string()),
            Some("prune_workspace_worktree requires workspaceId.".to_string()),
            None,
        );
        report_command_result(cloud, identity, store, &command.command_id, &result).await?;
        return Ok(());
    };
    let Some(cloud_workspace_id) = command.cloud_workspace_id.clone().or_else(|| {
        command
            .payload
            .get("cloudWorkspaceId")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    }) else {
        let result = command_result_request(
            &command,
            "rejected",
            Some("cloud_workspace_id_required".to_string()),
            Some("prune_workspace_worktree requires cloudWorkspaceId.".to_string()),
            None,
        );
        report_command_result(cloud, identity, store, &command.command_id, &result).await?;
        return Ok(());
    };

    cloud
        .report_command_delivery(
            &identity.worker_token,
            &command.command_id,
            &command_delivery_request(&command, "delivered", None, None),
        )
        .await?;
    report_materialization_state(
        cloud,
        identity,
        &cloud_workspace_id,
        Some(&workspace_id),
        "pruning",
        Some("pruning"),
        None,
        Vec::new(),
        None,
    )
    .await;

    let response = anyharness.retire_workspace(&workspace_id).await;
    let result = match response {
        Ok(mut response) if response.is_success() => {
            if response.body.get("outcome").and_then(Value::as_str) == Some("already_retired")
                && !response
                    .body
                    .get("cleanupSucceeded")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
            {
                match anyharness.retry_retire_cleanup(&workspace_id).await {
                    Ok(retry_response) => {
                        response = retry_response;
                    }
                    Err(error) => {
                        return report_prune_failed_and_command_result(
                            cloud,
                            identity,
                            store,
                            &command,
                            &cloud_workspace_id,
                            &workspace_id,
                            Some("anyharness_retire_cleanup_retry_failed".to_string()),
                            Some(error.to_string()),
                            None,
                        )
                        .await;
                    }
                }
            }
            if !response.is_success() {
                return report_prune_failed_and_command_result(
                    cloud,
                    identity,
                    store,
                    &command,
                    &cloud_workspace_id,
                    &workspace_id,
                    Some("anyharness_retire_failed".to_string()),
                    Some(format!("AnyHarness returned HTTP {}", response.status)),
                    Some(json!({
                        "anyharnessStatusCode": response.status.as_u16(),
                        "body": response.body,
                    })),
                )
                .await;
            }
            let outcome = response
                .body
                .get("outcome")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            let cleanup_succeeded = response
                .body
                .get("cleanupSucceeded")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let cleanup_message = response
                .body
                .get("cleanupMessage")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned);
            let blockers = response
                .body
                .get("preflight")
                .and_then(|preflight| preflight.get("blockers"))
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let (state, cleanup_status) = match (outcome, cleanup_succeeded) {
                ("retired" | "already_retired", true) => ("dehydrated", "completed"),
                ("blocked", _) => ("prune_blocked", "blocked"),
                ("cleanup_failed", _) => ("prune_failed", "failed"),
                _ if cleanup_succeeded => ("dehydrated", "completed"),
                _ => ("prune_failed", "failed"),
            };
            let worktree_path = if state == "dehydrated" {
                None
            } else {
                worktree_path_from_retire_response(&response.body)
            };
            report_materialization_state(
                cloud,
                identity,
                &cloud_workspace_id,
                Some(&workspace_id),
                state,
                Some(cleanup_status),
                cleanup_message.as_deref(),
                blockers.clone(),
                worktree_path.clone(),
            )
            .await;
            command_result_request(
                &command,
                "accepted",
                None,
                None,
                Some(json!({
                    "cloudWorkspaceId": cloud_workspace_id,
                    "anyharnessWorkspaceId": workspace_id,
                    "materializationState": state,
                    "cleanupStatus": cleanup_status,
                    "cleanupLastError": cleanup_message,
                    "blockers": blockers,
                    "worktreePath": worktree_path,
                    "anyharnessStatusCode": response.status.as_u16(),
                    "body": response.body,
                })),
            )
        }
        Ok(response) => command_result_request(
            &command,
            "failed_delivery",
            Some("anyharness_retire_failed".to_string()),
            Some(format!("AnyHarness returned HTTP {}", response.status)),
            Some(json!({
                "anyharnessStatusCode": response.status.as_u16(),
                "body": response.body,
            })),
        ),
        Err(error) => command_result_request(
            &command,
            "failed_delivery",
            Some("anyharness_retire_failed".to_string()),
            Some(error.to_string()),
            None,
        ),
    };
    if result.status == "failed_delivery" {
        report_materialization_state(
            cloud,
            identity,
            &cloud_workspace_id,
            Some(&workspace_id),
            "prune_failed",
            Some("failed"),
            result.error_message.as_deref(),
            Vec::new(),
            None,
        )
        .await;
    }
    report_command_result(cloud, identity, store, &command.command_id, &result).await
}

async fn report_materialization_state(
    cloud: &CloudClient,
    identity: &WorkerIdentity,
    cloud_workspace_id: &str,
    anyharness_workspace_id: Option<&str>,
    state: &str,
    cleanup_status: Option<&str>,
    cleanup_last_error: Option<&str>,
    blockers: Vec<Value>,
    worktree_path: Option<String>,
) {
    if let Err(error) = cloud
        .report_materialization(
            &identity.worker_token,
            &MaterializationReportRequest {
                cloud_workspace_id: cloud_workspace_id.to_string(),
                anyharness_workspace_id: anyharness_workspace_id.map(ToOwned::to_owned),
                state: state.to_string(),
                cleanup_status: cleanup_status.map(ToOwned::to_owned),
                cleanup_last_error: cleanup_last_error.map(ToOwned::to_owned),
                blockers,
                worktree_path,
                storage_bytes: None,
                reclaimed_bytes: None,
                generation: None,
            },
        )
        .await
    {
        warn!(
            ?error,
            cloud_workspace_id, state, "failed to report materialization state"
        );
    }
}

async fn report_prune_failed_and_command_result(
    cloud: &CloudClient,
    identity: &WorkerIdentity,
    store: &WorkerStore,
    command: &CloudCommandEnvelope,
    cloud_workspace_id: &str,
    workspace_id: &str,
    error_code: Option<String>,
    error_message: Option<String>,
    result: Option<Value>,
) -> Result<(), WorkerError> {
    report_materialization_state(
        cloud,
        identity,
        cloud_workspace_id,
        Some(workspace_id),
        "prune_failed",
        Some("failed"),
        error_message.as_deref(),
        Vec::new(),
        None,
    )
    .await;
    let request = command_result_request(
        command,
        "failed_delivery",
        error_code,
        error_message,
        result,
    );
    report_command_result(cloud, identity, store, &command.command_id, &request).await
}

fn worktree_path_from_retire_response(body: &Value) -> Option<String> {
    body.get("workspace")
        .and_then(|workspace| workspace.get("path"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

async fn flush_pending_command_results(
    cloud: &CloudClient,
    identity: &WorkerIdentity,
    store: &WorkerStore,
) -> Result<(), WorkerError> {
    for pending in store.list_pending_command_results()? {
        let request = CommandResultRequest {
            lease_id: pending.lease_id,
            cloud_workspace_id: pending.cloud_workspace_id,
            anyharness_workspace_id: pending.anyharness_workspace_id,
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
        cloud_workspace_id: result.cloud_workspace_id.clone(),
        anyharness_workspace_id: result.anyharness_workspace_id.clone(),
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
        AnyHarnessCommand::DecidePlan {
            workspace_id,
            plan_id,
            decision,
            expected_decision_version,
        } => {
            anyharness
                .decide_plan(workspace_id, plan_id, decision, *expected_decision_version)
                .await
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

fn command_delivery_request(
    command: &CloudCommandEnvelope,
    status: &str,
    error_code: Option<String>,
    error_message: Option<String>,
) -> CommandDeliveryRequest {
    CommandDeliveryRequest {
        lease_id: command.lease_id.clone(),
        cloud_workspace_id: command.cloud_workspace_id.clone(),
        status: status.to_string(),
        error_code,
        error_message,
    }
}

fn command_result_request(
    command: &CloudCommandEnvelope,
    status: &str,
    error_code: Option<String>,
    error_message: Option<String>,
    result: Option<Value>,
) -> CommandResultRequest {
    let anyharness_workspace_id = result
        .as_ref()
        .and_then(anyharness_workspace_id_from_result);
    CommandResultRequest {
        lease_id: command.lease_id.clone(),
        cloud_workspace_id: command.cloud_workspace_id.clone(),
        anyharness_workspace_id,
        status: status.to_string(),
        error_code,
        error_message,
        result,
    }
}

fn command_result(
    command: &CloudCommandEnvelope,
    mapped: &AnyHarnessCommand,
    response: Result<AnyHarnessCommandResponse, WorkerError>,
) -> CommandResultRequest {
    match response {
        Ok(response) if response.is_success() => match success_result(command, mapped, &response) {
            Ok(result) => command_result_request(
                command,
                accepted_status(mapped, &response),
                None,
                None,
                Some(result),
            ),
            Err(error) => command_result_request(
                command,
                "rejected",
                Some(error.code),
                Some(error.message),
                Some(error.result),
            ),
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
            command_result_request(
                command,
                status,
                Some(error_code.to_string()),
                Some(format!("AnyHarness returned HTTP {}", response.status)),
                Some(json!({
                    "anyharnessStatusCode": response.status.as_u16(),
                    "body": response.body,
                })),
            )
        }
        Err(error) => {
            let (error_code, error_message) = anyharness_delivery_error(&error);
            command_result_request(
                command,
                "failed_delivery",
                Some(error_code.to_string()),
                Some(error_message),
                None,
            )
        }
    }
}

fn anyharness_delivery_error(error: &WorkerError) -> (&'static str, String) {
    match error {
        WorkerError::Http(source) if source.is_timeout() => (
            "anyharness_delivery_timeout",
            "AnyHarness request timed out while delivering command.".to_string(),
        ),
        WorkerError::Http(source) => (
            "anyharness_delivery_failed",
            format!("AnyHarness request failed: {source}"),
        ),
        _ => ("anyharness_delivery_failed", error.to_string()),
    }
}

struct SuccessResultError {
    code: String,
    message: String,
    result: Value,
}

fn success_result(
    envelope: &CloudCommandEnvelope,
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
                        if let Some(cloud_workspace_id) = &envelope.cloud_workspace_id {
                            object.insert(
                                "cloudWorkspaceId".to_string(),
                                Value::from(cloud_workspace_id.clone()),
                            );
                        }
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

fn anyharness_workspace_id_from_result(result: &Value) -> Option<String> {
    result
        .get("anyharnessWorkspaceId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
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
        AnyHarnessCommand::DecidePlan { .. } => command.session_id.clone(),
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

    #[test]
    fn materialize_workspace_result_echoes_cloud_workspace_and_slot() {
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
                        "id": "workspace-1",
                        "repoRootId": "repo-root-1",
                        "path": "/workspace/proliferate",
                        "kind": "local"
                    }
                }),
            }),
        );
        assert_eq!(result.status, "accepted");
        assert_eq!(
            result.cloud_workspace_id.as_deref(),
            Some("cloud-workspace-1")
        );
        assert_eq!(
            result.anyharness_workspace_id.as_deref(),
            Some("workspace-1")
        );
        assert_eq!(
            result
                .result
                .as_ref()
                .and_then(|value| value.get("cloudWorkspaceId"))
                .and_then(serde_json::Value::as_str),
            Some("cloud-workspace-1")
        );
    }

    fn test_command() -> CloudCommandEnvelope {
        CloudCommandEnvelope {
            command_id: "command-1".to_string(),
            idempotency_key: "key-1".to_string(),
            target_id: "target-1".to_string(),
            workspace_id: None,
            cloud_workspace_id: Some("cloud-workspace-1".to_string()),
            sandbox_profile_id: Some("sandbox-profile-1".to_string()),
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
