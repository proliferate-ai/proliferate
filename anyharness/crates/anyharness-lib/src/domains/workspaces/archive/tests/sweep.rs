//! The leftover sweep, one test per predicate term.
//!
//! The predicate is the whole safety story, so most of these tests are
//! leave-alones: a row that differs from a real leftover in exactly one term, and
//! a sweep that removed it would be deleting work. The first test is the positive
//! control that keeps the rest from passing vacuously.
//!
//! A leftover is manufactured by archiving for real, letting phase 2 finish, and
//! then re-creating a worktree at the row's recorded path. That is the exact
//! on-disk and in-row state a killed phase 2 leaves — an archived, sha-bearing row
//! with a directory and intact refs — and it is reached without racing a detached
//! task, so the tests below are deterministic rather than timing-dependent.

use std::path::Path;
use std::process::Command;

use super::harness::{git, git_stdout, make_dirty, Harness};
use crate::domains::workspaces::archive::types::ArchiveOptions;
use crate::domains::workspaces::model::WorkspaceLifecycleState;

/// The primary cleanup, and the positive control for every leave-alone below: the
/// leftover directory goes, and the row and its refs — the only copy of the
/// snapshot — are untouched.
#[tokio::test]
async fn the_sweep_removes_a_leftover_worktree_and_leaves_the_row_and_refs_alone() {
    let harness = Harness::new("sweep-leftover");
    let path = harness.worktree_workspace("ws-1");
    make_dirty(&path);
    let service = harness.service();
    service
        .archive("ws-1", ArchiveOptions::default())
        .await
        .expect("archive");
    super::idempotency::settle_for(&service, "ws-1").await;
    recreate_worktree(&harness, "ws-1", &path);
    let refs_before = archive_refs(&harness);
    assert!(
        !refs_before.is_empty(),
        "the refs are what the sweep must not touch, so they have to exist"
    );

    service.sweep_leftovers().await;

    assert!(!path.exists(), "the leftover directory is gone");
    let row = harness.row("ws-1");
    assert_eq!(row.lifecycle_state, WorkspaceLifecycleState::Archived);
    assert!(
        row.archived_head_sha.is_some(),
        "the row is untouched: the snapshot is still what a later unarchive restores from"
    );
    assert_eq!(
        archive_refs(&harness),
        refs_before,
        "removing the directory must never reap the refs with it"
    );
}

/// A `kind=local` row is left alone: its directory is the user's own checkout and
/// legitimately exists.
#[tokio::test]
async fn the_sweep_leaves_a_local_row_alone() {
    let harness = Harness::new("sweep-local");
    let path = harness.local_workspace("ws-local");
    let service = harness.service();
    service
        .archive("ws-local", ArchiveOptions::default())
        .await
        .expect("archive");

    service.sweep_leftovers().await;

    assert!(
        path.join("hand-written.txt").exists(),
        "the kind guard is what stops the sweep deleting a user's own checkout"
    );
}

/// A sha-NULL absorbed row is left alone: it never had a snapshot, so its
/// directory may hold the only copy of never-snapshotted work.
#[tokio::test]
async fn the_sweep_leaves_a_sha_null_row_alone() {
    let harness = Harness::new("sweep-sha-null");
    let path = harness.worktree_workspace("ws-1");
    std::fs::write(path.join("only-copy.txt"), "irreplaceable\n").expect("write");
    harness.force_archived("ws-1", None, Some("ws-1"));

    harness.service().sweep_leftovers().await;

    assert!(
        path.join("only-copy.txt").exists(),
        "the snapshot guard is what stops the sweep deleting unsnapshotted work"
    );
}

/// An archived row whose freed path was reused by a NEWER, active workspace is
/// left alone: cleaning "A's leftover" must never delete B's live worktree.
#[tokio::test]
async fn the_sweep_leaves_a_path_another_row_claims_alone() {
    let harness = Harness::new("sweep-claimed");
    let path = harness.worktree_workspace("ws-1");
    make_dirty(&path);
    let service = harness.service();
    service
        .archive("ws-1", ArchiveOptions::default())
        .await
        .expect("archive");
    super::idempotency::settle_for(&service, "ws-1").await;
    recreate_worktree(&harness, "ws-1", &path);
    // The path was freed and a newer active row took it.
    harness.row_at("ws-2", &path);

    service.sweep_leftovers().await;

    assert!(
        path.exists(),
        "the path-ownership guard is what stops the sweep deleting a sibling's worktree"
    );
}

