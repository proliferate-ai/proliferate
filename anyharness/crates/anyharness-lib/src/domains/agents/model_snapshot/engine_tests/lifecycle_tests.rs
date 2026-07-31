//! Plan continuity, Proof B6 (failure never destroys truth), Proof B7's sweep
//! and lock legs, and cleanup on failure and on timeout.

use super::*;

// ---------------------------------------------------------------------------
// Plan continuity
// ---------------------------------------------------------------------------

/// Plan continuity: the probe must be given the LIVE gateway model list, not
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
        vec![
            "live-1", "live-2", "live-3", "live-4", "live-5", "live-6", "live-7", "live-8",
            "live-9",
        ],
        vec!["seed-1", "seed-2", "seed-3", "seed-4"],
    ));
    let service = Arc::new(ModelSnapshotService::with_parts(
        home.path().to_path_buf(),
        plan.clone(),
        Arc::new(FixedTargets::single("opencode")),
        runner.clone(),
        test_config(),
    ));

    service.probe_on_event("opencode", PokeReason::Startup).await;
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

    // A later automatic poke inside the memo window reuses the fetch.
    service
        .probe_on_event("opencode", PokeReason::InstallCompleted)
        .await;
    assert_eq!(
        plan.fetches(),
        1,
        "an ordinary poke must not re-ask the gateway"
    );

    // A forced refresh invalidates it.
    service.refresh_now("opencode").await.expect("refresh");
    assert_eq!(
        plan.fetches(),
        2,
        "a forced refresh must genuinely re-ask /v1/models"
    );
}

// ---------------------------------------------------------------------------
// Proof B6: failure recording and cleanup
// ---------------------------------------------------------------------------

/// **Proof B6.** A failed probe records `lastAttempt.outcome == "failed"` and
/// changes NOTHING else: `probedAt`, the models and the modes of the pre-existing
/// observation all keep serving. A failed refresh must never destroy truth.
#[tokio::test]
async fn a_failed_probe_updates_only_the_last_attempt() {
    let home = seeded_home("failure", "opencode");
    let (service, runner, _plan) = engine(&home, "opencode", test_config());

    let good = service.refresh_now("opencode").await.expect("first probe");
    assert_eq!(good.models.len(), 2);

    runner.set_behavior(FakeBehavior::Fail("provider auth error".to_string()));
    let error = service
        .refresh_now("opencode")
        .await
        .expect_err("second probe fails");
    assert_eq!(error.code(), "MODEL_SNAPSHOT_PROBE_FAILED");

    let document = read_document(home.path(), "opencode").expect("document");
    assert_eq!(document.last_attempt.outcome, AttemptOutcome::Failed);
    assert_eq!(
        document.last_attempt.detail.as_deref(),
        Some("provider auth error")
    );
    assert_eq!(
        document.probed_at, good.probed_at,
        "probedAt must not regress on failure"
    );
    assert_eq!(document.models, good.models, "the last good list keeps serving");
    assert_eq!(document.modes, good.modes);

    // And the last-good lists keep serving THROUGH the universe too — a failed
    // attempt never empties the picker.
    assert!(service
        .observed_universe("opencode")
        .observes_id(&good.models[0].id));
}

