//! `probePhase` on the launch-options wire.
//!
//! `detecting` alone cannot tell an active probe apart from a provisional row
//! nothing will ever refresh — a manual-refresh-only harness sits `detecting`
//! forever by design. These pin the three answers the field exists to give:
//! `running` while an attempt is in flight, `idle` when settled-unobserved, and
//! ABSENT only when nothing is in flight durably and this runtime does not own
//! the probe engine, so the phase is genuinely unknowable here.

use serde_json::Value;

use super::agent_launch_options_test_fixtures::*;
use crate::domains::agents::launch_probe::ProbePhase;
use crate::domains::agents::launch_probe::lock::ProbeEngineLock;
use crate::domains::agents::launch_probe::targets::{ProbeTargets, RuntimeProbeTargets};
use crate::domains::agents::launch_probe::test_support::{
    gateway_state, wait_until, TempRuntimeHome,
};
use crate::domains::agents::launch_probe::{PokeReason, ProbeEngineMode};

/// A probe that has cleared both concurrency waits and is inside the harness
/// reports `running`, so a `detecting` response is legible as "wait, this is
/// converging" rather than "this is as good as it gets".
#[tokio::test]
async fn probe_phase_is_running_while_an_attempt_is_in_flight() {
    let home = TempRuntimeHome::new("probe-phase-running");
    let (_state, engine, release) = state_with_a_gated_engine(&home, HARNESS);
    assert_eq!(
        engine.probe_phase(HARNESS, chrono::Utc::now(), None),
        Some(ProbePhase::Idle),
        "no attempt has been admitted yet"
    );

    engine.clone().poke_harness(HARNESS, PokeReason::Startup);
    wait_until("the attempt reaches the harness", || {
        engine.probe_phase(HARNESS, chrono::Utc::now(), None) == Some(ProbePhase::Running)
    })
    .await;

    release.send(true).expect("release the fake probe");
    wait_until("the attempt settles", || {
        engine.probe_phase(HARNESS, chrono::Utc::now(), None) == Some(ProbePhase::Idle)
    })
    .await;
}

/// The settled-unobserved case the bug report describes: nothing is in flight,
/// so the phase is `idle` and a client can stop waiting for a probe that is not
/// coming.
#[tokio::test]
async fn launch_options_report_idle_when_settled_unobserved() {
    let home = temp_runtime_home("idle");
    let payload = launch_options_payload(app_state(home.clone())).await;

    assert_eq!(payload["state"], Value::from("detecting"));
    assert_eq!(
        payload["probePhase"],
        Value::from("idle"),
        "a runtime that owns the probe engine and has no attempt in flight is idle"
    );
    let _ = std::fs::remove_dir_all(&home);
}

/// A runtime that lost the probe-engine lock never admits an attempt, so every
/// slot it could read is one it never wrote. It omits the field rather than
/// reporting another process's scheduler as settled.
#[tokio::test]
async fn launch_options_omit_probe_phase_when_the_runtime_does_not_own_the_engine() {
    let home = temp_runtime_home("read-only");
    let _owner = ProbeEngineLock::try_acquire(&home).expect("take the engine lock first");

    let state = app_state(home.clone());
    assert_eq!(
        state.launch_probe_service.mode(),
        ProbeEngineMode::ReadOnly,
        "the lock above must have degraded this runtime to read-only"
    );

    let payload = launch_options_payload(state).await;
    assert_eq!(payload["state"], Value::from("detecting"));
    assert!(
        payload.get("probePhase").is_none(),
        "an unknown phase is omitted, never null and never a settled value: {payload}"
    );
    let _ = std::fs::remove_dir_all(&home);
}

/// Why the ROW outranks a missing slot, with an owner that is REALLY probing —
/// not a bare lock file standing in for one. An owner admits before `begin_probe`,
/// so for an owner the slot leads the row; a read-only runtime never admits
/// anything, so its slot map is empty for a harness the owner has in flight right
/// now. The row is the only source it has, and without it the response would be
/// `detecting` with no phase, which a client reads as terminal.
#[tokio::test]
async fn a_read_only_runtime_reports_the_probe_its_owner_is_really_running() {
    let home = TempRuntimeHome::new("read-only-sees-a-real-probe");
    let (owner, engine, release) = state_with_a_gated_engine(&home, HARNESS);
    let attempt = spawn_refresh(&engine, HARNESS);
    wait_until("the owner's attempt reaches the harness", || {
        engine.probe_phase(HARNESS, chrono::Utc::now(), None) == Some(ProbePhase::Running)
    })
    .await;

    let reader = read_only_view(&home, &owner);
    assert_eq!(
        reader
            .launch_probe_service
            .probe_phase(HARNESS, chrono::Utc::now(), None),
        None,
        "no slot to read, so the slot alone answers nothing at all"
    );

    let payload = payload_for(reader, HARNESS).await;
    assert_eq!(payload["state"], Value::from("detecting"));
    assert_eq!(
        payload["probePhase"],
        Value::from("queued"),
        "the row the owner wrote is what makes this response legible: {payload}"
    );
    let _ = release.send(true);
    let _ = attempt.await;
}

