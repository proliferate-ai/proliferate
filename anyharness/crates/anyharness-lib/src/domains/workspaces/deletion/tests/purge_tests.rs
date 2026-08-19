//! `deletion/purge.rs`'s own suite. The fixture — real `AppState`, real git
//! repositories, real worktrees — lives next door in `purge_harness.rs`.

use std::process::Command;

use super::purge_harness::{
    delete_admin_registration_only, pack_file_count, session_record, Harness,
};
use crate::app::test_support;
use crate::domains::sessions::store::SessionStore;
use crate::domains::workspaces::deletion::purge::{WorkspacePurgeError, WorkspacePurgeOutcome};

#[tokio::test(flavor = "multi_thread")]
async fn local_kind_purge_never_touches_the_directory_but_deletes_sessions_and_the_row() {
    let _env = test_support::lock_env();
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let harness = Harness::new("local-kind");
    let path = harness.local_workspace("workspace-local");
    let capture_service = harness.state.workspace_checkpoint_service.clone();
    let capture_lease = harness
        .state
        .workspace_operation_gate
        .acquire_shared(
            "workspace-local",
            crate::domains::workspaces::operation_gate::WorkspaceOperationKind::SessionPrompt,
        )
        .await;
    let checkpoint = capture_service
        .capture_turn_start_under_workspace_lease(
            "workspace-local",
            Some("session-1".to_string()),
            Some("prompt-1".to_string()),
        )
        .await
        .expect("capture local checkpoint");
    drop(capture_lease);
    let checkpoint_tree = checkpoint.work_tree_oid.clone();
    assert_ne!(
        checkpoint_tree, checkpoint.index_tree_oid,
        "the untracked user file makes the captured worktree tree checkpoint-only"
    );
    let checkpoint_blob = git_stdout(
        &path,
        &["rev-parse", &format!("{checkpoint_tree}:hand-written.txt")],
    );
    let checkpoint_only_oids = [checkpoint_tree, checkpoint_blob];
    assert!(
        !git_succeeds(&path, &["rev-parse", "HEAD:hand-written.txt"]),
        "the checkpoint-only blob must not be reachable from committed history"
    );
    assert!(
        checkpoint_only_oids
            .iter()
            .all(|oid| git_succeeds(&path, &["cat-file", "-e", oid])),
        "checkpoint refs must initially retain their private tree and blob"
    );
    assert_eq!(
        crate::domains::workspaces::checkpoints::refs::list_for_workspace(&path, "workspace-local")
            .expect("list local checkpoint refs")
            .len(),
        3
    );
    let session_store = SessionStore::new(harness.state.db.clone());
    session_store
        .insert(&session_record("session-1", "workspace-local", None))
        .expect("insert session");

    let outcome = harness
        .state
        .workspace_purge_service
        .purge("workspace-local")
        .await
        .expect("purge local workspace");

    assert_eq!(
        outcome,
        WorkspacePurgeOutcome::Deleted {
            already_deleted: false
        }
    );
    assert!(!harness.workspace_row_exists("workspace-local"));
    assert!(!harness.session_row_exists("session-1"));
    assert!(
        harness
            .state
            .workspace_checkpoint_service
            .store_for_tests()
            .find_checkpoint(&checkpoint.id)
            .expect("find checkpoint after purge")
            .is_none(),
        "local purge must delete checkpoint metadata"
    );
    assert!(
        crate::domains::workspaces::checkpoints::refs::list_for_workspace(&path, "workspace-local")
            .expect("list local checkpoint refs after purge")
            .is_empty(),
        "local purge must delete checkpoint refs"
    );
    let deferred = harness
        .state
        .workspace_archive_service
        .deferred_gc_for_tests();
    assert!(
        deferred.iter().any(|repo_root| repo_root == &path),
        "local checkpoint cleanup must hand its repo to deferred gc: {deferred:?}"
    );
    run_git(
        &path,
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
            .all(|oid| !git_succeeds(&path, &["cat-file", "-e", oid])),
        "once purge removes checkpoint refs, aggressive gc must reclaim checkpoint-only objects"
    );
    // The whole point of kind=local: the directory the user owns is never
    // touched, even though the row, sessions, and checkpoint copies are gone.
    assert!(path.exists(), "local checkout directory must survive purge");
    assert_eq!(
        std::fs::read(path.join("hand-written.txt")).expect("read surviving user file"),
        b"mine\n",
        "the user's own file bytes must survive checkpoint cleanup and gc"
    );
}

