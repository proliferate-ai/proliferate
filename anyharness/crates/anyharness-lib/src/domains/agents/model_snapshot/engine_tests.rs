//! The engine: coalescing, per-harness serialization, the concurrency cap,
//! idempotence, the completed-attempt floor, backoff, the forced-refresh
//! fingerprint re-check, the not-installed filter, plan continuity, the
//! single-runtime lock, and cleanup on failure and timeout.
//!
//! Real filesystem (the document and `state.json` ARE state), fake runner and fake
//! plan producer (a real probe would spawn a harness and hit a network).

use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

use super::document::{read_document, AttemptOutcome};
use super::probe::ProbeError;
use super::test_support::{
    env_context, gateway_context, gateway_state, CountingPlanProducer, FakeBehavior, FakeRunner,
    FixedTargets, TempRuntimeHome,
};
use super::{ModelSnapshotService, PokeReason, ProbeEngineConfig, ProbeEngineMode, RefreshError};

fn test_config() -> ProbeEngineConfig {
    ProbeEngineConfig {
        per_probe_timeout: Duration::from_secs(30),
        model_switch_timeout: Duration::from_secs(1),
        min_reprobe_interval: Duration::from_secs(60),
        ttl_base: Duration::from_secs(24 * 3600),
        ttl_jitter_span: Duration::from_secs(6 * 3600),
        backoff_base: Duration::from_secs(60),
        backoff_max: Duration::from_secs(6 * 3600),
        max_concurrent_probes: 1,
        sweep_age_multiplier: 3,
    }
}

/// A one-harness engine over a real temp home with a gateway document and a
/// manifest, wired to a counting fake runner.
fn engine(
    home: &TempRuntimeHome,
    harness: &str,
    contexts: Vec<crate::domains::agents::catalog::schema::AgentCatalogAuthContext>,
    config: ProbeEngineConfig,
) -> (Arc<ModelSnapshotService>, Arc<FakeRunner>, Arc<CountingPlanProducer>) {
    let runner = Arc::new(FakeRunner::new());
    let plan = Arc::new(CountingPlanProducer::new(
        vec!["m-1", "m-2", "m-3"],
        vec!["seed-1"],
    ));
    let service = Arc::new(ModelSnapshotService::with_parts(
        home.path().to_path_buf(),
        plan.clone(),
        Arc::new(FixedTargets::single(harness, contexts)),
        runner.clone(),
        config,
    ));
    (service, runner, plan)
}

fn seeded_home(prefix: &str, harness: &str) -> TempRuntimeHome {
    let home = TempRuntimeHome::new(prefix);
    home.write_state_json(&gateway_state(3, &[(harness, "sk-vk")]));
    home.write_manifest(harness, Some("1.0.0"), Some("sha-1"), "pinned_archive");
    home
}

// ---------------------------------------------------------------------------
// T-20..T-23: coalescing, serialization, the cap, idempotence
// ---------------------------------------------------------------------------

/// T-20 — **the coalescing proof.** Eight concurrent pokes for one key against a
/// runner that blocks on a barrier produce exactly ONE invocation, and every caller
/// ends up observing the written entry.
///
/// Today's shipped code has no dedupe at all: an apply, a launch and a manual
/// refresh landing together each hit the gateway independently.
#[tokio::test]
async fn eight_concurrent_pokes_for_one_key_produce_one_probe() {
    let home = seeded_home("coalesce", "opencode");
    let (runner, release) = FakeRunner::gated();
    let plan = Arc::new(CountingPlanProducer::new(vec!["m-1"], vec!["seed"]));
    let service = Arc::new(ModelSnapshotService::with_parts(
        home.path().to_path_buf(),
        plan,
        Arc::new(FixedTargets::single("opencode", vec![gateway_context()])),
        runner.clone(),
        test_config(),
    ));

    let mut handles = Vec::new();
    for _ in 0..8 {
        let service = service.clone();
        handles.push(tokio::spawn(async move {
            service.probe_if_stale("opencode", "gateway", PokeReason::Startup).await;
        }));
    }
    // Let all eight reach the gate before the single winner is allowed to finish.
    tokio::task::yield_now().await;
    release.send(true).expect("release");
    for handle in handles {
        handle.await.expect("join");
    }

    assert_eq!(
        runner.count(),
        1,
        "eight simultaneous pokes must produce exactly one spawn"
    );
    let document = read_document(home.path(), "opencode").expect("document written");
    let entry = document.entries.get("gateway").expect("gateway entry");
    assert!(
        !entry.models.is_empty(),
        "every caller observes the winner's written entry"
    );
    assert_eq!(entry.last_attempt.outcome, AttemptOutcome::Ok);
}