/// The bound that keeps the previous test from becoming a permanent 1.5s poll. The
/// engine lock is taken once at construction and never retried, and a sealed
/// container home has no owner at all, so "the owner will rewrite the row" is not
/// something a read-only runtime may assume. An attempt older than any queue could
/// explain is abandoned, and the response must say so in BOTH fields.
#[tokio::test]
async fn an_abandoned_row_stops_asking_a_read_only_runtime_to_wait() {
    let home = TempRuntimeHome::new("read-only-abandoned-row");
    let (owner, _engine, _release) = state_with_a_gated_engine(&home, HARNESS);
    observe_models(&owner, HARNESS);
    // The refresh a user pressed, whose future was then dropped, long ago.
    owner
        .launch_options_service
        .begin_probe(HARNESS, &hours_ago(2))
        .expect("strand a row at probing");

    let reader = read_only_view(&home, &owner);
    let payload = payload_for(reader, HARNESS).await;
    assert!(
        payload.get("probePhase").is_none(),
        "nothing is running and nothing here can tell otherwise: {payload}"
    );
    assert_eq!(
        payload["state"],
        Value::from("observed"),
        "the last observation is the honest answer, not a refresh nobody is doing: {payload}"
    );
    assert_eq!(payload["observedAt"], Value::from(OBSERVED_AT));
}

/// The sizing trap in the other direction. `begin_probe` runs BEFORE the
/// machine-wide semaphore, so a whole-machine pass over K harnesses legitimately
/// leaves the last row `probing` for as long as every probe ahead of it may take.
/// A bound of three probe timeouts — the tempting reuse of `sweep_age_multiplier` —
/// would call this row abandoned and report a genuinely queued probe as settled.
#[tokio::test]
async fn a_queued_probe_behind_a_whole_machine_pass_is_never_reported_idle() {
    let home = TempRuntimeHome::new("whole-machine-pass");
    let (owner, _engine, _release) = state_with_a_gated_engine(&home, HARNESS);
    let queued = ["claude", "codex", "cursor", "grok", HARNESS];
    assert!(queued.len() >= 4, "the trap only opens from K = 4 upward");

    let reader = read_only_view(&home, &owner);
    // 135s is three timeouts — the tempting-but-wrong bound. 230s is the REAL
    // worst case: four probes of the pass ahead of this one, each allowed its full
    // timeout, with the fifth running. A bound that only clears the first number
    // leaves the whole band between them untested and unprotected.
    for waited in [135, 230] {
        for harness in queued {
            owner
                .launch_options_service
                .begin_probe(harness, &seconds_ago(waited))
                .expect("admit a queued attempt");
        }
        for harness in queued {
            let payload = payload_for(reader.clone(), harness).await;
            assert_eq!(
                payload["probePhase"],
                Value::from("queued"),
                "{harness} waited {waited}s behind the pass, it is not abandoned: {payload}"
            );
            assert_eq!(payload["state"], Value::from("detecting"));
        }
    }
}

/// The bound itself, from both sides. Sizing it is a judgement call; where it
/// lands is not, and a test that only probes one side of an inequality cannot
/// tell a 270s bound from a 27000s one.
#[tokio::test]
async fn a_claim_is_believed_right_up_to_the_bound_and_not_one_second_past_it() {
    let home = TempRuntimeHome::new("bound-edges");
    let (owner, _engine, _release) = state_with_a_gated_engine(&home, HARNESS);
    let reader = read_only_view(&home, &owner);

    for (waited, expected) in [(269, Some("queued")), (271, None)] {
        owner
            .launch_options_service
            .begin_probe(HARNESS, &seconds_ago(waited))
            .expect("strand a row at probing");
        let payload = payload_for(reader.clone(), HARNESS).await;
        assert_eq!(
            payload.get("probePhase").and_then(Value::as_str),
            expected,
            "a {waited}s-old claim on a read-only runtime: {payload}"
        );
    }
}

