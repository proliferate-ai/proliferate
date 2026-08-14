//! Failure injection and idempotency: what the row and the disk look like after
//! each step of `archive.rs` either fails or repeats.
//!
//! The promise being pinned is a boundary, not a feeling: everything before
//! `mark_archived` aborts clean and leaves the workspace fully normal, and
//! everything after it is convergence work a re-POST finishes.

use std::sync::Arc;
use std::time::Duration;

use super::harness::{git, git_stdout, head_sha, make_dirty, status_porcelain, Harness};
use crate::domains::workspaces::archive::types::{ArchiveError, ArchiveOptions, UnarchiveOptions};
use crate::domains::workspaces::archive::WorkspaceArchiveService;
use crate::domains::workspaces::model::WorkspaceLifecycleState;

#[tokio::test]
async fn archiving_a_dirty_worktree_flips_the_row_and_records_the_snapshot() {
    let harness = Harness::new("archive-flip");
    let path = harness.worktree_workspace("ws-1");
    make_dirty(&path);
    let before_head = head_sha(&path);
    let before_status = status_porcelain(&path);

    let outcome = harness
        .service()
        .archive("ws-1", ArchiveOptions::default())
        .await
        .expect("archive");

    assert_eq!(
        outcome.record.lifecycle_state,
        WorkspaceLifecycleState::Archived
    );
    assert_eq!(
        outcome.record.archived_head_sha.as_deref(),
        Some(before_head.as_str()),
        "the row records the HEAD the snapshot was taken at"
    );
    assert_eq!(outcome.record.archived_branch.as_deref(), Some("ws-1"));
    assert!(outcome.record.archived_at.is_some());
    assert!(
        !before_status.is_empty(),
        "the fixture must have been dirty for this to prove anything"
    );
}

/// A full cycle, which is the one assertion the whole rung exists for: staged,
/// unstaged, and untracked state all read identical before and after.
#[tokio::test]
async fn a_full_archive_unarchive_cycle_restores_every_kind_of_dirt() {
    let harness = Harness::new("round-trip");
    let path = harness.worktree_workspace("ws-1");
    make_dirty(&path);
    let before_head = head_sha(&path);
    let before_status = status_porcelain(&path);

    harness
        .service()
        .archive("ws-1", ArchiveOptions::default())
        .await
        .expect("archive");
    // Phase 2 detaches, so the removal is not observable the instant archive
    // answers. Unarchive cancels and awaits it, which is exactly the path under
    // test here.
    let outcome = harness
        .service()
        .unarchive("ws-1", UnarchiveOptions::default())
        .await
        .expect("unarchive");

    assert_eq!(
        outcome.record.lifecycle_state,
        WorkspaceLifecycleState::Active
    );
    assert_eq!(head_sha(&path), before_head, "HEAD must read identical");
    assert_eq!(
        status_porcelain(&path),
        before_status,
        "staged, unstaged, and untracked state must all read identical"
    );
}

/// The verify passed, so the snapshot is redundant: the columns clear and the
/// refs are gone. Columns first, then refs — asserted by observing both cleared
/// together on the happy path, and by the sweep suite for the crash window.
#[tokio::test]
async fn a_verified_unarchive_releases_the_columns_and_the_refs() {
    let harness = Harness::new("release");
    let path = harness.worktree_workspace("ws-1");
    make_dirty(&path);

    harness
        .service()
        .archive("ws-1", ArchiveOptions::default())
        .await
        .expect("archive");
    harness
        .service()
        .unarchive("ws-1", UnarchiveOptions::default())
        .await
        .expect("unarchive");

    let row = harness.row("ws-1");
    assert!(row.archived_head_sha.is_none());
    assert!(row.archived_branch.is_none());
    assert!(row.partial_capture_json.is_none());
    assert!(
        git_stdout(
            &harness.repo_root,
            &["for-each-ref", "--format=%(refname)", "refs/proliferate/"],
        )
        .is_empty(),
        "a verified restore deletes the refs it restored from"
    );
    assert!(path.exists(), "the restored worktree is still there");
}

