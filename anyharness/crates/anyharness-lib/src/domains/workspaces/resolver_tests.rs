use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use super::resolver::resolve_git_context;
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
