//! T-20..T-23: coalescing, per-harness serialization, the machine-wide cap, and
//! idempotence.

use super::*;

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
