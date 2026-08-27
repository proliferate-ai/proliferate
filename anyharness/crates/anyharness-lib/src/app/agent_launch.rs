use std::path::Path;
use std::sync::Arc;

use crate::domains::agents::launch_options::HarnessLaunchOptionsService;
use crate::domains::agents::launch_probe::targets::RuntimeProbeTargets;
use crate::domains::agents::launch_probe::LaunchProbeService;
use crate::domains::agents::route_auth::gateway_plan::GatewayModelPlanner;
use crate::persistence::Db;

pub(super) fn build_services(db: &Db, runtime_home: &Path) -> (
    Arc<HarnessLaunchOptionsService>,
    Arc<LaunchProbeService>,
    Arc<GatewayModelPlanner>,
) {
    // OpenCode route materialization uses a memoized live `GET /v1/models`.
    // It has no catalog input and never writes executable launch options.
    let gateway_model_planner = Arc::new(GatewayModelPlanner::new(runtime_home.to_path_buf()));
    let launch_options_service = Arc::new(HarnessLaunchOptionsService::new(
        db.clone(),
        runtime_home.to_path_buf(),
    ));
    // Construct one probe engine per process so every poke shares one
    // single-flight gate. Its lock makes a second runtime read-only.
    let launch_probe_service = Arc::new(
        LaunchProbeService::new(
            runtime_home.to_path_buf(),
            gateway_model_planner.clone(),
            Arc::new(RuntimeProbeTargets::new(runtime_home.to_path_buf())),
        )
        .with_launch_options(launch_options_service.clone()),
    );
    (
        launch_options_service,
        launch_probe_service,
        gateway_model_planner,
    )
}
