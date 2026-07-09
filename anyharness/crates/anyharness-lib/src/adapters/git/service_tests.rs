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
fn stage_patch_stages_single_hunk_without_touching_worktree() {
    let repo = init_repo();
    commit_file(repo.path(), "file.txt", "one\ntwo\nthree\n", "initial");
    fs::write(repo.path().join("file.txt"), "one\nchanged\nthree\n").expect("write file");
    let patch = git_stdout(repo.path(), ["diff", "--", "file.txt"]);

    GitService::stage_patch(repo.path(), &format!("{patch}\n")).expect("stage patch");

    // Index has the change
    let staged = git_stdout(repo.path(), ["diff", "--cached", "--name-only"]);
    assert_eq!(staged, "file.txt");
    // Worktree unchanged (still has the edit)
    assert_eq!(
        fs::read_to_string(repo.path().join("file.txt")).unwrap(),
        "one\nchanged\nthree\n"
    );
    // No remaining unstaged diff
    assert_eq!(git_stdout(repo.path(), ["diff", "--name-only"]), "");
}

#[test]
fn stage_patch_stages_one_hunk_of_many() {
    let repo = init_repo();
    let base: String = (1..=20).map(|i| format!("line{i}\n")).collect();
    commit_file(repo.path(), "multi.txt", &base, "initial");
    let mut lines: Vec<String> = (1..=20).map(|i| format!("line{i}")).collect();
    lines[0] = "changed-top".to_string();
    lines[19] = "changed-bottom".to_string();
    fs::write(repo.path().join("multi.txt"), lines.join("\n") + "\n").expect("write file");

    let patch = git_stdout(repo.path(), ["diff", "--", "multi.txt"]);
    // Extract only the first hunk (headers + first @@ block), splitting on hunk
    // header lines.
    let mut kept_lines: Vec<&str> = Vec::new();
    let mut hunks_seen = 0usize;
    for line in patch.lines() {
        if line.starts_with("@@ ") {
            hunks_seen += 1;
            if hunks_seen > 1 {
                break;
            }
        }
        kept_lines.push(line);
    }
    assert!(hunks_seen >= 2, "expected two hunks");
    let single_hunk_patch = kept_lines.join("\n");

    GitService::stage_patch(repo.path(), &format!("{single_hunk_patch}\n"))
        .expect("stage single hunk");

    // Staged diff has the top change only
    let staged_diff = git_stdout(repo.path(), ["diff", "--cached"]);
    assert!(staged_diff.contains("changed-top"));
    assert!(!staged_diff.contains("changed-bottom"));
    // Unstaged diff still has the bottom change
    let unstaged_diff = git_stdout(repo.path(), ["diff"]);
    assert!(unstaged_diff.contains("changed-bottom"));
    assert!(!unstaged_diff.contains("changed-top"));
}

#[test]
fn unstage_patch_removes_hunk_from_index_without_touching_worktree() {
    let repo = init_repo();
    commit_file(repo.path(), "file.txt", "one\ntwo\nthree\n", "initial");
    fs::write(repo.path().join("file.txt"), "one\nchanged\nthree\n").expect("write file");
    run_git_cmd(repo.path(), ["add", "file.txt"]);
    let staged_patch = git_stdout(repo.path(), ["diff", "--cached", "--", "file.txt"]);

    GitService::unstage_patch(repo.path(), &format!("{staged_patch}\n")).expect("unstage patch");

    // Index no longer has the change
    assert_eq!(git_stdout(repo.path(), ["diff", "--cached", "--name-only"]), "");
    // Worktree still has the edit
    assert_eq!(
        fs::read_to_string(repo.path().join("file.txt")).unwrap(),
        "one\nchanged\nthree\n"
    );
    // Change now shows as unstaged
    assert_eq!(git_stdout(repo.path(), ["diff", "--name-only"]), "file.txt");
}

#[test]
fn stage_patch_rejects_stale_patch() {
    let repo = init_repo();
    commit_file(repo.path(), "file.txt", "one\ntwo\n", "initial");
    fs::write(repo.path().join("file.txt"), "one\nchanged\n").expect("write file");
    let patch = git_stdout(repo.path(), ["diff", "--", "file.txt"]);
    // Stage the change, making the captured patch stale relative to the index
    run_git_cmd(repo.path(), ["add", "file.txt"]);

    let error = GitService::stage_patch(repo.path(), &format!("{patch}\n"))
        .expect_err("stale patch should be rejected");
    assert!(!error.to_string().is_empty());
}

#[test]
fn stage_patch_rejects_empty_patch() {
    let repo = init_repo();
    commit_file(repo.path(), "file.txt", "one\n", "initial");

    let error = GitService::stage_patch(repo.path(), "  \n").expect_err("empty patch rejected");
    assert!(error.to_string().contains("empty"));
}

#[test]
fn stage_patch_stages_new_file_hunk() {
    let repo = init_repo();
    commit_file(repo.path(), "existing.txt", "hello\n", "initial");
    fs::write(repo.path().join("brand-new.txt"), "alpha\nbeta\n").expect("write file");
    // Untracked files do not appear in `git diff`; construct the new-file patch manually
    let patch = "diff --git a/brand-new.txt b/brand-new.txt\nnew file mode 100644\n--- /dev/null\n+++ b/brand-new.txt\n@@ -0,0 +1,2 @@\n+alpha\n+beta\n";

    GitService::stage_patch(repo.path(), patch).expect("stage new file patch");

    assert_eq!(
        git_stdout(repo.path(), ["diff", "--cached", "--name-only"]),
        "brand-new.txt"
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
