//! The poke SITES, asserted at the seams the production paths call.
//!
//! Each poke's job is "the right target, at the right moment, gated" — so each test
//! drives the real seam with a fake runner and reads the document the attempt wrote.
//! Nothing here spawns a harness or touches a network.
//!
//! The one thing these deliberately do NOT re-assert is coalescing, backoff or the
//! staleness rules: those are properties of the engine, covered in `engine_tests`,
//! and re-asserting them per site would pin the same behavior five times.

use std::sync::Arc;
use std::time::Duration;

use super::document::read_document;
use super::test_support::{
    gateway_context, gateway_state, CountingPlanProducer, FakeRunner, FixedTargets, TempRuntimeHome,
};
use super::{ModelSnapshotService, PokeReason, ProbeEngineConfig};
use crate::domains::agents::installer::progress::InstallProgressPhase;
use crate::domains::agents::installer::reconcile::execution::probe_after_install_for_test;

/// A two-harness engine over a real home, both installed and gateway-enrolled.
fn two_harness_engine(
    prefix: &str,
) -> (TempRuntimeHome, Arc<ModelSnapshotService>, Arc<FakeRunner>) {
    let home = TempRuntimeHome::new(prefix);
    home.write_state_json(&gateway_state(
        4,
        &[("opencode", "sk-opencode"), ("grok", "sk-grok")],
    ));
    for kind in ["opencode", "grok"] {
        home.write_manifest(kind, Some("1.0.0"), Some("sha-1"), "pinned_archive");
    }
    let runner = Arc::new(FakeRunner::new());
    let mut targets = FixedTargets::single("opencode", vec![gateway_context()]);
    targets.harnesses.push("grok".to_string());
    targets.installed.push("grok".to_string());
    targets
        .contexts
        .insert("grok".to_string(), vec!["gateway".to_string()]);
    targets
        .catalog_contexts
        .insert("grok".to_string(), vec![gateway_context()]);
    let service = Arc::new(ModelSnapshotService::with_parts(
        home.path().to_path_buf(),
        Arc::new(CountingPlanProducer::new(vec!["m-1"], vec!["seed-1"])),
        Arc::new(targets),
        runner.clone(),
        ProbeEngineConfig {
            min_reprobe_interval: Duration::ZERO,
            ..ProbeEngineConfig::default()
        },
    ));
    (home, service, runner)
}

/// Pokes are fire-and-forget `tokio::spawn`s; give them room to land.
async fn drain() {
    for _ in 0..32 {
        tokio::task::yield_now().await;
    }
}

/// **The startup poke** (site a): every eligible harness, one pass, and a machine
/// that is already fresh does no work on the second pass.
///
/// The second half is the property that makes the poke safe to fire on every boot:
/// `poke_all` is a convergence primitive, so a warm desktop must pay nothing for it.
#[tokio::test]
async fn the_startup_poke_covers_every_eligible_harness_and_no_ops_when_fresh() {
    let (home, service, runner) = two_harness_engine("poke-startup");

    service.clone().poke_all(PokeReason::Startup);
    drain().await;

    assert_eq!(runner.count(), 2, "both installed harnesses were probed");
    assert!(read_document(home.path(), "opencode").is_some());
    assert!(read_document(home.path(), "grok").is_some());

    // A second startup pass on the same machine: every entry is fresh, so the gate
    // admits nothing. "Running it twice does nothing twice."
    service.clone().poke_all(PokeReason::Startup);
    drain().await;
    assert_eq!(
        runner.count(),
        2,
        "a fresh machine must do no work on the next startup pass"
    );
}

