//! Path-claim safety: the gate that stops one workspace's restore from landing
//! on another's live work, and the narrowing that stops two archived rows from
//! wedging each other forever.
//!
//! A workspace's path is stable for its lifetime — native chat resume keys on the
//! absolute worktree path — so relocating to a sibling is not an option and an
//! occupied path has to be a decision.

use std::path::Path;

use super::harness::{make_dirty, Harness};
use crate::domains::workspaces::archive::types::{
    ArchiveOptions, OccupantLifecycle, UnarchiveError, UnarchiveOptions, UnarchiveScenario,
};
use crate::domains::workspaces::model::WorkspaceLifecycleState;

fn scenario(
    error: UnarchiveError,
) -> crate::domains::workspaces::archive::types::UnarchiveScenarioPayload {
    match error {
        UnarchiveError::Scenario(payload) => payload,
        other => panic!("expected a scenario 409, got {other:?}"),
    }
}

/// A second spelling of one directory, built rather than borrowed from the
/// platform so the aliasing property holds on macOS and Linux alike.
#[cfg(unix)]
fn symlink_dir(target: &Path, link: &Path) {
    std::os::unix::fs::symlink(target, link).expect("create the alias symlink");
}

#[cfg(windows)]
fn symlink_dir(target: &Path, link: &Path) {
    std::os::windows::fs::symlink_dir(target, link).expect("create the alias symlink");
}

/// The claim gate runs BEFORE the intact tier. "Git-registered with a resolvable
/// HEAD" is true of another row's live worktree too, so an intact tier evaluated
/// first would restore A's snapshot over B's live work.
#[tokio::test]
async fn the_claim_gate_refuses_before_any_tier_reads_the_directory() {
    let harness = Harness::new("claim-gate");
    let path = harness.worktree_workspace("ws-1");
    make_dirty(&path);
    harness
        .service()
        .archive("ws-1", ArchiveOptions::default())
        .await
        .expect("archive");
    super::idempotency::settle_for(&harness.service(), "ws-1").await;
    // A second, ACTIVE row now records the same directory, and a live worktree
    // sits there.
    harness.worktree_workspace("ws-2");
    std::fs::create_dir_all(&path).ok();
    harness
        .service()
        .store_for_tests()
        .update_current_branch("ws-2", Some("ws-2"), "2026-08-13T00:00:00Z")
        .expect("touch row");
    harness
        .state
        .db
        .with_conn(|conn| {
            conn.execute(
                "UPDATE workspaces SET path = ?2 WHERE id = ?1",
                rusqlite::params!["ws-2", path.display().to_string()],
            )?;
            Ok(())
        })
        .expect("point ws-2 at ws-1's path");

    let payload = scenario(
        harness
            .service()
            .unarchive("ws-1", UnarchiveOptions::default())
            .await
            .expect_err("a live claim must refuse"),
    );

    assert_eq!(payload.scenario, UnarchiveScenario::PathOccupied);
    assert_eq!(
        payload.occupant_lifecycle,
        Some(OccupantLifecycle::Active),
        "the dialog copy branches on the occupant's lifecycle so the exit it names is real"
    );
    assert!(
        payload.strategies.is_empty(),
        "no overwrite offer: force-removing an occupying row with no quiesce and no snapshot of IT \
         would be retire's loss profile reintroduced through a dialog"
    );
    assert!(
        payload.occupant_name.is_some(),
        "the 409 names the occupant"
    );
}

/// `overwrite: true` is refused server-side whenever a live claim exists,
/// whatever the client sends.
#[tokio::test]
async fn overwrite_is_refused_server_side_against_a_live_claim() {
    let harness = Harness::new("overwrite-refused");
    let path = harness.worktree_workspace("ws-1");
    make_dirty(&path);
    harness
        .service()
        .archive("ws-1", ArchiveOptions::default())
        .await
        .expect("archive");
    super::idempotency::settle_for(&harness.service(), "ws-1").await;
    harness.row_at("ws-2", &path);
    std::fs::create_dir_all(&path).ok();

    let payload = scenario(
        harness
            .service()
            .unarchive(
                "ws-1",
                UnarchiveOptions {
                    overwrite: true,
                    ..UnarchiveOptions::default()
                },
            )
            .await
            .expect_err("overwrite against a live claim must still refuse"),
    );

    assert_eq!(payload.scenario, UnarchiveScenario::PathOccupied);
    assert!(payload.strategies.is_empty());
}

