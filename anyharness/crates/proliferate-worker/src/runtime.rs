use tokio::time::sleep;
use tracing::{info, warn};

use crate::{
    cloud_client::CloudClient,
    config::WorkerConfig,
    error::WorkerError,
    identity,
    identity::credentials::WorkerIdentity,
    integration_gateway,
    launch_options_sync::{self, LaunchOptionsSyncState},
    lifecycle,
    process_lock::WorkerProcessLock,
    store::WorkerStore,
    supervisor_bridge, versions,
};

pub async fn run(config: WorkerConfig, once: bool) -> Result<(), WorkerError> {
    let _process_lock = WorkerProcessLock::acquire(&config.worker_db_path)?;
    let store = WorkerStore::open(config.worker_db_path.clone())?;
    let cloud = CloudClient::new(&config)?;
    let (identity, integration_gateway) =
        identity::ensure_enrolled(&config, &store, &cloud).await?;
    info!(worker_id = %identity.worker_id, "proliferate worker started");

    // Write the integration-gateway dotfile on every (re)enroll.
    if let Some(gateway) = integration_gateway.as_ref() {
        integration_gateway::write(&config, gateway)?;
        info!(
            path = %integration_gateway::dotfile_path(&config).display(),
            "wrote integration-gateway dotfile"
        );
    }

    let launch_options_sync_state = LaunchOptionsSyncState::new();
    heartbeat_and_converge(
        &config,
        &cloud,
        &store,
        &identity,
        integration_gateway.as_ref(),
        &launch_options_sync_state,
        once,
    )
    .await;
    if once {
        return Ok(());
    }
    loop {
        sleep(lifecycle::heartbeat::interval(&config)).await;
        heartbeat_and_converge(
            &config,
            &cloud,
            &store,
            &identity,
            integration_gateway.as_ref(),
            &launch_options_sync_state,
            false,
        )
        .await;
    }
}

/// One heartbeat plus whatever the ack demands. Never fails the worker loop:
/// a missed heartbeat leaves the current binary serving, and the next tick
/// retries. In `--once` mode pending convergence work is only reported (dry
/// run), never written to the mailbox.
async fn heartbeat_and_converge(
    config: &WorkerConfig,
    cloud: &CloudClient,
    store: &WorkerStore,
    identity: &WorkerIdentity,
    gateway: Option<&crate::cloud_client::IntegrationGatewayConfig>,
    launch_options_sync_state: &LaunchOptionsSyncState,
    dry_run: bool,
) {
    let anyharness_version = versions::running_anyharness_version(store);
    let response =
        match lifecycle::heartbeat::send_once(cloud, identity, config, anyharness_version).await {
            Ok(response) => response,
            Err(error) => {
                warn!(?error, "worker heartbeat failed");
                return;
            }
        };

    // Only the currently authorized Worker receives a successful heartbeat.
    // Reassert its gateway credential if a delayed predecessor overwrote the
    // shared runtime dotfile after this Worker enrolled. A revoked Worker
    // fails above and therefore cannot keep rewriting stale authority.
    if let Some(gateway) = gateway {
        match integration_gateway::ensure_current(config, gateway) {
            Ok(true) => info!(
                path = %integration_gateway::dotfile_path(config).display(),
                "repaired integration-gateway dotfile after heartbeat"
            ),
            Ok(false) => {}
            Err(error) => warn!(?error, "failed to repair integration-gateway dotfile"),
        }
    }

    // Launch-options copy: non-fatal, runs before convergence work.
    //
    // REL-10: the server's verdict off THIS tick's ack is handed straight to the
    // admission gate. Absent decodes to `false`, so an old server pauses copying
    // sync before any local read; the bit is never cached, aged, or reinterpreted
    // here, and it never influences the convergence work below.
    launch_options_sync::maybe_sync(
        response.launch_options_upload_allowed,
        config,
        cloud,
        &identity.worker_token,
        launch_options_sync_state,
    )
    .await;

    // Supervisor-owned target: the Worker is only an observer + writer; version
    // divergence is routed through the Supervisor mailbox. A config with no
    // mailbox dir (desktop, whose app bundle owns both binaries) converges
    // nothing — it only heartbeats and syncs.
    if supervisor_bridge::is_supervisor_owned(config) {
        supervisor_bridge::converge_via_mailbox(config, cloud, store, &response, dry_run).await;
    }
}

#[cfg(test)]
#[path = "runtime_tests.rs"]
mod tests;