/// The timeout path: the attempt records `detail == "timeout"`, no scratch
/// survives, and the observation's prior truth is intact.
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
        ProbeEngineConfig {
            per_probe_timeout: Duration::from_secs(5),
            ..test_config()
        },
    );

    service
        .refresh_now("opencode")
        .await
        .expect("seed a good observation");
    runner.set_behavior(FakeBehavior::Sleep(Duration::from_secs(600)));

    let error = service
        .refresh_now("opencode")
        .await
        .expect_err("must time out");
    assert!(matches!(error, RefreshError::Probe(ProbeError::Timeout)));

    let document = read_document(home.path(), "opencode").expect("document");
    assert_eq!(document.last_attempt.outcome, AttemptOutcome::Failed);
    assert_eq!(document.last_attempt.detail.as_deref(), Some("timeout"));
    assert_eq!(document.models.len(), 2, "the good list survived the timeout");

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
/// credential value — so this path never holds a plaintext credential either.
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

    let (service, runner, _plan) = engine(&home, "opencode", test_config());
    // Seed a good observation, because a failure with no document writes nothing.
    service
        .refresh_now("opencode")
        .await
        .expect("seed a good observation");

    // Exactly what a real provider does: echo the key back, at length.
    let padding = "detail ".repeat(200);
    runner.set_behavior(FakeBehavior::Fail(format!(
        "authentication failed for key={secret}, and \"{secret}\" was rejected. {padding}"
    )));
    let _ = service.refresh_now("opencode").await.expect_err("must fail");

    let document = read_document(home.path(), "opencode").expect("document");
    let detail = document.last_attempt.detail.expect("detail");

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

    // And the whole document is 0600.
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

// ---------------------------------------------------------------------------
// Proof B7: the sweep and the lock
// ---------------------------------------------------------------------------

