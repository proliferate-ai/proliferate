//! Agents wiring: the launch-options/probe/status services, the automatic
//! poke suppression, and the agent runtime with its engine attached.
//! Composition only — no behavior.

use std::path::PathBuf;
use std::sync::Arc;

use crate::domains::agents::catalog::service::AgentCatalogService;
use crate::domains::agents::catalog::sync::CatalogSyncService;
use crate::domains::agents::installer::reconcile::execution::AgentReconcileService;
use crate::domains::agents::installer::seed::AgentSeedStore;
use crate::domains::agents::launch_options::HarnessLaunchOptionsService;
use crate::domains::agent_auth::launch_probe::targets::RuntimeProbeTargets;
use crate::domains::agent_auth::launch_probe::LaunchProbeService;
use crate::domains::agent_auth::route_auth::gateway_plan::GatewayModelPlanner;
use crate::domains::agents::runtime::{AgentRuntime, RuntimeSurface};
use crate::domains::agent_auth::status::AgentStatusService;
use crate::persistence::Db;

/// Everything the agents wiring produces for `AppState`.
pub(super) struct AgentStack {
    pub(super) launch_options_service: Arc<HarnessLaunchOptionsService>,
    pub(super) launch_probe_service: Arc<LaunchProbeService>,
    pub(super) gateway_model_planner: Arc<GatewayModelPlanner>,
    pub(super) agent_status_service: Arc<AgentStatusService>,
    /// The one handle every AUTOMATIC poke site takes — `None` under
    /// `cfg(test)`. See the `AppState` field for why it is separate; the
    /// suppression is a property of the wiring rather than of which event
    /// sites happened to be threaded.
    pub(super) automatic_poke_engine: Option<Arc<LaunchProbeService>>,
    pub(super) agent_runtime: Arc<AgentRuntime>,
}

pub(super) fn build_agent_stack(
    db: &Db,
    runtime_home: &PathBuf,
    agent_reconcile_service: &Arc<AgentReconcileService>,
    agent_seed_store: &AgentSeedStore,
    catalog_sync_service: &Arc<CatalogSyncService>,
) -> AgentStack {
    // OpenCode route materialization uses a memoized live `GET /v1/models`.
    // It has no catalog input and never writes executable launch options.
    let gateway_model_planner = Arc::new(GatewayModelPlanner::new(runtime_home.clone()));
    let launch_options_service = Arc::new(HarnessLaunchOptionsService::new(
        db.clone(),
        runtime_home.clone(),
    ));
    let probe_targets = Arc::new(RuntimeProbeTargets::new(runtime_home.clone()));
    // The per-harness status documents (agent_auth spec §2): the probe engine
    // pushes its evidence in (admission → stale, completion → verdict), and
    // the API doors serve the persisted documents verbatim.
    let agent_status_service = Arc::new(AgentStatusService::new(
        db.clone(),
        runtime_home.clone(),
        probe_targets.clone(),
    ));
    // Construct one probe engine per process so every poke shares one
    // single-flight gate. Its lock makes a second runtime read-only.
    let launch_probe_service = Arc::new(
        LaunchProbeService::new(
            runtime_home.clone(),
            gateway_model_planner.clone(),
            probe_targets,
        )
        .with_launch_options(launch_options_service.clone())
        .with_agent_status(agent_status_service.clone()),
    );
    // Failure-armed backoff-expiry timers poke back into the engine through
    // this weak handle — the probe event set's self-recovery.
    launch_probe_service.bind_self();
    #[cfg(not(test))]
    let automatic_poke_engine = Some(launch_probe_service.clone());
    #[cfg(test)]
    let automatic_poke_engine: Option<Arc<LaunchProbeService>> = None;
    let agent_runtime_without_probes = AgentRuntime::new(
        runtime_home.clone(),
        agent_reconcile_service.clone(),
        agent_seed_store.clone(),
        AgentCatalogService::new(catalog_sync_service.clone()),
        // Read once, here: the auto-install pass needs the surface for the
        // cursor-in-cloud carve-out, and reading it at the decision point
        // would put a process-global read inside the reconcile loop.
        RuntimeSurface::from_env(),
    );
    // The agent runtime carries the engine for its startup and
    // install-completed pokes. Attached rather than constructor-injected
    // because the engine needs the catalog service the runtime also takes;
    // building the runtime first and attaching second keeps both constructors
    // acyclic.
    let agent_runtime = Arc::new(match automatic_poke_engine.clone() {
        Some(engine) => agent_runtime_without_probes.with_launch_probe(engine),
        None => agent_runtime_without_probes,
    });
    AgentStack {
        launch_options_service,
        launch_probe_service,
        gateway_model_planner,
        agent_status_service,
        automatic_poke_engine,
        agent_runtime,
    }
}

/// The status module's startup pass (agent_auth spec §2): every persisted
/// document is re-served STALE until the startup probes re-verify it, every
/// installed harness gets a row, and a harness that appeared with no install
/// event raises `FirstDetected`. Blocking-pool work (sqlite + fs); the caller
/// suppresses it under `cfg(test)` with the other startup side effects.
#[cfg_attr(test, allow(dead_code))]
pub(super) fn spawn_status_startup_pass(
    agent_status_service: &Arc<AgentStatusService>,
    automatic_poke_engine: &Option<Arc<LaunchProbeService>>,
) {
    let status = agent_status_service.clone();
    let poke_engine = automatic_poke_engine.clone();
    tokio::task::spawn_blocking(move || status.startup_pass(&poke_engine));
}