/// A settled row whose BASIS has moved is not an in-flight probe, however it
/// projects. `read` synthesizes `detecting` for it without consulting
/// `probe_state` at all, so a phase re-derived from the projection would say
/// `queued` and a client would poll every 1.5s forever. The basis folds in the
/// GLOBAL auth revision, so logging into any other harness reaches this arm.
#[tokio::test]
async fn a_stale_basis_reports_settled_rather_than_queued() {
    let home = TempRuntimeHome::new("stale-basis");
    home.write_manifest(HARNESS, Some("1.0.0"), Some("sha-1"), "managed");
    home.write_state_json(&gateway_state(1, &[(HARNESS, "test-not-a-real-key")]));
    let state = app_state(home.path().to_path_buf());
    settle_a_row(&state, HARNESS);

    let settled = launch_options_payload(state.clone()).await;
    assert_eq!(settled["state"], Value::from("observed_empty"));
    assert_eq!(settled["probePhase"], Value::from("idle"));

    // Any other harness's login bumps the shared auth revision, which moves EVERY
    // harness's basis — this harness's row is now about a basis nobody asked about.
    home.write_state_json(&gateway_state(2, &[("claude", "test-not-a-real-key")]));

    let stale = launch_options_payload(state).await;
    assert_eq!(
        stale["state"],
        Value::from("detecting"),
        "the projection synthesizes detecting for a moved basis: {stale}"
    );
    assert_eq!(
        stale["probePhase"],
        Value::from("idle"),
        "nothing is in flight, so this must read as an answer, not as a wait: {stale}"
    );
}

/// The same path for the harness that can never dig itself out: every automatic
/// poke for Cursor is refused, so a `queued` it never earned is a poll with no
/// end — 1.5s apart, each one recomputing a SHA-256 over the manifest, the
/// resolved artifacts and the auth state file.
#[tokio::test]
async fn a_stale_basis_does_not_spin_the_harness_no_poke_can_converge() {
    let home = TempRuntimeHome::new("stale-basis-cursor");
    home.write_manifest(CURSOR, Some("1.0.0"), Some("sha-1"), "managed");
    home.write_state_json(&gateway_state(1, &[(CURSOR, "test-not-a-real-key")]));
    assert!(
        !RuntimeProbeTargets::new(home.path().to_path_buf()).allows_automatic_probe(CURSOR),
        "the premise: no unattended poke will ever refresh this harness"
    );

    let state = app_state(home.path().to_path_buf());
    settle_a_row(&state, CURSOR);
    home.write_state_json(&gateway_state(2, &[("claude", "test-not-a-real-key")]));

    let payload = payload_for(state, CURSOR).await;
    assert_eq!(payload["state"], Value::from("detecting"));
    assert_eq!(
        payload["probePhase"],
        Value::from("idle"),
        "a harness only a human can refresh must never be served as queued: {payload}"
    );
}

/// A probe stamps the basis it STARTED at, and any auth apply moves the basis
/// under it — `apply_state_file` writes `state.json` BEFORE it pokes, so the
/// interleaving is the designed one, not a rare race. A genuinely running attempt
/// must keep reporting a live phase across it: judging the basis first would serve
/// the running probe as settled, the client would stop polling, and the
/// observation it is waiting for would land unseen.
#[tokio::test]
async fn an_in_flight_probe_survives_a_basis_move_under_it() {
    let home = TempRuntimeHome::new("basis-move-mid-probe");
    let (state, engine, release) = state_with_a_gated_engine(&home, HARNESS);
    let attempt = spawn_refresh(&engine, HARNESS);
    wait_until("the attempt reaches the harness", || {
        engine.probe_phase(HARNESS, chrono::Utc::now(), None) == Some(ProbePhase::Running)
    })
    .await;

    let before = payload_for(state.clone(), HARNESS).await;
    assert_eq!(before["probePhase"], Value::from("running"));

    // The auth apply that lands mid-probe: the state file moves first, so every
    // harness's basis moves while this harness's attempt is still inside the probe.
    home.write_state_json(&gateway_state(2, &[("claude", "test-not-a-real-key")]));

    let after = payload_for(state, HARNESS).await;
    assert_eq!(after["state"], Value::from("detecting"));
    assert_eq!(
        after["probePhase"],
        Value::from("running"),
        "the probe did not stop running because the basis moved under it: {after}"
    );
    let _ = release.send(true);
    let _ = attempt.await;
}