/// T-21 — distinct keys do not coalesce, AND they are serialized for one harness:
/// two contexts produce two invocations that never overlap.
#[tokio::test]
async fn distinct_contexts_probe_separately_but_never_concurrently() {
    let home = TempRuntimeHome::new("serialize");
    home.write_state_json(&serde_json::json!({
        "version": 2,
        "revision": 4,
        "harnesses": [{
            "harness_kind": "opencode",
            "sources": [
                { "kind": "gateway", "base_url": "https://gw.example", "key": "sk-vk" },
                { "kind": "api_key", "env_var_name": "ANTHROPIC_API_KEY", "value": "sk-ant" },
            ],
        }],
    }));
    home.write_manifest("opencode", Some("1.0.0"), Some("sha-1"), "pinned_archive");

    let (service, runner, _plan) = engine(
        &home,
        "opencode",
        vec![
            gateway_context(),
            env_context("anthropic-api", "anthropic", &["ANTHROPIC_API_KEY"]),
        ],
        test_config(),
    );

    let gateway = {
        let service = service.clone();
        tokio::spawn(async move {
            service.probe_if_stale("opencode", "gateway", PokeReason::Startup).await;
        })
    };
    let anthropic = {
        let service = service.clone();
        tokio::spawn(async move {
            service
                .probe_if_stale("opencode", "anthropic-api", PokeReason::Startup)
                .await;
        })
    };
    gateway.await.expect("join");
    anthropic.await.expect("join");

    assert_eq!(runner.count(), 2, "two distinct keys must not coalesce");
    assert_eq!(
        runner.peak_concurrency(),
        1,
        "probes for one harness must run serially"
    );
    let document = read_document(home.path(), "opencode").expect("document");
    assert_eq!(document.entries.len(), 2, "both contexts get entries");
}

/// T-22 — the machine-wide cap holds ACROSS harnesses, not just within one. Every
/// probe is a real harness process, so this is a memory bound, not a nicety.
#[tokio::test]
async fn the_global_cap_bounds_concurrency_across_harnesses() {
    let home = TempRuntimeHome::new("global-cap");
    let harnesses = ["claude", "codex", "grok", "opencode"];
    home.write_state_json(&gateway_state(
        2,
        &harnesses.map(|kind| (kind, "sk-vk")),
    ));
    for kind in harnesses {
        home.write_manifest(kind, Some("1.0.0"), Some("sha-1"), "pinned_archive");
    }
    let runner = Arc::new(FakeRunner::new());
    let plan = Arc::new(CountingPlanProducer::new(vec!["m-1"], vec!["seed"]));
    let mut targets = FixedTargets::single("claude", vec![gateway_context()]);
    for kind in &harnesses[1..] {
        targets.harnesses.push(kind.to_string());
        targets.installed.push(kind.to_string());
        targets
            .contexts
            .insert(kind.to_string(), vec!["gateway".to_string()]);
        targets
            .catalog_contexts
            .insert(kind.to_string(), vec![gateway_context()]);
    }
    let service = Arc::new(ModelSnapshotService::with_parts(
        home.path().to_path_buf(),
        plan,
        Arc::new(targets),
        runner.clone(),
        test_config(),
    ));

    let mut handles = Vec::new();
    for kind in harnesses {
        for _ in 0..3 {
            let service = service.clone();
            let kind = kind.to_string();
            handles.push(tokio::spawn(async move {
                service.probe_if_stale(&kind, "gateway", PokeReason::Startup).await;
            }));
        }
    }
    for handle in handles {
        handle.await.expect("join");
    }

    assert_eq!(
        runner.peak_concurrency(),
        1,
        "the machine-wide semaphore must never be exceeded"
    );
    assert_eq!(
        runner.count(),
        4,
        "one probe per harness: the three pokes per harness coalesce"
    );
}

/// T-23 — idempotence: "running it twice does nothing twice". A second poke against
/// a fresh entry probes zero times.
///
/// Uses `min_reprobe_interval: 0` so the STALENESS GATE is what refuses, not the
/// floor — otherwise this test would pass even with a broken gate.
#[tokio::test]
async fn a_second_poke_against_a_fresh_entry_does_nothing() {
    let home = seeded_home("idempotent", "opencode");
    let (service, runner, _plan) = engine(
        &home,
        "opencode",
        vec![gateway_context()],
        ProbeEngineConfig {
            min_reprobe_interval: Duration::ZERO,
            ..test_config()
        },
    );

    service.probe_if_stale("opencode", "gateway", PokeReason::Startup).await;
    assert_eq!(runner.count(), 1);
    service.probe_if_stale("opencode", "gateway", PokeReason::SessionLaunch).await;
    assert_eq!(
        runner.count(),
        1,
        "the staleness gate alone must refuse the second poke"
    );
}