/// The startup poke is a no-op on a runtime with no engine attached, which is the
/// configuration every reconcile test uses. Asserted through `AgentRuntime`'s own
/// seam rather than the engine's, because the `Option` lives there.
#[tokio::test]
async fn an_agent_runtime_without_an_engine_pokes_nothing() {
    use crate::domains::agents::catalog::service::AgentCatalogService;
    use crate::domains::agents::catalog::sync::CatalogSyncService;
    use crate::domains::agents::installer::reconcile::execution::AgentReconcileService;
    use crate::domains::agents::installer::seed::AgentSeedStore;
    use crate::domains::agents::runtime::{AgentRuntime, RuntimeSurface};

    let home = TempRuntimeHome::new("poke-no-engine");
    let runtime = AgentRuntime::new(
        home.path().to_path_buf(),
        Arc::new(AgentReconcileService::new()),
        AgentSeedStore::not_configured_dev(),
        AgentCatalogService::new(Arc::new(CatalogSyncService::from_bundled())),
        RuntimeSurface::Local,
    );
    // The assertion is that this neither panics nor writes: no engine, no probe, no
    // document, and specifically no filesystem lock taken on the home.
    runtime.poke_model_snapshots(PokeReason::Startup);
    drain().await;
    assert!(read_document(home.path(), "opencode").is_none());
    assert!(!home.path().join(".probe-engine.lock").exists());
}

/// **The install-completed poke** (site b): fires for `Completed` and for nothing
/// else.
///
/// A failed install leaves the old binary in place and a skipped one installed
/// nothing, so neither moved the install identity an entry is bound to. Poking them
/// would spend a real harness spawn to re-confirm an unchanged identity.
#[test]
fn only_a_completed_install_warrants_a_re_probe() {
    assert!(probe_after_install_for_test(InstallProgressPhase::Completed));
    assert!(!probe_after_install_for_test(InstallProgressPhase::Failed));
    assert!(!probe_after_install_for_test(InstallProgressPhase::Skipped));
    // And no mid-flight phase leaks a poke per progress update.
    for phase in [
        InstallProgressPhase::Queued,
        InstallProgressPhase::Downloading,
        InstallProgressPhase::Verifying,
        InstallProgressPhase::Extracting,
        InstallProgressPhase::Installing,
        InstallProgressPhase::Finalizing,
    ] {
        assert!(
            !probe_after_install_for_test(phase),
            "a non-terminal phase must not poke: {phase:?}"
        );
    }
}

/// **The install-completed and install-endpoint pokes** (sites b and c) name exactly
/// one harness — the one that just converged — and leave every other harness alone.
///
/// Both sites call `poke_harness`, so one assertion covers the shape both rely on:
/// precision. A whole-machine pass after each install would spawn every harness on
/// the box for a change to one of them.
#[tokio::test]
async fn an_install_poke_probes_only_the_harness_that_finished() {
    let (home, service, runner) = two_harness_engine("poke-install");

    service
        .clone()
        .poke_harness("grok", PokeReason::InstallCompleted);
    drain().await;

    assert_eq!(runner.count(), 1);
    assert!(read_document(home.path(), "grok").is_some());
    assert!(
        read_document(home.path(), "opencode").is_none(),
        "installing grok must not re-probe opencode"
    );
}

/// A poke for a harness that is not installed writes NOTHING — not even a failed
/// attempt.
///
/// `probe_agent` bails without an install, so a recorded failure here would render
/// in the UI as "probe error" for a harness the user simply has not installed. The
/// install endpoint can reach this: its handler pokes after an install that returned
/// `NotInstallable`.
#[tokio::test]
async fn poking_an_uninstalled_harness_records_nothing() {
    let home = TempRuntimeHome::new("poke-uninstalled");
    home.write_state_json(&gateway_state(1, &[("opencode", "sk-a")]));
    let runner = Arc::new(FakeRunner::new());
    let mut targets = FixedTargets::single("opencode", vec![gateway_context()]);
    targets.installed.clear();
    let service = Arc::new(ModelSnapshotService::with_parts(
        home.path().to_path_buf(),
        Arc::new(CountingPlanProducer::new(vec!["m-1"], vec!["seed"])),
        Arc::new(targets),
        runner.clone(),
        ProbeEngineConfig::default(),
    ));

    service
        .clone()
        .poke_harness("opencode", PokeReason::InstallCompleted);
    drain().await;

    assert_eq!(runner.count(), 0);
    assert!(read_document(home.path(), "opencode").is_none());
}

