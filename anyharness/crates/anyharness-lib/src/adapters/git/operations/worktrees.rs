use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Instant;

pub struct GitWorktreeRemoveOutput {
    pub success: bool,
    pub stderr: String,
}

pub fn create_worktree(
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

pub fn create_mobility_worktree(
    source_repo_root: &str,
    target_path: &str,
    branch_name: &str,
    exact_ref: &str,
) -> anyhow::Result<()> {
    prune_stale_worktrees_if_possible(Path::new(source_repo_root));
    fetch_mobility_branch_if_possible(Path::new(source_repo_root), branch_name);
    ensure_ref_exists(Path::new(source_repo_root), exact_ref)?;

    if git_local_branch_exists(Path::new(source_repo_root), branch_name)? {
        let branch_ref = format!("refs/heads/{branch_name}");
        let local_branch_sha = git_rev_parse(Path::new(source_repo_root), &branch_ref)?;
        let exact_sha = git_rev_parse(Path::new(source_repo_root), exact_ref)?;
        if local_branch_sha != exact_sha {
            ensure_existing_branch_worktrees_clean(Path::new(source_repo_root), branch_name)?;
            fast_forward_existing_branch_to_ref(
                Path::new(source_repo_root),
                branch_name,
                &local_branch_sha,
                &exact_sha,
            )?;
        }
        ensure_existing_branch_worktrees_clean(Path::new(source_repo_root), branch_name)?;
        add_existing_branch_worktree(source_repo_root, target_path, branch_name)?;
        return Ok(());
    }

    create_worktree(source_repo_root, target_path, branch_name, Some(exact_ref))
}

pub fn prune_stale_worktrees_if_possible(cwd: &Path) {
    let _ = Command::new("git")
        .args(["worktree", "prune"])
        .current_dir(cwd)
        .output();
}

pub fn remove_worktree_force(
    repo_root_path: &str,
    worktree_path: &str,
) -> anyhow::Result<GitWorktreeRemoveOutput> {
    let output = Command::new("git")
        .args(["worktree", "remove", "--force", worktree_path])
        .current_dir(repo_root_path)
        .output()?;

    Ok(GitWorktreeRemoveOutput {
        success: output.status.success(),
        stderr: String::from_utf8_lossy(&output.stderr).trim().to_string(),
    })
}

pub fn ref_exists(repo_root: &Path, ref_name: &str) -> bool {
    Command::new("git")
        .args([
            "-C",
            &repo_root.display().to_string(),
            "rev-parse",
            "--verify",
            ref_name,
        ])
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

pub fn stdout_result(repo_root: &Path, args: &[&str]) -> anyhow::Result<String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(repo_root)
        .output()
        .map_err(|error| anyhow::anyhow!("git {:?} failed: {error}", args))?;
    if !output.status.success() {
        anyhow::bail!(
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

pub fn switch_to_existing_branch(workspace_path: &Path, branch_name: &str) -> anyhow::Result<()> {
    run_switch(workspace_path, &["switch", branch_name], branch_name)
}

pub fn switch_to_tracking_branch(
    workspace_path: &Path,
    branch_name: &str,
    upstream: &str,
) -> anyhow::Result<()> {
    run_switch(
        workspace_path,
        &["switch", "--track", "-c", branch_name, upstream],
        branch_name,
    )
}

fn run_switch(workspace_path: &Path, args: &[&str], branch_name: &str) -> anyhow::Result<()> {
    let output = Command::new("git")
        .args(["-C", &workspace_path.display().to_string()])
        .args(args)
        .output()?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        anyhow::bail!("failed to switch to branch '{branch_name}': {stderr}");
    }
    Ok(())
}

fn fetch_mobility_branch_if_possible(cwd: &Path, branch_name: &str) {
    let _ = Command::new("git")
        .args(["fetch", "origin", branch_name])
        .current_dir(cwd)
        .output();
}

fn ensure_ref_exists(cwd: &Path, exact_ref: &str) -> anyhow::Result<()> {
    git_rev_parse(cwd, &format!("--verify {exact_ref}^{{commit}}")).map(|_| ())
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

fn ensure_existing_branch_worktrees_clean(cwd: &Path, branch_name: &str) -> anyhow::Result<()> {
    for worktree_path in git_branch_worktree_paths(cwd, branch_name)? {
        let output = Command::new("git")
            .args(["status", "--porcelain", "--untracked-files=all"])
            .current_dir(&worktree_path)
            .output()
            .map_err(|e| anyhow::anyhow!("git status failed: {e}"))?;
        if !output.status.success() {
            anyhow::bail!(
                "git status failed for existing worktree {}: {}",
                worktree_path.display(),
                String::from_utf8_lossy(&output.stderr).trim()
            );
        }
        if !String::from_utf8_lossy(&output.stdout).trim().is_empty() {
            anyhow::bail!(
                "existing local branch {branch_name} has uncommitted changes in {}",
                worktree_path.display()
            );
        }
    }
    Ok(())
}

fn fast_forward_existing_branch_to_ref(
    cwd: &Path,
    branch_name: &str,
    current_sha: &str,
    exact_sha: &str,
) -> anyhow::Result<()> {
    if !git_is_ancestor(cwd, current_sha, exact_sha)? {
        anyhow::bail!(
            "existing local branch {branch_name} is at {current_sha}, not requested commit {exact_sha}; sync the branch before moving"
        );
    }

    let worktree_paths = git_branch_worktree_paths(cwd, branch_name)?;
    if worktree_paths.is_empty() {
        force_update_branch_ref(cwd, branch_name, exact_sha)?;
    } else {
        anyhow::bail!(
            "existing local branch {branch_name} is already checked out in another worktree; open that worktree or remove it before moving"
        );
    }

    let branch_ref = format!("refs/heads/{branch_name}");
    let updated_sha = git_rev_parse(cwd, &branch_ref)?;
    if updated_sha != exact_sha {
        anyhow::bail!(
            "existing local branch {branch_name} is at {updated_sha}, not requested commit {exact_sha}; sync the branch before moving"
        );
    }

    Ok(())
}

fn git_is_ancestor(cwd: &Path, ancestor_sha: &str, descendant_sha: &str) -> anyhow::Result<bool> {
    let output = Command::new("git")
        .args(["merge-base", "--is-ancestor", ancestor_sha, descendant_sha])
        .current_dir(cwd)
        .output()
        .map_err(|e| anyhow::anyhow!("git merge-base failed: {e}"))?;

    match output.status.code() {
        Some(0) => Ok(true),
        Some(1) => Ok(false),
        _ => anyhow::bail!(
            "git merge-base failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ),
    }
}

fn force_update_branch_ref(cwd: &Path, branch_name: &str, exact_sha: &str) -> anyhow::Result<()> {
    let output = Command::new("git")
        .args(["branch", "--force", branch_name, exact_sha])
        .current_dir(cwd)
        .output()
        .map_err(|e| anyhow::anyhow!("git branch --force failed: {e}"))?;

    if !output.status.success() {
        anyhow::bail!(
            "git branch --force failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }

    Ok(())
}

fn git_branch_worktree_paths(cwd: &Path, branch_name: &str) -> anyhow::Result<Vec<PathBuf>> {
    let output = Command::new("git")
        .args(["worktree", "list", "--porcelain"])
        .current_dir(cwd)
        .output()
        .map_err(|e| anyhow::anyhow!("git worktree list failed: {e}"))?;
    if !output.status.success() {
        anyhow::bail!(
            "git worktree list failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }

    let branch_ref = format!("refs/heads/{branch_name}");
    let mut current_path: Option<PathBuf> = None;
    let mut current_branch: Option<String> = None;
    let mut current_prunable = false;
    let mut paths = Vec::new();
    let mut flush_current =
        |path: &mut Option<PathBuf>, branch: &mut Option<String>, prunable: &mut bool| {
            if branch.as_deref() == Some(branch_ref.as_str()) && !*prunable {
                if let Some(path) = path.take() {
                    paths.push(path);
                }
            } else {
                let _ = path.take();
            }
            *branch = None;
            *prunable = false;
        };

    for line in String::from_utf8_lossy(&output.stdout).lines() {
        if let Some(path) = line.strip_prefix("worktree ") {
            flush_current(
                &mut current_path,
                &mut current_branch,
                &mut current_prunable,
            );
            current_path = Some(PathBuf::from(path));
            continue;
        }
        if let Some(branch) = line.strip_prefix("branch ") {
            current_branch = Some(branch.to_string());
            continue;
        }
        if line.starts_with("prunable") {
            current_prunable = true;
        }
    }
    flush_current(
        &mut current_path,
        &mut current_branch,
        &mut current_prunable,
    );
    Ok(paths)
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
        .args(["worktree", "add", target_path, branch_name])
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
