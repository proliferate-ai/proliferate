//! Retention + orphan-reap scenario tests, split from `tests.rs` to stay
//! under the repo line cap; the shared `Harness` and its fixture helpers live
//! in `tests.rs`, and the shared `EnvGuard` lives in `test_support.rs`.

use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

use super::flags::checkpoint_capture_enabled;
use super::test_support::EnvGuard;
use super::tests::{bare_snapshot, head_sha, make_tree, timestamp_days_ago, Harness};
use super::{refs, CheckpointOrigin};
use crate::domains::workspaces::archive::refs as archive_refs;

/// 4. Flag-off freezes live policy culling while convergence cleanup remains
///    active, and the flag reads false.
#[tokio::test]
async fn flag_off_freezes_live_checkpoints_without_policy_culling() {
    let _env = EnvGuard::off().await;
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

/// 5. Retention: cull to exactly N, keep the newest N, exempt the newest safety
///    row beyond N, and exempt an in-flight revert even from the age cap.
#[tokio::test]
async fn retention_culls_to_n_with_safety_and_inflight_exemptions() {
    let _env = EnvGuard::on().await;
    let harness = Harness::new("retention");
    harness.worktree_workspace("ws-1");
    let service = harness.service();
    let n = super::retention::RETENTION_KEEP_N;

    // Give every ordinary row the same fresh timestamp so the deterministic
    // id-desc tiebreaker alone proves the N cutoff; age culling cannot mask it.
    let fresh_timestamp = timestamp_days_ago(1);
    for index in 0..(n + 3) {
        harness.make_checkpoint(
            "ws-1",
            &format!("fresh-{index:03}"),
            CheckpointOrigin::TurnStart,
            &fresh_timestamp,
            false,
        );
    }
    // Same timestamp but an id that sorts after every fresh row: the only safety
    // row is ranked beyond N and survives solely because of its exemption.
    harness.make_checkpoint(
        "ws-1",
        "aaa-safety",
        CheckpointOrigin::Safety,
        &fresh_timestamp,
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
    let surviving_fresh = surviving
        .iter()
        .filter(|id| id.starts_with("fresh-"))
        .cloned()
        .collect::<std::collections::BTreeSet<_>>();
    let expected_fresh = (3..(n + 3))
        .map(|index| format!("fresh-{index:03}"))
        .collect::<std::collections::BTreeSet<_>>();
    assert_eq!(
        surviving_fresh, expected_fresh,
        "retention keeps exactly the newest N ordinary checkpoints"
    );
    assert!(
        surviving.contains("claimed"),
        "an in-flight-claimed checkpoint survives even past both the N-cut and the age cap"
    );
    assert!(
        surviving.contains("aaa-safety"),
        "the newest safety row is exempt from the N-cull"
    );
}

/// Only the newest fresh safety checkpoint is the standing un-revert handle.
/// An older fresh safety row outside keep-N must take the ordinary N-cull.
#[tokio::test]
async fn retention_exempts_only_the_newest_safety_checkpoint_beyond_keep_n() {
    let _env = EnvGuard::on().await;
    let harness = Harness::new("retention-newest-safety-only");
    harness.worktree_workspace("ws-1");
    let n = super::retention::RETENTION_KEEP_N;

    // Fill every keep-N position with newer ordinary rows. Both safety rows
    // are fresh enough to avoid the age cap but rank beyond N.
    for index in 0..n {
        harness.make_checkpoint(
            "ws-1",
            &format!("ordinary-{index:03}"),
            CheckpointOrigin::TurnStart,
            &timestamp_days_ago(0),
            false,
        );
    }
    harness.make_checkpoint(
        "ws-1",
        "newest-safety",
        CheckpointOrigin::Safety,
        &timestamp_days_ago(1),
        false,
    );
    harness.make_checkpoint(
        "ws-1",
        "older-safety",
        CheckpointOrigin::Safety,
        &timestamp_days_ago(2),
        false,
    );

    let service = harness.service();
    service.sweep_retention().await;

    let surviving = harness.checkpoint_ref_ids("ws-1");
    assert!(
        surviving.contains("newest-safety"),
        "newest fresh safety checkpoint is exempt beyond keep-N"
    );
    assert!(
        !surviving.contains("older-safety"),
        "older fresh safety checkpoint is not exempt from the N-cull"
    );
    let newest = service
        .store_for_tests()
        .find_checkpoint("newest-safety")
        .expect("query newest safety")
        .expect("newest safety row");
    let older = service
        .store_for_tests()
        .find_checkpoint("older-safety")
        .expect("query older safety")
        .expect("older safety row");
    assert!(newest.expired_at.is_none());
    assert!(older.expired_at.is_some());
}

#[tokio::test]
async fn retention_age_cap_culls_even_the_newest_safety_checkpoint() {
    let _env = EnvGuard::on().await;
    let harness = Harness::new("retention-age");
    harness.worktree_workspace("ws-1");
    harness.make_checkpoint(
        "ws-1",
        "fresh",
        CheckpointOrigin::TurnStart,
        &timestamp_days_ago(1),
        false,
    );
    harness.make_checkpoint(
        "ws-1",
        "aged-ordinary",
        CheckpointOrigin::TurnStart,
        &timestamp_days_ago(20),
        false,
    );
    // This is the only (therefore newest) safety row. It must still age out.
    harness.make_checkpoint(
        "ws-1",
        "aged-safety",
        CheckpointOrigin::Safety,
        &timestamp_days_ago(30),
        false,
    );

    let service = harness.service();
    service.sweep_retention().await;

    let surviving = harness.checkpoint_ref_ids("ws-1");
    assert!(
        !surviving.contains("aged-safety"),
        "a safety row past the age cap is still culled"
    );
    assert!(
        !surviving.contains("aged-ordinary"),
        "the age cap culls even inside the newest N"
    );
    // A culled row keeps its expired_at set; its refs are gone.
    let expired = service
        .store_for_tests()
        .find_checkpoint("aged-safety")
        .expect("query")
        .expect("row");
    assert!(
        expired.expired_at.is_some(),
        "culled rows are expired, not deleted"
    );
    assert!(
        surviving.contains("fresh"),
        "a fresh checkpoint inside N survives"
    );
}

#[tokio::test]
async fn checkpoint_retention_never_mutates_archive_or_rescue_refs() {
    let _env = EnvGuard::on().await;
    let harness = Harness::new("namespace-isolation");
    harness.worktree_workspace("ws-1");

    let head = head_sha(&harness.repo_root);
    let archive_worktree = make_tree(
        &harness.repo_root,
        "archive-worktree.txt",
        "archive worktree bytes",
    );
    let archive_index = make_tree(
        &harness.repo_root,
        "archive-index.txt",
        "archive index bytes",
    );
    let archive_snapshot = bare_snapshot(head.clone(), archive_worktree, archive_index);
    archive_refs::write_archive_refs(&harness.repo_root, "ws-1", &archive_snapshot)
        .expect("write archive refs");
    archive_refs::copy_to_rescue(&harness.repo_root, "ws-1", &head)
        .expect("copy archive refs to rescue");

    let protected_before = archive_and_rescue_ref_map(&harness.repo_root);
    assert_eq!(
        protected_before.len(),
        6,
        "fixture must contain three archive refs and three rescue refs"
    );

    harness.make_checkpoint(
        "ws-1",
        "aged-checkpoint",
        CheckpointOrigin::TurnStart,
        &timestamp_days_ago(40),
        false,
    );
    assert!(
        harness
            .checkpoint_ref_ids("ws-1")
            .contains("aged-checkpoint"),
        "fixture must contain an age-cull-eligible checkpoint"
    );

    harness.service().sweep_retention().await;

    assert!(
        !harness
            .checkpoint_ref_ids("ws-1")
            .contains("aged-checkpoint"),
        "the retention pass must actually cull its eligible checkpoint"
    );
    assert_eq!(
        archive_and_rescue_ref_map(&harness.repo_root),
        protected_before,
        "checkpoint retention must preserve every archive/rescue ref name and raw OID"
    );
}

fn archive_and_rescue_ref_map(repo_root: &Path) -> BTreeMap<String, String> {
    let output = Command::new("git")
        .current_dir(repo_root)
        .args([
            "for-each-ref",
            "--format=%(refname) %(objectname)",
            "refs/proliferate/",
        ])
        .output()
        .expect("enumerate proliferate refs");
    assert!(
        output.status.success(),
        "git for-each-ref failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let (name, oid) = line.split_once(' ')?;
            (name.starts_with("refs/proliferate/archive-")
                || name.starts_with("refs/proliferate/rescue/"))
            .then(|| (name.to_string(), oid.to_string()))
        })
        .collect()
}

/// 6. Deletion-order crash states: a row-expired-but-refs-present state and a
///    refs-present-but-row-absent state are both reaped, and an unexpired row
///    never loses its refs.
#[tokio::test]
async fn the_orphan_reap_converges_both_crash_states_and_spares_live_rows() {
    let _env = EnvGuard::on().await;
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

#[tokio::test]
async fn a_first_rowless_capture_is_discovered_from_the_repo_refs() {
    let _env = EnvGuard::off().await;
    let harness = Harness::new("rowless-discovery");
    harness.worktree_workspace("ws-1");
    let tree = make_tree(&harness.repo_root, "rowless-only.txt", "orphan");
    let snap = bare_snapshot(head_sha(&harness.repo_root), tree.clone(), tree);
    refs::write_checkpoint_refs(&harness.repo_root, "ws-1", "rowless-only", &snap)
        .expect("write rowless checkpoint refs");
    assert!(harness
        .service()
        .store_for_tests()
        .list_workspace_ids_with_any_checkpoints()
        .expect("list row-backed candidates")
        .is_empty());

    harness.service().sweep_retention().await;

    assert!(
        harness.checkpoint_ref_ids("ws-1").is_empty(),
        "repo-ref discovery reaps a first capture that crashed before row insert"
    );
}

#[tokio::test]
async fn the_orphan_reap_fails_closed_when_a_row_cannot_be_mapped() {
    let _env = EnvGuard::on().await;
    let harness = Harness::new("mapping-error");
    harness.worktree_workspace("ws-1");
    harness.make_checkpoint(
        "ws-1",
        "z-unreadable",
        CheckpointOrigin::TurnStart,
        &timestamp_days_ago(1),
        true,
    );
    harness.corrupt_checkpoint_anchor_flag("z-unreadable");
    // This rowless ref set sorts before the unreadable row. A reap that deletes
    // while it classifies would remove it before discovering the mapping
    // failure; the required stage-all-first discipline preserves the whole
    // batch.
    let tree = make_tree(&harness.repo_root, "rowless.txt", "orphan");
    let snap = bare_snapshot(head_sha(&harness.repo_root), tree.clone(), tree);
    refs::write_checkpoint_refs(&harness.repo_root, "ws-1", "a-rowless", &snap)
        .expect("write rowless checkpoint refs");

    harness.service().sweep_retention().await;

    let surviving = harness.checkpoint_ref_ids("ws-1");
    assert!(
        surviving.contains("a-rowless") && surviving.contains("z-unreadable"),
        "a row read/mapping error is never reclassified as row absence"
    );
}

#[tokio::test]
async fn purge_expiry_marker_keeps_failed_cleanup_discoverable_to_the_sweep() {
    let _env = EnvGuard::off().await;
    assert!(!checkpoint_capture_enabled());
    let harness = Harness::new("purge-discovery");
    harness.worktree_workspace("ws-1");
    harness.make_checkpoint(
        "ws-1",
        "purge-leftover",
        CheckpointOrigin::TurnStart,
        &timestamp_days_ago(1),
        false,
    );
    let service = harness.service();
    service
        .store_for_tests()
        .mark_checkpoints_expired_for_workspace("ws-1", "2026-08-19T00:00:00Z")
        .expect("expire purge rows before ref deletion");

    // Model a crash/failure before purge deletes refs. The expired row keeps
    // the workspace in the retention candidate set, so the periodic duty can
    // finish the ref cleanup without a manual DELETE retry even while capture
    // (and therefore policy culling) is disabled.
    service.sweep_retention().await;

    assert!(
        harness.checkpoint_ref_ids("ws-1").is_empty(),
        "expired purge metadata keeps leftover refs discoverable"
    );
}