// ---------------------------------------------------------------------------
// T-37, T-24: the anti-storm floor and backoff
// ---------------------------------------------------------------------------

/// T-37 — **the structural anti-storm assertion.** With the identity rule
/// deliberately broken so the gate ALWAYS answers stale (the entry records one
/// manifest identity while the machine reports another, refreshed every round), 50
/// pokes still produce at most a handful of probes rather than 50.
///
/// This is independent of the identity fix being correct, which is the point: it
/// bounds the damage of any future mis-stated rule to one probe per minute per key.
#[tokio::test]
async fn a_permanently_stale_gate_still_cannot_storm() {
    let home = seeded_home("floor", "opencode");
    let (service, runner, _plan) = engine(
        &home,
        "opencode",
        vec![gateway_context()],
        test_config(),
    );

    for round in 0..50 {
        // Make the gate answer HarnessMoved every single time by moving the
        // manifest identity out from under whatever the last entry recorded.
        home.write_manifest(
            "opencode",
            Some(&format!("1.0.{round}")),
            Some(&format!("sha-{round}")),
            "pinned_archive",
        );
        service.probe_if_stale("opencode", "gateway", PokeReason::SessionLaunch).await;
    }

    let count = runner.count();
    assert!(
        count <= 2,
        "the 60s completed-attempt floor must bound a permanently-stale gate; got {count} probes"
    );
    assert!(count >= 1, "the first poke must genuinely probe");
}

/// T-24 — backoff: consecutive failures schedule 1m/2m/4m, a poke inside the window
/// does nothing, and a success resets the counter.
///
/// The window is asserted through the status surface's `nextAttemptAt` rather than
/// by sleeping, so the schedule is checked without a real clock.
#[tokio::test]
async fn failures_arm_exponential_backoff_and_a_success_resets_it() {
    let home = seeded_home("backoff", "opencode");
    let (service, runner, _plan) = engine(
        &home,
        "opencode",
        vec![gateway_context()],
        ProbeEngineConfig {
            min_reprobe_interval: Duration::ZERO,
            ..test_config()
        },
    );
    runner.set_behavior(FakeBehavior::Fail("provider down".to_string()));

    // First failure.
    service.probe_if_stale("opencode", "gateway", PokeReason::Startup).await;
    assert_eq!(runner.count(), 1);
    let now = chrono::Utc::now();
    let status = service.status("opencode", now);
    let context = &status.contexts[0];
    assert_eq!(context.state, super::status::LiveState::Backoff);
    let first_next = context.next_attempt_at.clone().expect("nextAttemptAt");
    let first_delay = chrono::DateTime::parse_from_rfc3339(&first_next)
        .expect("parse")
        .signed_duration_since(now)
        .num_seconds();
    assert!(
        (55..=65).contains(&first_delay),
        "the first backoff must be ~60s, got {first_delay}s"
    );

    // A poke inside the window does nothing.
    service.probe_if_stale("opencode", "gateway", PokeReason::SessionLaunch).await;
    assert_eq!(runner.count(), 1, "a poke inside the backoff window is a no-op");

    // A forced refresh bypasses the window (T-25a) and, still failing, doubles it.
    let error = service
        .refresh_now("opencode", "gateway")
        .await
        .expect_err("still failing");
    assert!(matches!(error, RefreshError::Probe(ProbeError::Failed { .. })));
    assert_eq!(runner.count(), 2, "a forced refresh must bypass backoff");
    let now = chrono::Utc::now();
    let second_delay = chrono::DateTime::parse_from_rfc3339(
        service.status("opencode", now).contexts[0]
            .next_attempt_at
            .as_ref()
            .expect("nextAttemptAt"),
    )
    .expect("parse")
    .signed_duration_since(now)
    .num_seconds();
    assert!(
        (115..=125).contains(&second_delay),
        "the second backoff must double to ~120s, got {second_delay}s"
    );

    // A success clears it.
    runner.set_behavior(FakeBehavior::Ok);
    service
        .refresh_now("opencode", "gateway")
        .await
        .expect("success");
    let cleared = service.status("opencode", chrono::Utc::now());
    assert_eq!(cleared.contexts[0].state, super::status::LiveState::Idle);
    assert_eq!(cleared.contexts[0].next_attempt_at, None);
}

// ---------------------------------------------------------------------------
// T-25: forced refresh
// ---------------------------------------------------------------------------

