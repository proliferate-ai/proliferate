//! T-38, T-10, T-11: plan continuity, and cleanup on failure and on timeout.

use super::*;

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

/// A persisted failure detail must be safe to store and to render.
///
/// The text is HARNESS-CONTROLLED — a spawned CLI's own error string — and several
/// providers quote the credential they were handed straight back ("invalid api key:
/// sk-…"). That string becomes `lastAttempt.detail`, which the status route serves as
/// `lastError` and a UI displays, so an unredacted one would put a live key on screen
/// AND in a file. It is also unbounded, so a harness that dumps a stack trace per
/// attempt would grow a document the engine re-reads and re-writes on every probe.
///
/// Redaction works by DIGEST — the token is hashed the same way phase A hashed the
/// credential value — so this path never holds a plaintext credential either, which is
/// the property the whole two-phase seam exists to preserve.
#[tokio::test]
async fn a_failure_detail_is_redacted_and_truncated_before_it_is_persisted() {
    let home = TempRuntimeHome::new("redaction");
    let secret = "sk-ant-super-secret-value";
    home.write_state_json(&serde_json::json!({
        "version": 2,
        "revision": 3,
        "harnesses": [{
            "harness_kind": "opencode",
            "sources": [
                { "kind": "gateway", "base_url": "https://gw.example", "key": secret },
            ],
        }],
    }));
    home.write_manifest("opencode", Some("1.0.0"), Some("sha-1"), "pinned_archive");

    let (service, runner, _plan) = engine(
        &home,
        "opencode",
        vec![gateway_context()],
        ProbeEngineConfig {
            min_reprobe_interval: Duration::ZERO,
            ..test_config()
        },
    );
    // Seed a good entry, because a failure with no entry writes nothing at all.
    service
        .refresh_now("opencode", "gateway")
        .await
        .expect("seed a good entry");

    // Exactly what a real provider does: echo the key back, at length.
    let padding = "detail ".repeat(200);
    runner.set_behavior(FakeBehavior::Fail(format!(
        "authentication failed for key={secret}, and \"{secret}\" was rejected. {padding}"
    )));
    let _ = service
        .refresh_now("opencode", "gateway")
        .await
        .expect_err("must fail");

    let entry = read_document(home.path(), "opencode")
        .expect("document")
        .entries
        .remove("gateway")
        .expect("entry");
    let detail = entry.last_attempt.detail.expect("detail");

    assert!(
        !detail.contains(secret),
        "the credential must not be persisted in the failure detail: {detail}"
    );
    assert!(
        detail.contains("[redacted]"),
        "the redaction must be visible rather than silent: {detail}"
    );
    // Both occurrences go, including the quoted one — the trim is why.
    assert_eq!(detail.matches("[redacted]").count(), 2);
    // The non-secret part of the message survives, so the detail is still useful.
    assert!(detail.contains("authentication failed"));
    assert!(
        detail.chars().count() <= 560,
        "the detail must be bounded, got {} chars",
        detail.chars().count()
    );
    assert!(detail.ends_with("… (truncated)"));

    // And the whole document is 0600: every entry carries an authFingerprint, which is
    // a stable per-credential identifier even though it is not a key.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let path = super::super::document::snapshot_path(home.path(), "opencode");
        let mode = std::fs::metadata(&path)
            .expect("metadata")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600, "model-snapshot.json must be 0600, got {mode:o}");
    }
}

