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
    if let Err(error) = send_heartbeat(&cloud, &identity).await {
        warn!(?error, "worker heartbeat failed");
    }
    if once {
        return Ok(());
    }
    let command_config = config.clone();
    let command_cloud = cloud.clone();
    let command_identity = identity.clone();
    tokio::spawn(async move {
        if let Err(error) =
            commands::dispatcher::run_loop(command_config, command_cloud, command_identity).await
        {
            warn!(?error, "worker command loop exited");
        }
    });
    loop {
        sleep(Duration::from_secs(
            config.heartbeat_interval_seconds.max(10),
        ))
        .await;
        if let Err(error) = send_heartbeat(&cloud, &identity).await {
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

async fn send_heartbeat(cloud: &CloudClient, identity: &WorkerIdentity) -> Result<(), WorkerError> {
    let request = heartbeat::online(Some(env!("CARGO_PKG_VERSION").to_string()), None, None);
    cloud.heartbeat(&identity.worker_token, &request).await
}
