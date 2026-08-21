//! `IdleReapPolicy`: the founder-ruled default, the documented env contract,
//! and the spawned sweep loop that applies them.

use super::*;

#[test]
fn the_default_policy_matches_the_founder_ruling_and_zero_disables_it() {
    assert_eq!(DEFAULT_IDLE_REAP_THRESHOLD, Duration::from_secs(120));
    assert_eq!(
        IdleReapPolicy::with_threshold(DEFAULT_IDLE_REAP_THRESHOLD).threshold(),
        Some(Duration::from_secs(120))
    );
    assert_eq!(
        IdleReapPolicy::with_threshold(Duration::ZERO),
        IdleReapPolicy::disabled()
    );
    assert_eq!(IdleReapPolicy::disabled().threshold(), None);
    assert_eq!(IdleReapPolicy::disabled().sweep_interval(), None);
    assert_eq!(
        IdleReapPolicy::with_threshold(Duration::from_secs(120)).sweep_interval(),
        Some(Duration::from_secs(15)),
        "the cadence is capped so the observed idle duration converges on the threshold"
    );
    assert_eq!(
        IdleReapPolicy::with_threshold(Duration::from_secs(20)).sweep_interval(),
        Some(Duration::from_secs(5))
    );
}

/// The spawned loop, end to end: its own cadence, its own clock, a real reap.
#[tokio::test]
async fn the_spawned_reaper_retires_an_idle_session_on_its_own_cadence() {
    let store = seeded_store(&["session-1"]);
    let manager = LiveSessionManager::new(test_support::actor_capabilities_for_store(&store));
    register_live_session(&manager, "session-1", SessionExecutionPhase::Idle).await;

    manager.spawn_idle_reaper(IdleReapPolicy::with_threshold(Duration::from_millis(20)));

    for _ in 0..100 {
        if !is_live(&manager, "session-1").await {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("the spawned reaper never retired a continuously idle session");
}

/// The `0` disable value from `ANYHARNESS_IDLE_SESSION_REAP_SECONDS`: the
/// sweep task must not start at all, even for a session that is idle forever.
#[tokio::test]
async fn a_zero_threshold_disables_the_reaper_entirely() {
    let store = seeded_store(&["session-1"]);
    let manager = LiveSessionManager::new(test_support::actor_capabilities_for_store(&store));
    register_live_session(&manager, "session-1", SessionExecutionPhase::Idle).await;

    manager.spawn_idle_reaper(IdleReapPolicy::with_threshold(Duration::ZERO));
    tokio::time::sleep(Duration::from_millis(200)).await;

    assert!(
        is_live(&manager, "session-1").await,
        "a disabled reaper must never retire anything"
    );
}

/// The documented env contract, exercised where it is decided. `from_env` is a
/// one-line read on top of `parse`, so this covers absent, `0`, whole seconds,
/// surrounding whitespace, and unparseable.
#[test]
fn the_env_contract_defaults_absent_and_unparseable_values() {
    use std::ffi::OsStr;

    assert_eq!(
        IdleReapPolicy::parse(None).threshold(),
        Some(DEFAULT_IDLE_REAP_THRESHOLD),
        "an unset variable keeps the default"
    );
    assert_eq!(
        IdleReapPolicy::parse(Some(OsStr::new("0"))),
        IdleReapPolicy::disabled(),
        "0 disables the reaper"
    );
    assert_eq!(
        IdleReapPolicy::parse(Some(OsStr::new("45"))).threshold(),
        Some(Duration::from_secs(45))
    );
    assert_eq!(
        IdleReapPolicy::parse(Some(OsStr::new("  45  "))).threshold(),
        Some(Duration::from_secs(45)),
        "surrounding whitespace is trimmed rather than treated as garbage"
    );
    for garbage in ["", "abc", "-1", "12.5", "12s"] {
        assert_eq!(
            IdleReapPolicy::parse(Some(OsStr::new(garbage))).threshold(),
            Some(DEFAULT_IDLE_REAP_THRESHOLD),
            "{garbage:?} must keep the default rather than silently disabling reclaim"
        );
    }
}
