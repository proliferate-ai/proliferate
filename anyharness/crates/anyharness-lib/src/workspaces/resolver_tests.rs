use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use super::resolver::{create_mobility_git_worktree, resolve_git_context};
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

#[test]
fn resolve_git_context_uses_main_worktree_as_repo_root_for_linked_worktree() {
    let repo_root = TempDirGuard::new("resolver-main-worktree-root");
    let linked_worktree = TempDirGuard::new("resolver-linked-worktree");
    let _ = fs::remove_dir_all(linked_worktree.path());

    init_repo(repo_root.path());
    run_git(
        repo_root.path(),
        [
            "worktree",
            "add",
            "-b",
            "feature/linked",
            &linked_worktree.path().display().to_string(),
            "main",
        ],
    );

    let context = resolve_git_context(&linked_worktree.path().display().to_string())
        .expect("resolve linked worktree context");

    assert!(context.is_worktree);
    let expected_main_path = fs::canonicalize(repo_root.path())
        .expect("canonical repo root")
        .to_string_lossy()
        .to_string();
    assert_eq!(
        context.main_worktree_path.as_deref(),
        Some(expected_main_path.as_str())
    );
}

#[test]
fn create_mobility_git_worktree_fast_forwards_clean_existing_branch() {
    let repo_root = TempDirGuard::new("resolver-mobility-root");
    let worktree_root = TempDirGuard::new("resolver-mobility-target");
    let _ = fs::remove_dir_all(worktree_root.path());

    init_repo(repo_root.path());
    let initial_sha = git_stdout(repo_root.path(), ["rev-parse", "HEAD"]);
    run_git(
        repo_root.path(),
        ["branch", "feature/landing", initial_sha.trim()],
    );

    fs::write(repo_root.path().join("README.md"), "updated\n").expect("write update");
    run_git(repo_root.path(), ["add", "README.md"]);
    run_git(repo_root.path(), ["commit", "-m", "Update README"]);
    let updated_sha = git_stdout(repo_root.path(), ["rev-parse", "HEAD"]);

    create_mobility_git_worktree(
        &repo_root.path().display().to_string(),
        &worktree_root.path().display().to_string(),
        "feature/landing",
        updated_sha.trim(),
    )
    .expect("create mobility worktree");

    let checked_out_branch =
        git_stdout(worktree_root.path(), ["rev-parse", "--abbrev-ref", "HEAD"]);
    let checked_out_sha = git_stdout(worktree_root.path(), ["rev-parse", "HEAD"]);

    assert_eq!(checked_out_branch.trim(), "feature/landing");
    assert_eq!(checked_out_sha.trim(), updated_sha.trim());
}

#[test]
fn create_mobility_git_worktree_refuses_existing_branch_checked_out_elsewhere() {
    let repo_root = TempDirGuard::new("resolver-mobility-root-checked-out");
    let existing_worktree = TempDirGuard::new("resolver-mobility-existing");
    let new_worktree = TempDirGuard::new("resolver-mobility-new");
    let _ = fs::remove_dir_all(existing_worktree.path());
    let _ = fs::remove_dir_all(new_worktree.path());

    init_repo(repo_root.path());
    let initial_sha = git_stdout(repo_root.path(), ["rev-parse", "HEAD"]);
    run_git(
        repo_root.path(),
        ["branch", "feature/landing", initial_sha.trim()],
    );
    run_git(
        repo_root.path(),
        [
            "worktree",
            "add",
            &existing_worktree.path().display().to_string(),
            "feature/landing",
        ],
    );

    let error = create_mobility_git_worktree(
        &repo_root.path().display().to_string(),
        &new_worktree.path().display().to_string(),
        "feature/landing",
        initial_sha.trim(),
    )
    .expect_err("duplicate checked-out branch must be rejected");

    assert!(
        error.to_string().contains("already checked out")
            || error.to_string().contains("already used by worktree")
    );
}

