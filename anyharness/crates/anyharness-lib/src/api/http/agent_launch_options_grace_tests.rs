//! What a BOOTING runtime may claim about a probe that has not run yet.
//!
//! Split from `agent_launch_options_tests` because these three share a premise
//! the others invert: the startup pass has NOT dispatched, so every slot map is
//! empty and the engine has to decide whether that means "nothing has run yet"
//! or "nothing will". That decision is per-harness — a harness excluded from
//! unattended probes is owed no pass at all — and getting it wrong in either
//! direction strands a client on a poll that can never converge.

use serde_json::Value;

use super::agent_launch_options_test_fixtures::*;
use crate::domains::agents::launch_probe::ProbeEngineMode;
use crate::domains::agents::launch_probe::ProbePhase;

/// The orphan that matters most, on the harness no unattended poke may refresh: a
/// spinning client here can never be converged by anything but a human.
///
/// The row is left by `begin_probe` — the same durable write `run_attempt` makes
/// (`attempt.rs`), not a hand-edited field — because cursor's credential is not
/// gateway-backed and so cannot be materialized into a probe by this fixture at
/// all. That inability is the point: nothing in this runtime will ever move this
/// row, so the phase must not ask a client to wait for it.
#[tokio::test]
async fn an_orphaned_cursor_row_never_asks_a_client_to_keep_waiting() {
    // BOTH windows, because the startup grace only exists in the second one and
    // that is the window this test previously missed: it built a RUNNING runtime,
    // where the grace is already spent, so the excuse it is meant to deny was
    // never on. A booting runtime is the reachable case — an unclean shutdown
    // leaves the row `probing`, the runtime restarts and serves HTTP while its
    // startup pass is still queued behind seed hydration — and for cursor that
    // pass will dispatch nothing at all.
    for booting in [false, true] {
        let home = temp_runtime_home(if booting {
            "orphaned-cursor-row-booting"
        } else {
            "orphaned-cursor-row-running"
        });
        let state = if booting {
            booting_app_state(home.clone())
        } else {
            app_state(home.clone())
        };
        assert_eq!(state.launch_probe_service.mode(), ProbeEngineMode::Owner);
        assert!(
            !state
                .launch_probe_service
                .targets_allow_automatic_probe(CURSOR),
            "the premise: no unattended poke may ever touch cursor"
        );
        begin_a_probe(&state, CURSOR);
        assert_eq!(
            state
                .launch_probe_service
                .probe_phase(CURSOR, chrono::Utc::now(), None),
            Some(ProbePhase::Idle),
            "the owner admits before it writes the row, so an idle slot means orphan"
        );

        let payload = payload_for(state, CURSOR).await;
        assert_eq!(payload["state"], Value::from("detecting"));
        assert_eq!(
            payload["probePhase"],
            Value::from("idle"),
            "a harness only a human can refresh must never be served as queued \
             (booting={booting}): {payload}"
        );
        let _ = std::fs::remove_dir_all(&home);
    }
}

/// The same window from the other side, so the fix cannot be "never excuse an
/// empty slot map". A harness the startup pass WILL poke keeps its grace while
/// that pass is still owed — `a_boot_that_has_not_probed_yet_does_not_call_a_
/// stranded_row_settled` pins that for `opencode`, and this pins that the two
/// harnesses genuinely diverge inside ONE booting runtime rather than the grace
/// having been switched off wholesale.
#[tokio::test]
async fn a_booting_runtime_excuses_only_the_harness_it_will_actually_poke() {
    let home = temp_runtime_home("boot-grace-is-per-harness");
    let state = booting_app_state(home.clone());
    assert_eq!(state.launch_probe_service.mode(), ProbeEngineMode::Owner);
    begin_a_probe(&state, HARNESS);
    begin_a_probe(&state, CURSOR);

    let probed = payload_for(state.clone(), HARNESS).await;
    assert_eq!(
        probed["probePhase"],
        Value::from("queued"),
        "a startup poke is owed to {HARNESS}, so its empty slot is an excuse: {probed}",
        HARNESS = HARNESS
    );
    let excluded = payload_for(state, CURSOR).await;
    assert_eq!(
        excluded["probePhase"],
        Value::from("idle"),
        "no startup poke is owed to {CURSOR}, so its empty slot is the answer: {excluded}",
        CURSOR = CURSOR
    );
    let _ = std::fs::remove_dir_all(&home);
}

/// B-R25. An unclean shutdown leaves a row `probing`; the runtime reboots and
/// serves HTTP while seed hydration and the reconcile still run ahead of the
/// startup probe pass. The slot map is empty because nothing has run YET, and
/// believing it would hand the client a terminal answer seconds before the
/// startup probe lands the real one.
#[tokio::test]
async fn a_boot_that_has_not_probed_yet_does_not_call_a_stranded_row_settled() {
    let home = temp_runtime_home("boot-before-startup-pass");
    let state = booting_app_state(home.clone());
    observe_models(&state, HARNESS);
    state
        .launch_options_service
        .begin_probe(HARNESS, &hours_ago(2))
        .expect("strand a row at probing");

    let payload = payload_for(state.clone(), HARNESS).await;
    assert_eq!(
        payload["probePhase"],
        Value::from("queued"),
        "a probe pass is owed to this harness, so the client keeps waiting: {payload}"
    );
    assert_eq!(
        payload["state"],
        Value::from("refreshing"),
        "and the state must agree, since that is the field the client waits on"
    );

    // Once the pass has actually dispatched, the empty slot means what it says.
    state.launch_probe_service.mark_startup_pass_dispatched();
    let payload = payload_for(state, HARNESS).await;
    assert_eq!(payload["probePhase"], Value::from("idle"));
    assert_eq!(payload["state"], Value::from("observed"), "{payload}");
    let _ = std::fs::remove_dir_all(&home);
}
