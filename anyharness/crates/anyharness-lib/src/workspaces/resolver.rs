use std::path::Path;
use std::process::Command;
use std::time::Instant;

use super::model::{ParsedRemote, ResolvedGitContext};
use crate::adapters::git::GitService;

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
        common_dir.and_then(|c| main_worktree_path_from_common_dir(Path::new(&c)))
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

fn main_worktree_path_from_common_dir(common_dir: &Path) -> Option<String> {
    if common_dir.file_name().is_some_and(|name| name == ".git") {
        return common_dir.parent().map(|path| path.display().to_string());
    }

    let mut current = common_dir;
    while let Some(parent) = current.parent() {
        if current.file_name().is_some_and(|name| name == ".git") {
            return current.parent().map(|path| path.display().to_string());
        }
        current = parent;
    }

    None
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
    GitService::create_worktree(source_repo_root, target_path, new_branch, base_branch)
}

pub fn create_mobility_git_worktree(
    source_repo_root: &str,
    target_path: &str,
    branch_name: &str,
    exact_ref: &str,
) -> anyhow::Result<()> {
    GitService::create_mobility_worktree(source_repo_root, target_path, branch_name, exact_ref)
}

pub fn prune_stale_worktrees_if_possible(cwd: &Path) {
    GitService::prune_stale_worktrees_if_possible(cwd);
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
