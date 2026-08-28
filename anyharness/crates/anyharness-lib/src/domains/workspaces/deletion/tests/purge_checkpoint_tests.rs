//! Checkpoint-specific purge convergence regressions kept separate from the
//! established purge suite so neither file needs a line-ratchet exception.

use std::path::Path;
use std::process::Command;

use super::purge_harness::{session_record, Harness};
use crate::app::test_support;
use crate::domains::sessions::store::SessionStore;
use crate::domains::workspaces::deletion::purge::{WorkspacePurgeError, WorkspacePurgeOutcome};
use crate::domains::workspaces::operation_gate::WorkspaceOperationKind;

#[tokio::test(flavor = "multi_thread")]
async fn managed_worktree_purge_releases_checkpoint_objects_for_follow_up_gc() {
    let _env = test_support::lock_env().await;
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let harness = Harness::new("managed-checkpoint-gc");
    let workspace_id = "workspace-checkpoint-gc";
    let path = harness.worktree_workspace(workspace_id);
    std::fs::write(path.join("checkpoint-only.txt"), b"checkpoint-only bytes\n")
        .expect("write checkpoint-only file");

    let capture_lease = harness
        .state
        .workspace_operation_gate
        .acquire_shared(workspace_id, WorkspaceOperationKind::SessionPrompt)
        .await;
    let checkpoint = harness
        .state
        .workspace_checkpoint_service
        .capture_turn_start_under_workspace_lease(workspace_id, None, None)
        .await
        .expect("capture managed-worktree checkpoint");
    drop(capture_lease);

    let checkpoint_tree = checkpoint.work_tree_oid.clone();
    let checkpoint_blob = git_stdout(
        &harness.repo_root,
        &[
            "rev-parse",
            &format!("{checkpoint_tree}:checkpoint-only.txt"),
        ],
    );
    let checkpoint_only_oids = [checkpoint_tree, checkpoint_blob];
    assert!(
        !git_succeeds(
            &harness.repo_root,
            &["rev-parse", "HEAD:checkpoint-only.txt"]
        ),
        "the checkpoint-only blob must not be reachable from committed history"
    );
    assert!(
        checkpoint_only_oids
            .iter()
            .all(|oid| git_succeeds(&harness.repo_root, &["cat-file", "-e", oid])),
        "checkpoint refs must initially retain their private tree and blob"
    );
    assert_eq!(
        crate::domains::workspaces::checkpoints::refs::list_for_workspace(
            &harness.repo_root,
            workspace_id,
        )
        .expect("list checkpoint refs before purge")
        .len(),
        3
    );

    // Keep purge's detached inline GC from racing this deterministic proof.
    // Purge still drives the real managed-worktree cleanup and defers this
    // common repo for the follow-up GC exercised below.
    let claim_target = harness.repo_root.join("claimed-by-a-sibling-flow");
    let gc_guard = harness
        .state
        .workspace_archive_service
        .inflight_for_tests()
        .try_claim("sibling-workspace", &harness.repo_root, &claim_target)
        .expect("claim the common repo for a sibling flow");
    let outcome = harness
        .state
        .workspace_purge_service
        .purge(workspace_id)
        .await
        .expect("purge managed worktree with checkpoint");

    assert_eq!(
        outcome,
        WorkspacePurgeOutcome::Deleted {
            already_deleted: false
        }
    );
    assert!(!harness.workspace_row_exists(workspace_id));
    assert!(!path.exists(), "managed worktree checkout must be removed");
    assert!(
        harness.repo_root.exists(),
        "the common repository must remain available for follow-up GC"
    );
    assert!(
        harness
            .state
            .workspace_checkpoint_service
            .store_for_tests()
            .find_checkpoint(&checkpoint.id)
            .expect("find checkpoint after purge")
            .is_none(),
        "managed-worktree purge must delete checkpoint metadata"
    );
    assert!(
        crate::domains::workspaces::checkpoints::refs::list_for_workspace(
            &harness.repo_root,
            workspace_id,
        )
        .expect("list checkpoint refs after purge")
        .is_empty(),
        "managed-worktree purge must delete every private checkpoint ref"
    );
    assert!(
        checkpoint_only_oids
            .iter()
            .all(|oid| git_succeeds(&harness.repo_root, &["cat-file", "-e", oid])),
        "purge must leave unreachable checkpoint objects for the deferred GC handoff"
    );

    drop(gc_guard);
    run_git(
        &harness.repo_root,
        &[
            "-c",
            "gc.cruftPacks=false",
            "gc",
            "--prune=now",
            "--aggressive",
        ],
    );
    assert!(
        checkpoint_only_oids
            .iter()
            .all(|oid| !git_succeeds(&harness.repo_root, &["cat-file", "-e", oid])),
        "follow-up GC must reclaim checkpoint-only objects after purge removes their refs"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn local_purge_converges_after_the_repository_directory_is_already_gone() {
    let _env = test_support::lock_env().await;
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let harness = Harness::new("local-repo-already-gone");
    let workspace_id = "workspace-local-gone";
    let path = harness.local_workspace(workspace_id);
    let session_store = SessionStore::new(harness.state.db.clone());
    session_store
        .insert(&session_record("session-gone", workspace_id, None))
        .expect("insert local session");

    let capture_lease = harness
        .state
        .workspace_operation_gate
        .acquire_shared(workspace_id, WorkspaceOperationKind::SessionPrompt)
        .await;
    let checkpoint = harness
        .state
        .workspace_checkpoint_service
        .capture_turn_start_under_workspace_lease(workspace_id, None, None)
        .await
        .expect("capture checkpoint before external repository deletion");
    drop(capture_lease);
    assert!(harness
        .state
        .workspace_checkpoint_service
        .store_for_tests()
        .find_checkpoint(&checkpoint.id)
        .expect("find checkpoint before purge")
        .is_some());

    std::fs::remove_dir_all(&path).expect("model user deleting the local repository");
    let outcome = harness
        .state
        .workspace_purge_service
        .purge(workspace_id)
        .await
        .expect("missing local repository means checkpoint refs are already absent");

    assert_eq!(
        outcome,
        WorkspacePurgeOutcome::Deleted {
            already_deleted: false
        }
    );
    assert!(!harness.workspace_row_exists(workspace_id));
    assert!(!harness.session_row_exists("session-gone"));
    assert!(harness
        .state
        .workspace_checkpoint_service
        .store_for_tests()
        .find_checkpoint(&checkpoint.id)
        .expect("find checkpoint after purge")
        .is_none());
    assert!(
        !harness
            .state
            .workspace_archive_service
            .deferred_gc_for_tests()
            .iter()
            .any(|repo_root| repo_root == &path),
        "an absent repository must not enter the deferred GC queue"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn local_purge_inoperable_repo_keeps_expired_checkpoint_discoverable_for_retry() {
    let _env = test_support::lock_env().await;
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let harness = Harness::new("local-inoperable-checkpoint-retry");
    let workspace_id = "workspace-local-inoperable";
    let path = harness.local_workspace(workspace_id);

    let capture_lease = harness
        .state
        .workspace_operation_gate
        .acquire_shared(workspace_id, WorkspaceOperationKind::SessionPrompt)
        .await;
    let checkpoint = harness
        .state
        .workspace_checkpoint_service
        .capture_turn_start_under_workspace_lease(workspace_id, None, None)
        .await
        .expect("capture checkpoint before repository failure");
    drop(capture_lease);
    assert_eq!(
        crate::domains::workspaces::checkpoints::refs::list_for_workspace(&path, workspace_id)
            .expect("list checkpoint refs before repository failure")
            .len(),
        3
    );

    let disabled_git_dir = path.join("git-metadata-disabled");
    std::fs::rename(path.join(".git"), &disabled_git_dir)
        .expect("make the existing local repository inoperable");
    let error = harness
        .state
        .workspace_purge_service
        .purge(workspace_id)
        .await
        .expect_err("checkpoint ref cleanup must fail against an inoperable repository");

    assert!(matches!(
        error,
        WorkspacePurgeError::CheckpointCleanupFailed
    ));
    assert!(
        harness.workspace_row_exists(workspace_id),
        "failed cleanup must leave the workspace row available for retry"
    );
    assert!(
        path.exists(),
        "local purge must never remove the user-owned materialization"
    );
    let expired = harness
        .state
        .workspace_checkpoint_service
        .store_for_tests()
        .find_checkpoint(&checkpoint.id)
        .expect("find checkpoint after failed purge")
        .expect("failed ref cleanup must retain checkpoint metadata");
    assert!(
        expired.expired_at.is_some(),
        "failed ref cleanup must leave expired metadata for retry or retention"
    );

    std::fs::rename(&disabled_git_dir, path.join(".git"))
        .expect("repair the local repository for retry");
    assert_eq!(
        crate::domains::workspaces::checkpoints::refs::list_for_workspace(&path, workspace_id)
            .expect("list checkpoint refs after repository repair")
            .len(),
        3,
        "the failed cleanup must leave checkpoint refs for the retry"
    );

    let outcome = harness
        .state
        .workspace_purge_service
        .purge(workspace_id)
        .await
        .expect("retry purge after repository repair");
    assert_eq!(
        outcome,
        WorkspacePurgeOutcome::Deleted {
            already_deleted: false
        }
    );
    assert!(!harness.workspace_row_exists(workspace_id));
    assert!(
        path.exists(),
        "successful local purge must still preserve the user-owned materialization"
    );
    assert!(harness
        .state
        .workspace_checkpoint_service
        .store_for_tests()
        .find_checkpoint(&checkpoint.id)
        .expect("find checkpoint after retry")
        .is_none());
    assert!(
        crate::domains::workspaces::checkpoints::refs::list_for_workspace(&path, workspace_id)
            .expect("list checkpoint refs after retry")
            .is_empty(),
        "retry must finish checkpoint ref cleanup"
    );
}

fn run_git(cwd: &Path, args: &[&str]) {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("spawn git");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn git_stdout(cwd: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("spawn git");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

fn git_succeeds(cwd: &Path, args: &[&str]) -> bool {
    Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("spawn git")
        .status
        .success()
}