#[test]
fn create_mobility_git_worktree_refuses_to_fast_forward_checked_out_branch() {
    let repo_root = TempDirGuard::new("resolver-mobility-root-checked-out-ff");
    let existing_worktree = TempDirGuard::new("resolver-mobility-existing-ff");
    let new_worktree = TempDirGuard::new("resolver-mobility-new-ff");
    let _ = fs::remove_dir_all(existing_worktree.path());
    let _ = fs::remove_dir_all(new_worktree.path());

    init_repo(repo_root.path());
    let initial_sha = git_stdout(repo_root.path(), ["rev-parse", "HEAD"]);
    run_git(
        repo_root.path(),
        ["branch", "feature/landing", initial_sha.trim()],
    );
    run_git(
        repo_root.path(),
        [
            "worktree",
            "add",
            &existing_worktree.path().display().to_string(),
            "feature/landing",
        ],
    );

    fs::write(repo_root.path().join("README.md"), "updated\n").expect("write update");
    run_git(repo_root.path(), ["add", "README.md"]);
    run_git(repo_root.path(), ["commit", "-m", "Update README"]);
    let updated_sha = git_stdout(repo_root.path(), ["rev-parse", "HEAD"]);

    let error = create_mobility_git_worktree(
        &repo_root.path().display().to_string(),
        &new_worktree.path().display().to_string(),
        "feature/landing",
        updated_sha.trim(),
    )
    .expect_err("checked-out branch must not be fast-forwarded behind the user's back");

    assert!(error.to_string().contains("already checked out"));
}

#[test]
fn create_mobility_git_worktree_refuses_dirty_existing_branch_worktree() {
    let repo_root = TempDirGuard::new("resolver-mobility-root-dirty");
    let existing_worktree = TempDirGuard::new("resolver-mobility-existing-dirty");
    let new_worktree = TempDirGuard::new("resolver-mobility-new-dirty");
    let _ = fs::remove_dir_all(existing_worktree.path());
    let _ = fs::remove_dir_all(new_worktree.path());

    init_repo(repo_root.path());
    let initial_sha = git_stdout(repo_root.path(), ["rev-parse", "HEAD"]);
    run_git(
        repo_root.path(),
        ["branch", "feature/landing", initial_sha.trim()],
    );
    run_git(
        repo_root.path(),
        [
            "worktree",
            "add",
            &existing_worktree.path().display().to_string(),
            "feature/landing",
        ],
    );
    fs::write(existing_worktree.path().join("DIRTY.md"), "dirty\n").expect("write dirty file");

    let error = create_mobility_git_worktree(
        &repo_root.path().display().to_string(),
        &new_worktree.path().display().to_string(),
        "feature/landing",
        initial_sha.trim(),
    )
    .expect_err("dirty branch worktree must block mobility destination");

    assert!(error.to_string().contains("uncommitted changes"));
}

#[test]
fn create_mobility_git_worktree_prunes_missing_branch_worktree_metadata() {
    let repo_root = TempDirGuard::new("resolver-mobility-root-prunable");
    let missing_worktree = TempDirGuard::new("resolver-mobility-missing");
    let new_worktree = TempDirGuard::new("resolver-mobility-new-after-prune");
    let _ = fs::remove_dir_all(missing_worktree.path());
    let _ = fs::remove_dir_all(new_worktree.path());

    init_repo(repo_root.path());
    let initial_sha = git_stdout(repo_root.path(), ["rev-parse", "HEAD"]);
    run_git(
        repo_root.path(),
        ["branch", "feature/return", initial_sha.trim()],
    );
    run_git(
        repo_root.path(),
        [
            "worktree",
            "add",
            &missing_worktree.path().display().to_string(),
            "feature/return",
        ],
    );
    fs::remove_dir_all(missing_worktree.path()).expect("remove linked worktree directory");

    create_mobility_git_worktree(
        &repo_root.path().display().to_string(),
        &new_worktree.path().display().to_string(),
        "feature/return",
        initial_sha.trim(),
    )
    .expect("create mobility worktree after pruning missing metadata");

    let checked_out_branch = git_stdout(new_worktree.path(), ["rev-parse", "--abbrev-ref", "HEAD"]);
    assert_eq!(checked_out_branch.trim(), "feature/return");
}

fn init_repo(path: &Path) {
    run_git(path, ["init", "-b", "main"]);
    run_git(path, ["config", "user.email", "codex@example.com"]);
    run_git(path, ["config", "user.name", "Codex"]);
    fs::write(path.join("README.md"), "seed\n").expect("write seed file");
    run_git(path, ["add", "README.md"]);
    run_git(path, ["commit", "-m", "Initial commit"]);
}

fn run_git<const N: usize>(cwd: &Path, args: [&str; N]) {
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

fn git_stdout<const N: usize>(cwd: &Path, args: [&str; N]) -> String {
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
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}
