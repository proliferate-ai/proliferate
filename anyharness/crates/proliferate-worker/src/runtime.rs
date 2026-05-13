use std::time::Duration;

use crate::anyharness_client::AnyHarnessClient;
use crate::cloud_client::commands::{
    CommandResultReport, DeliveryReport, DeliveryStatus, LeaseCommandsRequest,
};
use crate::cloud_client::heartbeat::HeartbeatRequest;
use crate::cloud_client::inventory::InventoryReportRequest;
use crate::cloud_client::{CloudClient, WorkerAuth};
use crate::commands::result::DispatchStatus;
use crate::commands::CommandDispatcher;
use crate::config::{CloudConfig, WorkerConfig};
use crate::error::{Result, WorkerError};
use crate::identity::StoredIdentity;
use crate::lifecycle::{activity, safe_stop, shutdown};
use crate::store::commands::CommandLeaseRecord;
use crate::store::Store;
use crate::{identity, inventory, sync, updates};

pub async fn run(config: WorkerConfig) -> Result<()> {
    std::fs::create_dir_all(&config.worker_home)?;

    let store = Store::open(&config.database_path)?;
    updates::seed_installed_versions(&store)?;

    let anyharness = AnyHarnessClient::new(&config.anyharness);
    let enrollment_cloud = CloudClient::unauthenticated(&config.cloud);
    let initial_inventory = inventory::collect(&anyharness).await?;
    let identity =
        identity::ensure_identity(&store, &config, &enrollment_cloud, &initial_inventory).await?;

    let cloud_config = cloud_config_for_identity(&config, &identity);
    let auth = WorkerAuth::from_identity(&identity).ok_or_else(|| {
        WorkerError::Identity("only bearer worker credentials are supported in V1 skeleton".into())
    })?;
    let cloud = CloudClient::authenticated(&cloud_config, auth);

    match anyharness.health().await {
        Ok(health) => tracing::info!(
            anyharness_version = %health.version,
            runtime_home = %health.runtime_home,
            "local AnyHarness health check passed"
        ),
        Err(error) => tracing::warn!(%error, "local AnyHarness health check failed"),
    }

    report_inventory_once(&store, &cloud, &anyharness, &identity).await?;

    let dispatcher = CommandDispatcher::new(anyharness.clone());
    let handles = vec![
        tokio::spawn(heartbeat_loop(
            config.loops.heartbeat_active,
            config.loops.heartbeat_idle,
            cloud.clone(),
            anyharness.clone(),
            identity.clone(),
        )),
        tokio::spawn(inventory_loop(
            config.loops.inventory,
            store.clone(),
            cloud.clone(),
            anyharness.clone(),
            identity.clone(),
        )),
        tokio::spawn(command_loop(
            config.loops.command_poll_timeout,
            config.loops.command_idle_sleep,
            store.clone(),
            cloud.clone(),
            dispatcher,
            identity.clone(),
        )),
        tokio::spawn(outbox_loop(
            config.loops.outbox_retry,
            store.clone(),
            cloud.clone(),
            identity.clone(),
        )),
        tokio::spawn(sync_tail_loop(
            config.loops.sync_flush,
            store.clone(),
            anyharness.clone(),
            identity.clone(),
        )),
        tokio::spawn(update_loop(
            config.loops.updates,
            store.clone(),
            cloud.clone(),
            identity.clone(),
        )),
    ];

    tracing::info!(
        target_id = %identity.target_id,
        worker_id = %identity.worker_id,
        worker_home = %config.worker_home.display(),
        "proliferate worker loops started"
    );

    shutdown::wait_for_shutdown_signal().await;
    for handle in handles {
        handle.abort();
    }
    tracing::info!("proliferate worker shutdown complete");
    Ok(())
}

fn cloud_config_for_identity(config: &WorkerConfig, identity: &StoredIdentity) -> CloudConfig {
    let mut cloud = config.cloud.clone();
    if let Ok(base_url) = url::Url::parse(&identity.cloud_base_url) {
        cloud.base_url = base_url;
    }
    cloud
}

