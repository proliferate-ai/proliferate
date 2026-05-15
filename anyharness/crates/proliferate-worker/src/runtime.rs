use tokio::time::{sleep, Duration};
use tracing::{info, warn};

use crate::{
    anyharness_client::{health as anyharness_health, AnyHarnessClient},
    cloud_client::{heartbeat, inventory as cloud_inventory, CloudClient},
    commands,
    config::WorkerConfig,
    error::WorkerError,
    identity::{credentials::WorkerIdentity, enrollment},
    inventory,
    store::WorkerStore,
    sync, updates, versions,
};

struct RuntimeHealth {
    status: &'static str,
    status_detail: Option<String>,
    anyharness_version: Option<String>,
}

pub async fn run(config: WorkerConfig, once: bool) -> Result<(), WorkerError> {
    let store = WorkerStore::open(config.worker_db_path.clone())?;
    let cloud = CloudClient::new(&config)?;
    let identity = ensure_identity(&config, &store, &cloud).await?;
    let health = runtime_health(&config).await;
    info!(
        healthy = health.status == "online",
        status = health.status,
        "anyharness health probe completed"
    );
    info!(
        target_id = %identity.target_id,
        worker_id = %identity.worker_id,
        "proliferate worker started"
    );
    if let Err(error) = upload_inventory(&cloud, &identity, &health).await {
        warn!(?error, "worker inventory upload failed");
    }
    if let Err(error) = send_heartbeat(&config, &cloud, &identity).await {
        warn!(?error, "worker heartbeat failed");
    }
    if once {
        return Ok(());
    }
    let command_config = config.clone();
    let command_cloud = cloud.clone();
    let command_identity = identity.clone();
    let command_store = store.clone();
    tokio::spawn(async move {
        if let Err(error) = commands::dispatcher::run_loop(
            command_config,
            command_cloud,
            command_identity,
            command_store,
        )
        .await
        {
            warn!(?error, "worker command loop exited");
        }
    });
    let sync_config = config.clone();
    let sync_cloud = cloud.clone();
    let sync_identity = identity.clone();
    let sync_store = store.clone();
    tokio::spawn(async move {
        if let Err(error) =
            sync::tailer::run_loop(sync_config, sync_cloud, sync_identity, sync_store).await
        {
            warn!(?error, "worker event sync loop exited");
        }
    });
    loop {
        sleep(Duration::from_secs(
            config.heartbeat_interval_seconds.max(10),
        ))
        .await;
        if let Err(error) = send_heartbeat(&config, &cloud, &identity).await {
            warn!(?error, "worker heartbeat failed");
        }
    }
}

async fn ensure_identity(
    config: &WorkerConfig,
    store: &WorkerStore,
    cloud: &CloudClient,
) -> Result<WorkerIdentity, WorkerError> {
    if let Some(identity) = WorkerIdentity::load(store)? {
        if let Err(error) = config.clear_enrollment_token() {
            warn!(
                ?error,
                "failed to clear enrollment token from worker config"
            );
        }
        return Ok(identity);
    }
    let local_inventory = inventory::collect();
    let request = enrollment::build_enroll_request(config, local_inventory)?;
    let response = cloud.enroll(&request).await?;
    let identity = enrollment::identity_from_response(response);
    identity.save(store)?;
    if let Err(error) = config.clear_enrollment_token() {
        warn!(
            ?error,
            "failed to clear enrollment token from worker config"
        );
    }
    Ok(identity)
}

async fn upload_inventory(
    cloud: &CloudClient,
    identity: &WorkerIdentity,
    health: &RuntimeHealth,
) -> Result<(), WorkerError> {
    let request = cloud_inventory::report(
        inventory::collect(),
        health.status,
        health.status_detail.clone(),
    );
    cloud
        .upload_inventory(&identity.worker_token, &request)
        .await
}

async fn send_heartbeat(
    config: &WorkerConfig,
    cloud: &CloudClient,
    identity: &WorkerIdentity,
) -> Result<(), WorkerError> {
    let health = runtime_health(config).await;
    let anyharness_version = health.anyharness_version.clone();
    let worker_version = versions::worker_version();
    let supervisor_version = versions::supervisor_version_or_configured(&config.supervisor_version);
    let request = heartbeat::report(
        health.status,
        health.status_detail.clone(),
        worker_version.clone(),
        anyharness_version.clone(),
        supervisor_version.clone(),
    );
    let response = cloud.heartbeat(&identity.worker_token, &request).await?;
    crate::observability::heartbeat_ack(&response);
    let installed = updates::desired::InstalledVersions {
        anyharness_version,
        worker_version,
        supervisor_version,
    };
    if let Err(error) = updates::desired::reconcile(
        config,
        cloud,
        identity,
        &response.desired_versions,
        &installed,
    )
    .await
    {
        warn!(?error, "worker update reconciliation failed");
    }
    Ok(())
}

async fn runtime_health(config: &WorkerConfig) -> RuntimeHealth {
    if config.anyharness_base_url.is_none() {
        return RuntimeHealth {
            status: "online",
            status_detail: None,
            anyharness_version: None,
        };
    }
    match anyharness_version(config).await {
        Some(version) => RuntimeHealth {
            status: "online",
            status_detail: None,
            anyharness_version: Some(version),
        },
        None => RuntimeHealth {
            status: "degraded",
            status_detail: Some("AnyHarness health probe failed.".to_string()),
            anyharness_version: None,
        },
    }
}

async fn anyharness_version(config: &WorkerConfig) -> Option<String> {
    let base_url = config.anyharness_base_url.clone()?;
    let client = AnyHarnessClient::new(base_url, config.anyharness_bearer_token.clone()).ok()?;
    for attempt in 0..20 {
        if let Some(version) = anyharness_health::version(&client).await {
            return Some(version);
        }
        if attempt < 19 {
            sleep(Duration::from_millis(500)).await;
        }
    }
    None
}