/// T-25(b)(c) — **the forced-refresh fingerprint re-check.**
///
/// (b) Two concurrent forced refreshes with the credential UNCHANGED produce one
/// spawn: the second adopts the winner's result, which genuinely covers its
/// request.
///
/// (c) Two forced refreshes straddling a key rotation produce TWO spawns. Without
/// the pre-queue fingerprint capture, the second caller — who pressed Refresh
/// BECAUSE their key changed — would be handed the pre-change observation labelled
/// "refreshed just now", and no surface could detect the lie.
#[tokio::test]
async fn a_forced_refresh_adopts_a_coalesced_winner_only_when_the_credential_matches() {
    // (b) unchanged credential: one spawn, both callers served.
    let home = seeded_home("refresh-adopt", "opencode");
    let (runner, release) = FakeRunner::gated();
    let plan = Arc::new(CountingPlanProducer::new(vec!["m-1"], vec!["seed"]));
    let service = Arc::new(ModelSnapshotService::with_parts(
        home.path().to_path_buf(),
        plan,
        Arc::new(FixedTargets::single("opencode", vec![gateway_context()])),
        runner.clone(),
        test_config(),
    ));

    let first = {
        let service = service.clone();
        tokio::spawn(async move { service.refresh_now("opencode", "gateway").await })
    };
    let second = {
        let service = service.clone();
        tokio::spawn(async move { service.refresh_now("opencode", "gateway").await })
    };
    tokio::task::yield_now().await;
    release.send(true).expect("release");
    let first = first.await.expect("join").expect("first ok");
    let second = second.await.expect("join").expect("second ok");
    assert_eq!(
        runner.count(),
        1,
        "an unchanged credential must coalesce onto one spawn"
    );
    assert_eq!(
        first.auth_fingerprint, second.auth_fingerprint,
        "both callers were served the same observation"
    );

    // (c) rotation between the two requests: two spawns, and the second carries the
    // NEW fingerprint.
    let home = seeded_home("refresh-rotate", "opencode");
    let runner = Arc::new(FakeRunner::new());
    let plan = Arc::new(CountingPlanProducer::new(vec!["m-1"], vec!["seed"]));
    let service = Arc::new(ModelSnapshotService::with_parts(
        home.path().to_path_buf(),
        plan,
        Arc::new(FixedTargets::single("opencode", vec![gateway_context()])),
        runner.clone(),
        test_config(),
    ));

    let before = service
        .refresh_now("opencode", "gateway")
        .await
        .expect("first refresh");
    home.write_state_json(&gateway_state(4, &[("opencode", "sk-ROTATED")]));
    let after = service
        .refresh_now("opencode", "gateway")
        .await
        .expect("second refresh");

    assert_eq!(runner.count(), 2, "a rotation must force a second spawn");
    assert_ne!(
        before.auth_fingerprint, after.auth_fingerprint,
        "the second entry must carry the ROTATED credential's fingerprint"
    );
}

/// A forced refresh on an unknown or not-installed target is a typed refusal, not
/// a spawn.
#[tokio::test]
async fn a_forced_refresh_refuses_unknown_contexts_and_uninstalled_harnesses() {
    let home = seeded_home("refresh-refusals", "opencode");
    let runner = Arc::new(FakeRunner::new());
    let plan = Arc::new(CountingPlanProducer::new(vec!["m-1"], vec!["seed"]));
    let mut targets = FixedTargets::single("opencode", vec![gateway_context()]);
    targets.harnesses.push("grok".to_string());
    targets
        .contexts
        .insert("grok".to_string(), vec!["gateway".to_string()]);
    let service = ModelSnapshotService::with_parts(
        home.path().to_path_buf(),
        plan,
        Arc::new(targets),
        runner.clone(),
        test_config(),
    );

    let unknown = service
        .refresh_now("opencode", "not-a-context")
        .await
        .expect_err("unknown context");
    assert!(matches!(unknown, RefreshError::UnknownContext { .. }));
    assert_eq!(unknown.code(), "MODEL_SNAPSHOT_UNKNOWN_CONTEXT");

    // `grok` is a target but not installed.
    let not_installed = service
        .refresh_now("grok", "gateway")
        .await
        .expect_err("not installed");
    assert!(matches!(not_installed, RefreshError::NotInstalled(_)));
    assert_eq!(runner.count(), 0, "neither refusal may spawn");
}

// ---------------------------------------------------------------------------
// T-26: the not-installed filter
// ---------------------------------------------------------------------------