async fn heartbeat_loop(
    active_interval: Duration,
    idle_interval: Duration,
    cloud: CloudClient,
    anyharness: AnyHarnessClient,
    identity: StoredIdentity,
) {
    loop {
        let anyharness_reachable = anyharness.health().await.is_ok();
        let activity = activity::collect(&anyharness).await;
        let safe_stop = safe_stop::collect(&anyharness).await;
        let active = activity.active_session_count > 0
            || activity.active_turn_count > 0
            || activity.pending_interaction_count > 0;

        let request = HeartbeatRequest {
            target_id: identity.target_id.clone(),
            worker_id: identity.worker_id.clone(),
            worker_version: env!("CARGO_PKG_VERSION").to_string(),
            anyharness_reachable,
            anyharness_version: None,
            online_status: "online".to_string(),
            safe_stop_state: serde_json::to_value(safe_stop.state)
                .ok()
                .and_then(|value| value.as_str().map(ToOwned::to_owned))
                .unwrap_or_else(|| "unknown".to_string()),
            safe_stop_reasons: serde_json::json!({
                "blockers": safe_stop.blockers,
                "details": safe_stop.details,
            }),
            active_session_count: activity.active_session_count,
            active_turn_count: activity.active_turn_count,
            pending_interaction_count: activity.pending_interaction_count,
            active_terminal_count: activity.active_terminal_count,
            active_process_count: activity.active_process_count,
            last_activity_at: activity.last_activity_at,
        };
        if let Err(error) = cloud.heartbeat(&request).await {
            tracing::warn!(%error, "worker heartbeat failed");
        }

        tokio::time::sleep(if active {
            active_interval
        } else {
            idle_interval
        })
        .await;
    }
}

async fn inventory_loop(
    interval: Duration,
    store: Store,
    cloud: CloudClient,
    anyharness: AnyHarnessClient,
    identity: StoredIdentity,
) {
    loop {
        if let Err(error) = report_inventory_once(&store, &cloud, &anyharness, &identity).await {
            tracing::warn!(%error, "inventory report failed");
        }
        tokio::time::sleep(interval).await;
    }
}

async fn report_inventory_once(
    store: &Store,
    cloud: &CloudClient,
    anyharness: &AnyHarnessClient,
    identity: &StoredIdentity,
) -> Result<()> {
    let report = inventory::collect(anyharness).await?;
    let report_hash = inventory::hash_report(&report)?;
    let payload = serde_json::to_string(&report)?;
    if let Some(cache) = store.load_inventory_cache("target")? {
        if cache.last_report_hash == report_hash {
            return Ok(());
        }
    }

    cloud
        .report_inventory(&InventoryReportRequest {
            target_id: identity.target_id.clone(),
            worker_id: identity.worker_id.clone(),
            report,
            report_hash: report_hash.clone(),
        })
        .await?;
    store.save_inventory_cache("target", &report_hash, &payload)?;
    Ok(())
}

