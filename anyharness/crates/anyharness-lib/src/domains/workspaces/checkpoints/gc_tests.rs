//! Checkpoint-ref reachability across ordinary Git GC. LFS object-store
//! pruning is a separate, founder-flagged question; this suite constructs the
//! exact parentless anchor-commit shape without invoking git-lfs.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use uuid::Uuid;

use super::refs;
use crate::adapters::git::operations::snapshot::snapshot_workspace;
use crate::adapters::git::operations::snapshot_restore::restore_trees;

struct TempDirGuard {
    path: PathBuf,
}

impl TempDirGuard {
    fn new(prefix: &str) -> Self {
        let path = std::env::temp_dir().join(format!("anyharness-{prefix}-{}", Uuid::new_v4()));
        fs::create_dir_all(&path).expect("create temp directory");
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

#[test]
fn parentless_anchor_checkpoint_round_trips_after_aggressive_git_gc() {
    let source = TempDirGuard::new("checkpoint-gc-source");
    let workspace = TempDirGuard::new("checkpoint-gc-workspace");
    fs::remove_dir_all(workspace.path()).expect("remove placeholder workspace directory");
    init_repo(source.path());
    add_linked_worktree(source.path(), workspace.path(), "captured");

    fs::write(workspace.path().join("README.md"), "unstaged bytes\n").expect("write tracked edit");
    fs::write(workspace.path().join("staged.txt"), "staged bytes\n").expect("write staged file");
    run(workspace.path(), &["add", "staged.txt"]);
    fs::write(workspace.path().join("untracked.txt"), "untracked bytes\n")
        .expect("write untracked file");

    let before_status = stdout(workspace.path(), &["status", "--porcelain=v1", "-uall"]);
    let before_readme = fs::read(workspace.path().join("README.md")).expect("read tracked edit");
    let before_staged = fs::read(workspace.path().join("staged.txt")).expect("read staged file");
    let before_untracked =
        fs::read(workspace.path().join("untracked.txt")).expect("read untracked file");
    let before_index = output(workspace.path(), &["show", ":staged.txt"]);

    let mut snapshot = snapshot_workspace(workspace.path()).expect("capture workspace snapshot");
    snapshot.work_tree_anchor = Some(parentless_anchor(
        workspace.path(),
        &snapshot.work_tree,
        "checkpoint worktree anchor",
    ));
    snapshot.index_tree_anchor = Some(parentless_anchor(
        workspace.path(),
        &snapshot.index_tree,
        "checkpoint index anchor",
    ));

    refs::write_checkpoint_refs(source.path(), "ws-gc", "cp-gc", &snapshot)
        .expect("write checkpoint refs");
    refs::verify_checkpoint_refs(source.path(), "ws-gc", "cp-gc", &snapshot)
        .expect("verify anchored checkpoint refs");

    let worktree_ref = "refs/proliferate/checkpoints/ws-gc/cp-gc/worktree";
    let index_ref = "refs/proliferate/checkpoints/ws-gc/cp-gc/index";
    let worktree_anchor = stdout(source.path(), &["rev-parse", worktree_ref]);
    let index_anchor = stdout(source.path(), &["rev-parse", index_ref]);
    assert_parentless_commit(source.path(), &worktree_anchor);
    assert_parentless_commit(source.path(), &index_anchor);
    assert_eq!(
        snapshot.work_tree_anchor.as_deref(),
        Some(worktree_anchor.as_str())
    );
    assert_eq!(
        snapshot.index_tree_anchor.as_deref(),
        Some(index_anchor.as_str())
    );

    remove_linked_worktree(source.path(), workspace.path());
    run(source.path(), &["gc", "--prune=now", "--aggressive"]);

    refs::verify_checkpoint_refs(source.path(), "ws-gc", "cp-gc", &snapshot)
        .expect("checkpoint refs and anchored trees survive aggressive gc");
    assert_eq!(
        stdout(source.path(), &["rev-parse", worktree_ref]),
        worktree_anchor
    );
    assert_eq!(
        stdout(source.path(), &["rev-parse", index_ref]),
        index_anchor
    );

    let restored = TempDirGuard::new("checkpoint-gc-restored");
    fs::remove_dir_all(restored.path()).expect("remove placeholder restore directory");
    add_linked_worktree(source.path(), restored.path(), "restored");
    restore_trees(restored.path(), &worktree_anchor, &index_anchor)
        .expect("restore checkpoint after aggressive gc");

    assert_eq!(
        fs::read(restored.path().join("README.md")).unwrap(),
        before_readme
    );
    assert_eq!(
        fs::read(restored.path().join("staged.txt")).unwrap(),
        before_staged
    );
    assert_eq!(
        fs::read(restored.path().join("untracked.txt")).unwrap(),
        before_untracked
    );
    assert_eq!(
        output(restored.path(), &["show", ":staged.txt"]),
        before_index
    );
    assert_eq!(
        stdout(restored.path(), &["status", "--porcelain=v1", "-uall"]),
        before_status
    );
}

fn init_repo(path: &Path) {
    run(path, &["init", "-b", "main"]);
    run(path, &["config", "user.email", "test@example.com"]);
    run(path, &["config", "user.name", "Test"]);
    run(path, &["config", "commit.gpgsign", "false"]);
    fs::write(path.join("README.md"), "seed\n").expect("write seed file");
    run(path, &["add", "README.md"]);
    run(path, &["commit", "-m", "initial"]);
}

fn add_linked_worktree(source: &Path, workspace: &Path, branch: &str) {
    run(
        source,
        &[
            "worktree",
            "add",
            "-b",
            branch,
            &workspace.display().to_string(),
            "HEAD",
        ],
    );
}

fn remove_linked_worktree(source: &Path, workspace: &Path) {
    run(
        source,
        &[
            "worktree",
            "remove",
            "--force",
            "--force",
            &workspace.display().to_string(),
        ],
    );
}

fn parentless_anchor(repo: &Path, tree: &str, message: &str) -> String {
    let result = Command::new("git")
        .current_dir(repo)
        .env("GIT_AUTHOR_NAME", "AnyHarness Checkpoint Test")
        .env("GIT_AUTHOR_EMAIL", "checkpoint-test@anyharness.local")
        .env("GIT_COMMITTER_NAME", "AnyHarness Checkpoint Test")
        .env("GIT_COMMITTER_EMAIL", "checkpoint-test@anyharness.local")
        .args([
            "-c",
            "commit.gpgsign=false",
            "commit-tree",
            tree,
            "-m",
            message,
        ])
        .output()
        .expect("create parentless anchor commit");
    assert!(
        result.status.success(),
        "git commit-tree failed: {}",
        String::from_utf8_lossy(&result.stderr)
    );
    String::from_utf8_lossy(&result.stdout).trim().to_string()
}

fn assert_parentless_commit(repo: &Path, oid: &str) {
    assert_eq!(stdout(repo, &["cat-file", "-t", oid]), "commit");
    assert_eq!(
        stdout(repo, &["rev-list", "--parents", "-n", "1", oid])
            .split_whitespace()
            .count(),
        1,
        "the checkpoint anchor must have no parent"
    );
}

fn run(cwd: &Path, args: &[&str]) {
    let result = Command::new("git")
        .current_dir(cwd)
        .args(args)
        .output()
        .expect("spawn git");
    assert!(
        result.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&result.stderr)
    );
}

fn output(cwd: &Path, args: &[&str]) -> Vec<u8> {
    let result = Command::new("git")
        .current_dir(cwd)
        .args(args)
        .output()
        .expect("spawn git");
    assert!(
        result.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&result.stderr)
    );
    result.stdout
}

fn stdout(cwd: &Path, args: &[&str]) -> String {
    String::from_utf8_lossy(&output(cwd, args))
        .trim()
        .to_string()
}
