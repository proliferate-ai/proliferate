//! Proof B5: the poke SITES, asserted at the seams the production paths call.
//!
//! The closed trigger set (model-catalog.md, "Freshness is event-driven") is:
//! the unconditional startup pass, the auth-apply ack, install completed,
//! login-terminal exit, and manual refresh. Each poke's job is "the right
//! target, at the right moment" — so each test drives the real seam with a fake
//! runner and reads the document the attempt wrote. Nothing here spawns a
//! harness or touches a network.
//!
//! The one thing these deliberately do NOT re-assert is coalescing or backoff:
//! those are properties of the engine, covered in `engine_tests`, and
//! re-asserting them per site would pin the same behavior five times.

use std::sync::Arc;
use std::time::Duration;

use super::document::read_document;
use super::test_support::{
    gateway_state, wait_until, CountingPlanProducer, FakeRunner, FixedTargets, TempRuntimeHome,
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
    let mut targets = FixedTargets::single("opencode");
    targets.harnesses.push("grok".to_string());
    targets.installed.push("grok".to_string());
    let service = Arc::new(ModelSnapshotService::with_parts(
        home.path().to_path_buf(),
        Arc::new(CountingPlanProducer::new(vec!["m-1"], vec!["seed-1"])),
        Arc::new(targets),
        runner.clone(),
        ProbeEngineConfig::default(),
    ));
    (home, service, runner)
}

/// Wait for the pokes' effect: `runner.count()` reaches `expected`.
///
/// Not a fixed yield count — the pokes are `tokio::spawn`s, so on a multi-thread
/// runtime yielding proves nothing about another worker's progress.
async fn expect_probes(runner: &FakeRunner, expected: usize) {
    wait_until(&format!("{expected} probes"), || runner.count() >= expected).await;
    assert_eq!(runner.count(), expected, "more probes fired than expected");
}

/// Prove a poke caused NO probe. There is no effect to wait for, so this waits out a
/// window long enough for one to have landed and then asserts the count is unchanged.
async fn expect_no_further_probes(runner: &FakeRunner, expected: usize) {
    tokio::time::sleep(Duration::from_millis(150)).await;
    assert_eq!(runner.count(), expected, "a gated poke must not have probed");
}

/// **Proof B5 (the closed set).** The trigger vocabulary is exactly the spec's
/// five events — no session-launch backstop, no auth-cleared sibling (a clear is
/// an apply), no timer or poll reason. A new variant added here without a spec
/// ruling fails this test by construction.
#[test]
fn the_poke_vocabulary_is_exactly_the_five_events() {
    let reasons = [
        PokeReason::Startup,
        PokeReason::InstallCompleted,
        PokeReason::AuthApplied,
        PokeReason::LoginTerminal,
        PokeReason::Manual,
    ];
    let spellings: Vec<&str> = reasons.iter().map(|reason| reason.as_str()).collect();
    assert_eq!(
        spellings,
        vec![
            "startup",
            "install_completed",
            "auth_applied",
            "login_terminal",
            "manual"
        ]
    );
    // Manual is the ONLY user-initiated reason (cursor's carve-out turns on it).
    for reason in reasons {
        assert_eq!(
            reason.is_user_initiated(),
            matches!(reason, PokeReason::Manual),
            "{reason:?}"
        );
    }
}

/// **The startup poke**: every eligible harness, one pass — and the pass is
/// UNCONDITIONAL. A second pass probes again: the startup pass is deliberately
/// bookkeeping-free, because it is the safety net for everything that happened
/// while the runtime was down or that had no event (an out-of-band `claude login`,
/// a gateway-side model change).
#[tokio::test]
async fn the_startup_poke_covers_every_eligible_harness_unconditionally() {
    let (home, service, runner) = two_harness_engine("poke-startup");

    service.clone().poke_all(PokeReason::Startup);
    expect_probes(&runner, 2).await;

    assert!(read_document(home.path(), "opencode").is_some());
    assert!(read_document(home.path(), "grok").is_some());

    // A second startup pass re-probes: no comparison decides whether to probe.
    service.clone().poke_all(PokeReason::Startup);
    expect_probes(&runner, 4).await;
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
    tokio::time::sleep(Duration::from_millis(150)).await;
    assert!(read_document(home.path(), "opencode").is_none());
    assert!(!home.path().join(".probe-engine.lock").exists());
}