/// The listing pass is only a hint. A row unarchived between listing and lease is
/// left alone, which is why the predicate is re-evaluated against a freshly
/// re-loaded row rather than the candidate the listing produced.
#[tokio::test]
async fn the_sweep_re_reads_the_row_and_leaves_a_since_unarchived_one_alone() {
    let harness = Harness::new("sweep-toctou");
    let path = harness.worktree_workspace("ws-1");
    make_dirty(&path);
    let service = harness.service();
    service
        .archive("ws-1", ArchiveOptions::default())
        .await
        .expect("archive");
    super::idempotency::settle_for(&service, "ws-1").await;
    recreate_worktree(&harness, "ws-1", &path);
    // The candidate the listing produced: archived, sha-bearing, directory
    // present. It matches the predicate on its face.
    let stale_candidate = harness.row("ws-1");
    assert!(
        crate::domains::workspaces::archive::phase2::is_leftover(&service, &stale_candidate)
            .expect("predicate"),
        "the stale candidate has to look like a leftover for the re-read to be the thing tested"
    );
    // ...and then the user unarchived it before the lease was taken.
    service
        .store_for_tests()
        .mark_active("ws-1", "2026-08-13T00:00:00Z")
        .expect("mark active");

    let removed =
        crate::domains::workspaces::archive::phase2::converge_leftover(&service, &stale_candidate)
            .await
            .expect("converge");

    assert!(!removed, "an active row's worktree is never a leftover");
    assert!(path.exists(), "and it is still on disk");
}

/// The sweep only ever removes paths inside the managed worktrees root, even when
/// every other term of the predicate matches.
#[tokio::test]
async fn the_sweep_refuses_a_path_outside_the_managed_root() {
    let harness = Harness::new("sweep-containment");
    let outside = harness
        .repo_root
        .parent()
        .expect("base directory")
        .join("outside-the-root");
    git(
        &harness.repo_root,
        &[
            "worktree",
            "add",
            "-b",
            "outsider",
            &outside.display().to_string(),
            "HEAD",
        ],
    );
    harness.row_at("ws-outside", &outside);
    harness.force_archived("ws-outside", Some("deadbeef"), Some("outsider"));
    assert!(
        !outside.starts_with(harness.managed_root()),
        "the path has to be outside the root for the guard to be what is under test"
    );

    harness.service().sweep_leftovers().await;

    assert!(
        outside.exists(),
        "an rm-rf outside the managed root is the one mistake with no recovery"
    );
}

/// The request-driven convergence runs the IDENTICAL knob-free cleanup the sweep
/// runs, so it refuses an out-of-root path for the identical reason: the
/// removal's documented fallback is an rm-rf, and a guard a re-POST can route
/// around is not a guard.
#[tokio::test]
async fn the_request_path_refuses_to_converge_outside_the_managed_root() {
    let harness = Harness::new("request-containment");
    let outside = harness
        .repo_root
        .parent()
        .expect("base directory")
        .join("outside-the-root");
    git(
        &harness.repo_root,
        &[
            "worktree",
            "add",
            "-b",
            "outsider",
            &outside.display().to_string(),
            "HEAD",
        ],
    );
    harness.row_at("ws-outside", &outside);
    make_dirty(&outside);
    let service = harness.service();
    // Archived for real, so the row carries a sha and the refs exist: every term
    // of the leftover predicate matches except containment.
    service
        .archive("ws-outside", ArchiveOptions::default())
        .await
        .expect("archive");
    super::idempotency::settle_for(&service, "ws-outside").await;
    // Phase 2's own removal already freed it; put a directory back at the
    // recorded path so the re-POST has a leftover to be tempted by.
    git(
        &harness.repo_root,
        &[
            "worktree",
            "add",
            &outside.display().to_string(),
            "outsider",
        ],
    );
    std::fs::write(outside.join("not-ours.txt"), "outside the root\n").expect("write");

    // The re-POST: answers 200 and kicks the detached knob-free cleanup.
    service
        .archive("ws-outside", ArchiveOptions::default())
        .await
        .expect("re-archive");
    super::idempotency::settle_for(&service, "ws-outside").await;

    assert!(
        outside.join("not-ours.txt").exists(),
        "the request path must refuse the rm-rf fallback outside the managed root, exactly as the \
         sweep does"
    );
}

/// The convergence-lag warning counts only rows that can actually converge. A
/// `kind=local` row's directory is the user's own checkout and a sha-NULL row's
/// directory is protected BY the predicate, so counting either means warning
/// every hour, forever, about a state that is working as designed.
#[tokio::test]
async fn the_leftover_census_ignores_local_and_sha_null_rows() {
    let harness = Harness::new("sweep-census");
    let service = harness.service();
    // One of each shape whose directory legitimately persists...
    harness.local_workspace("ws-local");
    harness.force_archived("ws-local", None, None);
    harness.worktree_workspace("ws-absorbed");
    harness.force_archived("ws-absorbed", None, Some("ws-absorbed"));
    let census = || {
        crate::domains::workspaces::archive::sweep::leftover_census(
            &service
                .store_for_tests()
                .list_by_lifecycle(WorkspaceLifecycleState::Archived)
                .expect("list archived"),
        )
    };

    assert!(
        census().is_empty(),
        "neither shape is a leftover, so neither is convergence falling behind"
    );

    // ...and the positive control: a real leftover IS counted, so the assertion
    // above is not passing because the census counts nothing at all.
    let path = harness.worktree_workspace("ws-leftover");
    make_dirty(&path);
    service
        .archive("ws-leftover", ArchiveOptions::default())
        .await
        .expect("archive");
    super::idempotency::settle_for(&service, "ws-leftover").await;
    recreate_worktree(&harness, "ws-leftover", &path);

    assert_eq!(census(), vec!["ws-leftover".to_string()]);
}

