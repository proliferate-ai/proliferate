//! Agents wiring: the launch-options/probe/status services, the automatic
//! poke suppression, and the agent runtime with its engine attached.
//! Composition only — no behavior.

use std::path::Path;
use std::sync::Arc;

use crate::domains::agents::catalog::service::AgentCatalogService;
use crate::domains::agents::catalog::sync::CatalogSyncService;
use crate::domains::agents::installer::reconcile::execution::AgentReconcileService;
use crate::domains::agents::installer::seed::AgentSeedStore;
use crate::domains::agents::launch_options::HarnessLaunchOptionsService;
use crate::domains::agents::launch_probe::targets::RuntimeProbeTargets;
use crate::domains::agents::launch_probe::LaunchProbeService;
use crate::domains::agents::route_auth::gateway_plan::GatewayModelPlanner;
use crate::domains::agents::runtime::{AgentRuntime, RuntimeSurface};
use crate::domains::agents::status::AgentStatusService;
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
    runtime_home: &Path,
    agent_reconcile_service: &Arc<AgentReconcileService>,
    agent_seed_store: &AgentSeedStore,
    catalog_sync_service: &Arc<CatalogSyncService>,
) -> AgentStack {
    // OpenCode route materialization uses a memoized live `GET /v1/models`.
    // It has no catalog input and never writes executable launch options.
    let gateway_model_planner = Arc::new(GatewayModelPlanner::new(runtime_home.to_path_buf()));
    let launch_options_service = Arc::new(HarnessLaunchOptionsService::new(
        db.clone(),
        runtime_home.to_path_buf(),
    ));
    let probe_targets = Arc::new(RuntimeProbeTargets::new(runtime_home.to_path_buf()));
    // The per-harness status documents (agent_auth spec §2): the probe engine
    // pushes its evidence in (admission → stale, completion → verdict), and
    // the API doors serve the persisted documents verbatim.
    let agent_status_service = Arc::new(AgentStatusService::new(
        db.clone(),
        runtime_home.to_path_buf(),
        probe_targets.clone(),
    ));
    // Construct one probe engine per process so every poke shares one
    // single-flight gate. Its lock makes a second runtime read-only.
    let launch_probe_service = Arc::new(
        LaunchProbeService::new(
            runtime_home.to_path_buf(),
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
        runtime_home.to_path_buf(),
        agent_reconcile_service.clone(),
        agent_seed_store.clone(),
        AgentCatalogService::new(catalog_sync_service.clone()),
        // Read once, here: the auto-install pass needs the surface for the
        // cursor-in-cloud carve-out, and reading it at the decision point
        // would put a process-global read inside the reconcile loop.
        RuntimeSurface::from_env(),
    )
    // The status service is attached UNCONDITIONALLY — unlike the poke engine
    // below, which is suppressed under cfg(test) because a poke spawns a real
    // harness process. Composing a status document is sqlite+fs work with no
    // process side effects, and a reconcile-driven install must compose the
    // harness's first row in every wiring (the HTTP install door already does).
    .with_agent_status(agent_status_service.clone());
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

/// The agents startup work, ONE sequenced task: the status module's startup
/// pass first (agent_auth spec §2 — every persisted document is re-served
/// STALE until re-verified, every installed harness gets a row, a harness
/// that appeared with no install event raises `FirstDetected`), THEN the
/// runtime's startup pass (seed hydration, the full reconcile, and the
/// launch-probe pokes it ends with).
///
/// The order is load-bearing. These used to be two independent spawns, so a
/// startup probe could VERIFY a harness before the stale-mark pass reached
/// its row — and the pass then re-dimmed a fresh document with no admitted
/// attempt behind the mark and no recovery timer armed: stale until an
/// unrelated event refreshed it. Running the stale-mark pass to completion
/// before anything that can complete a probe makes "stale until re-verified"
/// true in both directions. Fire-and-forget from the app's view; the caller
/// suppresses it under `cfg(test)` with the other startup side effects.
#[cfg_attr(test, allow(dead_code))]
pub(super) fn spawn_agent_startup_passes(
    agent_runtime: &Arc<AgentRuntime>,
    agent_status_service: &Arc<AgentStatusService>,
    automatic_poke_engine: &Option<Arc<LaunchProbeService>>,
) {
    let status = agent_status_service.clone();
    let poke_engine = automatic_poke_engine.clone();
    let runtime = agent_runtime.clone();
    tokio::spawn(async move {
        status_pass_then_startup_pokes(&status, &poke_engine, move || {
            runtime.spawn_startup_pass();
        })
        .await;
    });
}

/// The sequencing primitive, split out so the ORDER is what a test drives:
/// the status startup pass runs to completion on the blocking pool (sqlite +
/// fs work), and only then do the startup pokes fire. `startup_pokes` is
/// everything that can complete a probe at boot — in production,
/// [`AgentRuntime::spawn_startup_pass`].
async fn status_pass_then_startup_pokes(
    agent_status_service: &Arc<AgentStatusService>,
    automatic_poke_engine: &Option<Arc<LaunchProbeService>>,
    startup_pokes: impl FnOnce() + Send + 'static,
) {
    let status = agent_status_service.clone();
    let poke_engine = automatic_poke_engine.clone();
    // If the blocking pool refused the pass (shutdown), skip the pokes too
    // rather than fire them against un-marked rows.
    if tokio::task::spawn_blocking(move || status.startup_pass(&poke_engine))
        .await
        .is_ok()
    {
        startup_pokes();
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use chrono::{TimeZone, Utc};

    use crate::domains::agents::launch_probe::test_support::FixedTargets;
    use crate::domains::agents::route_auth::test_support::TempHome;
    use crate::domains::agents::status::{AgentStatusService, ProbeVerdict, RefreshCause};
    use crate::persistence::Db;

    /// The startup ordering (review m3): the stale-mark pass completes BEFORE
    /// the startup pokes run, so a startup probe's fresh verify lands AFTER
    /// the mark and the document ends verified and fresh. With the spawns
    /// unordered, a verify that beat the pass was re-dimmed by it — a fresh
    /// document served stale with no admitted attempt and no recovery timer.
    ///
    /// The closure stands in for the startup pokes' effect (the probe engine
    /// verifying the harness) at exactly the point in time the sequencing
    /// guarantees. Falsify by swapping the pass and the pokes in
    /// `status_pass_then_startup_pokes`: the document then ends stale.
    #[tokio::test]
    async fn the_startup_pass_lands_before_the_startup_pokes_so_a_fresh_verify_is_not_redimmed() {
        let home = TempHome::new("startup-pass-order");
        let status = Arc::new(AgentStatusService::with_parts(
            Db::open(home.path()).expect("open db"),
            home.path().to_path_buf(),
            Arc::new(FixedTargets::single("codex")),
            vec!["codex".to_string()],
            home.path().join("detection-home"),
        ));
        // A persisted row from a previous run — the thing the pass stale-marks.
        status.refresh("codex", RefreshCause::AuthApplied);
        let t_ok = Utc.with_ymd_and_hms(2026, 8, 27, 13, 0, 0).unwrap();

        let verify_status = status.clone();
        super::status_pass_then_startup_pokes(&status, &None, move || {
            verify_status.probe_verified("codex", t_ok);
        })
        .await;

        let doc = status.read("codex").expect("codex row");
        assert_eq!(doc.probe.verdict, ProbeVerdict::Verified);
        assert_eq!(doc.probe.at, Some(t_ok.to_rfc3339()));
        assert!(
            !doc.probe.stale,
            "the stale-mark pass ran first, so the startup verify is served \
             fresh; the inverted order re-dims a verified document"
        );
    }
}