/// The liveness gate is what keeps "first unarchiver wins" satisfiable: an
/// ARCHIVED, sha-NULL claimant with NO directory at the path is not an
/// obstruction, because nothing exists to overwrite.
#[tokio::test]
async fn an_archived_claimant_with_no_directory_does_not_block_the_restore() {
    let harness = Harness::new("liveness-gate");
    let path = harness.worktree_workspace("ws-1");
    make_dirty(&path);
    harness
        .service()
        .archive("ws-1", ArchiveOptions::default())
        .await
        .expect("archive");
    super::idempotency::settle_for(&harness.service(), "ws-1").await;
    // A sha-NULL archived sibling recorded at the same path, with nothing there.
    harness.row_at("ws-2", &path);
    harness.force_archived("ws-2", None, Some("ws-2"));
    let _ = std::fs::remove_dir_all(&path);

    let outcome = harness
        .service()
        .unarchive("ws-1", UnarchiveOptions::default())
        .await
        .expect("a claimant with no directory is not an obstruction");

    assert_eq!(
        outcome.record.lifecycle_state,
        WorkspaceLifecycleState::Active
    );
    assert!(path.exists(), "the restore took the path");
}

/// A sha-NULL claimant whose directory DOES exist is a real claim: its surviving
/// directory may be the only copy of never-snapshotted work.
#[tokio::test]
async fn a_sha_null_claimant_with_a_surviving_directory_is_a_real_claim() {
    let harness = Harness::new("sha-null-claim");
    let path = harness.worktree_workspace("ws-1");
    make_dirty(&path);
    harness
        .service()
        .archive("ws-1", ArchiveOptions::default())
        .await
        .expect("archive");
    super::idempotency::settle_for(&harness.service(), "ws-1").await;
    harness.row_at("ws-2", &path);
    harness.force_archived("ws-2", None, Some("ws-2"));
    std::fs::create_dir_all(&path).expect("the sibling's directory survives");

    let payload = scenario(
        harness
            .service()
            .unarchive("ws-1", UnarchiveOptions::default())
            .await
            .expect_err("a sha-NULL claimant with a surviving directory must refuse"),
    );

    assert_eq!(payload.scenario, UnarchiveScenario::PathOccupied);
    assert_eq!(
        payload.occupant_lifecycle,
        Some(OccupantLifecycle::Archived),
        "an archived occupant reads 'unarchive or delete that workspace first'"
    );
    assert!(
        path.exists(),
        "the refusal must never force-remove the sibling"
    );
}

/// The narrowing, and its negative control. Two sha-BEARING archived rows
/// recording one path must not block each other's leftover cleanup: with
/// any-lifecycle matching, each reads as the other's claimant and both stay
/// wedged forever.
#[tokio::test]
async fn two_sha_bearing_archived_rows_do_not_wedge_each_others_cleanup() {
    let harness = Harness::new("dual-row-wedge");
    let path = harness.worktree_workspace("ws-1");
    let store = harness.service().store_for_tests().clone();
    harness.force_archived("ws-1", Some("deadbeef"), Some("ws-1"));
    harness.row_at("ws-2", &path);
    harness.force_archived("ws-2", Some("cafebabe"), Some("ws-2"));

    let first = store
        .any_other_row_claims_path(&harness.row("ws-1"))
        .expect("claim check");
    let second = store
        .any_other_row_claims_path(&harness.row("ws-2"))
        .expect("claim check");

    assert!(
        !first,
        "a sha-bearing archived row's work lives in its refs, not its directory"
    );
    assert!(!second);

    // The negative control for the narrowing: matching ANY lifecycle is what the
    // wedge looks like. Both rows would read as claimed, so neither leftover
    // could ever be swept and neither row could be individually converged.
    let any_lifecycle_claims = |id: &str| -> bool {
        let subject = harness.row(id);
        store
            .list_all()
            .expect("list rows")
            .into_iter()
            .filter(|row| row.id != subject.id)
            .any(|row| row.path == subject.path)
    };
    assert!(any_lifecycle_claims("ws-1"));
    assert!(any_lifecycle_claims("ws-2"));
}

