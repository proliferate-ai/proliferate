use tokio::time::sleep;
use tracing::{info, warn};

use crate::{
    anyharness_update,
    catalog_sync::{self, CatalogSyncState},
    cloud_client::CloudClient,
    config::WorkerConfig,
    error::WorkerError,
    identity,
    identity::credentials::WorkerIdentity,
    integration_gateway, lifecycle,
    process_lock::WorkerProcessLock,
    self_update, supervisor_bridge,
    store::WorkerStore,
};

/// Whether the worker loop should keep running or exit cleanly after a tick. The
/// D5 bridge hands the box to a freshly-started Supervisor and asks this Worker
/// to exit so the Supervisor's own Worker child takes over; every other tick
/// continues the loop.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TickControl {
    Continue,
    Exit,
}

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
    if heartbeat_and_converge(&config, &cloud, &store, &identity, &catalog_state, once).await
        == TickControl::Exit
    {
        return Ok(());
    }
    if once {
        return Ok(());
    }
    loop {
        sleep(lifecycle::heartbeat::interval(&config)).await;
        if heartbeat_and_converge(&config, &cloud, &store, &identity, &catalog_state, false).await
            == TickControl::Exit
        {
            return Ok(());
        }
    }
}

/// One heartbeat plus whatever the ack demands. Never fails the worker loop:
/// a missed heartbeat or a failed self-update leaves the current binary
/// serving, and the next tick retries. In `--once` mode a pending update is
/// only reported (dry run), never executed.
async fn heartbeat_and_converge(
    config: &WorkerConfig,
    cloud: &CloudClient,
    store: &WorkerStore,
    identity: &WorkerIdentity,
    catalog_state: &CatalogSyncState,
    dry_run: bool,
) -> TickControl {
    let anyharness_version = anyharness_update::running_anyharness_version(store);
    let response = match lifecycle::heartbeat::send_once(cloud, identity, anyharness_version).await
    {
        Ok(response) => response,
        Err(error) => {
            warn!(?error, "worker heartbeat failed");
            return TickControl::Continue;
        }
    };

    // Catalog sync: non-fatal, runs first (a worker binary swap exec's and
    // never returns, so anything on this tick must precede it).
    catalog_sync::maybe_sync(
        config,
        cloud,
        &identity.worker_token,
        &response,
        catalog_state,
    )
    .await;

    // Supervisor-owned target: the Worker is only an observer + writer. It never
    // runs the legacy in-place AnyHarness swap or the self-exec worker swap here;
    // version divergence is routed through the Supervisor mailbox and the
    // one-time D5 bridge migrates an already-provisioned sandbox to Supervisor
    // ownership (exiting cleanly once the Supervisor owns the box).
    if supervisor_bridge::is_supervisor_owned(config) {
        return converge_supervisor_owned(config, cloud, store, &response, dry_run).await;
    }

    // Legacy independent-launch path (fenced during the bridge window): the
    // Worker owns the AnyHarness swap and its own self-update.
    //
    // AnyHarness runtime binary swap: non-fatal, runs before worker
    // self-update. Unlike the worker swap this does not exec — it
    // stops/swaps/relaunches a sibling process and keeps heartbeating — so the
    // loop continues normally afterward.
    converge_anyharness_runtime(config, cloud, store, &response, dry_run).await;

    let Some(update) = self_update::plan(config, &response) else {
        return TickControl::Continue;
    };
    if dry_run {
        info!(
            desired = %update.desired_version,
            "self-update pending; skipped in --once mode"
        );
        return TickControl::Continue;
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
    TickControl::Continue
}

/// Supervisor-owned convergence (decision 2 write side + decision 6 bridge).
/// Runs the one-time D5 bridge when the ack requests it — exiting cleanly once a
/// freshly-started Supervisor owns the box — then routes any version divergence
/// through the Supervisor mailbox. The Worker never downloads, replaces, kills,
/// or rolls back AnyHarness or itself in this path.
async fn converge_supervisor_owned(
    config: &WorkerConfig,
    cloud: &CloudClient,
    store: &WorkerStore,
    response: &crate::cloud_client::HeartbeatResponse,
    dry_run: bool,
) -> TickControl {
    if dry_run {
        // Dry run: never spawn a Supervisor or write a request. Only report.
        if response.desired_topology.as_deref()
            == Some(supervisor_bridge::SUPERVISOR_OWNED_TOPOLOGY)
        {
            info!("supervisor bridge pending; skipped in --once mode");
        }
        supervisor_bridge::converge_via_mailbox(config, cloud, store, response, true).await;
        return TickControl::Continue;
    }

    match supervisor_bridge::maybe_bridge_to_supervisor(config, response).await {
        Ok(supervisor_bridge::BridgeOutcome::Bridged) => {
            // Handed the box to a freshly-started Supervisor; exit cleanly so its
            // own Worker child takes over as the mailbox writer.
            return TickControl::Exit;
        }
        Ok(_) => {}
        Err(error) => {
            // The bridge did not confirm this tick; the current runtime keeps
            // serving and the next heartbeat resumes it (crash-safe via markers).
            warn!(?error, "supervisor bridge attempt did not complete; retrying next heartbeat");
        }
    }

    supervisor_bridge::converge_via_mailbox(config, cloud, store, response, false).await;
    TickControl::Continue
}

async fn converge_anyharness_runtime(
    config: &WorkerConfig,
    cloud: &CloudClient,
    store: &WorkerStore,
    response: &crate::cloud_client::HeartbeatResponse,
    dry_run: bool,
) {
    let Some(update) = anyharness_update::plan(config, store, response) else {
        return;
    };
    if dry_run {
        info!(
            desired = %update.desired_version,
            "anyharness runtime update pending; skipped in --once mode"
        );
        return;
    }
    if let Err(error) = anyharness_update::converge(config, cloud, store, &update).await {
        warn!(
            ?error,
            desired = %update.desired_version,
            "anyharness runtime update failed; current runtime keeps serving"
        );
    }
}
