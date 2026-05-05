use std::path::Path;
use std::process::Command;
use std::time::Instant;

use super::model::{ParsedRemote, ResolvedGitContext};

const GIT_CONTEXT_SLOW_STEP_MS: u128 = 25;

pub fn resolve_git_context(path: &str) -> anyhow::Result<ResolvedGitContext> {
    let started = Instant::now();
    let canonicalize_started = Instant::now();
    let canon = std::fs::canonicalize(path)
        .map_err(|e| anyhow::anyhow!("cannot resolve path '{}': {}", path, e))?;
    log_git_context_step_if_slow(
        path,
        "canonicalize",
        canonicalize_started.elapsed().as_millis(),
        true,
    );

    let repo_root_started = Instant::now();
    let repo_root = git_rev_parse(&canon, "--show-toplevel")?;
    log_git_context_step_if_slow(
        path,
        "rev_parse_show_toplevel",
        repo_root_started.elapsed().as_millis(),
        true,
    );

    let common_dir_started = Instant::now();
    let common_dir_result = git_rev_parse(&canon, "--git-common-dir");
    log_git_context_step_if_slow(
        path,
        "rev_parse_git_common_dir",
        common_dir_started.elapsed().as_millis(),
        common_dir_result.is_ok(),
    );
    let common_dir = common_dir_result.ok();

    let git_dir_started = Instant::now();
    let git_dir_result = git_rev_parse(&canon, "--git-dir");
    log_git_context_step_if_slow(
        path,
        "rev_parse_git_dir",
        git_dir_started.elapsed().as_millis(),
        git_dir_result.is_ok(),
    );
    let git_dir = git_dir_result.ok();

    let is_worktree = match (&common_dir, &git_dir) {
        (Some(common), Some(git)) => {
            let common_canon = std::fs::canonicalize(common).unwrap_or_default();
            let git_canon = std::fs::canonicalize(git).unwrap_or_default();
            common_canon != git_canon
        }
        _ => false,
    };

    let main_worktree_path = if is_worktree {
        common_dir.and_then(|c| {
            let p = std::path::Path::new(&c);
            // .git/worktrees/../.. => repo root
            p.parent()
                .and_then(|p| p.parent())
                .map(|p| p.display().to_string())
        })
    } else {
        None
    };

    let branch_started = Instant::now();
    let current_branch_result = git_rev_parse(&canon, "--abbrev-ref HEAD");
    log_git_context_step_if_slow(
        path,
        "rev_parse_current_branch",
        branch_started.elapsed().as_millis(),
        current_branch_result.is_ok(),
    );
    let current_branch = current_branch_result.ok();

    let remote_started = Instant::now();
    let remote_url_result = git_config_get(&canon, "remote.origin.url");
    log_git_context_step_if_slow(
        path,
        "config_remote_origin_url",
        remote_started.elapsed().as_millis(),
        remote_url_result.is_ok(),
    );
    let remote_url = remote_url_result.ok();

    let total_elapsed_ms = started.elapsed().as_millis();
    if total_elapsed_ms >= GIT_CONTEXT_SLOW_STEP_MS {
        tracing::info!(
            path = %path,
            is_worktree,
            elapsed_ms = total_elapsed_ms,
            "[anyharness-latency] git_context.resolve_slow"
        );
    }

    Ok(ResolvedGitContext {
        repo_root,
        is_worktree,
        main_worktree_path,
        current_branch,
        remote_url,
    })
}

fn log_git_context_step_if_slow(path: &str, step: &str, elapsed_ms: u128, success: bool) {
    if elapsed_ms < GIT_CONTEXT_SLOW_STEP_MS {
        return;
    }
    tracing::info!(
        path = %path,
        step = step,
        success,
        elapsed_ms,
        "[anyharness-latency] git_context.step_slow"
    );
}