/// **Proof B7 (sweep).** The orphan sweep is live from the moment an engine
/// exists, not only from a later startup pass.
///
/// This matters more than "a stray directory": a native-codex probe materializes a
/// COPY OF THE USER'S OWN `~/.codex/auth.json` into its scratch, because relocating
/// `CODEX_HOME` relocates where codex looks for its login. A SIGKILL runs no guard, so
/// without a sweep at construction that plaintext credential copy would sit under the
/// runtime home indefinitely — zero credential bytes may remain after the sweep.
#[tokio::test]
async fn constructing_an_engine_reclaims_abandoned_scratch_roots() {
    let home = seeded_home("sweep-on-construction", "opencode");
    let probe_dir = home.path().join("agent-auth-probe");
    std::fs::create_dir_all(&probe_dir).expect("create probe dir");

    // A root abandoned by a long-dead pid, old enough to be past the age bound, with
    // a credential copy inside it — the shape a SIGKILLed native-codex probe leaves.
    let ancient_nanos = 1_u128;
    let abandoned = probe_dir.join(format!("codex-{}-{ancient_nanos}", 999_999));
    std::fs::create_dir_all(abandoned.join("agent-auth/codex-native")).expect("create root");
    let credential = abandoned.join("agent-auth/codex-native/auth.json");
    std::fs::write(&credential, b"{\"tokens\":{\"access_token\":\"leaked\"}}")
        .expect("write credential copy");

    // A root belonging to THIS process must survive: our own guards own it, and a
    // live probe of ours may be mid-spawn.
    let ours = probe_dir.join(format!("opencode-{}-{ancient_nanos}", std::process::id()));
    std::fs::create_dir_all(&ours).expect("create our root");

    assert!(credential.exists(), "the fixture starts with the copy present");
    let (_service, _runner, _plan) = engine(&home, "opencode", test_config());

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

/// **Proof B7 (lock).** One probe engine per runtime home. The second service over
/// the same home reports `readonly`, performs zero probes and zero sweeps, still
/// serves the document, and refuses a forced refresh with the typed code (the
/// transport maps it to 409). Dropping the owner lets a third acquire ownership.
///
/// Without this, a dev sidecar beside the desktop would have each runtime sweeping
/// the other's in-flight scratch — deleting a live probe's config dir mid-spawn.
#[tokio::test]
async fn only_one_runtime_owns_the_probe_engine_for_a_home() {
    let home = seeded_home("engine-lock", "opencode");

    let owner = Arc::new(ModelSnapshotService::with_parts(
        home.path().to_path_buf(),
        Arc::new(CountingPlanProducer::new(vec!["m-1"], vec!["seed"])),
        Arc::new(FixedTargets::single("opencode")),
        Arc::new(FakeRunner::new()),
        test_config(),
    ));
    assert_eq!(owner.mode(), ProbeEngineMode::Owner);

    let second_runner = Arc::new(FakeRunner::new());
    let second = Arc::new(ModelSnapshotService::with_parts(
        home.path().to_path_buf(),
        Arc::new(CountingPlanProducer::new(vec!["m-1"], vec!["seed"])),
        Arc::new(FixedTargets::single("opencode")),
        second_runner.clone(),
        test_config(),
    ));
    assert_eq!(second.mode(), ProbeEngineMode::ReadOnly);

    // Every poke on the non-owner is a no-op.
    second.clone().poke_all(PokeReason::Startup);
    second
        .clone()
        .poke_harness("opencode", PokeReason::AuthApplied);
    second.probe_on_event("opencode", PokeReason::Startup).await;
    tokio::task::yield_now().await;
    assert_eq!(second_runner.count(), 0, "a read-only engine must never probe");

    // Nor does it sweep: pre-create an obviously-sweepable root and prove it stays.
    let sweepable = home
        .path()
        .join("agent-auth-probe")
        .join("opencode-999999-1");
    std::fs::create_dir_all(&sweepable).expect("create sweepable root");
    second.sweep_orphan_scratch();
    assert!(
        sweepable.is_dir(),
        "a read-only engine must never sweep the owner's scratch space"
    );

    // A forced refresh is refused with the typed code rather than silently ignored.
    let refused = second
        .refresh_now("opencode")
        .await
        .expect_err("must refuse");
    assert!(matches!(refused, RefreshError::NotOwner));
    assert_eq!(refused.code(), "PROBE_ENGINE_NOT_OWNER");

    // Reads still work, and the status surface says which mode it is in.
    let owner_probe = owner.refresh_now("opencode").await.expect("owner probes");
    assert_eq!(
        second
            .document("opencode")
            .map(|document| document.probed_at),
        Some(owner_probe.probed_at),
        "a read-only engine still serves the document"
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
        Arc::new(FixedTargets::single("opencode")),
        Arc::new(FakeRunner::new()),
        test_config(),
    );
    assert_eq!(
        third.mode(),
        ProbeEngineMode::Owner,
        "the lock must be released when its holder drops"
    );
}

/// **Proof B7 (re-acquisition).** Losing the startup lock race is per-attempt,
/// not for life. While the owner lives, the loser's forced refresh is the typed
/// refusal and retrying never steals the lock; the moment the owner is gone
/// (`drop` here — a killed process gets the same flock release from the OS),
/// the loser's next trigger acquires the lock, runs the owner's orphan sweep,
/// and probes. No restart required.
///
/// The wedge this pins: a sidecar orphaned by a dead desktop app held the lock,
/// so the next app launch's runtime booted read-only and every manual refresh
/// answered 409 ("this runtime does not hold the probe-engine lock") for the
/// rest of its life — even after the orphan was killed and the lock was free.
#[tokio::test]
async fn a_read_only_engine_reacquires_the_lock_once_the_owner_exits() {
    let home = seeded_home("engine-lock-reacquire", "opencode");
    let (owner, _owner_runner, _owner_plan) = engine(&home, "opencode", test_config());
    assert_eq!(owner.mode(), ProbeEngineMode::Owner);

    let (second, second_runner, _second_plan) = engine(&home, "opencode", test_config());
    assert_eq!(second.mode(), ProbeEngineMode::ReadOnly);

    // The two-live-runtimes ruling is untouched: the retry loses while the
    // owner holds the lock, and the refusal keeps its typed code.
    let refused = second
        .refresh_now("opencode")
        .await
        .expect_err("the owner is alive, so the retry must lose");
    assert!(matches!(refused, RefreshError::NotOwner));
    assert_eq!(second.mode(), ProbeEngineMode::ReadOnly);

    // An abandoned root from a long-dead pid, so the sweep leg of late
    // acquisition is observable (same fixture shape as the construction sweep).
    let abandoned = home
        .path()
        .join("agent-auth-probe")
        .join(format!("codex-{}-1", 999_999));
    std::fs::create_dir_all(&abandoned).expect("create abandoned root");

    drop(owner);

    // The next forced refresh self-heals: acquires the lock, sweeps, probes.
    second
        .refresh_now("opencode")
        .await
        .expect("the refresh must succeed once the lock is free");
    assert_eq!(
        second.mode(),
        ProbeEngineMode::Owner,
        "ownership must follow the lock's availability"
    );
    assert!(
        second_runner.count() >= 1,
        "the once-read-only engine must actually probe"
    );
    assert!(
        !abandoned.exists(),
        "late acquisition must run the owner's orphan sweep"
    );
}

/// The automatic pokes self-heal too, not just the manual refresh. The 409 was
/// only the SYMPTOM a user could see; the common recovery paths are the
/// event-driven pokes (auth-apply, install-completed), and a regression that
/// re-froze only those would leave the refresh-path proof above green.
#[tokio::test]
async fn a_read_only_engine_reacquires_the_lock_on_an_automatic_poke() {
    let home = seeded_home("engine-lock-reacquire-poke", "opencode");
    let (owner, _owner_runner, _owner_plan) = engine(&home, "opencode", test_config());
    let (second, second_runner, _second_plan) = engine(&home, "opencode", test_config());
    assert_eq!(second.mode(), ProbeEngineMode::ReadOnly);

    // While the owner lives, an automatic poke on the loser stays a no-op.
    second
        .clone()
        .poke_harness("opencode", PokeReason::AuthApplied);
    tokio::task::yield_now().await;
    assert_eq!(second_runner.count(), 0);

    drop(owner);

    second
        .clone()
        .poke_harness("opencode", PokeReason::AuthApplied);
    wait_until("the self-healed poke's probe", || second_runner.count() >= 1).await;
    assert_eq!(second.mode(), ProbeEngineMode::Owner);
}

// ---------------------------------------------------------------------------
// Poke fan-out
// ---------------------------------------------------------------------------

/// The poke surface fans out to exactly the right harnesses: `poke_harnesses`
/// touches only the harnesses named, and `poke_all` covers every eligible harness.
#[tokio::test]
async fn pokes_fan_out_to_exactly_the_named_targets() {
    let home = TempRuntimeHome::new("fanout");
    home.write_state_json(&gateway_state(2, &[("opencode", "sk-a"), ("grok", "sk-b")]));
    for kind in ["opencode", "grok"] {
        home.write_manifest(kind, Some("1.0.0"), Some("sha-1"), "pinned_archive");
    }
    let runner = Arc::new(FakeRunner::new());
    let mut targets = FixedTargets::single("opencode");
    targets.harnesses.push("grok".to_string());
    targets.installed.push("grok".to_string());

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

    service.clone().poke_all(PokeReason::Startup);
    wait_until("both harnesses probed", || runner.count() >= 3).await;
    assert!(read_document(home.path(), "opencode").is_some());
}

/// The seed-floor leg: a plan that fell back to the SEED FLOOR marks its
/// observation.
///
/// This is the honesty requirement behind the floor. When the gateway fetch fails,
/// `render_opencode_gateway` still needs a non-empty models map or the launch dies —
/// so the seed ids get written into `opencode.json`, and the probe then reports back
/// exactly those ids. Without the warning that tautology is indistinguishable from a
/// real discovery. The picker still gets a launchable list either way; the warning
/// is what stops the observation being trusted as a discovery.
#[tokio::test]
async fn a_seed_floor_plan_marks_its_observation_as_not_a_discovery() {
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
        Arc::new(FixedTargets::single("opencode")),
        runner.clone(),
        test_config(),
    ));

    // A live plan carries no warning.
    let healthy = service
        .refresh_now("opencode")
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
        .refresh_now("opencode")
        .await
        .expect("probe with a floor plan");
    assert!(
        degraded.warnings.iter().any(|w| w == SEED_FALLBACK_WARNING),
        "a floor plan must say so, got {:?}",
        degraded.warnings
    );
    // And it is persisted, not merely returned — the document is what a UI reads.
    let document = read_document(home.path(), "opencode").expect("document");
    assert!(document.warnings.iter().any(|w| w == SEED_FALLBACK_WARNING));
}
