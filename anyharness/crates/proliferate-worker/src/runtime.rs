use tokio::time::sleep;
use tracing::{info, warn};

use crate::{
    cloud_client::{inventory as cloud_inventory, CloudClient},
    config::WorkerConfig,
    control,
    error::WorkerError,
    identity::{self, credentials::WorkerIdentity},
    inventory, lifecycle,
    process_lock::WorkerProcessLock,
    store::WorkerStore,
    tail,
};

pub async fn run(config: WorkerConfig, once: bool) -> Result<(), WorkerError> {
    let _process_lock = WorkerProcessLock::acquire(&config.worker_db_path)?;
    let store = WorkerStore::open(config.worker_db_path.clone())?;
    let cloud = CloudClient::new(&config)?;
    let identity = identity::ensure_enrolled(&config, &store, &cloud).await?;
    let health = lifecycle::heartbeat::runtime_health(&config).await;
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
    if let Err(error) = lifecycle::heartbeat::send_once(&config, &cloud, &identity).await {
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
        if let Err(error) = control::r#loop::run_loop(
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
    let tail_config = config.clone();
    let tail_cloud = cloud.clone();
    let tail_identity = identity.clone();
    let tail_store = store.clone();
    tokio::spawn(async move {
        if let Err(error) =
            tail::r#loop::run_loop(tail_config, tail_cloud, tail_identity, tail_store).await
        {
            warn!(?error, "worker event tail loop exited");
        }
    });
    loop {
        sleep(lifecycle::heartbeat::interval(&config)).await;
        if let Err(error) = lifecycle::heartbeat::send_once(&config, &cloud, &identity).await {
            warn!(?error, "worker heartbeat failed");
        }
    }
}

async fn upload_inventory(
    cloud: &CloudClient,
    identity: &WorkerIdentity,
    health: &lifecycle::heartbeat::RuntimeHealth,
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
