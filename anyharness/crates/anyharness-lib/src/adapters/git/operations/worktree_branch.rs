use std::path::Path;
use std::process::Command;

/// The recreate-tier verb for R4's archive scenarios. Explicitly NOT
/// [`super::worktrees::create_worktree_at_ref`], whose fast-forward path
/// reaches `force_update_branch_ref` and runs `git branch --force` — the
/// force-move the diverged ruling bans. This verb only ever creates a new
/// branch name; it never moves, fetches, or fast-forwards an existing ref.
///
/// Returns the branch name actually created (e.g. `"feature-x-archived-2"`
/// when `desired_branch` already exists at a different SHA).
pub fn create_branch_at_sha_uniquified(
    source_repo_root: &Path,
    desired_branch: &str,
    sha: &str,
) -> anyhow::Result<String> {
    let mut candidate = desired_branch.to_string();
    for suffix in 2..1000 {
        if !branch_exists(source_repo_root, &candidate)? {
            create_branch(source_repo_root, &candidate, sha)?;
            return Ok(candidate);
        }
        if branch_sha(source_repo_root, &candidate)? == sha {
            // Already exists at the exact requested SHA: idempotent, reuse it.
            return Ok(candidate);
        }
        candidate = format!("{desired_branch}-archived-{suffix}");
    }
    anyhow::bail!("could not find a free branch name for '{desired_branch}'")
}

fn branch_exists(repo_root: &Path, branch_name: &str) -> anyhow::Result<bool> {
    let output = Command::new("git")
        .args([
            "show-ref",
            "--verify",
            "--quiet",
            &format!("refs/heads/{branch_name}"),
        ])
        .current_dir(repo_root)
        .output()
        .map_err(|error| anyhow::anyhow!("git show-ref failed: {error}"))?;
    match output.status.code() {
        Some(0) => Ok(true),
        Some(1) => Ok(false),
        _ => anyhow::bail!(
            "git show-ref failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ),
    }
}

fn branch_sha(repo_root: &Path, branch_name: &str) -> anyhow::Result<String> {
    let output = Command::new("git")
        .args(["rev-parse", &format!("refs/heads/{branch_name}")])
        .current_dir(repo_root)
        .output()
        .map_err(|error| anyhow::anyhow!("git rev-parse failed: {error}"))?;
    if !output.status.success() {
        anyhow::bail!(
            "git rev-parse failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn create_branch(repo_root: &Path, branch_name: &str, sha: &str) -> anyhow::Result<()> {
    let output = Command::new("git")
        .args(["branch", branch_name, sha])
        .current_dir(repo_root)
        .output()
        .map_err(|error| anyhow::anyhow!("git branch failed: {error}"))?;
    if !output.status.success() {
        anyhow::bail!(
            "git branch {branch_name} {sha} failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::process::Command;

    use super::create_branch_at_sha_uniquified;
    use crate::adapters::git::operations::worktrees::create_worktree_at_ref;

    struct TempDirGuard {
        path: PathBuf,
    }

    impl TempDirGuard {
        fn new(prefix: &str) -> Self {
            let path = std::env::temp_dir()
                .join(format!("anyharness-{prefix}-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&path).unwrap();
            Self { path }
        }

        fn path(&self) -> &std::path::Path {
            &self.path
        }
    }

    impl Drop for TempDirGuard {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn init_repo(path: &std::path::Path) -> (String, String) {
        run(path, &["init", "-b", "main"]);
        run(path, &["config", "user.email", "test@example.com"]);
        run(path, &["config", "user.name", "Test"]);
        fs::write(path.join("README.md"), "seed\n").unwrap();
        run(path, &["add", "README.md"]);
        run(path, &["commit", "-m", "first"]);
        let first = stdout(path, &["rev-parse", "HEAD"]);
        fs::write(path.join("README.md"), "second\n").unwrap();
        run(path, &["add", "README.md"]);
        run(path, &["commit", "-m", "second"]);
        let second = stdout(path, &["rev-parse", "HEAD"]);
        (first, second)
    }

    fn run(cwd: &std::path::Path, args: &[&str]) {
        let output = Command::new("git").args(args).current_dir(cwd).output().unwrap();
        assert!(output.status.success(), "{:?}", String::from_utf8_lossy(&output.stderr));
    }

    fn stdout(cwd: &std::path::Path, args: &[&str]) -> String {
        let output = Command::new("git").args(args).current_dir(cwd).output().unwrap();
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    #[test]
    fn uniquifies_against_an_existing_branch_at_a_different_sha_without_moving_it() {
        let repo = TempDirGuard::new("branch-at-sha-root");
        let (first, second) = init_repo(repo.path());
        run(repo.path(), &["branch", "feature-x", &first]);

        let created =
            create_branch_at_sha_uniquified(repo.path(), "feature-x", &second).expect("create");

        assert_eq!(created, "feature-x-archived-2");
        assert_eq!(stdout(repo.path(), &["rev-parse", "feature-x"]), first);
        assert_eq!(
            stdout(repo.path(), &["rev-parse", "feature-x-archived-2"]),
            second
        );
    }

    #[test]
    fn creates_directly_when_no_collision() {
        let repo = TempDirGuard::new("branch-at-sha-fresh");
        let (first, _second) = init_repo(repo.path());

        let created =
            create_branch_at_sha_uniquified(repo.path(), "feature-y", &first).expect("create");

        assert_eq!(created, "feature-y");
        assert_eq!(stdout(repo.path(), &["rev-parse", "feature-y"]), first);
    }

    /// Negative control against the banned shape: unlike
    /// `create_branch_at_sha_uniquified`, `create_worktree_at_ref` DOES
    /// force-move an existing branch (via its fast-forward path), which is
    /// exactly why the new verb exists for R4's recreate tiers.
    #[test]
    fn create_worktree_at_ref_force_moves_the_existing_branch_unlike_the_new_verb() {
        let repo = TempDirGuard::new("branch-at-sha-negative-control-root");
        let worktree = TempDirGuard::new("branch-at-sha-negative-control-worktree");
        fs::remove_dir_all(worktree.path()).unwrap();
        let (first, second) = init_repo(repo.path());
        run(repo.path(), &["branch", "feature-z", &first]);

        create_worktree_at_ref(
            &repo.path().display().to_string(),
            &worktree.path().display().to_string(),
            "feature-z",
            &second,
        )
        .expect("create_worktree_at_ref fast-forwards the existing branch");

        assert_eq!(
            stdout(repo.path(), &["rev-parse", "feature-z"]),
            second,
            "create_worktree_at_ref must have force-moved feature-z to the newer SHA"
        );
    }
}
