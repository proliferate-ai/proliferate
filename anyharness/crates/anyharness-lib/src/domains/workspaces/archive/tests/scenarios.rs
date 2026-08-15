//! One test per unarchive scenario: which shapes auto-resolve with no prompt,
//! which ones are a decision only the user can make, and what the answer to each
//! decision actually does.

use std::time::Duration;

use super::harness::{commit_on_top, git, git_stdout, head_sha, make_dirty, Harness};
use crate::domains::workspaces::archive::types::{
    ArchiveOptions, BranchStrategy, UnarchiveError, UnarchiveNotice, UnarchiveOptions,
    UnarchiveScenario, UnarchiveScenarioPayload, UnarchiveStrategy,
};
use crate::domains::workspaces::model::WorkspaceLifecycleState;

fn scenario(error: UnarchiveError) -> UnarchiveScenarioPayload {
    match error {
        UnarchiveError::Scenario(payload) => payload,
        other => panic!("expected a scenario 409, got {other:?}"),
    }
}

/// Archive, then stop the detached tail from removing anything, so the following
/// unarchive meets its own intact worktree. That is the Undo-mid-script shape,
/// reached here without a script.
async fn archive_leaving_the_worktree_intact(harness: &Harness, id: &str) {
    let service = harness.service();
    service
        .archive(id, ArchiveOptions::default())
        .await
        .expect("archive");
    // Firing the token before removal starts is exactly what the spec says makes
    // removal skip; awaiting the handle is what makes it deterministic.
    service.cancel_phase2(id).await_completion().await;
}

/// The old path holds our own intact worktree: restored in place, never removed.
#[tokio::test]
async fn an_intact_own_worktree_is_restored_in_place() {
    let harness = Harness::new("intact");
    let path = harness.worktree_workspace("ws-1");
    make_dirty(&path);
    std::fs::write(path.join(".gitignore"), "heavy/\n").expect("gitignore");
    std::fs::create_dir_all(path.join("heavy")).expect("ignored dir");
    std::fs::write(path.join("heavy/sentinel.bin"), "expensive\n").expect("sentinel");
    let inode_witness = path.join("heavy/sentinel.bin");
    archive_leaving_the_worktree_intact(&harness, "ws-1").await;
    assert!(path.exists(), "removal was skipped");

    let outcome = harness
        .service()
        .unarchive("ws-1", UnarchiveOptions::default())
        .await
        .expect("unarchive");

    assert_eq!(
        outcome.record.lifecycle_state,
        WorkspaceLifecycleState::Active
    );
    assert!(
        inode_witness.exists(),
        "an in-place restore never force-removes, so ignored state survives"
    );
}

/// The HEAD gate is load-bearing: with HEAD moved past the archived SHA an
/// in-place restore reads as one giant staged reversion against the wrong base,
/// so a failed gate falls THROUGH to the later tiers instead of restoring.
#[tokio::test]
async fn a_moved_head_falls_through_the_intact_tier() {
    let harness = Harness::new("head-gate");
    let path = harness.worktree_workspace("ws-1");
    make_dirty(&path);
    let archived_sha = head_sha(&path);
    archive_leaving_the_worktree_intact(&harness, "ws-1").await;
    // Somebody committed on the branch after the archive: HEAD no longer matches.
    git(&path, &["add", "-A"]);
    commit_on_top(&path, "after-archive.txt");
    assert_ne!(head_sha(&path), archived_sha);

    // The intact tier is skipped. The branch tiers now see a diverged branch,
    // which is a decision, not a silent restore against the wrong base.
    let payload = scenario(
        harness
            .service()
            .unarchive("ws-1", UnarchiveOptions::default())
            .await
            .expect_err("a diverged branch must 409 rather than restore"),
    );

    assert_eq!(payload.scenario, UnarchiveScenario::BranchDiverged);
}