/// **The install-completed poke**: fires for `Completed` and for nothing else.
///
/// A failed install leaves the old binary in place and a skipped one installed
/// nothing, so neither moved the install the observation is provenance-bound to.
/// Poking them would spend a real harness spawn to re-confirm an unchanged binary.
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

/// **The install-completed and install-endpoint pokes** name exactly one harness —
/// the one that just converged — and leave every other harness alone.
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
    expect_probes(&runner, 1).await;

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
    let mut targets = FixedTargets::single("opencode");
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
    expect_no_further_probes(&runner, 0).await;
    assert!(read_document(home.path(), "opencode").is_none());
}

/// **The auth-applied poke** names every harness the applied document mentions,
/// and every named harness re-probes — the event IS the invalidation; no
/// fingerprint decides which "really" changed.
#[tokio::test]
async fn an_auth_apply_reprobes_every_named_harness() {
    let (home, service, runner) = two_harness_engine("poke-auth-applied");
    let both = vec!["opencode".to_string(), "grok".to_string()];

    service
        .clone()
        .poke_harnesses(&both, PokeReason::AuthApplied);
    expect_probes(&runner, 2).await;
    assert!(read_document(home.path(), "opencode").is_some());
    assert!(read_document(home.path(), "grok").is_some());

    // A second apply naming both re-probes both: freshness is event-driven.
    home.write_state_json(&gateway_state(
        5,
        &[("opencode", "sk-opencode-rotated"), ("grok", "sk-grok")],
    ));
    service
        .clone()
        .poke_harnesses(&both, PokeReason::AuthApplied);
    expect_probes(&runner, 4).await;
}

/// **The login-terminal poke** is a named-harness poke like the install ones; it
/// probes exactly the harness whose login terminal closed.
#[tokio::test]
async fn a_login_terminal_poke_probes_only_the_named_harness() {
    let (home, service, runner) = two_harness_engine("poke-login-terminal");

    service
        .clone()
        .poke_harness("opencode", PokeReason::LoginTerminal);
    expect_probes(&runner, 1).await;
    assert!(read_document(home.path(), "opencode").is_some());
    assert!(
        read_document(home.path(), "grok").is_none(),
        "a login for opencode must not re-probe grok"
    );
}

/// **Cursor's manual-refresh-only law, enforced at every poke site.**
///
/// model-catalog.md, "Cursor is manual-refresh only": *"Its credential lives in the
/// macOS keychain, so an unattended spawn can surface an OS keychain prompt with no
/// user-visible cause… cursor's observation is written only when a user asks."*
///
/// The test iterates EVERY automatic `PokeReason` rather than sampling one, because
/// the bug this guards against was per-site: the exclusion list was consulted only by
/// the whole-machine enumeration, so the pokes that name a harness directly walked
/// past it and would have spawned `cursor-agent` unattended. A test covering only
/// `Startup` would have passed against that code.
#[tokio::test]
async fn cursor_is_never_probed_by_an_automatic_poke_but_a_manual_refresh_works() {
    let home = TempRuntimeHome::new("cursor-manual-only");
    // No enrolled sources: cursor's login is the user's keychain, and it has no
    // gateway route at all. Its probe materializes nothing, which is exactly why an
    // unattended spawn would reach the OS keychain.
    home.write_state_json(&serde_json::json!({
        "version": 2, "revision": 2, "harnesses": [],
    }));
    home.write_manifest("cursor", Some("1.0.0"), Some("sha-1"), "pinned_archive");

    let runner = Arc::new(FakeRunner::new());
    let mut targets = FixedTargets::single("cursor");
    targets.manual_refresh_only = vec!["cursor".to_string()];
    let service = Arc::new(ModelSnapshotService::with_parts(
        home.path().to_path_buf(),
        Arc::new(CountingPlanProducer::new(vec!["m-1"], vec!["seed"])),
        Arc::new(targets),
        runner.clone(),
        ProbeEngineConfig::default(),
    ));

    // Every automatic reason, through every poke entry point.
    for reason in [
        PokeReason::Startup,
        PokeReason::InstallCompleted,
        PokeReason::AuthApplied,
        PokeReason::LoginTerminal,
    ] {
        service.clone().poke_all(reason);
        service.clone().poke_harness("cursor", reason);
        service
            .clone()
            .poke_harnesses(&["cursor".to_string()], reason);
    }
    expect_no_further_probes(&runner, 0).await;
    assert!(
        read_document(home.path(), "cursor").is_none(),
        "no automatic poke may write a cursor observation"
    );

    // A user asking still gets a probe: the prompt then has an obvious cause.
    let document = service
        .refresh_now("cursor")
        .await
        .expect("a manual refresh must still probe cursor");
    assert!(!document.models.is_empty());
    assert_eq!(runner.count(), 1, "exactly the one the user asked for");
}