/// Duty 1, with both of its protections and the removal that proves neither is
/// vacuous. Liveness comes from the in-flight map and never from mtimes: a
/// staging parent's mtime freezes at creation, so a live restore's staging
/// directory looks arbitrarily old.
#[tokio::test]
async fn staging_siblings_are_protected_by_the_age_gate_and_then_the_in_flight_map() {
    let harness = Harness::new("sweep-staging");
    // An archived row is what puts this repo root in the duty's scan set; a
    // sha-NULL one so the primary cleanup leaves it alone.
    harness.worktree_workspace("ws-keeper");
    harness.force_archived("ws-keeper", None, Some("ws-keeper"));
    let staging_parent = harness
        .managed_root()
        .join(".proliferate-worktree-restore-abc");
    let staged = staging_parent.join("ws-staged");
    git(
        &harness.repo_root,
        &[
            "worktree",
            "add",
            "-b",
            "staged",
            &staged.display().to_string(),
            "HEAD",
        ],
    );
    let service = harness.service();

    service.sweep_leftovers().await;
    assert!(
        staged.exists(),
        "a fresh staging sibling may still belong to a running restore"
    );

    // Past the age gate, but a live flow holds the claim. The claim is on the
    // TARGET path, which is the only path an unarchive ever registers — a test
    // that claimed the staged path itself would prove `path_busy` works while
    // hiding the fact that the sweep and the restore key the map differently.
    backdate(&staged);
    let restore_target = harness.managed_root().join("ws-staged");
    let guard = service
        .inflight_for_tests()
        .try_claim("ws-staged", &harness.repo_root, &restore_target)
        .expect("claim the restore's target path");
    service.sweep_leftovers().await;
    assert!(
        staged.exists(),
        "an mtime-based liveness check would delete a live restore's staging directory"
    );

    // Nothing holds it and it is old: now it is debris.
    drop(guard);
    service.sweep_leftovers().await;
    assert!(
        !staged.exists(),
        "the crashed restore's staging sibling is reclaimed"
    );
    assert!(
        !staging_parent.exists(),
        "the emptied staging parent goes too, or one accumulates per crashed restore"
    );
}

/// Duty 3 releases the refs and the row's archive columns TOGETHER. Deleting refs
/// while a sha survived would manufacture the exact false `snapshot_lost` the duty
/// exists to prevent.
#[tokio::test]
async fn the_refs_duty_releases_the_columns_and_the_refs_together() {
    let harness = Harness::new("sweep-refs");
    let path = harness.worktree_workspace("ws-1");
    make_dirty(&path);
    let service = harness.service();
    service
        .archive("ws-1", ArchiveOptions::default())
        .await
        .expect("archive");
    super::idempotency::settle_for(&service, "ws-1").await;
    // The crash window the duty exists for: the row went active but the release
    // never ran, so an active row still carries both the columns and the refs.
    service
        .store_for_tests()
        .mark_active("ws-1", "2026-08-13T00:00:00Z")
        .expect("mark active");
    assert!(harness.row("ws-1").archived_head_sha.is_some());
    assert!(!archive_refs(&harness).is_empty());

    service.sweep_leftovers().await;

    let row = harness.row("ws-1");
    assert!(
        row.archived_head_sha.is_none(),
        "the columns were released first"
    );
    assert!(row.archived_branch.is_none());
    assert!(
        archive_refs(&harness).is_empty(),
        "and the refs went with them in the same tick"
    );
}

/// Re-create a worktree at a row's recorded path: the on-disk half of the state a
/// killed phase 2 leaves behind.
fn recreate_worktree(harness: &Harness, branch: &str, path: &Path) {
    assert!(
        !path.exists(),
        "phase 2 must have finished before the leftover is staged"
    );
    git(
        &harness.repo_root,
        &["worktree", "add", &path.display().to_string(), branch],
    );
}

fn archive_refs(harness: &Harness) -> String {
    git_stdout(
        &harness.repo_root,
        &["for-each-ref", "--format=%(refname)", "refs/proliferate/"],
    )
}

/// Push a directory's mtime two hours into the past so the age gate is genuinely
/// passed. Sleeping through a one-hour gate is not a test anybody runs, and
/// parameterising the gate would let the production constant drift untested.
fn backdate(path: &Path) {
    let stamp = (chrono::Local::now() - chrono::Duration::hours(2))
        .format("%Y%m%d%H%M")
        .to_string();
    let output = Command::new("touch")
        .args(["-t", &stamp, &path.display().to_string()])
        .output()
        .expect("spawn touch");
    assert!(
        output.status.success(),
        "touch -t failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}