/// A divergence created ON the intact worktree (what an archive script that
/// commits produces) must still 409 rather than restore quietly.
#[tokio::test]
async fn a_script_committed_divergence_on_the_intact_worktree_still_prompts() {
    let harness = Harness::new("intact-diverged");
    let path = harness.worktree_workspace("ws-1");
    make_dirty(&path);
    archive_leaving_the_worktree_intact(&harness, "ws-1").await;
    git(&path, &["add", "-A"]);
    commit_on_top(&path, "script-commit.txt");

    let payload = scenario(
        harness
            .service()
            .unarchive("ws-1", UnarchiveOptions::default())
            .await
            .expect_err("divergence must still prompt"),
    );

    assert_eq!(payload.scenario, UnarchiveScenario::BranchDiverged);
    assert_eq!(
        payload.strategies,
        vec![
            UnarchiveStrategy::RecreateAtSha,
            UnarchiveStrategy::RestoreDetached
        ]
    );
}

/// `recreate_at_sha` means a uniquified NEW branch at the archived SHA, never a
/// force-move: the diverged branch keeps its commits.
#[tokio::test]
async fn recreate_at_sha_makes_a_uniquified_branch_and_keeps_the_diverged_one() {
    let harness = Harness::new("recreate");
    let path = harness.worktree_workspace("ws-1");
    make_dirty(&path);
    archive_leaving_the_worktree_intact(&harness, "ws-1").await;
    git(&path, &["add", "-A"]);
    commit_on_top(&path, "script-commit.txt");
    let diverged_tip = head_sha(&path);

    let outcome = harness
        .service()
        .unarchive(
            "ws-1",
            UnarchiveOptions {
                branch_strategy: Some(BranchStrategy::RecreateAtSha),
                ..UnarchiveOptions::default()
            },
        )
        .await
        .expect("answered 409");

    assert_eq!(
        outcome.record.lifecycle_state,
        WorkspaceLifecycleState::Active
    );
    let branch = git_stdout(&path, &["rev-parse", "--abbrev-ref", "HEAD"]);
    assert_ne!(branch, "ws-1", "a NEW branch, not a force-move");
    assert_eq!(
        git_stdout(&harness.repo_root, &["rev-parse", "ws-1"]),
        diverged_tip,
        "the diverged branch keeps its commits"
    );
}

/// `restore_detached` answers the same 409 by detaching at the archived SHA.
#[tokio::test]
async fn restore_detached_answers_the_diverged_scenario_by_detaching() {
    let harness = Harness::new("detach-answer");
    let path = harness.worktree_workspace("ws-1");
    make_dirty(&path);
    let archived_sha = head_sha(&path);
    archive_leaving_the_worktree_intact(&harness, "ws-1").await;
    git(&path, &["add", "-A"]);
    commit_on_top(&path, "script-commit.txt");

    harness
        .service()
        .unarchive(
            "ws-1",
            UnarchiveOptions {
                branch_strategy: Some(BranchStrategy::RestoreDetached),
                ..UnarchiveOptions::default()
            },
        )
        .await
        .expect("answered 409");

    assert_eq!(head_sha(&path), archived_sha);
    assert_eq!(
        git_stdout(&path, &["rev-parse", "--abbrev-ref", "HEAD"]),
        "HEAD",
        "detached"
    );
}

/// The branch is gone: auto-resolved with no prompt by recreating it at the
/// archived SHA.
#[tokio::test]
async fn a_missing_branch_is_recreated_with_no_prompt() {
    let harness = Harness::new("branch-missing");
    let path = harness.worktree_workspace("ws-1");
    make_dirty(&path);
    let archived_sha = head_sha(&path);
    harness
        .service()
        .archive(
            "ws-1",
            ArchiveOptions {
                delete_branch: true,
                archive_script: None,
            },
        )
        .await
        .expect("archive");
    super::idempotency::settle_for(&harness.service(), "ws-1").await;

    let outcome = harness
        .service()
        .unarchive("ws-1", UnarchiveOptions::default())
        .await
        .expect("a missing branch auto-resolves");

    assert_eq!(
        outcome.record.lifecycle_state,
        WorkspaceLifecycleState::Active
    );
    assert_eq!(head_sha(&path), archived_sha);
}