/// T-26 — a not-installed harness is filtered BEFORE spawning, and no
/// `lastAttempt` is written: `probe_agent`'s install precondition is never reached,
/// and a missing install must not render as a probe error.
#[tokio::test]
async fn a_not_installed_harness_is_filtered_before_spawning() {
    let home = TempRuntimeHome::new("not-installed");
    home.write_state_json(&gateway_state(1, &[("grok", "sk-vk")]));
    let runner = Arc::new(FakeRunner::new());
    let plan = Arc::new(CountingPlanProducer::new(vec!["m-1"], vec!["seed"]));
    let mut targets = FixedTargets::single("grok", vec![gateway_context()]);
    targets.installed.clear();
    let service = Arc::new(ModelSnapshotService::with_parts(
        home.path().to_path_buf(),
        plan,
        Arc::new(targets),
        runner.clone(),
        test_config(),
    ));

    service.clone().poke_all(PokeReason::Startup);
    service.clone().poke_harness("grok", PokeReason::InstallCompleted);
    tokio::task::yield_now().await;

    assert_eq!(runner.count(), 0, "no spawn for an uninstalled harness");
    assert!(
        read_document(home.path(), "grok").is_none(),
        "no lastAttempt entry may be written for an uninstalled harness"
    );
}

// ---------------------------------------------------------------------------
// T-38: plan continuity
// ---------------------------------------------------------------------------

/// T-38 — plan continuity: the probe must be given the LIVE gateway model list, not
/// the four seed ids it would otherwise write into `opencode.json` itself and then
/// "observe" — a tautology that can never discover a gateway-side model add.
///
/// Also: a forced refresh invalidates the memo (the fetch happens again) while an
/// ordinary poke reuses it.
#[tokio::test]
async fn the_probe_receives_the_live_gateway_plan_and_a_forced_refresh_refetches() {
    let home = seeded_home("plan-continuity", "opencode");
    let runner = Arc::new(FakeRunner::new());
    let plan = Arc::new(CountingPlanProducer::new(
        vec!["live-1", "live-2", "live-3", "live-4", "live-5", "live-6", "live-7", "live-8", "live-9"],
        vec!["seed-1", "seed-2", "seed-3", "seed-4"],
    ));
    let service = Arc::new(ModelSnapshotService::with_parts(
        home.path().to_path_buf(),
        plan.clone(),
        Arc::new(FixedTargets::single("opencode", vec![gateway_context()])),
        runner.clone(),
        ProbeEngineConfig {
            min_reprobe_interval: Duration::ZERO,
            ..test_config()
        },
    ));

    service.probe_if_stale("opencode", "gateway", PokeReason::Startup).await;
    let observed = runner
        .observed_plan_models
        .lock()
        .expect("observed")
        .clone();
    assert_eq!(
        observed[0].len(),
        9,
        "the probe must be configured with the 9 LIVE ids, not the 4 seed ids"
    );
    assert_eq!(plan.fetches(), 1);

    // An ordinary poke inside the memo window reuses the fetch.
    service.probe_if_stale("opencode", "gateway", PokeReason::SessionLaunch).await;
    assert_eq!(
        plan.fetches(),
        1,
        "an ordinary poke must not re-ask the gateway"
    );

    // A forced refresh invalidates it.
    service
        .refresh_now("opencode", "gateway")
        .await
        .expect("refresh");
    assert_eq!(
        plan.fetches(),
        2,
        "a forced refresh must genuinely re-ask /v1/models"
    );
}

// ---------------------------------------------------------------------------
// T-10, T-11, T-34: cleanup and failure recording
// ---------------------------------------------------------------------------

/// T-10 — a failed probe records `lastAttempt.outcome == "failed"` and changes
/// NOTHING else: `probedAt`, the models and the modes of the pre-existing entry all
/// keep serving. A failed refresh must never destroy truth.
#[tokio::test]
async fn a_failed_probe_updates_only_the_last_attempt() {
    let home = seeded_home("failure", "opencode");
    let (service, runner, _plan) = engine(
        &home,
        "opencode",
        vec![gateway_context()],
        ProbeEngineConfig {
            min_reprobe_interval: Duration::ZERO,
            ..test_config()
        },
    );

    let good = service
        .refresh_now("opencode", "gateway")
        .await
        .expect("first probe");
    assert_eq!(good.models.len(), 2);

    runner.set_behavior(FakeBehavior::Fail("provider auth error".to_string()));
    let error = service
        .refresh_now("opencode", "gateway")
        .await
        .expect_err("second probe fails");
    assert_eq!(error.code(), "MODEL_SNAPSHOT_PROBE_FAILED");

    let entry = read_document(home.path(), "opencode")
        .expect("document")
        .entries
        .remove("gateway")
        .expect("entry");
    assert_eq!(entry.last_attempt.outcome, AttemptOutcome::Failed);
    assert_eq!(
        entry.last_attempt.detail.as_deref(),
        Some("provider auth error")
    );
    assert_eq!(
        entry.probed_at, good.probed_at,
        "probedAt must not regress on failure"
    );
    assert_eq!(entry.models, good.models, "the last good list keeps serving");
    assert_eq!(entry.modes, good.modes);
    assert_eq!(entry.auth_fingerprint, good.auth_fingerprint);
}