/// `/tmp` versus `/private/tmp`: two spellings of one directory are one path, or
/// the claim gate calls an occupied path unclaimed on every machine we ship to.
///
/// The alias is BUILT rather than borrowed from the platform. macOS supplies one
/// for free (`/tmp` is a symlink to `/private/tmp`) and Linux does not, so a test
/// that asserted the temp directory is aliased passed on one and refused to run
/// on the other. A symlink beside the managed root is the same property on both.
#[tokio::test]
async fn two_spellings_of_one_directory_are_treated_as_the_same_path() {
    let harness = Harness::new("alias");
    let path = harness.worktree_workspace("ws-1");
    let base = harness.repo_root.parent().expect("base directory");
    let alias_root = base.join("worktrees-by-another-name");
    symlink_dir(&harness.managed_root(), &alias_root);
    let aliased = alias_root.join("ws-1");
    assert_ne!(
        aliased, path,
        "the two spellings must differ textually for the test to prove anything"
    );
    assert_eq!(
        std::fs::canonicalize(&aliased).expect("canonicalize the alias"),
        std::fs::canonicalize(&path).expect("canonicalize"),
        "and they must be the same directory underneath"
    );
    harness.row_at("ws-2", &aliased);

    let claimed = harness
        .service()
        .store_for_tests()
        .any_other_row_claims_path(&harness.row("ws-1"))
        .expect("claim check");

    assert!(
        claimed,
        "a string compare would call two spellings of one directory different paths"
    );
}

/// Two unarchives claiming one path serialize on the in-flight map rather than
/// both passing the no-directory check and racing to create a worktree there.
#[tokio::test]
async fn two_unarchives_claiming_one_path_serialize_on_the_in_flight_map() {
    let harness = Harness::new("inflight-serialize");
    let path = harness.worktree_workspace("ws-1");
    let inflight = harness.service();
    let guard = inflight
        .inflight_for_tests()
        .try_claim("ws-2", &harness.repo_root, &path)
        .expect("the other unarchive claims the target path first");
    harness.force_archived("ws-1", Some("deadbeef"), Some("ws-1"));

    let error = harness
        .service()
        .unarchive("ws-1", UnarchiveOptions::default())
        .await
        .expect_err("the loser must refuse rather than race");

    assert_eq!(
        scenario(error).scenario,
        UnarchiveScenario::PathOccupied,
        "exactly one unarchive wins the path"
    );
    drop(guard);
}

/// A lifecycle value this binary cannot parse counts as a CLAIM.
///
/// The claim predicate is the last thing standing between a row's directory and
/// an rm-rf, so it fails closed: a row written by a newer binary in a state we
/// have never heard of must never read as "nobody is using this". Only the
/// provably safe case — an archived row whose work is already in its refs — is
/// exempt. This is the destructive half of the same tolerance R0 built into the
/// read path.
#[tokio::test]
async fn an_unknown_lifecycle_value_still_claims_its_path() {
    let harness = Harness::new("future-lifecycle");
    let path = harness.worktree_workspace("ws-1");
    // A textbook leftover: archived, sha-bearing, directory on disk, inside the
    // managed root. Everything the sweep needs to remove it.
    harness.force_archived("ws-1", Some("deadbeef"), Some("ws-1"));
    // ...except that a row a NEWER binary wrote records the same directory.
    harness.row_at("ws-future", &path);
    harness
        .state
        .db
        .with_conn(|conn| {
            conn.execute("PRAGMA ignore_check_constraints = ON", [])?;
            conn.execute(
                "UPDATE workspaces SET lifecycle_state = 'quarantined' WHERE id = 'ws-future'",
                [],
            )?;
            conn.execute("PRAGMA ignore_check_constraints = OFF", [])?;
            Ok(())
        })
        .expect("write a lifecycle value neither binary knows");

    let claimed = harness
        .service()
        .store_for_tests()
        .any_other_row_claims_path(&harness.row("ws-1"))
        .expect("claim check");
    harness.service().sweep_leftovers().await;

    assert!(
        claimed,
        "an unparseable lifecycle is not a licence to delete the directory"
    );
    assert!(path.exists(), "and the sweep leaves it exactly where it is");
}