/// Archived on a detached HEAD: `archived_branch` NULL alongside a present sha is
/// the marker, and the branch scenarios are skipped entirely.
#[tokio::test]
async fn a_detached_archive_restores_detached() {
    let harness = Harness::new("detached-archive");
    let path = harness.worktree_workspace("ws-1");
    let sha = head_sha(&path);
    git(&path, &["checkout", "--detach", &sha]);
    make_dirty(&path);

    let archived = harness
        .service()
        .archive("ws-1", ArchiveOptions::default())
        .await
        .expect("archive");
    assert!(
        archived.record.archived_branch.is_none(),
        "a detached archive records no branch — that IS the marker"
    );
    super::idempotency::settle_for(&harness.service(), "ws-1").await;
    let outcome = harness
        .service()
        .unarchive("ws-1", UnarchiveOptions::default())
        .await
        .expect("unarchive");

    assert_eq!(
        outcome.record.lifecycle_state,
        WorkspaceLifecycleState::Active
    );
    assert_eq!(head_sha(&path), sha);
    assert_eq!(
        git_stdout(&path, &["rev-parse", "--abbrev-ref", "HEAD"]),
        "HEAD"
    );
}

/// A sha-NULL row whose directory survives is ADOPTED in place: the directory may
/// hold the only copy of never-snapshotted work, so it is never wiped and never
/// prompts.
#[tokio::test]
async fn a_sha_null_row_with_a_surviving_directory_is_adopted_in_place() {
    let harness = Harness::new("adoption");
    let path = harness.worktree_workspace("ws-1");
    std::fs::write(path.join("only-copy.txt"), "irreplaceable\n").expect("write");
    harness.force_archived("ws-1", None, Some("ws-1"));

    let outcome = harness
        .service()
        .unarchive("ws-1", UnarchiveOptions::default())
        .await
        .expect("adopt");

    assert_eq!(
        outcome.record.lifecycle_state,
        WorkspaceLifecycleState::Active
    );
    assert!(
        path.join("only-copy.txt").exists(),
        "adoption keeps the directory exactly as-is"
    );
}

/// The refs are missing on a sha-NULL row (an absorbed pre-archiving row whose
/// directory is also gone): restored at the backfilled branch tip with a
/// `no_snapshot` notice.
#[tokio::test]
async fn a_row_with_no_snapshot_restores_at_the_branch_tip_with_a_notice() {
    let harness = Harness::new("no-snapshot");
    let path = harness.worktree_workspace("ws-1");
    let tip = head_sha(&path);
    git(
        &harness.repo_root,
        &["worktree", "remove", "--force", &path.display().to_string()],
    );
    harness.force_archived("ws-1", None, Some("ws-1"));

    let outcome = harness
        .service()
        .unarchive("ws-1", UnarchiveOptions::default())
        .await
        .expect("branch-tip restore");

    assert_eq!(
        outcome.record.lifecycle_state,
        WorkspaceLifecycleState::Active
    );
    assert!(
        outcome.notices.contains(&UnarchiveNotice::NoSnapshot),
        "the user is told the restore is a branch-tip checkout, not their state"
    );
    assert_eq!(head_sha(&path), tip);
}

/// The refs are gone but the row records a snapshot: ref loss, never a benign
/// case. A 409 `snapshot_lost` with an explicitly destructive answer, never the
/// silent branch-tip path.
#[tokio::test]
async fn a_lost_snapshot_is_a_scenario_not_a_silent_branch_tip_restore() {
    let harness = Harness::new("snapshot-lost");
    let path = harness.worktree_workspace("ws-1");
    make_dirty(&path);
    harness
        .service()
        .archive("ws-1", ArchiveOptions::default())
        .await
        .expect("archive");
    super::idempotency::settle_for(&harness.service(), "ws-1").await;
    // Simulate a crashed purge having eaten the refs.
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

    let payload = scenario(
        harness
            .service()
            .unarchive("ws-1", UnarchiveOptions::default())
            .await
            .expect_err("ref loss must be a decision"),
    );

    assert_eq!(payload.scenario, UnarchiveScenario::SnapshotLost);
    assert_eq!(
        payload.strategies,
        vec![UnarchiveStrategy::RestoreBranchTip]
    );

    // The answered restore is terminal for the snapshot, so it releases the
    // columns too — otherwise the surviving sha manufactures a false
    // `snapshot_lost` alarm on the NEXT unarchive of a healthy workspace.
    harness
        .service()
        .unarchive(
            "ws-1",
            UnarchiveOptions {
                branch_strategy: Some(BranchStrategy::RestoreBranchTip),
                ..UnarchiveOptions::default()
            },
        )
        .await
        .expect("answered snapshot_lost");
    let row = harness.row("ws-1");
    assert!(row.archived_head_sha.is_none(), "the columns were released");

    let next = harness
        .service()
        .unarchive("ws-1", UnarchiveOptions::default())
        .await
        .expect("the next unarchive is a plain no-op, never a fresh alarm");
    assert!(next.notices.is_empty());
}

