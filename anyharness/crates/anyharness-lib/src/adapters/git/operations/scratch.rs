//! Git operations for Workflow scratch placement and exact ensure/adopt
//! inspection (spec `workflow-workspace-placement`). "Scratch" is the product
//! meaning "no user repository," implemented by an internal blank Git
//! repository because current AnyHarness workspaces are Git-backed. The
//! inspection helpers let the Workspace domain verify an orphan artifact's shape
//! before adopting it — never a destructive cleanup to force a match.

use std::path::Path;
use std::process::Command;

/// A stable, AnyHarness-owned, non-personal Git identity for the scratch
/// initial commit. Persisted as repo-local config so later Workflow commits keep
/// the same non-personal identity.
pub const SCRATCH_IDENTITY_NAME: &str = "AnyHarness Workflow";
pub const SCRATCH_IDENTITY_EMAIL: &str = "workflow@anyharness.local";
pub const SCRATCH_INITIAL_BRANCH: &str = "main";
const SCRATCH_INITIAL_COMMIT_MESSAGE: &str = "Initialize workflow scratch workspace";

/// Initialize one blank local Git repository at `path`: initial branch `main`,
/// stable non-personal identity, exactly one empty initial commit, and no
/// remote. Fails closed; never touches an existing repository.
pub fn init_scratch_repository(path: &str) -> anyhow::Result<()> {
    std::fs::create_dir_all(path).map_err(|error| {
        anyhow::anyhow!("failed to create scratch workspace directory: {error}")
    })?;
    run(path, &["init", "-b", SCRATCH_INITIAL_BRANCH])?;
    run(path, &["config", "user.name", SCRATCH_IDENTITY_NAME])?;
    run(path, &["config", "user.email", SCRATCH_IDENTITY_EMAIL])?;
    run(path, &["config", "commit.gpgsign", "false"])?;
    run(
        path,
        &[
            "commit",
            "--allow-empty",
            "--no-gpg-sign",
            "-m",
            SCRATCH_INITIAL_COMMIT_MESSAGE,
        ],
    )?;
    Ok(())
}

/// The short symbolic branch name of `checkout_path`'s HEAD, or `None` when the
/// HEAD is detached.
pub fn current_branch(checkout_path: &Path) -> anyhow::Result<Option<String>> {
    let output = Command::new("git")
        .args(["symbolic-ref", "--quiet", "--short", "HEAD"])
        .current_dir(checkout_path)
        .output()
        .map_err(|error| anyhow::anyhow!("git symbolic-ref failed: {error}"))?;
    if output.status.success() {
        Ok(Some(
            String::from_utf8_lossy(&output.stdout).trim().to_string(),
        ))
    } else {
        Ok(None)
    }
}

/// The number of commits reachable from HEAD.
pub fn head_commit_count(checkout_path: &Path) -> anyhow::Result<u64> {
    let count = stdout(checkout_path, &["rev-list", "--count", "HEAD"])?;
    count
        .trim()
        .parse::<u64>()
        .map_err(|error| anyhow::anyhow!("unexpected git rev-list count output: {error}"))
}

/// Whether the repository at `checkout_path` has no configured remotes.
pub fn has_no_remotes(checkout_path: &Path) -> anyhow::Result<bool> {
    Ok(stdout(checkout_path, &["remote"])?.trim().is_empty())
}

/// Whether HEAD points at an empty tree (an empty initial commit).
pub fn head_tree_is_empty(checkout_path: &Path) -> anyhow::Result<bool> {
    // The well-known empty tree object hash. `git write-tree` of an empty index
    // yields this; comparing HEAD^{tree} against it proves the commit is empty
    // without depending on the working tree state.
    let tree = stdout(checkout_path, &["rev-parse", "HEAD^{tree}"])?;
    Ok(tree.trim() == "4b825dc642cb6eb9a060e54bf8d69288fbee4904")
}

/// The absolute common git directory of a worktree (shared with its source
/// repository). Used to prove an orphan worktree belongs to the expected repo.
pub fn common_git_dir(checkout_path: &Path) -> anyhow::Result<String> {
    stdout(
        checkout_path,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )
}

/// Whether `checkout_path` is a linked worktree (not the primary checkout).
///
/// Both the common dir and this checkout's own git dir are resolved in the
/// absolute path format: a bare `--git-common-dir` can be relative (`.git`)
/// while `--absolute-git-dir` is absolute, so comparing them directly makes a
/// primary checkout look linked. In absolute form a primary checkout's git dir
/// equals its common dir; only a linked worktree differs.
pub fn is_linked_worktree(checkout_path: &Path) -> anyhow::Result<bool> {
    let common = stdout(
        checkout_path,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )?;
    let git_dir = stdout(
        checkout_path,
        &["rev-parse", "--path-format=absolute", "--absolute-git-dir"],
    )?;
    let common = canonical(common.trim());
    let git_dir = canonical(git_dir.trim());
    Ok(common != git_dir)
}

/// Whether the repository at `checkout_path` carries the stable AnyHarness
/// scratch identity in its repo-local config (name and email). Part of the
/// exact scratch initialization contract proved before orphan adoption.
pub fn scratch_identity_matches(checkout_path: &Path) -> anyhow::Result<bool> {
    let name = config_value(checkout_path, "user.name")?;
    let email = config_value(checkout_path, "user.email")?;
    Ok(name.as_deref() == Some(SCRATCH_IDENTITY_NAME)
        && email.as_deref() == Some(SCRATCH_IDENTITY_EMAIL))
}

/// Read a repo-local config value, returning `None` when it is unset.
fn config_value(checkout_path: &Path, key: &str) -> anyhow::Result<Option<String>> {
    let output = Command::new("git")
        .args(["config", "--local", "--get", key])
        .current_dir(checkout_path)
        .output()
        .map_err(|error| anyhow::anyhow!("failed to run git config: {error}"))?;
    match output.status.code() {
        Some(0) => Ok(Some(
            String::from_utf8_lossy(&output.stdout).trim().to_string(),
        )),
        // Exit code 1 = key not present; treat as unset rather than an error.
        Some(1) => Ok(None),
        _ => anyhow::bail!("git config --get {key} failed"),
    }
}

/// Canonicalize a path string for comparison, falling back to the raw value
/// when the path does not resolve.
fn canonical(path: &str) -> std::path::PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| Path::new(path).to_path_buf())
}

fn run(cwd: &str, args: &[&str]) -> anyhow::Result<()> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|error| anyhow::anyhow!("failed to run git {:?}: {error}", args))?;
    if !output.status.success() {
        anyhow::bail!(
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(())
}

fn stdout(cwd: &Path, args: &[&str]) -> anyhow::Result<String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|error| anyhow::anyhow!("failed to run git {:?}: {error}", args))?;
    if !output.status.success() {
        anyhow::bail!(
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}
