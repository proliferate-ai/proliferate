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
    sync, updates,
};

pub async fn run(config: WorkerConfig, once: bool) -> Result<(), WorkerError> {
    let store = WorkerStore::open(config.worker_db_path.clone())?;
    let cloud = CloudClient::new(&config)?;
    let identity = ensure_identity(&config, &store, &cloud).await?;
    if let Some(base_url) = config.anyharness_base_url.clone() {
        let client = AnyHarnessClient::new(base_url, config.anyharness_bearer_token.clone())?;
        let healthy = anyharness_health::probe(&client).await;
        info!(healthy, "anyharness health probe completed");
    }
    info!(
        target_id = %identity.target_id,
        worker_id = %identity.worker_id,
        "proliferate worker started"
    );
    if let Err(error) = upload_inventory(&cloud, &identity).await {
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
) -> Result<(), WorkerError> {
    let request = cloud_inventory::report(inventory::collect());
    cloud
        .upload_inventory(&identity.worker_token, &request)
        .await
}

async fn send_heartbeat(
    config: &WorkerConfig,
    cloud: &CloudClient,
    identity: &WorkerIdentity,
) -> Result<(), WorkerError> {
    let anyharness_version = anyharness_version(config).await;
    let worker_version = Some(env!("CARGO_PKG_VERSION").to_string());
    let supervisor_version = config.supervisor_version.clone();
    let request = heartbeat::online(
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

async fn anyharness_version(config: &WorkerConfig) -> Option<String> {
    let base_url = config.anyharness_base_url.clone()?;
    let client = AnyHarnessClient::new(base_url, config.anyharness_bearer_token.clone()).ok()?;
    anyharness_health::version(&client).await
}
