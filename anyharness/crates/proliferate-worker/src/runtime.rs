use tokio::time::sleep;
use tracing::{info, warn};

use crate::{
    cloud_client::CloudClient,
    config::WorkerConfig,
    error::WorkerError,
    identity, integration_gateway, lifecycle,
    process_lock::WorkerProcessLock,
    store::WorkerStore,
};

pub async fn run(config: WorkerConfig, once: bool) -> Result<(), WorkerError> {
    let _process_lock = WorkerProcessLock::acquire(&config.worker_db_path)?;
    let store = WorkerStore::open(config.worker_db_path.clone())?;
    let cloud = CloudClient::new(&config)?;
    let (identity, integration_gateway) = identity::ensure_enrolled(&config, &store, &cloud).await?;
    info!(worker_id = %identity.worker_id, "proliferate worker started");

    // Write the integration-gateway dotfile on every (re)enroll.
    if let Some(gateway) = integration_gateway {
        integration_gateway::write(&config, &gateway)?;
        info!(
            path = %integration_gateway::dotfile_path(&config).display(),
            "wrote integration-gateway dotfile"
        );
    }

    if let Err(error) = lifecycle::heartbeat::send_once(&cloud, &identity).await {
        warn!(?error, "worker heartbeat failed");
    }
    if once {
        return Ok(());
    }
    loop {
        sleep(lifecycle::heartbeat::interval(&config)).await;
        if let Err(error) = lifecycle::heartbeat::send_once(&cloud, &identity).await {
            warn!(?error, "worker heartbeat failed");
        }
    }
}