/// The production exclusion list really names cursor, and really names nothing else.
///
/// The engine test above uses a fake targets impl, so on its own it would pass even if
/// the production list were empty. This closes that loop against the real
/// `RuntimeProbeTargets`.
#[test]
fn the_production_exclusion_list_covers_cursor_only() {
    use crate::domains::agents::model_snapshot::targets::{ProbeTargets, RuntimeProbeTargets};

    let home = TempRuntimeHome::new("production-exclusions");
    let targets = RuntimeProbeTargets::new(home.path().to_path_buf());

    assert!(!targets.allows_automatic_probe("cursor"));
    for kind in ["claude", "codex", "opencode", "grok"] {
        assert!(
            targets.allows_automatic_probe(kind),
            "{kind} has no keychain-prompt hazard and must converge automatically"
        );
    }
}

/// **The optional-handle seam every call site runs through**, in both states.
///
/// The automatic sites hold an `Option<Arc<ModelSnapshotService>>` and call these
/// three functions; this drives the same code with a real engine and with `None`. It
/// exists because asserting a handler's status code (as `router_tests` does) proves only
/// that the poke did not break the response — it cannot distinguish "poked" from
/// "silently did nothing", which is exactly the failure mode a suppressed-by-accident
/// handle produces.
#[tokio::test]
async fn the_optional_poke_seam_pokes_when_wired_and_no_ops_when_suppressed() {
    let (home, service, runner) = two_harness_engine("poke-optional-seam");

    // Suppressed: every entry point is a no-op, and specifically not a panic.
    let suppressed: Option<Arc<ModelSnapshotService>> = None;
    ModelSnapshotService::poke_optional(&suppressed, "opencode", PokeReason::InstallCompleted);
    ModelSnapshotService::poke_all_optional(&suppressed, PokeReason::Startup);
    ModelSnapshotService::poke_harnesses_optional(
        &suppressed,
        &["opencode".to_string()],
        PokeReason::AuthApplied,
    );
    expect_no_further_probes(&runner, 0).await;
    assert!(read_document(home.path(), "opencode").is_none());

    // Wired: the install-endpoint and login-terminal shape (one named harness).
    let wired = Some(service.clone());
    ModelSnapshotService::poke_optional(&wired, "opencode", PokeReason::InstallCompleted);
    expect_probes(&runner, 1).await;
    assert!(read_document(home.path(), "opencode").is_some());
    assert!(
        read_document(home.path(), "grok").is_none(),
        "a named-harness poke must not fan out"
    );

    // Wired: the whole-machine shape (the startup pass and the auth clear).
    ModelSnapshotService::poke_all_optional(&wired, PokeReason::AuthApplied);
    wait_until("grok probed", || read_document(home.path(), "grok").is_some()).await;
}
