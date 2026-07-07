use tokio::time::sleep;
use tracing::{info, warn};

use crate::{
    catalog_sync::{self, CatalogSyncState},
    cloud_client::CloudClient,
    config::WorkerConfig,
    error::WorkerError,
    identity,
    identity::credentials::WorkerIdentity,
    integration_gateway, lifecycle,
    process_lock::WorkerProcessLock,
    self_update,
    store::WorkerStore,
};

pub async fn run(config: WorkerConfig, once: bool) -> Result<(), WorkerError> {
    let _process_lock = WorkerProcessLock::acquire(&config.worker_db_path)?;
    let store = WorkerStore::open(config.worker_db_path.clone())?;
    let cloud = CloudClient::new(&config)?;
    let (identity, integration_gateway) =
        identity::ensure_enrolled(&config, &store, &cloud).await?;
    info!(worker_id = %identity.worker_id, "proliferate worker started");

    // Write the integration-gateway dotfile on every (re)enroll.
    if let Some(gateway) = integration_gateway {
        integration_gateway::write(&config, &gateway)?;
        info!(
            path = %integration_gateway::dotfile_path(&config).display(),
            "wrote integration-gateway dotfile"
        );
    }

    let catalog_state = CatalogSyncState::new();
    heartbeat_and_converge(&config, &cloud, &identity, &catalog_state, once).await;
    if once {
        return Ok(());
    }
    loop {
        sleep(lifecycle::heartbeat::interval(&config)).await;
        heartbeat_and_converge(&config, &cloud, &identity, &catalog_state, false).await;
    }
}

/// One heartbeat plus whatever the ack demands. Never fails the worker loop:
/// a missed heartbeat or a failed self-update leaves the current binary
/// serving, and the next tick retries. In `--once` mode a pending update is
/// only reported (dry run), never executed.
async fn heartbeat_and_converge(
    config: &WorkerConfig,
    cloud: &CloudClient,
    identity: &WorkerIdentity,
    catalog_state: &CatalogSyncState,
    dry_run: bool,
) {
    let response = match lifecycle::heartbeat::send_once(cloud, identity).await {
        Ok(response) => response,
        Err(error) => {
            warn!(?error, "worker heartbeat failed");
            return;
        }
    };

    // Catalog sync: non-fatal, runs before self-update because a binary swap
    // exec's and never returns.
    catalog_sync::maybe_sync(config, cloud, &identity.worker_token, &response, catalog_state)
        .await;

    let Some(update) = self_update::plan(config, &response) else {
        return;
    };
    if dry_run {
        info!(
            desired = %update.desired_version,
            "self-update pending; skipped in --once mode"
        );
        return;
    }
    // On success this never returns: converge ends by exec'ing the swapped
    // binary in place of this process.
    if let Err(error) = self_update::converge(cloud, &update).await {
        warn!(
            ?error,
            desired = %update.desired_version,
            "worker self-update failed; staying on the current version"
        );
    }
}
