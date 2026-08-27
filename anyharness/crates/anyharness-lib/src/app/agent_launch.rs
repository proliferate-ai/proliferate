use std::path::PathBuf;
use std::sync::Arc;

use crate::domains::agents::launch_options::HarnessLaunchOptionsService;
use crate::domains::agents::launch_probe::targets::RuntimeProbeTargets;
use crate::domains::agents::launch_probe::LaunchProbeService;
use crate::domains::agents::route_auth::gateway_plan::GatewayModelPlanner;
use crate::domains::agents::status::AgentStatusService;
use crate::persistence::Db;

pub(super) fn build_services(
    db: &Db,
    runtime_home: &PathBuf,
) -> (
    Arc<HarnessLaunchOptionsService>,
    Arc<LaunchProbeService>,
    Arc<GatewayModelPlanner>,
    Arc<AgentStatusService>,
) {
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
    (
        launch_options_service,
        launch_probe_service,
        gateway_model_planner,
        agent_status_service,
    )
}
