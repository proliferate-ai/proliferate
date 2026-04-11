use std::path::Path;
use std::process::Command;
use std::time::Instant;

use super::model::{ParsedRemote, ResolvedGitContext};

pub fn resolve_git_context(path: &str) -> anyhow::Result<ResolvedGitContext> {
    let canon = std::fs::canonicalize(path)
        .map_err(|e| anyhow::anyhow!("cannot resolve path '{}': {}", path, e))?;

    let repo_root = git_rev_parse(&canon, "--show-toplevel")?;

    let common_dir = git_rev_parse(&canon, "--git-common-dir").ok();
    let git_dir = git_rev_parse(&canon, "--git-dir").ok();

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

    let current_branch = git_rev_parse(&canon, "--abbrev-ref HEAD").ok();
    let remote_url = git_config_get(&canon, "remote.origin.url").ok();

    Ok(ResolvedGitContext {
        repo_root,
        is_worktree,
        main_worktree_path,
        current_branch,
        remote_url,
    })
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