/// An unclaimed foreign directory at the path: 409, then `overwrite: true`
/// force-removes it and restores. This is the one rm-rf in the feature that may
/// act outside the managed root, and it acts only behind an explicit confirm.
///
/// Reaching it requires a recorded path OUTSIDE the managed worktrees root, which
/// is the whole distinction between this tier and own-debris reclaim: inside the
/// root, a directory at the row's own path is that row's debris and is reclaimed
/// with no prompt. Outside it, the runtime never created that directory, so it
/// cannot assume the contents are its own to delete.
#[tokio::test]
async fn an_unclaimed_foreign_directory_prompts_then_yields_to_overwrite() {
    let harness = Harness::new("overwrite");
    let path = harness
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
            "ws-1",
            &path.display().to_string(),
            "HEAD",
        ],
    );
    harness.row_at("ws-1", &path);
    make_dirty(&path);
    harness
        .service()
        .archive("ws-1", ArchiveOptions::default())
        .await
        .expect("archive");
    super::idempotency::settle_for(&harness.service(), "ws-1").await;
    assert!(!path.exists(), "phase 2 freed the path");
    // Something unrelated now sits at the freed path, claimed by no row.
    std::fs::create_dir_all(&path).expect("recreate the path");
    std::fs::write(path.join("stranger.txt"), "not ours\n").expect("write stranger");

    let payload = scenario(
        harness
            .service()
            .unarchive("ws-1", UnarchiveOptions::default())
            .await
            .expect_err("an occupied path must prompt"),
    );
    assert_eq!(payload.scenario, UnarchiveScenario::PathOccupied);
    assert!(
        payload.occupant_name.is_none(),
        "no row claims it, so it is unnamed"
    );
    assert_eq!(payload.strategies, vec![UnarchiveStrategy::Overwrite]);
    assert!(
        path.join("stranger.txt").exists(),
        "the refusal removed nothing"
    );

    let outcome = harness
        .service()
        .unarchive(
            "ws-1",
            UnarchiveOptions {
                overwrite: true,
                ..UnarchiveOptions::default()
            },
        )
        .await
        .expect("confirmed overwrite");

    assert_eq!(
        outcome.record.lifecycle_state,
        WorkspaceLifecycleState::Active
    );
    assert!(
        !path.join("stranger.txt").exists(),
        "the confirm cleared the occupant"
    );
}

/// `rerun_setup` kicks off setup without making the response wait for it.
#[tokio::test]
async fn rerun_setup_does_not_make_the_response_wait() {
    let harness = Harness::new("rerun-setup");
    let path = harness.worktree_workspace("ws-1");
    make_dirty(&path);
    harness
        .service()
        .archive("ws-1", ArchiveOptions::default())
        .await
        .expect("archive");
    super::idempotency::settle_for(&harness.service(), "ws-1").await;

    let started = std::time::Instant::now();
    let outcome = harness
        .service()
        .unarchive(
            "ws-1",
            UnarchiveOptions {
                rerun_setup: true,
                setup_script: Some("sleep 30".to_string()),
                ..UnarchiveOptions::default()
            },
        )
        .await
        .expect("unarchive with a setup rerun");

    assert_eq!(
        outcome.record.lifecycle_state,
        WorkspaceLifecycleState::Active
    );
    assert!(
        started.elapsed() < Duration::from_secs(20),
        "the setup rerun is fire-and-return: took {:?}",
        started.elapsed()
    );
    // The fire-and-return script streams into a real PTY whose blocking reader
    // thread would hang this test's runtime at shutdown; closed explicitly, as
    // every other PTY-creating test in the house does.
    let _ = harness
        .state
        .terminal_service
        .close_all_for_workspace("ws-1")
        .await;
}