/// An ORPHANED row: `begin_probe` is durable and the three awaits after it have no
/// compensating write, so dropping the attempt future — an ordinary client
/// disconnect from `refresh_now`, no crash required — strands the row at `probing`
/// forever. Nothing is in flight, so reporting the row would poll a client every
/// 1.5s against an attempt that no longer exists. The owner's slot is what tells
/// the two apart, and it can only do so because admission precedes `begin_probe`.
#[tokio::test]
async fn an_orphaned_probing_row_reports_the_owners_idle_slot() {
    let home = TempRuntimeHome::new("orphaned-probing-row");
    let (state, engine, release) = state_with_a_gated_engine(&home, HARNESS);
    let attempt = spawn_refresh(&engine, HARNESS);
    wait_until("the attempt reaches the harness", || {
        engine.probe_phase(HARNESS, chrono::Utc::now(), None) == Some(ProbePhase::Running)
    })
    .await;

    // The client goes away mid-refresh. The guard releases the slot; nothing
    // releases the row.
    attempt.abort();
    wait_until("the dropped future releases the slot", || {
        engine.probe_phase(HARNESS, chrono::Utc::now(), None) == Some(ProbePhase::Idle)
    })
    .await;
    assert!(
        state
            .launch_options_service
            .read_with_probe_state(HARNESS)
            .expect("read")
            .expect("a row exists")
            .probe_in_flight,
        "the premise: the row is stranded at probing, with no attempt behind it"
    );

    let payload = payload_for(state.clone(), HARNESS).await;
    assert_eq!(payload["state"], Value::from("detecting"));
    assert_eq!(
        payload["probePhase"],
        Value::from("idle"),
        "an orphan must read as an answer, or nothing ever stops the polling: {payload}"
    );

    // And at a moved basis, which is where this row will spend the rest of its life.
    home.write_state_json(&gateway_state(2, &[("claude", "test-not-a-real-key")]));
    let moved = payload_for(state, HARNESS).await;
    assert_eq!(moved["state"], Value::from("detecting"));
    assert_eq!(
        moved["probePhase"],
        Value::from("idle"),
        "the basis moving does not resurrect the attempt: {moved}"
    );
    let _ = release.send(true);
}

/// The basis moving under a REAL probe, seen from a runtime that cannot read a
/// slot at all. Its only source is the row, so a basis-gated read would omit the
/// field entirely — which the client also treats as terminal.
#[tokio::test]
async fn a_read_only_runtime_keeps_reporting_a_probe_across_a_basis_move() {
    let home = TempRuntimeHome::new("basis-move-read-only");
    let (owner, engine, release) = state_with_a_gated_engine(&home, HARNESS);
    let attempt = spawn_refresh(&engine, HARNESS);
    wait_until("the owner's attempt reaches the harness", || {
        engine.probe_phase(HARNESS, chrono::Utc::now(), None) == Some(ProbePhase::Running)
    })
    .await;

    let reader = read_only_view(&home, &owner);
    home.write_state_json(&gateway_state(2, &[("claude", "test-not-a-real-key")]));

    let payload = payload_for(reader, HARNESS).await;
    assert_eq!(payload["state"], Value::from("detecting"));
    assert_eq!(
        payload["probePhase"],
        Value::from("queued"),
        "absent reads as terminal to a client, so it must not be absent here: {payload}"
    );
    let _ = release.send(true);
    let _ = attempt.await;
}

/// THE `refreshing` ORPHAN. `begin_probe` does not clear `options_json`, so a
/// harness with 180 observed models that a user pressed Refresh on keeps every one
/// of them in the row — and the projection calls that `refreshing`. Drop the
/// refresh future (a page reload while the request is in flight) and the row is
/// stranded: the owner served `refreshing` + `idle` forever, and a client waits on
/// `refreshing` WITHOUT consulting the phase, so it polled forever. Withdrawing the
/// claim from the phase alone does not fix that; the state has to withdraw it too.
#[tokio::test]
async fn an_observed_harness_orphan_serves_its_last_observation() {
    let home = TempRuntimeHome::new("observed-harness-orphan");
    let (state, engine, release) = state_with_a_gated_engine(&home, HARNESS);
    observe_models(&state, HARNESS);

    let attempt = spawn_refresh(&engine, HARNESS);
    wait_until("the refresh reaches the harness", || {
        engine.probe_phase(HARNESS, chrono::Utc::now(), None) == Some(ProbePhase::Running)
    })
    .await;
    attempt.abort();
    wait_until("the dropped future releases the slot", || {
        engine.probe_phase(HARNESS, chrono::Utc::now(), None) == Some(ProbePhase::Idle)
    })
    .await;

    let payload = payload_for(state, HARNESS).await;
    assert_eq!(
        payload["probePhase"],
        Value::from("idle"),
        "nothing is running: {payload}"
    );
    assert_eq!(
        payload["state"],
        Value::from("observed"),
        "a refresh nobody is doing must not be reported as one, or the client polls \
         forever and slice E spins a disabled Refresh button: {payload}"
    );
    assert_eq!(payload["observedAt"], Value::from(OBSERVED_AT));
    assert_eq!(
        payload["options"]["models"][0]["id"],
        Value::from("m-1"),
        "the models really were seen, and they are still the truth: {payload}"
    );
    let _ = release.send(true);
}

