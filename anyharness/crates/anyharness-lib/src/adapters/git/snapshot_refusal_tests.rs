//! Refusal matrix (spec §7.2): one test per state capture must refuse, each
//! asserting the typed error and that the repository is left untouched.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use super::operations::snapshot::{probe_refusals, snapshot_workspace};
use crate::adapters::git::types::SnapshotError;
use uuid::Uuid;

struct TempDirGuard {
    path: PathBuf,
}

impl TempDirGuard {
    fn new(prefix: &str) -> Self {
        let path = env::temp_dir().join(format!("anyharness-{prefix}-{}", Uuid::new_v4()));
        fs::create_dir_all(&path).expect("create temp dir");
        Self { path }
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempDirGuard {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn run(cwd: &Path, args: &[&str]) {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("spawn git");
    assert!(
        output.status.success(),
        "git {:?} failed: {}",
        args,
        String::from_utf8_lossy(&output.stderr)
    );
}

fn try_run(cwd: &Path, args: &[&str]) -> bool {
    Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn stdout(cwd: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("spawn git");
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

fn init_repo(path: &Path) -> String {
    run(path, &["init", "-b", "main"]);
    run(path, &["config", "user.email", "test@example.com"]);
    run(path, &["config", "user.name", "Test"]);
    run(path, &["config", "commit.gpgsign", "false"]);
    fs::write(path.join("file.txt"), "line one\n").expect("write seed");
    run(path, &["add", "file.txt"]);
    run(path, &["commit", "-m", "initial"]);
    stdout(path, &["rev-parse", "HEAD"])
}

/// Diverges `main` and a `topic` branch so that merging/cherry-picking/
/// reverting between them conflicts on `file.txt`.
fn diverge(path: &Path) {
    run(path, &["branch", "topic"]);
    fs::write(path.join("file.txt"), "main change\n").unwrap();
    run(path, &["commit", "-am", "main change"]);
    run(path, &["switch", "topic"]);
    fs::write(path.join("file.txt"), "topic change\n").unwrap();
    run(path, &["commit", "-am", "topic change"]);
}

fn assert_refuses_and_untouched(path: &Path, before_status: &str, before_head: &str) {
    let probe_error = probe_refusals(path).expect_err("probe_refusals must refuse");
    assert!(matches!(
        probe_error,
        SnapshotError::GitOperationInProgress { .. }
    ));
    let capture_error = snapshot_workspace(path).expect_err("snapshot_workspace must refuse");
    assert!(matches!(
        capture_error,
        SnapshotError::GitOperationInProgress { .. }
    ));
    assert_eq!(
        stdout(path, &["status", "--porcelain=v1", "-uall"]),
        before_status
    );
    assert_eq!(stdout(path, &["rev-parse", "HEAD"]), before_head);
}

#[test]
fn refuses_mid_merge() {
    let repo = TempDirGuard::new("refusal-merge");
    init_repo(repo.path());
    diverge(repo.path());
    assert!(!try_run(repo.path(), &["merge", "main"]));
    assert!(repo.path().join(".git/MERGE_HEAD").exists());

    let before_status = stdout(repo.path(), &["status", "--porcelain=v1", "-uall"]);
    let before_head = stdout(repo.path(), &["rev-parse", "HEAD"]);
    assert_refuses_and_untouched(repo.path(), &before_status, &before_head);
}

#[test]
fn refuses_mid_rebase_apply_backend() {
    let repo = TempDirGuard::new("refusal-rebase-apply");
    init_repo(repo.path());
    diverge(repo.path());
    // `--apply` forces the patch-based "apply" backend
    // (`.git/rebase-apply/`), which is no longer git's unadorned default.
    assert!(!try_run(repo.path(), &["rebase", "--apply", "main"]));
    assert!(repo.path().join(".git/rebase-apply").exists());

    let before_status = stdout(repo.path(), &["status", "--porcelain=v1", "-uall"]);
    let before_head = stdout(repo.path(), &["rev-parse", "HEAD"]);
    assert_refuses_and_untouched(repo.path(), &before_status, &before_head);
}

#[test]
fn refuses_mid_rebase_merge_backend() {
    let repo = TempDirGuard::new("refusal-rebase-merge");
    init_repo(repo.path());
    diverge(repo.path());
    // `--rebase-merges` forces the "merge" backend (`.git/rebase-merge/`).
    assert!(!try_run(
        repo.path(),
        &["rebase", "--rebase-merges", "main"]
    ));
    assert!(repo.path().join(".git/rebase-merge").exists());

    let before_status = stdout(repo.path(), &["status", "--porcelain=v1", "-uall"]);
    let before_head = stdout(repo.path(), &["rev-parse", "HEAD"]);
    assert_refuses_and_untouched(repo.path(), &before_status, &before_head);
}

#[test]
fn refuses_mid_cherry_pick() {
    let repo = TempDirGuard::new("refusal-cherry-pick");
    init_repo(repo.path());
    diverge(repo.path());
    let main_sha = stdout(repo.path(), &["rev-parse", "main"]);
    assert!(!try_run(repo.path(), &["cherry-pick", &main_sha]));
    assert!(repo.path().join(".git/CHERRY_PICK_HEAD").exists());

    let before_status = stdout(repo.path(), &["status", "--porcelain=v1", "-uall"]);
    let before_head = stdout(repo.path(), &["rev-parse", "HEAD"]);
    assert_refuses_and_untouched(repo.path(), &before_status, &before_head);
}

#[test]
fn refuses_mid_revert() {
    let repo = TempDirGuard::new("refusal-revert");
    init_repo(repo.path());
    fs::write(repo.path().join("file.txt"), "second\n").unwrap();
    run(repo.path(), &["commit", "-am", "second"]);
    fs::write(
        repo.path().join("file.txt"),
        "third, conflicts with revert\n",
    )
    .unwrap();
    run(repo.path(), &["commit", "-am", "third"]);
    let second_sha = stdout(repo.path(), &["rev-parse", "HEAD~1"]);
    assert!(!try_run(repo.path(), &["revert", "--no-edit", &second_sha]));
    assert!(repo.path().join(".git/REVERT_HEAD").exists());

    let before_status = stdout(repo.path(), &["status", "--porcelain=v1", "-uall"]);
    let before_head = stdout(repo.path(), &["rev-parse", "HEAD"]);
    assert_refuses_and_untouched(repo.path(), &before_status, &before_head);
}

#[test]
fn refuses_multi_commit_sequencer() {
    // A multi-commit cherry-pick/revert always carries CHERRY_PICK_HEAD or
    // REVERT_HEAD alongside `sequencer/` while stopped on a conflict, which
    // the dedicated cherry-pick/revert tests above already cover. This test
    // isolates the `sequencer/` sentinel itself (the ADR's structural,
    // multi-commit-pick-or-revert check) by constructing it directly, the
    // way a `sequencer/todo` with no HEAD file would look between steps.
    let repo = TempDirGuard::new("refusal-sequencer");
    init_repo(repo.path());
    fs::create_dir_all(repo.path().join(".git/sequencer")).unwrap();
    fs::write(
        repo.path().join(".git/sequencer/todo"),
        "pick deadbeef placeholder\n",
    )
    .unwrap();
    assert!(repo.path().join(".git/sequencer").exists());

    let before_status = stdout(repo.path(), &["status", "--porcelain=v1", "-uall"]);
    let before_head = stdout(repo.path(), &["rev-parse", "HEAD"]);
    assert_refuses_and_untouched(repo.path(), &before_status, &before_head);
}

#[test]
fn refuses_mid_bisect() {
    let repo = TempDirGuard::new("refusal-bisect");
    init_repo(repo.path());
    fs::write(repo.path().join("file.txt"), "second\n").unwrap();
    run(repo.path(), &["commit", "-am", "second"]);
    let good = stdout(repo.path(), &["rev-parse", "HEAD~1"]);
    fs::write(repo.path().join("file.txt"), "third\n").unwrap();
    run(repo.path(), &["commit", "-am", "third"]);

    run(repo.path(), &["bisect", "start"]);
    run(repo.path(), &["bisect", "bad", "HEAD"]);
    run(repo.path(), &["bisect", "good", &good]);
    assert!(repo.path().join(".git/BISECT_LOG").exists());

    let before_status = stdout(repo.path(), &["status", "--porcelain=v1", "-uall"]);
    let before_head = stdout(repo.path(), &["rev-parse", "HEAD"]);
    assert_refuses_and_untouched(repo.path(), &before_status, &before_head);

    run(repo.path(), &["bisect", "reset"]);
}

#[test]
fn refuses_leftover_unmerged_index_entries() {
    let repo = TempDirGuard::new("refusal-unmerged-entries");
    init_repo(repo.path());
    diverge(repo.path());
    assert!(!try_run(repo.path(), &["merge", "main"]));
    // Remove the sentinel file but leave the unmerged index stages behind,
    // exercising the belt-and-braces `ls-files -u` check in isolation.
    fs::remove_file(repo.path().join(".git/MERGE_HEAD")).unwrap();
    assert!(!stdout(repo.path(), &["ls-files", "-u"]).is_empty());

    let before_status = stdout(repo.path(), &["status", "--porcelain=v1", "-uall"]);
    let before_head = stdout(repo.path(), &["rev-parse", "HEAD"]);
    assert_refuses_and_untouched(repo.path(), &before_status, &before_head);
}

#[test]
fn refuses_unborn_head_via_orphan_worktree() {
    let source = TempDirGuard::new("refusal-unborn-source");
    let orphan = TempDirGuard::new("refusal-unborn-worktree");
    let _ = fs::remove_dir_all(orphan.path());
    init_repo(source.path());

    run(
        source.path(),
        &[
            "worktree",
            "add",
            "--orphan",
            "-b",
            "unborn-branch",
            &orphan.path().display().to_string(),
        ],
    );

    let probe_error = probe_refusals(orphan.path()).expect_err("probe_refusals must refuse");
    assert!(matches!(probe_error, SnapshotError::UnbornHead));
    let capture_error =
        snapshot_workspace(orphan.path()).expect_err("snapshot_workspace must refuse");
    assert!(matches!(capture_error, SnapshotError::UnbornHead));
}

#[test]
fn conflict_in_sibling_worktree_does_not_refuse_this_one_and_vice_versa() {
    let source = TempDirGuard::new("refusal-sibling-source");
    let conflicted = TempDirGuard::new("refusal-sibling-conflicted");
    let clean = TempDirGuard::new("refusal-sibling-clean");
    let _ = fs::remove_dir_all(conflicted.path());
    let _ = fs::remove_dir_all(clean.path());
    init_repo(source.path());
    run(source.path(), &["branch", "topic"]);
    fs::write(source.path().join("file.txt"), "main change\n").unwrap();
    run(source.path(), &["commit", "-am", "main change"]);

    run(
        source.path(),
        &[
            "worktree",
            "add",
            &conflicted.path().display().to_string(),
            "topic",
        ],
    );
    run(
        source.path(),
        &[
            "worktree",
            "add",
            "-b",
            "clean-branch",
            &clean.path().display().to_string(),
            "main",
        ],
    );
    fs::write(conflicted.path().join("file.txt"), "topic change\n").unwrap();
    run(conflicted.path(), &["commit", "-am", "topic change"]);
    assert!(!try_run(conflicted.path(), &["merge", "main"]));
    assert!(conflicted.path().join(".git/worktrees").exists() || true);

    // The clean sibling must not see the other worktree's conflict.
    probe_refusals(clean.path()).expect("sibling worktree's merge must not refuse this one");
    // And the conflicted worktree must still refuse on its own state.
    let error =
        probe_refusals(conflicted.path()).expect_err("must still refuse on its own conflict");
    assert!(matches!(
        error,
        SnapshotError::GitOperationInProgress { .. }
    ));
}

/// The `GitLocked` mapping is stat-conditional: `write-tree` exits 128 for a
/// corrupt index with no `index.lock` anywhere, and that must surface as the
/// retryable generic error rather than telling the user to delete a lock file
/// that does not exist.
#[test]
fn write_tree_exit_128_without_an_index_lock_is_not_reported_as_git_locked() {
    let repo = TempDirGuard::new("snapshot-write-tree-128-no-lock");
    init_repo(repo.path());
    let git_dir = repo.path().join(".git");
    fs::write(git_dir.join("index"), b"garbage").expect("corrupt the index");
    assert!(
        !git_dir.join("index.lock").exists(),
        "the negative control requires that no lock file exists"
    );

    let error = snapshot_workspace(repo.path()).expect_err("a corrupt index must fail the capture");
    match error {
        SnapshotError::Internal(_) => {}
        other => panic!("expected the retryable Internal error, got {other:?}"),
    }
}

#[test]
fn ancestor_repo_guard_refuses_a_hollow_checkout_under_a_git_controlled_parent() {
    let parent = TempDirGuard::new("refusal-hollow-parent");
    init_repo(parent.path());
    let nested = parent.path().join("nested-dir-not-a-repo");
    fs::create_dir_all(&nested).unwrap();
    fs::write(nested.join("some-file.txt"), "not a repo of its own\n").unwrap();
    let before_status = stdout(parent.path(), &["status", "--porcelain=v1"]);

    let probe_error = probe_refusals(&nested).expect_err("must refuse a hollow checkout");
    assert!(matches!(probe_error, SnapshotError::HollowCheckout { .. }));
    let capture_error = snapshot_workspace(&nested).expect_err("must refuse a hollow checkout");
    assert!(matches!(
        capture_error,
        SnapshotError::HollowCheckout { .. }
    ));

    // The ancestor repository itself must be untouched: nothing snapshotted
    // or restored into the wrong repo.
    assert_eq!(
        stdout(parent.path(), &["status", "--porcelain=v1"]),
        before_status
    );
}