/// T-11 / T-34 — the timeout path: the attempt records `detail == "timeout"`, no
/// scratch survives, and the entry's prior truth is intact.
///
/// The runner honors `per_probe_timeout` itself here (the real runner does so on
/// its own thread with the child), so the timeout is deterministic without a real
/// 240-second wait.
#[tokio::test(start_paused = true)]
async fn a_timed_out_probe_records_a_timeout_and_leaves_no_scratch() {
    let home = seeded_home("timeout", "opencode");
    let (service, runner, _plan) = engine(
        &home,
        "opencode",
        vec![gateway_context()],
        ProbeEngineConfig {
            per_probe_timeout: Duration::from_secs(5),
            min_reprobe_interval: Duration::ZERO,
            ..test_config()
        },
    );

    service
        .refresh_now("opencode", "gateway")
        .await
        .expect("seed a good entry");
    runner.set_behavior(FakeBehavior::Sleep(Duration::from_secs(600)));

    let error = service
        .refresh_now("opencode", "gateway")
        .await
        .expect_err("must time out");
    assert!(matches!(error, RefreshError::Probe(ProbeError::Timeout)));

    let entry = read_document(home.path(), "opencode")
        .expect("document")
        .entries
        .remove("gateway")
        .expect("entry");
    assert_eq!(entry.last_attempt.outcome, AttemptOutcome::Failed);
    assert_eq!(entry.last_attempt.detail.as_deref(), Some("timeout"));
    assert_eq!(entry.models.len(), 2, "the good list survived the timeout");

    let probe_dir = home.path().join("agent-auth-probe");
    let leftovers: Vec<String> = std::fs::read_dir(&probe_dir)
        .map(|entries| {
            entries
                .flatten()
                .map(|entry| entry.file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default();
    assert!(
        leftovers.is_empty(),
        "no scratch may outlive a timed-out attempt, found {leftovers:?}"
    );
}

// ---------------------------------------------------------------------------
// T-32: the single-runtime lock
// ---------------------------------------------------------------------------

/// T-32 — **one probe engine per runtime home.** The second service over the same
/// home reports `readonly`, performs zero probes and zero sweeps, still serves the
/// document, and refuses a forced refresh with the typed code. Dropping the owner
/// lets a third acquire ownership.
///
/// Without this, a dev sidecar beside the desktop would have each runtime sweeping
/// the other's in-flight scratch — deleting a live probe's config dir mid-spawn.
#[tokio::test]
async fn only_one_runtime_owns_the_probe_engine_for_a_home() {
    let home = seeded_home("engine-lock", "opencode");
    let contexts = vec![gateway_context()];

    let owner = Arc::new(ModelSnapshotService::with_parts(
        home.path().to_path_buf(),
        Arc::new(CountingPlanProducer::new(vec!["m-1"], vec!["seed"])),
        Arc::new(FixedTargets::single("opencode", contexts.clone())),
        Arc::new(FakeRunner::new()),
        test_config(),
    ));
    assert_eq!(owner.mode(), ProbeEngineMode::Owner);

    let second_runner = Arc::new(FakeRunner::new());
    let second = Arc::new(ModelSnapshotService::with_parts(
        home.path().to_path_buf(),
        Arc::new(CountingPlanProducer::new(vec!["m-1"], vec!["seed"])),
        Arc::new(FixedTargets::single("opencode", contexts.clone())),
        second_runner.clone(),
        test_config(),
    ));
    assert_eq!(second.mode(), ProbeEngineMode::ReadOnly);

    // Every poke on the non-owner is a no-op.
    second.clone().poke_all(PokeReason::Startup);
    second.clone().poke_harness("opencode", PokeReason::AuthApplied);
    second.probe_if_stale("opencode", "gateway", PokeReason::Startup).await;
    tokio::task::yield_now().await;
    assert_eq!(second_runner.count(), 0, "a read-only engine must never probe");

    // Nor does it sweep: pre-create an obviously-sweepable root and prove it stays.
    let sweepable = home
        .path()
        .join("agent-auth-probe")
        .join("opencode-gateway-999999-1");
    std::fs::create_dir_all(&sweepable).expect("create sweepable root");
    second.sweep_orphan_scratch();
    assert!(
        sweepable.is_dir(),
        "a read-only engine must never sweep the owner's scratch space"
    );

    // A forced refresh is refused with the typed code rather than silently ignored.
    let refused = second
        .refresh_now("opencode", "gateway")
        .await
        .expect_err("must refuse");
    assert!(matches!(refused, RefreshError::NotOwner));
    assert_eq!(refused.code(), "PROBE_ENGINE_NOT_OWNER");

    // Reads still work, and the status surface says which mode it is in.
    let owner_probe = owner
        .refresh_now("opencode", "gateway")
        .await
        .expect("owner probes");
    assert!(
        second.entry("opencode", "gateway").is_some(),
        "a read-only engine still serves the document"
    );
    assert_eq!(
        second.entry("opencode", "gateway").map(|entry| entry.auth_fingerprint),
        Some(owner_probe.auth_fingerprint)
    );
    assert_eq!(
        second.status("opencode", chrono::Utc::now()).probe_engine,
        ProbeEngineMode::ReadOnly
    );

    // The owner DOES sweep.
    owner.sweep_orphan_scratch();

    // Dropping the owner releases the lock.
    drop(owner);
    let third = ModelSnapshotService::with_parts(
        home.path().to_path_buf(),
        Arc::new(CountingPlanProducer::new(vec!["m-1"], vec!["seed"])),
        Arc::new(FixedTargets::single("opencode", contexts)),
        Arc::new(FakeRunner::new()),
        test_config(),
    );
    assert_eq!(
        third.mode(),
        ProbeEngineMode::Owner,
        "the lock must be released when its holder drops"
    );
}

// ---------------------------------------------------------------------------
// T-29: poke fan-out
// ---------------------------------------------------------------------------

/// T-29 — the poke surface fans out to exactly the right keys: `poke_harnesses`
/// touches only the harnesses named, `poke_all` covers every eligible harness, and
/// nothing probes a context that is not active.
#[tokio::test]
async fn pokes_fan_out_to_exactly_the_named_targets() {
    let home = TempRuntimeHome::new("fanout");
    home.write_state_json(&gateway_state(
        2,
        &[("opencode", "sk-a"), ("grok", "sk-b")],
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
    // A catalog context that is NOT active must never be probed.
    targets
        .catalog_contexts
        .get_mut("opencode")
        .expect("opencode")
        .push(env_context("anthropic-api", "anthropic", &["ANTHROPIC_API_KEY"]));

    let service = Arc::new(ModelSnapshotService::with_parts(
        home.path().to_path_buf(),
        Arc::new(CountingPlanProducer::new(vec!["m-1"], vec!["seed"])),
        Arc::new(targets),
        runner.clone(),
        test_config(),
    ));

    service
        .clone()
        .poke_harnesses(&["grok".to_string()], PokeReason::AuthApplied);
    // Pokes are fire-and-forget spawns; drain them.
    for _ in 0..8 {
        tokio::task::yield_now().await;
    }
    assert_eq!(runner.count(), 1, "only the named harness was poked");
    assert!(read_document(home.path(), "grok").is_some());
    assert!(
        read_document(home.path(), "opencode").is_none(),
        "an unnamed harness must not be probed"
    );

    service.clone().poke_all(PokeReason::AuthCleared);
    for _ in 0..16 {
        tokio::task::yield_now().await;
    }
    let opencode = read_document(home.path(), "opencode").expect("opencode document");
    assert_eq!(
        opencode.entries.len(),
        1,
        "only the ACTIVE context gets an entry, not every catalog context"
    );
    assert!(opencode.entries.contains_key("gateway"));
    assert_eq!(
        runner.invocations.load(Ordering::SeqCst),
        2,
        "grok was already fresh; only opencode's one active context probed"
    );
}

// ---------------------------------------------------------------------------
// Adversarial: every degraded input must fail closed
// ---------------------------------------------------------------------------

/// Everything that can be broken about the engine's inputs must fail CLOSED: it
/// declines to probe or records an honest failure, and it never panics, never
/// spins, and never serves a fiction.
///
/// Four degradations, each a state a real user machine reaches.
#[tokio::test]
async fn a_corrupt_state_file_declines_to_probe_and_surfaces_a_typed_error() {
    let home = TempRuntimeHome::new("degraded-state");
    home.write_manifest("opencode", Some("1.0.0"), Some("sha-1"), "pinned_archive");
    let state_path = crate::domains::agents::route_auth::state::state_file_path(home.path());
    std::fs::create_dir_all(state_path.parent().expect("parent")).expect("mkdir");
    std::fs::write(&state_path, b"{not json").expect("corrupt state");

    let (service, runner, _plan) = engine(
        &home,
        "opencode",
        vec![gateway_context()],
        ProbeEngineConfig {
            min_reprobe_interval: Duration::ZERO,
            ..test_config()
        },
    );

    service.probe_if_stale("opencode", "gateway", PokeReason::Startup).await;
    assert_eq!(
        runner.count(),
        0,
        "a corrupt state.json must not produce a probe"
    );
    // A caller who explicitly asked DOES get told why.
    let error = service
        .refresh_now("opencode", "gateway")
        .await
        .expect_err("typed error");
    assert_eq!(error.code(), "MODEL_SNAPSHOT_MATERIAL_FAILED");
    // And the status surface answers rather than panicking.
    assert_eq!(
        service.status("opencode", chrono::Utc::now()).agent,
        "opencode"
    );
}

/// No `state.json` at all is NOT a degradation — it is a fresh desktop, and its
/// native logins are exactly what the snapshot exists to observe. Declining here
/// would leave every un-enrolled machine with no observation at all.
#[tokio::test]
async fn a_machine_with_no_enrolled_auth_still_observes_its_native_models() {
    let home = TempRuntimeHome::new("degraded-nostate");
    home.write_manifest("opencode", Some("1.0.0"), Some("sha-1"), "pinned_archive");
    let (service, runner, _plan) =
        engine(&home, "opencode", vec![gateway_context()], test_config());

    service.probe_if_stale("opencode", "gateway", PokeReason::Startup).await;
    assert_eq!(runner.count(), 1);
    assert!(read_document(home.path(), "opencode").is_some());
}

/// A corrupt snapshot document reads as absent, so the entry is `Missing` and the
/// next poke rewrites the document whole. It is derived state: deleting it loses
/// nothing a re-probe cannot restore, and refusing to serve over it would be
/// strictly worse.
#[tokio::test]
async fn a_corrupt_snapshot_document_is_rewritten_whole_by_the_next_poke() {
    let home = seeded_home("degraded-document", "opencode");
    let document_path = super::document::snapshot_path(home.path(), "opencode");
    std::fs::create_dir_all(document_path.parent().expect("parent")).expect("mkdir");
    std::fs::write(&document_path, b"{\"schemaVersion\":1,\"agent\":").expect("corrupt");

    let (service, runner, _plan) =
        engine(&home, "opencode", vec![gateway_context()], test_config());
    service.probe_if_stale("opencode", "gateway", PokeReason::Startup).await;

    assert_eq!(runner.count(), 1, "a corrupt document must read as absent");
    let healed = read_document(home.path(), "opencode").expect("rewritten whole");
    assert!(healed.entries.contains_key("gateway"));
}

/// A selection the machine cannot honor for a PURE env context: the gate declines
/// silently (an automatic poke must not manufacture failed attempts), an explicit
/// caller gets the typed error, and the status surface shows it stale rather than
/// silently fresh.
#[tokio::test]
async fn an_unsatisfiable_context_is_declined_silently_but_reads_stale() {
    let home = TempRuntimeHome::new("degraded-selection");
    home.write_state_json(&gateway_state(2, &[("opencode", "sk-vk")]));
    home.write_manifest("opencode", Some("1.0.0"), Some("sha-1"), "pinned_archive");

    let runner = Arc::new(FakeRunner::new());
    let targets = FixedTargets::single(
        "opencode",
        vec![env_context("gemini-api", "gemini", &["GEMINI_API_KEY"])],
    );
    let service = Arc::new(ModelSnapshotService::with_parts(
        home.path().to_path_buf(),
        Arc::new(CountingPlanProducer::new(vec!["m-1"], vec!["seed"])),
        Arc::new(targets),
        runner.clone(),
        test_config(),
    ));

    service
        .probe_if_stale("opencode", "gemini-api", PokeReason::Startup)
        .await;
    assert_eq!(
        runner.count(),
        0,
        "a selection the machine cannot honor must not spawn"
    );
    let error = service
        .refresh_now("opencode", "gemini-api")
        .await
        .expect_err("typed refusal");
    assert_eq!(error.code(), "MODEL_SNAPSHOT_MATERIAL_FAILED");

    let status = service.status("opencode", chrono::Utc::now());
    let context = status
        .contexts
        .iter()
        .find(|context| context.auth_context_id == "gemini-api")
        .expect("gemini-api context");
    assert!(context.stale, "an unresolvable context must read stale");
}