/// B-R24. The two reads a launch-options response is built from cannot be made
/// atomic, so the ORDER decides which stale pair is reachable. Reading the row
/// first admits the fatal one — a `probing` row beside an already-`idle` slot,
/// which is indistinguishable from an orphan — and retires the observation the
/// client is waiting for. This drives both orders over one real commit.
#[tokio::test]
async fn an_attempt_committing_between_the_two_reads_is_not_mistaken_for_an_orphan() {
    let home = TempRuntimeHome::new("commit-between-reads");
    let (state, engine, release) = state_with_a_gated_engine(&home, HARNESS);
    observe_models(&state, HARNESS);
    let attempt = spawn_refresh(&engine, HARNESS);
    wait_until("the attempt reaches the harness", || {
        engine.live_probe_phase(HARNESS, chrono::Utc::now()).phase() == Some(ProbePhase::Running)
    })
    .await;
    let now = chrono::Utc::now();

    // THE SAFE ORDER, which is the one the handler uses: slot first...
    let live_first = engine.live_probe_phase(HARNESS, now);
    // ...the attempt commits here, between the two reads...
    release.send(true).expect("release the fake probe");
    attempt.await.expect("the attempt finishes");
    // ...and the row is read second, already carrying the new observation.
    let after = state
        .launch_options_service
        .read_with_probe_state(HARNESS)
        .expect("read the row")
        .expect("a row exists");
    assert!(
        !after.probe_in_flight,
        "the commit settled the row, so nothing is claimed"
    );
    assert_eq!(
        engine.refine_row_claim(live_first, after.read_at, None, now),
        Some(ProbePhase::Running),
        "a slot livelier than the row costs one extra poll and nothing else"
    );

    // And for the record, the slot read AFTER that commit says `idle` — beside a
    // row that (read first) would still have said `probing`, that is the orphan
    // pair exactly, over an attempt that succeeded.
    assert_eq!(
        engine.live_probe_phase(HARNESS, chrono::Utc::now()).phase(),
        Some(ProbePhase::Idle)
    );

    // And the wire, built the safe way, carries the observation the probe just made.
    let payload = payload_for(state, HARNESS).await;
    assert_eq!(payload["state"], Value::from("observed"));
    assert_ne!(
        payload["observedAt"],
        Value::from(OBSERVED_AT),
        "the fresh observation must not be replaced by the pre-attempt snapshot: {payload}"
    );
}

/// B-R26. `ProbeEngineMode` was on no wire at all, so a surface had to guess from
/// "is this runtime local?" — and guessed wrong for a sidecar, rendering a Refresh
/// control whose only possible outcome is a 409.
#[tokio::test]
async fn a_runtime_that_cannot_refresh_says_so_on_the_wire() {
    let home = TempRuntimeHome::new("refresh-ownership");
    let (owner, _engine, _release) = state_with_a_gated_engine(&home, HARNESS);
    observe_models(&owner, HARNESS);

    let reader = read_only_view(&home, &owner);
    let payload = payload_for(reader, HARNESS).await;
    assert_eq!(
        payload["canManuallyRefresh"],
        Value::from(false),
        "this runtime does not own the engine, so the refresh route can only 409: {payload}"
    );

    let payload = payload_for(owner, HARNESS).await;
    assert_eq!(
        payload["canManuallyRefresh"],
        Value::from(true),
        "the owner can dispatch a refresh: {payload}"
    );
}

/// The ordering rule is a precondition, not a convention: deriving a phase from a
/// slot read AFTER the row is refused outright, so the unsafe order cannot be
/// reintroduced by a later refactor that merely looks tidier.
#[tokio::test]
#[should_panic(expected = "the probe slot must be read BEFORE the launch-options row")]
async fn deriving_a_phase_from_a_slot_read_after_the_row_is_refused() {
    let home = TempRuntimeHome::new("row-first-refused");
    let (_state, engine, _release) = state_with_a_gated_engine(&home, HARNESS);
    let row_read_at = chrono::Utc::now();
    let live = engine.live_probe_phase(HARNESS, row_read_at + chrono::Duration::milliseconds(1));
    let _ = engine.refine_row_claim(live, row_read_at, Some(row_read_at), row_read_at);
}
