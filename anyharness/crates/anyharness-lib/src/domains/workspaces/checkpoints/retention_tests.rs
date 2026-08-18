//! Retention + orphan-reap scenario tests, split from `tests.rs` to stay
//! under the repo line cap; the shared harness (`Harness`, `EnvGuard`, and
//! their fixture helpers) lives in `tests.rs`.

use super::flags::checkpoint_capture_enabled;
use super::tests::{bare_snapshot, head_sha, make_tree, timestamp_days_ago, EnvGuard, Harness};
use super::{refs, CheckpointOrigin};

/// 4. Flag-off = zero capture: retention leaves existing checkpoints untouched
///    while the flag is off, and the flag reads false.
#[tokio::test]
async fn retention_is_a_noop_while_the_flag_is_off() {
    let _env = EnvGuard::off();
    assert!(!checkpoint_capture_enabled());
    let harness = Harness::new("flag-off");
    harness.worktree_workspace("ws-1");
    // Way past the age cap and way past N — retention WOULD cull these if it ran.
    for index in 0..(super::retention::RETENTION_KEEP_N + 5) {
        harness.make_checkpoint(
            "ws-1",
            &format!("cp-{index}"),
            CheckpointOrigin::TurnStart,
            &timestamp_days_ago(100),
            false,
        );
    }
    let before = harness.checkpoint_ref_ids("ws-1");

    harness.service().sweep_retention().await;

    assert_eq!(
        harness.checkpoint_ref_ids("ws-1"),
        before,
        "flag-off retention must leave every checkpoint untouched"
    );
}

/// 5. Retention: cull to N, keep the newest N, honor the age cap, and honor the
///    three exemptions (in-flight claim, newest safety row beyond N, safety past
///    the age cap).
#[tokio::test]
async fn retention_culls_to_n_with_the_age_cap_and_exemptions() {
    let _env = EnvGuard::on();
    let harness = Harness::new("retention");
    harness.worktree_workspace("ws-1");
    let service = harness.service();
    let n = super::retention::RETENTION_KEEP_N;

    // N+3 fresh turn-start rows, newest first by created_at (index 0 = newest).
    for index in 0..(n + 3) {
        harness.make_checkpoint(
            "ws-1",
            &format!("fresh-{index:03}"),
            CheckpointOrigin::TurnStart,
            &timestamp_days_ago(index as i64),
            false,
        );
    }
    // One fresh row inside the newest N but older than the age cap.
    harness.make_checkpoint(
        "ws-1",
        "aged-in-n",
        CheckpointOrigin::TurnStart,
        &timestamp_days_ago(20),
        false,
    );
    // The newest safety row, ranked WAY beyond N by age, but exempt from N-cull.
    harness.make_checkpoint(
        "ws-1",
        "safety-old",
        CheckpointOrigin::Safety,
        &timestamp_days_ago(9),
        false,
    );
    // A safety row past the age cap: exempt from N, NOT from age → culled.
    harness.make_checkpoint(
        "ws-1",
        "safety-expired",
        CheckpointOrigin::Safety,
        &timestamp_days_ago(30),
        false,
    );
    // A row that would be culled by BOTH the age cap AND the N-cut, but a revert
    // claims it → survives. Dated past the 14-day cap so ONLY the in-flight claim
    // can explain its survival (remove the `is_claimed` check in `should_retain`
    // and this test fails).
    harness.make_checkpoint(
        "ws-1",
        "claimed",
        CheckpointOrigin::TurnStart,
        &timestamp_days_ago(40),
        false,
    );
    let _claim = service.inflight_reverts().claim("claimed");

    service.sweep_retention().await;

    let surviving = harness.checkpoint_ref_ids("ws-1");
    assert!(
        surviving.contains("claimed"),
        "an in-flight-claimed checkpoint survives even past both the N-cut and the age cap"
    );
    assert!(
        surviving.contains("safety-old"),
        "the newest safety row is exempt from the N-cull"
    );
    assert!(
        !surviving.contains("safety-expired"),
        "a safety row past the age cap is still culled"
    );
    assert!(
        !surviving.contains("aged-in-n"),
        "the age cap culls even inside the newest N"
    );
    // A culled row keeps its expired_at set; its refs are gone.
    let expired = service
        .store_for_tests()
        .find_checkpoint("safety-expired")
        .expect("query")
        .expect("row");
    assert!(
        expired.expired_at.is_some(),
        "culled rows are expired, not deleted"
    );
    // The very newest fresh row is intact.
    assert!(
        surviving.contains("fresh-000"),
        "the newest fresh row survives"
    );
}

/// 6. Deletion-order crash states: a row-expired-but-refs-present state and a
///    refs-present-but-row-absent state are both reaped, and an unexpired row
///    never loses its refs.
#[tokio::test]
async fn the_orphan_reap_converges_both_crash_states_and_spares_live_rows() {
    let _env = EnvGuard::on();
    let harness = Harness::new("deletion-order");
    harness.worktree_workspace("ws-1");
    let service = harness.service();

    // A live unexpired row (keeps the workspace a retention candidate and is the
    // spare-me control).
    harness.make_checkpoint(
        "ws-1",
        "live",
        CheckpointOrigin::TurnStart,
        &timestamp_days_ago(1),
        false,
    );
    // Crash state A: the row was expired but its refs never got deleted.
    harness.make_checkpoint(
        "ws-1",
        "expired-refs",
        CheckpointOrigin::TurnStart,
        &timestamp_days_ago(1),
        true,
    );
    // Crash state B: refs exist with no row at all (capture crashed before the
    // insert). Write refs directly, insert no row.
    {
        let tree = make_tree(&harness.repo_root, "orphan.txt", "orphan");
        let snap = bare_snapshot(head_sha(&harness.repo_root), tree.clone(), tree);
        refs::write_checkpoint_refs(&harness.repo_root, "ws-1", "rowless", &snap)
            .expect("write orphan refs");
    }
    assert!(harness.checkpoint_ref_ids("ws-1").contains("rowless"));

    service.sweep_retention().await;

    let surviving = harness.checkpoint_ref_ids("ws-1");
    assert!(
        surviving.contains("live"),
        "an unexpired row never has its refs deleted"
    );
    assert!(
        !surviving.contains("expired-refs"),
        "an expired row's leftover refs are reaped"
    );
    assert!(
        !surviving.contains("rowless"),
        "refs with no row (crash before insert) are reaped"
    );
}