/// A failure BEFORE the flip: the read-only probe refuses a repository with an
/// unborn HEAD, and the workspace is left exactly as it was.
#[tokio::test]
async fn a_refusal_before_the_flip_leaves_the_workspace_fully_normal() {
    let harness = Harness::new("unborn");
    let path = harness.worktree_workspace("ws-1");
    // An orphan branch with no commit is the unborn-HEAD shape.
    git(&path, &["checkout", "--orphan", "fresh"]);
    git(&path, &["rm", "-r", "--cached", "."]);

    let error = harness
        .service()
        .archive("ws-1", ArchiveOptions::default())
        .await
        .expect_err("an unborn HEAD must refuse");

    assert!(
        matches!(error, ArchiveError::UnbornHead),
        "expected the typed unborn-HEAD refusal, got {error:?}"
    );
    let row = harness.row("ws-1");
    assert_eq!(row.lifecycle_state, WorkspaceLifecycleState::Active);
    assert!(row.archived_head_sha.is_none());
    assert!(path.exists(), "the worktree must be untouched");
}

/// Re-POSTing archive is harmless. The second call answers 200 with the archived
/// record; it never errors and never reinstates the row.
#[tokio::test]
async fn re_posting_archive_is_harmless() {
    let harness = Harness::new("double-archive");
    let path = harness.worktree_workspace("ws-1");
    make_dirty(&path);

    harness
        .service()
        .archive("ws-1", ArchiveOptions::default())
        .await
        .expect("first archive");
    // Let the detached tail finish so the second POST exercises the no-live-task
    // branch (the one that kicks the knob-free cleanup) rather than the pre-gate
    // fast path.
    settle_for(&harness.service(), "ws-1").await;
    let second = harness
        .service()
        .archive("ws-1", ArchiveOptions::default())
        .await
        .expect("second archive");

    assert_eq!(
        second.record.lifecycle_state,
        WorkspaceLifecycleState::Archived
    );
}

/// The local rm-rf regression, stated explicitly because it is the one the
/// product cannot survive: a `kind=local` workspace's directory is the user's
/// own checkout, and neither the first archive nor a re-POST may touch it.
#[tokio::test]
async fn archiving_a_local_workspace_never_touches_its_directory() {
    let harness = Harness::new("local");
    let path = harness.local_workspace("ws-local");

    let first = harness
        .service()
        .archive("ws-local", ArchiveOptions::default())
        .await
        .expect("archive");
    // No phase 2 exists on this branch — archive is quiesce plus the flip — so
    // the re-POST lands on the already-archived no-op immediately.
    let second = harness
        .service()
        .archive("ws-local", ArchiveOptions::default())
        .await
        .expect("re-archive");

    assert_eq!(
        first.record.lifecycle_state,
        WorkspaceLifecycleState::Archived
    );
    assert_eq!(
        second.record.lifecycle_state,
        WorkspaceLifecycleState::Archived
    );
    assert!(
        first.record.archived_head_sha.is_none(),
        "a local archive never snapshots, so the sha stays NULL"
    );
    assert!(
        path.join("hand-written.txt").exists(),
        "the user's own file must survive"
    );
    assert!(
        path.join(".git").exists(),
        "the user's own repository must survive"
    );
}

/// And back: unarchiving a local workspace is just the row flip.
#[tokio::test]
async fn unarchiving_a_local_workspace_is_just_the_row_flip() {
    let harness = Harness::new("local-back");
    let path = harness.local_workspace("ws-local");
    harness
        .service()
        .archive("ws-local", ArchiveOptions::default())
        .await
        .expect("archive");

    let outcome = harness
        .service()
        .unarchive("ws-local", UnarchiveOptions::default())
        .await
        .expect("unarchive");

    assert_eq!(
        outcome.record.lifecycle_state,
        WorkspaceLifecycleState::Active
    );
    assert!(path.join("hand-written.txt").exists());
}

/// A workspace whose directory is already gone archives cleanly as the
/// no-snapshot shape instead of failing forever. Without this branch it could
/// never be archived at all.
#[tokio::test]
async fn a_missing_directory_archives_as_the_no_snapshot_shape() {
    let harness = Harness::new("missing-dir");
    let path = harness.worktree_workspace("ws-1");
    std::fs::remove_dir_all(&path).expect("delete the directory by hand");

    let outcome = harness
        .service()
        .archive("ws-1", ArchiveOptions::default())
        .await
        .expect("archive a workspace with no directory");

    assert_eq!(
        outcome.record.lifecycle_state,
        WorkspaceLifecycleState::Archived
    );
    assert!(
        outcome.record.archived_head_sha.is_none(),
        "nothing was snapshotted, so the sha stays NULL"
    );
    assert_eq!(
        outcome.record.archived_branch.as_deref(),
        Some("ws-1"),
        "the branch is backfilled so the refs-missing tier has a tip to aim at"
    );
}

