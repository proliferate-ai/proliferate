use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::process::Command;

use uuid::Uuid;

use super::service::GitService;
use super::types::{GitRevertPatchEntry, GitRevertPatchOperation, GitRevertPatchesError};

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
    let repo = TempDirGuard::new("service-repo");
    run_git_cmd(repo.path(), ["init", "-b", "main"]);
    run_git_cmd(repo.path(), ["config", "user.email", "codex@example.com"]);
    run_git_cmd(repo.path(), ["config", "user.name", "Codex"]);
    repo
}

fn commit_file(repo: &Path, path: &str, content: &str, message: &str) {
    fs::write(repo.join(path), content).expect("write file");
    run_git_cmd(repo, ["add", path]);
    run_git_cmd(repo, ["commit", "-m", message]);
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
        .trim_end()
        .to_string()
}

fn run_git_cmd<const N: usize>(cwd: &Path, args: [&str; N]) {
    let _ = git_stdout(cwd, args);
}

#[test]
fn revert_patches_reverses_complete_edit_patch() {
    let repo = init_repo();
    commit_file(repo.path(), "README.md", "one\ntwo\n", "initial");
    fs::write(repo.path().join("README.md"), "one\nchanged\n").expect("write file");
    let patch = git_stdout(repo.path(), ["diff", "--", "README.md"]);

    let result = GitService::revert_patches(
        repo.path(),
        &[GitRevertPatchEntry {
            path: "README.md".to_string(),
            old_path: None,
            operation: GitRevertPatchOperation::Edit,
            patch,
            patch_truncated: false,
        }],
    )
    .expect("revert patch");

    assert_eq!(
        fs::read_to_string(repo.path().join("README.md")).unwrap(),
        "one\ntwo\n"
    );
    assert_eq!(result.reverted_paths, vec!["README.md"]);
    assert_eq!(result.head_oid_before, result.head_oid_after);
}

#[test]
fn revert_patches_rejects_staged_affected_path_without_mutating_index() {
    let repo = init_repo();
    commit_file(repo.path(), "README.md", "one\ntwo\n", "initial");
    fs::write(repo.path().join("README.md"), "one\nchanged\n").expect("write file");
    let patch = git_stdout(repo.path(), ["diff", "--", "README.md"]);
    run_git_cmd(repo.path(), ["add", "README.md"]);

    let error = GitService::revert_patches(
        repo.path(),
        &[GitRevertPatchEntry {
            path: "README.md".to_string(),
            old_path: None,
            operation: GitRevertPatchOperation::Edit,
            patch,
            patch_truncated: false,
        }],
    )
    .expect_err("staged path should be rejected");

    assert!(matches!(error, GitRevertPatchesError::StagedChanges { .. }));
    assert_eq!(
        fs::read_to_string(repo.path().join("README.md")).unwrap(),
        "one\nchanged\n"
    );
    assert_eq!(
        git_stdout(repo.path(), ["diff", "--cached", "--name-only"]),
        "README.md"
    );
}

#[test]
fn revert_patches_rejects_patch_header_path_mismatch_without_mutating() {
    let repo = init_repo();
    commit_file(repo.path(), "safe.txt", "safe\n", "initial safe");
    commit_file(repo.path(), "target.txt", "one\ntwo\n", "initial target");
    fs::write(repo.path().join("target.txt"), "one\nchanged\n").expect("write file");
    let patch = git_stdout(repo.path(), ["diff", "--", "target.txt"]);

    let error = GitService::revert_patches(
        repo.path(),
        &[GitRevertPatchEntry {
            path: "safe.txt".to_string(),
            old_path: None,
            operation: GitRevertPatchOperation::Edit,
            patch,
            patch_truncated: false,
        }],
    )
    .expect_err("mismatched patch header should be rejected");

    assert!(matches!(error, GitRevertPatchesError::PatchRejected { .. }));
    assert_eq!(
        fs::read_to_string(repo.path().join("target.txt")).unwrap(),
        "one\nchanged\n"
    );
    assert_eq!(
        fs::read_to_string(repo.path().join("safe.txt")).unwrap(),
        "safe\n"
    );
}

#[test]
fn revert_patches_rejects_stale_patch_without_mutating() {
    let repo = init_repo();
    commit_file(repo.path(), "README.md", "one\ntwo\n", "initial");
    fs::write(repo.path().join("README.md"), "one\nchanged\n").expect("write file");
    let patch = git_stdout(repo.path(), ["diff", "--", "README.md"]);
    fs::write(repo.path().join("README.md"), "one\nchanged again\n").expect("write file");

    let error = GitService::revert_patches(
        repo.path(),
        &[GitRevertPatchEntry {
            path: "README.md".to_string(),
            old_path: None,
            operation: GitRevertPatchOperation::Edit,
            patch,
            patch_truncated: false,
        }],
    )
    .expect_err("stale patch should be rejected");

    assert!(matches!(error, GitRevertPatchesError::PatchRejected { .. }));
    assert_eq!(
        fs::read_to_string(repo.path().join("README.md")).unwrap(),
        "one\nchanged again\n",
    );
}