pub fn parse_remote_url(url: &str) -> Option<ParsedRemote> {
    // SSH: git@github.com:owner/repo.git
    if let Some(rest) = url.strip_prefix("git@") {
        let (host, path) = rest.split_once(':')?;
        let path = path.trim_end_matches(".git");
        let (owner, repo) = path.split_once('/')?;
        return Some(ParsedRemote {
            provider: host_to_provider(host),
            owner: owner.to_string(),
            repo: repo.to_string(),
        });
    }
    // HTTPS: https://github.com/owner/repo.git
    if let Ok(parsed) = url::Url::parse(url) {
        let host = parsed.host_str()?;
        let path = parsed
            .path()
            .trim_start_matches('/')
            .trim_end_matches(".git");
        let (owner, repo) = path.split_once('/')?;
        return Some(ParsedRemote {
            provider: host_to_provider(host),
            owner: owner.to_string(),
            repo: repo.to_string(),
        });
    }
    None
}

fn host_to_provider(host: &str) -> String {
    if host.contains("github") {
        "github".into()
    } else if host.contains("gitlab") {
        "gitlab".into()
    } else if host.contains("bitbucket") {
        "bitbucket".into()
    } else {
        host.to_string()
    }
}

pub fn create_git_worktree(
    source_repo_root: &str,
    target_path: &str,
    new_branch: &str,
    base_branch: Option<&str>,
) -> anyhow::Result<()> {
    let base = base_branch.unwrap_or("HEAD");
    let started = Instant::now();
    tracing::info!(
        source_repo_root = %source_repo_root,
        target_path = %target_path,
        new_branch = %new_branch,
        base_ref = %base,
        "[workspace-latency] workspace.worktree.git_add.start"
    );
    let output = Command::new("git")
        .args(["worktree", "add", "-b", new_branch, target_path, base])
        .current_dir(source_repo_root)
        .output()
        .map_err(|e| {
            tracing::warn!(
                source_repo_root = %source_repo_root,
                target_path = %target_path,
                new_branch = %new_branch,
                base_ref = %base,
                elapsed_ms = started.elapsed().as_millis(),
                error = %e,
                "[workspace-latency] workspace.worktree.git_add.failed_to_spawn"
            );
            anyhow::anyhow!("failed to run git worktree add: {e}")
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        tracing::warn!(
            source_repo_root = %source_repo_root,
            target_path = %target_path,
            new_branch = %new_branch,
            base_ref = %base,
            elapsed_ms = started.elapsed().as_millis(),
            stderr = %stderr.trim(),
            "[workspace-latency] workspace.worktree.git_add.failed"
        );
        anyhow::bail!("git worktree add failed: {}", stderr.trim());
    }
    tracing::info!(
        source_repo_root = %source_repo_root,
        target_path = %target_path,
        new_branch = %new_branch,
        base_ref = %base,
        elapsed_ms = started.elapsed().as_millis(),
        "[workspace-latency] workspace.worktree.git_add.success"
    );
    Ok(())
}

pub fn create_mobility_git_worktree(
    source_repo_root: &str,
    target_path: &str,
    branch_name: &str,
    exact_ref: &str,
) -> anyhow::Result<()> {
    if git_local_branch_exists(Path::new(source_repo_root), branch_name)? {
        add_existing_branch_worktree(source_repo_root, target_path, branch_name)?;
        git_reset_hard(Path::new(target_path), exact_ref)?;
        return Ok(());
    }

    create_git_worktree(source_repo_root, target_path, branch_name, Some(exact_ref))
}

fn git_rev_parse(cwd: &Path, args: &str) -> anyhow::Result<String> {
    let mut cmd = Command::new("git");
    cmd.arg("rev-parse");
    for part in args.split_whitespace() {
        cmd.arg(part);
    }
    let output = cmd
        .current_dir(cwd)
        .output()
        .map_err(|e| anyhow::anyhow!("git rev-parse failed: {e}"))?;

    if !output.status.success() {
        anyhow::bail!(
            "git rev-parse {} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn git_config_get(cwd: &Path, key: &str) -> anyhow::Result<String> {
    let output = Command::new("git")
        .args(["config", "--get", key])
        .current_dir(cwd)
        .output()
        .map_err(|e| anyhow::anyhow!("git config failed: {e}"))?;

    if !output.status.success() {
        anyhow::bail!("git config --get {} not set", key);
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn git_local_branch_exists(cwd: &Path, branch_name: &str) -> anyhow::Result<bool> {
    let output = Command::new("git")
        .args([
            "show-ref",
            "--verify",
            "--quiet",
            &format!("refs/heads/{branch_name}"),
        ])
        .current_dir(cwd)
        .output()
        .map_err(|e| anyhow::anyhow!("git show-ref failed: {e}"))?;

    match output.status.code() {
        Some(0) => Ok(true),
        Some(1) => Ok(false),
        _ => anyhow::bail!(
            "git show-ref failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ),
    }
}

fn add_existing_branch_worktree(
    source_repo_root: &str,
    target_path: &str,
    branch_name: &str,
) -> anyhow::Result<()> {
    let started = Instant::now();
    tracing::info!(
        source_repo_root = %source_repo_root,
        target_path = %target_path,
        branch_name = %branch_name,
        "[workspace-latency] workspace.worktree.git_add_existing.start"
    );
    let output = Command::new("git")
        .args(["worktree", "add", "--force", target_path, branch_name])
        .current_dir(source_repo_root)
        .output()
        .map_err(|e| {
            tracing::warn!(
                source_repo_root = %source_repo_root,
                target_path = %target_path,
                branch_name = %branch_name,
                elapsed_ms = started.elapsed().as_millis(),
                error = %e,
                "[workspace-latency] workspace.worktree.git_add_existing.failed_to_spawn"
            );
            anyhow::anyhow!("failed to run git worktree add: {e}")
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        tracing::warn!(
            source_repo_root = %source_repo_root,
            target_path = %target_path,
            branch_name = %branch_name,
            elapsed_ms = started.elapsed().as_millis(),
            stderr = %stderr.trim(),
            "[workspace-latency] workspace.worktree.git_add_existing.failed"
        );
        anyhow::bail!("git worktree add failed: {}", stderr.trim());
    }

    tracing::info!(
        source_repo_root = %source_repo_root,
        target_path = %target_path,
        branch_name = %branch_name,
        elapsed_ms = started.elapsed().as_millis(),
        "[workspace-latency] workspace.worktree.git_add_existing.success"
    );
    Ok(())
}

fn git_reset_hard(cwd: &Path, exact_ref: &str) -> anyhow::Result<()> {
    let output = Command::new("git")
        .args(["reset", "--hard", exact_ref])
        .current_dir(cwd)
        .output()
        .map_err(|e| anyhow::anyhow!("git reset --hard failed: {e}"))?;

    if !output.status.success() {
        anyhow::bail!(
            "git reset --hard {} failed: {}",
            exact_ref,
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use std::env;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::Command;

    use super::create_mobility_git_worktree;
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
    fn create_mobility_git_worktree_reuses_existing_branch_and_resets_to_exact_ref() {
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
    fn create_mobility_git_worktree_allows_existing_branch_checked_out_elsewhere() {
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

        fs::write(repo_root.path().join("README.md"), "updated\n").expect("write update");
        run_git(repo_root.path(), ["add", "README.md"]);
        run_git(repo_root.path(), ["commit", "-m", "Update README"]);
        let updated_sha = git_stdout(repo_root.path(), ["rev-parse", "HEAD"]);

        create_mobility_git_worktree(
            &repo_root.path().display().to_string(),
            &new_worktree.path().display().to_string(),
            "feature/landing",
            updated_sha.trim(),
        )
        .expect("create mobility worktree");

        let checked_out_branch =
            git_stdout(new_worktree.path(), ["rev-parse", "--abbrev-ref", "HEAD"]);
        let checked_out_sha = git_stdout(new_worktree.path(), ["rev-parse", "HEAD"]);

        assert_eq!(checked_out_branch.trim(), "feature/landing");
        assert_eq!(checked_out_sha.trim(), updated_sha.trim());
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
}
