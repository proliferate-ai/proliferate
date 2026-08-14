//! Two interlocks the scenario suite cannot state on its own, because each one
//! is invisible unless the world is arranged against it.
//!
//! - A DETACHED restore lands `git worktree add --no-checkout --detach` at the
//!   SOURCE repo root's HEAD, so the repark to the archived SHA only becomes
//!   observable once the root has moved on.
//! - The TIER ORDER: an intact worktree already at the archived SHA is judged
//!   before the refs are consulted, so losing the refs under live uncommitted
//!   work cannot route it into a destructive confirm.

use super::harness::{
    commit_on_top, git, git_stdout, head_sha, make_dirty, status_porcelain, Harness,
};
use crate::domains::workspaces::archive::types::{ArchiveOptions, UnarchiveOptions};
use crate::domains::workspaces::model::WorkspaceLifecycleState;

/// Archive, then stop the detached tail from removing anything, so the following
/// unarchive meets its own intact worktree.
async fn archive_leaving_the_worktree_intact(harness: &Harness, id: &str) {
    let service = harness.service();
    service
        .archive(id, ArchiveOptions::default())
        .await
        .expect("archive");
    service.cancel_phase2(id).await_completion().await;
}

/// The interlock DEFER-R2-e asks about, pinned: a detached restore parks HEAD at
/// the archived SHA even when the SOURCE repo root has moved on.
///
/// `git worktree add --no-checkout --detach` lands the new worktree's HEAD at the
/// repo root's HEAD, not at anything this flow chose. With the root sitting at the
/// archived SHA — as it does in every other detached test here — that mistake is
/// invisible. Advancing the root first is what makes the repark observable, and
/// `--no-checkout` plus a HEAD-independent tree restore is why no phantom diff
/// survives it.
#[tokio::test]
async fn a_detached_unarchive_parks_head_at_the_archived_sha_when_the_repo_root_moved() {
    let harness = Harness::new("detached-interlock");
    let path = harness.worktree_workspace("ws-1");
    let archived_sha = head_sha(&path);
    git(&path, &["checkout", "--detach", &archived_sha]);
    make_dirty(&path);
    let dirt_before = status_porcelain(&path);
    harness
        .service()
        .archive("ws-1", ArchiveOptions::default())
        .await
        .expect("archive");
    super::idempotency::settle_for(&harness.service(), "ws-1").await;
    // The source repo root moves past the archived SHA.
    commit_on_top(&harness.repo_root, "root-advanced.txt");
    assert_ne!(
        head_sha(&harness.repo_root),
        archived_sha,
        "the root has to have moved for the repark to be what is under test"
    );

    harness
        .service()
        .unarchive("ws-1", UnarchiveOptions::default())
        .await
        .expect("unarchive");

    assert_eq!(
        head_sha(&path),
        archived_sha,
        "HEAD is reparked at the archived SHA, never left at the source root's"
    );
    assert_eq!(
        git_stdout(&path, &["rev-parse", "--abbrev-ref", "HEAD"]),
        "HEAD"
    );
    assert_eq!(
        status_porcelain(&path),
        dirt_before,
        "a HEAD left at the moved root would read as a phantom diff against the wrong base"
    );
}

/// FIX-R4-g: the refs are gone but our own intact worktree still stands at the
/// recorded path with HEAD at the archived SHA. That is ADOPTION, not
/// `snapshot_lost` — the files are already exactly what a restore would have
/// written, and `snapshot_lost`'s only strategy clears the very directory the
/// user's live work is standing in.
#[tokio::test]
async fn refs_missing_with_an_intact_worktree_adopts_instead_of_prompting_snapshot_lost() {
    let harness = Harness::new("intact-refs-lost");
    let path = harness.worktree_workspace("ws-1");
    make_dirty(&path);
    let archived_sha = head_sha(&path);
    archive_leaving_the_worktree_intact(&harness, "ws-1").await;
    assert!(
        path.exists(),
        "removal was skipped, so the worktree is intact"
    );
    // Uncommitted work that exists nowhere else, and a crashed purge that ate the
    // refs out from under it.
    std::fs::write(path.join("live-work.txt"), "in no snapshot anywhere\n").expect("write");
    for family in ["archive-heads", "archive-worktrees", "archive-indexes"] {
        git(
            &harness.repo_root,
            &[
                "update-ref",
                "-d",
                &format!("refs/proliferate/{family}/ws-1"),
            ],
        );
    }

    let outcome = harness
        .service()
        .unarchive("ws-1", UnarchiveOptions::default())
        .await
        .expect("an intact worktree is adopted, never routed into a destructive confirm");

    assert_eq!(
        outcome.record.lifecycle_state,
        WorkspaceLifecycleState::Active
    );
    assert!(
        path.join("live-work.txt").exists(),
        "nothing cleared the target path"
    );
    assert_eq!(head_sha(&path), archived_sha);
    let row = harness.row("ws-1");
    assert!(
        row.archived_head_sha.is_none(),
        "adoption is terminal for the snapshot, so the columns are released — a surviving sha \
         with no refs behind it manufactures a false snapshot_lost next time"
    );
    let next = harness
        .service()
        .unarchive("ws-1", UnarchiveOptions::default())
        .await
        .expect("the next unarchive is a plain no-op");
    assert!(next.notices.is_empty());
}