/// **The auth-applied poke** (site d) names every harness the applied document
/// mentions, and the FINGERPRINT gate — not the poke — decides which re-probe.
///
/// The two halves together are the whole replacement argument for
/// `schedule_gateway_probes`. The poke is deliberately wide (a harness whose sources
/// were emptied is named too, where the gateway-only scheduler skipped it), and the
/// gate is exactly as narrow as the change: rotating opencode's key re-probes
/// opencode and leaves grok's fresh entry untouched. The predecessor keyed on
/// `state.json`'s global revision, so it could not distinguish these.
#[tokio::test]
async fn an_auth_apply_reprobes_only_the_harness_whose_credential_moved() {
    let (home, service, runner) = two_harness_engine("poke-auth-applied");
    let both = vec!["opencode".to_string(), "grok".to_string()];

    service
        .clone()
        .poke_harnesses(&both, PokeReason::AuthApplied);
    drain().await;
    assert_eq!(runner.count(), 2, "first apply observes both");

    // Rotate ONLY opencode's key, at a higher revision, and apply again naming both.
    home.write_state_json(&gateway_state(
        5,
        &[("opencode", "sk-opencode-rotated"), ("grok", "sk-grok")],
    ));
    service
        .clone()
        .poke_harnesses(&both, PokeReason::AuthApplied);
    drain().await;

    assert_eq!(
        runner.count(),
        3,
        "exactly one re-probe: grok's fingerprint did not move, though the revision did"
    );
}

/// **The auth-cleared poke** (the extra site): clearing the state file changes every
/// harness's credential material, so every harness re-probes.
///
/// Without it, a user who disconnects their account keeps a picker full of models
/// their machine can no longer reach — the entries stay pinned to credentials that
/// no longer exist.
#[tokio::test]
async fn clearing_auth_reprobes_every_harness() {
    let (home, service, runner) = two_harness_engine("poke-auth-cleared");

    service.clone().poke_all(PokeReason::Startup);
    drain().await;
    assert_eq!(runner.count(), 2);

    // What `clear_state_file` leaves behind: no state at all.
    let state_path = crate::domains::agents::route_auth::state::state_file_path(home.path());
    std::fs::remove_file(&state_path).expect("clear the state file");

    service.clone().poke_all(PokeReason::AuthCleared);
    drain().await;
    assert_eq!(
        runner.count(),
        4,
        "every harness's fingerprint moved when its credentials vanished"
    );
}

/// **The session-launch backstop** (site e): a launch on a machine with a fresh
/// entry spawns nothing, and a launch on a machine that missed a probe self-heals.
///
/// This is the property the trait-default deletion depended on. The predecessor
/// (`schedule_launch_probe_if_stale`) checked for a probe ROW at the current global
/// revision, so every launch after any harness's auth change re-probed; the poke's
/// gate is per (harness, context), so a warm machine pays one in-memory evaluation.
#[tokio::test]
async fn the_launch_backstop_self_heals_a_gap_and_is_free_when_fresh() {
    let (home, service, runner) = two_harness_engine("poke-launch");

    // A machine that never probed: the launch backstop fills the gap.
    service
        .clone()
        .poke_harness("opencode", PokeReason::SessionLaunch);
    drain().await;
    assert_eq!(runner.count(), 1);
    assert!(read_document(home.path(), "opencode").is_some());

    // Every subsequent launch of the same harness is free.
    for _ in 0..5 {
        service
            .clone()
            .poke_harness("opencode", PokeReason::SessionLaunch);
    }
    drain().await;
    assert_eq!(
        runner.count(),
        1,
        "launching against a fresh entry must never spawn a probe"
    );
}
