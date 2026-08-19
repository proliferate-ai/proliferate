use std::path::PathBuf;
use std::sync::Arc;

use crate::domains::agents::catalog::gateway_plan::GatewayModelPlanner;
use crate::domains::agents::catalog::sync::CatalogSyncService;
use crate::domains::agents::launch_options::HarnessLaunchOptionsService;
use crate::domains::agents::launch_probe::targets::RuntimeProbeTargets;
use crate::domains::agents::launch_probe::LaunchProbeService;
use crate::persistence::Db;

pub(super) fn build_services(
    db: &Db,
    runtime_home: &PathBuf,
    catalog_sync_service: Arc<CatalogSyncService>,
) -> (Arc<HarnessLaunchOptionsService>, Arc<LaunchProbeService>) {
    // The render plan uses the catalog's gateway policy plus a memoized live
    // `GET /v1/models`, never the revision-keyed gateway probe rows.
    let gateway_model_planner = Arc::new(GatewayModelPlanner::new(
        catalog_sync_service,
        runtime_home.clone(),
    ));
    let launch_options_service = Arc::new(HarnessLaunchOptionsService::new(
        db.clone(),
        runtime_home.clone(),
    ));
    // Construct one probe engine per process so every poke shares one
    // single-flight gate. Its lock makes a second runtime read-only.
    let launch_probe_service = Arc::new(
        LaunchProbeService::new(
            runtime_home.clone(),
            gateway_model_planner,
            Arc::new(RuntimeProbeTargets::new(runtime_home.clone())),
        )
        .with_launch_options(launch_options_service.clone()),
    );
    (launch_options_service, launch_probe_service)
}
