//! The `delete_branch` guards.
//!
//! Deleting the repository's default branch is the one phase-2 mistake that is
//! not merely inconvenient, and git's own checked-out protection is gone by the
//! time the delete runs — the worktree that held the branch was just removed. So
//! both guards are the orchestrator's own, and both have a silent-failure mode
//! worth pinning: `detect_default_branch` must STRIP the `refs/remotes/origin/`
//! prefix (an unstripped ref path never equals a local branch name, so the guard
//! would never fire and would delete main), and it must fall back to the literal
//! main/master names on a repo that has no `origin/HEAD` at all.

use super::harness::{git, git_stdout, make_dirty, Harness};
use crate::domains::workspaces::archive::types::ArchiveOptions;

/// With a real `origin/HEAD` present: the default branch survives
/// `delete_branch: true`. This is the stripped-comparison case.
#[tokio::test]
async fn the_default_branch_survives_delete_branch_with_origin_head_present() {
    let harness = Harness::new("branch-default-origin");
    // A believable `origin/HEAD`, which is what a fresh clone has and what the
    // stripped comparison reads.
    git(
        &harness.repo_root,
        &["update-ref", "refs/remotes/origin/main", "HEAD"],
    );
    git(
        &harness.repo_root,
        &[
            "symbolic-ref",
            "refs/remotes/origin/HEAD",
            "refs/remotes/origin/main",
        ],
    );
    // The repo root moves off main so ONLY the default-branch guard is standing
    // between the knob and `main` — with main still checked out at the root, the
    // checked-out-elsewhere skip would protect it and this test would pass for
    // the wrong reason.
    free_main(&harness);
    let path = harness.worktree_workspace_on("ws-1", "main", false);
    make_dirty(&path);

    archive_deleting_the_branch(&harness, "ws-1").await;

    assert!(
        branch_exists(&harness, "main"),
        "an unstripped comparison never matches a local branch name and would delete main"
    );
}

/// The fallback case: no `origin/HEAD` at all (an older git, or a repo that was
/// never fetched). The literal main/master fallback is what protects it.
#[tokio::test]
async fn the_default_branch_survives_delete_branch_with_no_origin_head() {
    let harness = Harness::new("branch-default-fallback");
    free_main(&harness);
    let path = harness.worktree_workspace_on("ws-1", "main", false);
    assert!(
        git_stdout(
            &harness.repo_root,
            &["for-each-ref", "--format=%(refname)", "refs/remotes/"]
        )
        .is_empty(),
        "this test is only about the fallback, so there must be no remote refs"
    );
    make_dirty(&path);

    archive_deleting_the_branch(&harness, "ws-1").await;

    assert!(branch_exists(&harness, "main"), "main survives regardless");
}

/// A non-default branch checked out in ANOTHER worktree is skipped too: git's own
/// protection is gone once this workspace's worktree is removed, so the skip has
/// to be the orchestrator's.
#[tokio::test]
async fn a_branch_checked_out_in_another_worktree_is_not_deleted() {
    let harness = Harness::new("branch-checked-out");
    git(&harness.repo_root, &["branch", "shared"]);
    let path = harness.worktree_workspace_on("ws-1", "shared", false);
    make_dirty(&path);
    // A sibling worktree holding the same branch. `--force` is how that state is
    // reached deliberately; it is reached accidentally in the field whenever a
    // registration outlives the checkout that made it.
    let sibling = harness.managed_root().join("sibling");
    git(
        &harness.repo_root,
        &[
            "worktree",
            "add",
            "--force",
            &sibling.display().to_string(),
            "shared",
        ],
    );

    archive_deleting_the_branch(&harness, "ws-1").await;

    assert!(
        branch_exists(&harness, "shared"),
        "deleting a branch another worktree holds would leave that worktree on a dangling ref"
    );
    assert!(
        sibling.exists(),
        "and the sibling worktree is untouched either way"
    );
}

/// An ordinary feature branch with the knob set IS deleted — the positive control
/// without which every guard above could be passing for the wrong reason.
#[tokio::test]
async fn an_ordinary_branch_is_deleted_when_the_knob_is_set() {
    let harness = Harness::new("branch-ordinary");
    let path = harness.worktree_workspace("ws-1");
    make_dirty(&path);
    assert!(branch_exists(&harness, "ws-1"));

    archive_deleting_the_branch(&harness, "ws-1").await;

    assert!(
        !branch_exists(&harness, "ws-1"),
        "the knob has to actually delete something"
    );
}

async fn archive_deleting_the_branch(harness: &Harness, workspace_id: &str) {
    harness
        .service()
        .archive(
            workspace_id,
            ArchiveOptions {
                delete_branch: true,
                archive_script: None,
            },
        )
        .await
        .expect("archive");
    super::idempotency::settle_for(&harness.service(), workspace_id).await;
}

/// Move the repo root off `main` so the default-branch guard is the only thing
/// protecting it.
fn free_main(harness: &Harness) {
    git(&harness.repo_root, &["checkout", "-b", "root-holder"]);
}

fn branch_exists(harness: &Harness, branch: &str) -> bool {
    !git_stdout(
        &harness.repo_root,
        &[
            "for-each-ref",
            "--format=%(refname:short)",
            &format!("refs/heads/{branch}"),
        ],
    )
    .is_empty()
}