/// The same branch must NOT clobber an earlier generation. A sha-bearing row
/// whose directory later went missing keeps its sha (the refs are the only copy)
/// and keeps `archived_branch` NULL as the detached-at-archive marker.
#[tokio::test]
async fn a_missing_directory_never_clobbers_a_surviving_snapshot() {
    let harness = Harness::new("missing-dir-generation");
    let path = harness.worktree_workspace("ws-1");
    let sha = head_sha(&path);
    std::fs::remove_dir_all(&path).expect("delete the directory");
    // A detached archive: sha present, branch NULL.
    harness.force_archived("ws-1", Some(&sha), None);
    // The row reads archived, so re-POSTing lands on the convergence branch;
    // force it back to active to reach the missing-directory branch with a sha
    // already present, which is the crashed-restore shape.
    harness
        .service()
        .store_for_tests()
        .mark_active("ws-1", "2026-08-13T00:00:00Z")
        .expect("mark active");

    harness
        .service()
        .archive("ws-1", ArchiveOptions::default())
        .await
        .expect("archive");

    let row = harness.row("ws-1");
    assert_eq!(
        row.archived_head_sha.as_deref(),
        Some(sha.as_str()),
        "a surviving sha is the only copy and must be preserved"
    );
    assert!(
        row.archived_branch.is_none(),
        "an unconditional backfill would convert a detached archive into a fake branch archive"
    );
}

/// Unarchiving an already-active workspace with released columns is a no-op.
#[tokio::test]
async fn unarchiving_an_active_workspace_is_a_no_op() {
    let harness = Harness::new("unarchive-noop");
    let path = harness.worktree_workspace("ws-1");
    let before = status_porcelain(&path);

    let outcome = harness
        .service()
        .unarchive("ws-1", UnarchiveOptions::default())
        .await
        .expect("unarchive an active workspace");

    assert_eq!(
        outcome.record.lifecycle_state,
        WorkspaceLifecycleState::Active
    );
    assert!(outcome.notices.is_empty());
    assert_eq!(status_porcelain(&path), before);
}

/// A double-click during PHASE 1. The second POST queues on the gate, and
/// whichever way the race lands it must never answer T7 against a row the first
/// click just archived: the loser's bounded acquire either wins the gate after the
/// flip or times out and RE-READS, and both paths answer 200 archived.
#[tokio::test]
async fn two_concurrent_archives_both_answer_two_hundred_archived() {
    let harness = Harness::new("phase-one-double-click");
    let path = harness.worktree_workspace("ws-1");
    make_dirty(&path);
    let first = harness.service();
    let second = harness.service();

    let (a, b) = tokio::join!(
        async move { first.archive("ws-1", ArchiveOptions::default()).await },
        async move { second.archive("ws-1", ArchiveOptions::default()).await }
    );

    for outcome in [a, b] {
        let outcome = outcome.expect("neither click may answer in-flight");
        assert_eq!(
            outcome.record.lifecycle_state,
            WorkspaceLifecycleState::Archived,
            "an in-flight answer here would reinstate the sidebar row of an archived workspace"
        );
    }
    settle_for(&harness.service(), "ws-1").await;
    assert!(!path.exists(), "exactly one archive did the cleanup");
}

/// R3-5(b): `run_archive_script` bails on an empty or whitespace-only script.
/// R4's phase 2 is its first caller, and it skips empty scripts itself — this
/// pins the layer below so the two cannot disagree about what "no script" means.
#[tokio::test]
async fn the_archive_script_run_bails_on_an_empty_script() {
    let harness = Harness::new("empty-script");
    harness.worktree_workspace("ws-1");

    for script in ["", "   ", "\n\t "] {
        let error = harness
            .state
            .workspace_setup_runtime
            .run_archive_script("ws-1", script)
            .await
            .expect_err("an empty script must not run");
        assert!(
            error.to_string().to_lowercase().contains("command"),
            "expected the invalid-command bail, got {error}"
        );
    }
}

/// Wait for the detached phase-2 tail to finish.
///
/// Polls the token map rather than sleeping a fixed span: the tail's length is a
/// git call, not a constant, and a sleep long enough to be reliable on a loaded
/// machine is a sleep every run pays for. The registration's Drop is what clears
/// liveness, so this waits on the same signal the pre-gate fast path reads.
pub(super) async fn settle_for(service: &Arc<WorkspaceArchiveService>, workspace_id: &str) {
    for _ in 0..600 {
        if !service.phase2_live(workspace_id) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("phase 2 never finished for {workspace_id}");
}