fn run_git(cwd: &std::path::Path, args: &[&str]) {
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

fn git_stdout(cwd: &std::path::Path, args: &[&str]) -> String {
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

fn git_succeeds(cwd: &std::path::Path, args: &[&str]) -> bool {
    Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("spawn git")
        .status
        .success()
}

#[tokio::test(flavor = "multi_thread")]
async fn purge_is_idempotent_when_the_row_is_already_gone() {
    let harness = Harness::new("idempotent");

    let outcome = harness
        .state
        .workspace_purge_service
        .purge("workspace-never-existed")
        .await
        .expect("purge a missing workspace");

    assert_eq!(
        outcome,
        WorkspacePurgeOutcome::Deleted {
            already_deleted: true
        }
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn purge_fails_closed_and_leaves_the_row_when_the_repo_root_record_is_missing() {
    let harness = Harness::new("repo-root-missing");
    harness.worktree_workspace("workspace-orphan-repo-root");
    // Delete the repo_root row out from under the workspace. Foreign keys
    // are toggled off only for this one statement, reproducing an orphan
    // reference without hand-rolling a schema fork.
    harness
        .state
        .db
        .with_conn(|conn| {
            conn.execute_batch("PRAGMA foreign_keys = OFF;")?;
            conn.execute("DELETE FROM repo_roots WHERE id = 'repo-root-1'", [])?;
            conn.execute_batch("PRAGMA foreign_keys = ON;")?;
            Ok(())
        })
        .expect("delete repo root out from under the workspace");

    let error = harness
        .state
        .workspace_purge_service
        .purge("workspace-orphan-repo-root")
        .await
        .expect_err("purge must fail when the repo root record is missing");

    assert!(matches!(error, WorkspacePurgeError::Failed(_)));
    // Every step before the row delete is idempotent and this failure never
    // reached one: a retried DELETE must still have a row to retry against.
    assert!(harness.workspace_row_exists("workspace-orphan-repo-root"));
}

#[tokio::test(flavor = "multi_thread")]
async fn purge_refuses_a_worktree_outside_the_managed_root_and_leaves_it_untouched() {
    let harness = Harness::new("unmanaged-root");
    let path = harness.unmanaged_worktree_workspace("workspace-unmanaged");

    let error = harness
        .state
        .workspace_purge_service
        .purge("workspace-unmanaged")
        .await
        .expect_err("purge must refuse a worktree outside the managed root");

    assert!(matches!(error, WorkspacePurgeError::Failed(_)));
    assert!(harness.workspace_row_exists("workspace-unmanaged"));
    assert!(
        path.exists(),
        "the unmanaged checkout must survive the refused purge"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn purge_converges_through_the_rm_rf_fallback_when_the_worktree_registration_is_dead() {
    let harness = Harness::new("exit-128-fallback");
    let path = harness.worktree_workspace("workspace-dead-registration");
    assert!(path.join("README.md").exists());

    // Corrupt just the admin registration; the checkout directory (and its
    // content) survives on disk — exactly the case a bare exit 128 cannot
    // distinguish from "nothing left at all", and exactly the case the
    // rm-rf fallback exists to converge on.
    delete_admin_registration_only(&harness.repo_root, &path);
    assert!(path.join("README.md").exists());

    let outcome = harness
        .state
        .workspace_purge_service
        .purge("workspace-dead-registration")
        .await
        .expect("purge must converge through the rm-rf fallback");

    assert_eq!(
        outcome,
        WorkspacePurgeOutcome::Deleted {
            already_deleted: false
        }
    );
    assert!(!harness.workspace_row_exists("workspace-dead-registration"));
    assert!(
        !path.exists(),
        "the fallback must actually remove the surviving directory"
    );
    let listing = String::from_utf8_lossy(
        &Command::new("git")
            .args(["worktree", "list", "--porcelain"])
            .current_dir(&harness.repo_root)
            .output()
            .expect("list worktrees")
            .stdout,
    )
    .to_string();
    assert!(
        !listing.contains(&path.display().to_string()),
        "the registration must be cleared after the fallback, got: {listing}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn purge_converges_on_an_archived_workspace_whose_checkout_is_already_gone() {
    // The ADR's headline flow: archive, then delete. An archived row has no
    // directory by construction, so if the containment guard treats an absent
    // path as "outside the managed root" every archived workspace becomes
    // permanently undeletable. Reverting the missing-directory early-out
    // turns this test red with `Failed("refusing to remove a worktree outside
    // the managed worktrees root")` and a surviving row.
    let harness = Harness::new("archived-checkout-gone");
    let path = harness.archived_worktree_workspace("workspace-archived");
    harness.seed_archive_refs("workspace-archived");
    let session_store = SessionStore::new(harness.state.db.clone());
    session_store
        .insert(&session_record("session-archived", "workspace-archived", None))
        .expect("insert session");
    assert!(!path.exists());
    assert_eq!(harness.archive_ref_names("workspace-archived").len(), 3);

    let outcome = harness
        .state
        .workspace_purge_service
        .purge("workspace-archived")
        .await
        .expect("purge must converge on an archived row with no checkout left");

    assert_eq!(
        outcome,
        WorkspacePurgeOutcome::Deleted {
            already_deleted: false
        }
    );
    assert!(!harness.workspace_row_exists("workspace-archived"));
    assert!(!harness.session_row_exists("session-archived"));
    // Every step past the guard actually ran: the refs died, not just the row.
    assert!(
        harness.archive_ref_names("workspace-archived").is_empty(),
        "purge must reach the ref delete: {:?}",
        harness.archive_ref_names("workspace-archived")
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_re_issued_purge_over_an_already_cleared_worktree_converges() {
    // Spec Tests bullet 3 and Done-when #1: killing the process mid-purge and
    // re-issuing DELETE converges, every time. The crash window this
    // reproduces is the one between the worktree removal and the ref delete —
    // checkout and registration gone, row still there — which is exactly the
    // state a retried DELETE has to walk through.
    let harness = Harness::new("cleared-worktree-reissue");
    let path = harness.worktree_workspace("workspace-cleared");
    harness.seed_archive_refs("workspace-cleared");
    harness.clear_checkout(&path);
    assert!(
        harness.workspace_row_exists("workspace-cleared"),
        "the row must survive the simulated crash; that is the whole contract"
    );

    let outcome = harness
        .state
        .workspace_purge_service
        .purge("workspace-cleared")
        .await
        .expect("a re-issued purge over an already-cleared worktree must converge");

    assert_eq!(
        outcome,
        WorkspacePurgeOutcome::Deleted {
            already_deleted: false
        }
    );
    assert!(!harness.workspace_row_exists("workspace-cleared"));
    assert!(harness.archive_ref_names("workspace-cleared").is_empty());

    // And a third DELETE, now that the row itself is gone, is the idempotent
    // no-op the contract promises rather than an error.
    let repeat = harness
        .state
        .workspace_purge_service
        .purge("workspace-cleared")
        .await
        .expect("a repeat DELETE on a deleted workspace must succeed");
    assert_eq!(
        repeat,
        WorkspacePurgeOutcome::Deleted {
            already_deleted: true
        }
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn purge_deletes_all_three_session_artifact_classes_and_the_row_dies_last() {
    let harness = Harness::new("three-artifact-classes");
    harness.worktree_workspace("workspace-artifacts");
    let session_id = "session-artifacts";
    let native_session_id = "native-artifacts";
    SessionStore::new(harness.state.db.clone())
        .insert(&session_record(
            session_id,
            "workspace-artifacts",
            Some(native_session_id),
        ))
        .expect("insert session");

    // Class 1: native JSONL rollout, under the runtime-home codex home so
    // this test never touches the real user's home directory.
    let sessions_root = harness
        .runtime_home()
        .join("agent-auth")
        .join("codex-native")
        .join("sessions");
    std::fs::create_dir_all(&sessions_root).expect("create codex sessions root");
    let rollout_path = sessions_root.join(format!("rollout-2026-08-13-{native_session_id}.jsonl"));
    std::fs::write(&rollout_path, "{}\n").expect("write rollout file");

    // Class 3: prompt attachment directory.
    let attachment_dir = harness
        .runtime_home()
        .join("attachments")
        .join("sessions")
        .join(session_id);
    std::fs::create_dir_all(&attachment_dir).expect("create attachment dir");
    std::fs::write(attachment_dir.join("attachment-1"), b"content").expect("write attachment");

    let outcome = harness
        .state
        .workspace_purge_service
        .purge("workspace-artifacts")
        .await
        .expect("purge with three artifact classes");

    assert_eq!(
        outcome,
        WorkspacePurgeOutcome::Deleted {
            already_deleted: false
        }
    );
    // Class 1: the native JSONL rollout file is gone.
    assert!(!rollout_path.exists(), "native JSONL rollout must be deleted");
    // Class 2: the session graph row is gone.
    assert!(!harness.session_row_exists(session_id));
    // Class 3: the prompt attachment directory is gone.
    assert!(!attachment_dir.exists(), "attachment directory must be deleted");
    // The row itself, deleted last of all.
    assert!(!harness.workspace_row_exists("workspace-artifacts"));
}

#[tokio::test(flavor = "multi_thread")]
async fn purge_skips_the_inline_gc_while_a_sibling_flow_is_in_flight_on_the_repo_root() {
    let harness = Harness::new("gc-skip-while-busy");
    harness.worktree_workspace("workspace-gc-skip");
    assert_eq!(
        pack_file_count(&harness.repo_root),
        0,
        "a freshly initialized repo must not already carry a pack"
    );

    // Claim the repo root the same way a live archive/unarchive flow would,
    // and hold the guard across the purge call.
    let claim_target = harness.repo_root.join("claimed-by-a-sibling-flow");
    let guard = harness
        .state
        .workspace_archive_service
        .inflight_for_tests()
        .try_claim("sibling-workspace", &harness.repo_root, &claim_target)
        .expect("claim the repo root for a sibling flow");

    harness
        .state
        .workspace_purge_service
        .purge("workspace-gc-skip")
        .await
        .expect("purge while a sibling flow holds the repo root");

    // Give a wrongly-unguarded inline gc a real window to run before
    // asserting its absence: if the busy-check regressed, this is the
    // negative control that would catch it (this is a behavioral proof, not
    // a presence assertion — reverting the guard makes this fail).
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    assert_eq!(
        pack_file_count(&harness.repo_root),
        0,
        "the inline gc must not run while a sibling flow holds the repo root"
    );

    drop(guard);
}

#[tokio::test(flavor = "multi_thread")]
async fn purge_enqueues_the_deferred_gc_even_when_the_inline_gc_is_skipped() {
    let harness = Harness::new("gc-enqueue-while-skipped");
    harness.worktree_workspace("workspace-gc-enqueue-skipped");
    let claim_target = harness.repo_root.join("claimed-by-a-sibling-flow");
    let guard = harness
        .state
        .workspace_archive_service
        .inflight_for_tests()
        .try_claim("sibling-workspace", &harness.repo_root, &claim_target)
        .expect("claim the repo root for a sibling flow");

    harness
        .state
        .workspace_purge_service
        .purge("workspace-gc-enqueue-skipped")
        .await
        .expect("purge while a sibling flow holds the repo root");

    let deferred = harness.state.workspace_archive_service.deferred_gc_for_tests();
    assert!(
        deferred.iter().any(|path| path == &harness.repo_root),
        "a skipped inline gc must still enqueue the repo root for the sweep's follow-up gc: {deferred:?}"
    );

    drop(guard);
}

#[tokio::test(flavor = "multi_thread")]
async fn purge_runs_the_inline_gc_and_still_enqueues_the_deferred_gc_when_the_repo_root_is_free() {
    let harness = Harness::new("gc-run-when-free");
    harness.worktree_workspace("workspace-gc-run");
    assert_eq!(pack_file_count(&harness.repo_root), 0);

    harness
        .state
        .workspace_purge_service
        .purge("workspace-gc-run")
        .await
        .expect("purge with a free repo root");

    // The inline gc is fire-and-forget (purge must never stall DELETE on a
    // big repo's gc), so poll with a bound instead of asserting instantly.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        if pack_file_count(&harness.repo_root) > 0 {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "the inline gc must run and produce a pack when the repo root is free"
        );
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }

    let deferred = harness.state.workspace_archive_service.deferred_gc_for_tests();
    assert!(
        deferred.iter().any(|path| path == &harness.repo_root),
        "the purge-time gc reclaims essentially nothing for the deleted snapshot; the sweep's \
         follow-up gc past the hour grace is enqueued regardless of whether the inline gc ran: {deferred:?}"
    );
}
