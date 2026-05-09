use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::process::Command;

use super::diff::{branch_diff_files, diff_for_path_with_scope};
use super::types::{GitDiffError, GitDiffScope, GitFileStatus};
use uuid::Uuid;

struct TempDirGuard {
    path: PathBuf,
}

impl TempDirGuard {
    fn new(prefix: &str) -> Self {
        loop {
            let path =
                std::env::temp_dir().join(format!("anyharness-git-{prefix}-{}", Uuid::new_v4()));
            match fs::create_dir(&path) {
                Ok(()) => return Self { path },
                Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
                Err(error) => panic!("create temp dir: {error}"),
            }
        }
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

fn init_repo() -> TempDirGuard {
    let repo = TempDirGuard::new("repo");
    run_git_cmd(repo.path(), ["init", "-b", "main"]);
    run_git_cmd(repo.path(), ["config", "user.email", "codex@example.com"]);
    run_git_cmd(repo.path(), ["config", "user.name", "Codex"]);
    repo
}

fn commit_file(repo: &Path, path: &str, content: &str, message: &str) -> String {
    fs::write(repo.join(path), content).expect("write file");
    run_git_cmd(repo, ["add", path]);
    run_git_cmd(repo, ["commit", "-m", message]);
    git_stdout(repo, ["rev-parse", "HEAD"])
}

fn git_stdout<const N: usize>(cwd: &Path, args: [&str; N]) -> String {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("spawn git");
    assert!(
        output.status.success(),
        "git failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout)
        .expect("utf8")
        .trim()
        .to_string()
}

fn run_git_cmd<const N: usize>(cwd: &Path, args: [&str; N]) {
    let _ = git_stdout(cwd, args);
}

#[test]
fn working_tree_scope_falls_back_to_staged_patch_and_stats() {
    let repo = init_repo();
    commit_file(repo.path(), "tracked.txt", "one\n", "initial");
    fs::write(repo.path().join("tracked.txt"), "one\ntwo\n").expect("write file");
    run_git_cmd(repo.path(), ["add", "tracked.txt"]);

    let diff = diff_for_path_with_scope(
        repo.path(),
        "tracked.txt",
        GitDiffScope::WorkingTree,
        None,
        None,
    )
    .expect("diff");

    assert_eq!(diff.scope, GitDiffScope::WorkingTree);
    assert!(diff.patch.as_deref().unwrap_or_default().contains("+two"));
    assert_eq!(diff.additions, 1);
    assert_eq!(diff.deletions, 0);
}

#[test]
fn branch_base_ref_rejects_revision_syntax() {
    let repo = init_repo();
    commit_file(repo.path(), "tracked.txt", "one\n", "initial");

    let error = branch_diff_files(repo.path(), Some("main^")).expect_err("invalid ref");

    assert!(matches!(error, GitDiffError::InvalidBaseRef));
}

#[test]
fn branch_base_ref_uses_remote_main_when_local_main_absent() {
    let repo = init_repo();
    let base_oid = commit_file(repo.path(), "tracked.txt", "one\n", "initial");
    run_git_cmd(repo.path(), ["checkout", "-b", "feature"]);
    run_git_cmd(repo.path(), ["branch", "-D", "main"]);
    run_git_cmd(
        repo.path(),
        ["update-ref", "refs/remotes/origin/main", &base_oid],
    );
    commit_file(repo.path(), "feature.txt", "feature\n", "feature");

    let response = branch_diff_files(repo.path(), Some("main")).expect("files");

    assert_eq!(response.base_ref, "origin/main");
    assert_eq!(response.files.len(), 1);
    assert_eq!(response.files[0].path, "feature.txt");
}

#[test]
fn branch_base_ref_does_not_let_tag_named_main_win() {
    let repo = init_repo();
    commit_file(repo.path(), "tracked.txt", "one\n", "initial");
    run_git_cmd(repo.path(), ["checkout", "-b", "feature"]);
    commit_file(repo.path(), "feature.txt", "feature\n", "feature");
    run_git_cmd(repo.path(), ["tag", "main"]);

    let response = branch_diff_files(repo.path(), Some("main")).expect("files");

    assert_eq!(response.base_ref, "main");
    assert!(response.files.iter().any(|file| file.path == "feature.txt"));
}

#[test]
fn branch_renamed_file_diff_uses_old_path_to_preserve_rename_patch() {
    let repo = init_repo();
    commit_file(repo.path(), "old.txt", "one\n", "initial");
    run_git_cmd(repo.path(), ["checkout", "-b", "feature"]);
    run_git_cmd(repo.path(), ["mv", "old.txt", "new.txt"]);
    run_git_cmd(repo.path(), ["commit", "-m", "rename"]);

    let files = branch_diff_files(repo.path(), Some("main")).expect("files");
    let renamed = files
        .files
        .iter()
        .find(|file| file.path == "new.txt")
        .expect("renamed file");
    assert_eq!(renamed.status, GitFileStatus::Renamed);
    assert_eq!(renamed.old_path.as_deref(), Some("old.txt"));

    let diff = diff_for_path_with_scope(
        repo.path(),
        "new.txt",
        GitDiffScope::Branch,
        Some("main"),
        Some("old.txt"),
    )
    .expect("diff");

    let patch = diff.patch.as_deref().unwrap_or_default();
    assert!(patch.contains("rename from old.txt"), "{patch}");
    assert!(patch.contains("rename to new.txt"), "{patch}");
}