/// Layer 3 of the cleanup story is live from the moment an engine exists, not only
/// from a later startup pass.
///
/// This matters more than "a stray directory": a native-codex probe materializes a
/// COPY OF THE USER'S OWN `~/.codex/auth.json` into its scratch, because relocating
/// `CODEX_HOME` relocates where codex looks for its login. A SIGKILL runs no guard, so
/// without a sweep at construction that plaintext credential copy would sit under the
/// runtime home indefinitely.
#[tokio::test]
async fn constructing_an_engine_reclaims_abandoned_scratch_roots() {
    let home = seeded_home("sweep-on-construction", "opencode");
    let probe_dir = home.path().join("agent-auth-probe");
    std::fs::create_dir_all(&probe_dir).expect("create probe dir");

    // A root abandoned by a long-dead pid, old enough to be past the age bound, with
    // a credential copy inside it — the shape a SIGKILLed native-codex probe leaves.
    let ancient_nanos = 1_u128;
    let abandoned = probe_dir.join(format!("codex-openai-oauth-{}-{ancient_nanos}", 999_999));
    std::fs::create_dir_all(abandoned.join("agent-auth/codex-native")).expect("create root");
    let credential = abandoned.join("agent-auth/codex-native/auth.json");
    std::fs::write(&credential, b"{\"tokens\":{\"access_token\":\"leaked\"}}")
        .expect("write credential copy");

    // A root belonging to THIS process must survive: our own guards own it, and a
    // live probe of ours may be mid-spawn.
    let ours = probe_dir.join(format!(
        "opencode-gateway-{}-{ancient_nanos}",
        std::process::id()
    ));
    std::fs::create_dir_all(&ours).expect("create our root");

    assert!(credential.exists(), "the fixture starts with the copy present");
    let (_service, _runner, _plan) =
        engine(&home, "opencode", vec![gateway_context()], test_config());

    assert!(
        !abandoned.exists(),
        "constructing the engine must reclaim an abandoned scratch root"
    );
    assert!(
        !credential.exists(),
        "and with it the plaintext credential copy inside"
    );
    assert!(
        ours.is_dir(),
        "our own process's root must never be swept from under us"
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
    // Pokes are fire-and-forget spawns, so wait for the effect rather than yielding a
    // fixed number of times (which proves nothing on a multi-thread runtime).
    wait_until("grok probed", || runner.count() >= 1).await;
    assert_eq!(runner.count(), 1, "only the named harness was poked");
    assert!(read_document(home.path(), "grok").is_some());
    assert!(
        read_document(home.path(), "opencode").is_none(),
        "an unnamed harness must not be probed"
    );

    service.clone().poke_all(PokeReason::AuthCleared);
    wait_until("opencode probed", || {
        read_document(home.path(), "opencode").is_some()
    })
    .await;
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

/// T-38's remaining leg: a plan that fell back to the SEED FLOOR marks its entry.
///
/// This is the honesty requirement behind the floor. When the gateway fetch fails,
/// `render_opencode_gateway` still needs a non-empty models map or the launch dies —
/// so the seed ids get written into `opencode.json`, and the probe then reports back
/// exactly those ids. Without the warning that tautology is indistinguishable from a
/// real discovery, and a reviewer looking at the document would conclude the gateway
/// serves four models. The picker still gets a launchable list either way; the warning
/// is what stops the observation being trusted as a discovery.
#[tokio::test]
async fn a_seed_floor_plan_marks_its_entry_as_not_a_discovery() {
    use crate::domains::agents::catalog::gateway_plan::SEED_FALLBACK_WARNING;
    use crate::domains::agents::route_auth::GatewayModelResolve;

    let home = seeded_home("seed-floor-warning", "opencode");
    let runner = Arc::new(FakeRunner::new());
    let plan = Arc::new(CountingPlanProducer::new(
        vec!["live-1", "live-2"],
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

    // A live plan carries no warning.
    let healthy = service
        .refresh_now("opencode", "gateway")
        .await
        .expect("probe with a live plan");
    assert!(
        !healthy.warnings.iter().any(|w| w == SEED_FALLBACK_WARNING),
        "a live plan must not be labelled a fallback, got {:?}",
        healthy.warnings
    );

    // Now the gateway is unreachable, so the plan degrades to the floor.
    *plan.fetch_fails.lock().expect("flag") = true;
    plan.invalidate_gateway_plan("opencode");
    let degraded = service
        .refresh_now("opencode", "gateway")
        .await
        .expect("probe with a floor plan");
    assert!(
        degraded.warnings.iter().any(|w| w == SEED_FALLBACK_WARNING),
        "a floor plan must say so, got {:?}",
        degraded.warnings
    );
    // And it is persisted, not merely returned — the document is what a UI reads.
    let entry = read_document(home.path(), "opencode")
        .expect("document")
        .entries
        .remove("gateway")
        .expect("entry");
    assert!(entry.warnings.iter().any(|w| w == SEED_FALLBACK_WARNING));
}