async fn command_loop(
    poll_timeout: Duration,
    idle_sleep: Duration,
    store: Store,
    cloud: CloudClient,
    dispatcher: CommandDispatcher,
    identity: StoredIdentity,
) {
    loop {
        let lease = cloud
            .lease_commands(&LeaseCommandsRequest {
                timeout_seconds: poll_timeout.as_secs().min(30),
                lease_seconds: 60,
                max_commands: 10,
            })
            .await;

        let commands = match lease {
            Ok(response) => response.commands,
            Err(error) => {
                tracing::warn!(%error, "command lease request failed");
                tokio::time::sleep(idle_sleep).await;
                continue;
            }
        };

        if commands.is_empty() {
            tokio::time::sleep(idle_sleep).await;
            continue;
        }

        for command in commands {
            let kind = format!("{:?}", command.kind);
            let record = CommandLeaseRecord {
                command_id: command.command_id.clone(),
                lease_id: command.lease_id.clone(),
                kind,
                status: "leased".to_string(),
                leased_at: None,
                lease_expires_at: None,
                last_error: None,
            };
            if let Err(error) = store.upsert_command_lease(&record) {
                tracing::warn!(command_id = %command.command_id, %error, "failed to persist command lease");
            }

            let delivered = DeliveryReport {
                target_id: identity.target_id.clone(),
                worker_id: identity.worker_id.clone(),
                lease_id: command.lease_id.clone(),
                status: DeliveryStatus::Delivered,
                error_code: None,
                error_message: None,
            };
            if let Err(error) = cloud.report_delivery(&command.command_id, &delivered).await {
                tracing::warn!(command_id = %command.command_id, %error, "failed to report command delivery");
            }

            match dispatcher.dispatch(&command).await {
                Ok(result) => {
                    let status = match result.status {
                        DispatchStatus::Accepted => "accepted",
                        DispatchStatus::AcceptedButQueued => "accepted_but_queued",
                        DispatchStatus::Rejected => "rejected",
                    };
                    if let Err(error) = store.mark_command_status(&command.command_id, status, None)
                    {
                        tracing::warn!(command_id = %command.command_id, %error, "failed to update command status");
                    }
                    let report = CommandResultReport::from_dispatch(
                        identity.target_id.clone(),
                        identity.worker_id.clone(),
                        command.lease_id.clone(),
                        result,
                    );
                    if let Err(error) = cloud
                        .report_command_result(&command.command_id, &report)
                        .await
                    {
                        tracing::warn!(command_id = %command.command_id, %error, "failed to report command result");
                    }
                }
                Err(error) => {
                    let error_message = error.to_string();
                    let failed = DeliveryReport {
                        target_id: identity.target_id.clone(),
                        worker_id: identity.worker_id.clone(),
                        lease_id: command.lease_id.clone(),
                        status: DeliveryStatus::FailedDelivery,
                        error_code: Some("LOCAL_DELIVERY_FAILED".to_string()),
                        error_message: Some(error_message.clone()),
                    };
                    if let Err(report_error) =
                        cloud.report_delivery(&command.command_id, &failed).await
                    {
                        tracing::warn!(command_id = %command.command_id, %report_error, "failed to report delivery failure");
                    }
                    if let Err(store_error) = store.mark_command_status(
                        &command.command_id,
                        "failed_delivery",
                        Some(&error_message),
                    ) {
                        tracing::warn!(command_id = %command.command_id, %store_error, "failed to persist delivery failure");
                    }
                }
            }
        }
    }
}

async fn outbox_loop(
    interval: Duration,
    store: Store,
    cloud: CloudClient,
    identity: StoredIdentity,
) {
    loop {
        if let Err(error) = sync::outbox::upload_due_batches(&store, &cloud, &identity).await {
            tracing::warn!(%error, "outbox upload loop failed");
        }
        tokio::time::sleep(interval).await;
    }
}

async fn sync_tail_loop(
    interval: Duration,
    store: Store,
    anyharness: AnyHarnessClient,
    identity: StoredIdentity,
) {
    loop {
        match store.list_cursors(25) {
            Ok(cursors) => {
                for cursor in cursors {
                    let session = sync::tailer::TailSession {
                        workspace_id: Some(cursor.workspace_id),
                        session_id: cursor.session_id,
                        after_seq: Some(cursor.last_uploaded_seq),
                    };
                    if let Err(error) =
                        sync::tailer::tail_once(&store, &anyharness, &identity, &session).await
                    {
                        tracing::debug!(
                            session_id = %session.session_id,
                            %error,
                            "session tail pass did not enqueue events"
                        );
                    }
                }
            }
            Err(error) => tracing::warn!(%error, "failed to load sync cursors"),
        }
        tokio::time::sleep(interval).await;
    }
}

async fn update_loop(
    interval: Duration,
    store: Store,
    cloud: CloudClient,
    identity: StoredIdentity,
) {
    loop {
        if let Err(error) = updates::reconcile_once(&store, &cloud, &identity).await {
            tracing::warn!(%error, "update reconciliation failed");
        }
        tokio::time::sleep(interval).await;
    }
}
