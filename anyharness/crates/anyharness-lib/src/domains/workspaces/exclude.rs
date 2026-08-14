//! The one runtime-written git exclude entry: a root-relative
//! `/.proliferate/` line in the clone's SHARED `info/exclude`. Worktrees
//! share the common `.git` dir's exclude file, so one write covers the root
//! checkout and every worktree cut from that clone, and it never touches the
//! user's `.gitignore`. Idempotent: repeated calls write the entry once.

use std::path::{Path, PathBuf};
use std::process::Command;

/// Root-relative so it matches only the top-level `.proliferate/` folder in
/// each checkout, exactly like the server-side materialization precedent.
pub const PROLIFERATE_EXCLUDE_ENTRY: &str = "/.proliferate/";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExcludeOutcome {
    /// The entry was appended to `info/exclude`.
    Written,
    /// The entry was already present; nothing changed.
    AlreadyPresent,
    /// The path is not inside a git repository; there is nothing to exclude
    /// from. Not an error: non-git workspaces still materialize context.
    NotAGitRepo,
}

/// Ensure the shared `info/exclude` of the clone containing `workspace_root`
/// carries the `/.proliferate/` entry.
pub fn ensure_proliferate_excluded(workspace_root: &Path) -> anyhow::Result<ExcludeOutcome> {
    let Some(common_dir) = git_common_dir(workspace_root) else {
        return Ok(ExcludeOutcome::NotAGitRepo);
    };
    let info_dir = common_dir.join("info");
    let exclude_path = info_dir.join("exclude");
    let existing = match std::fs::read_to_string(&exclude_path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => {
            return Err(anyhow::anyhow!(
                "read {}: {error}",
                exclude_path.display()
            ))
        }
    };
    if existing
        .lines()
        .any(|line| line.trim() == PROLIFERATE_EXCLUDE_ENTRY)
    {
        return Ok(ExcludeOutcome::AlreadyPresent);
    }
    std::fs::create_dir_all(&info_dir)
        .map_err(|error| anyhow::anyhow!("create {}: {error}", info_dir.display()))?;
    let mut updated = existing;
    if !updated.is_empty() && !updated.ends_with('\n') {
        updated.push('\n');
    }
    updated.push_str(PROLIFERATE_EXCLUDE_ENTRY);
    updated.push('\n');
    std::fs::write(&exclude_path, updated)
        .map_err(|error| anyhow::anyhow!("write {}: {error}", exclude_path.display()))?;
    Ok(ExcludeOutcome::Written)
}

/// The clone's common `.git` dir (shared across worktrees), absolute. None
/// when `workspace_root` is not inside a git repository.
fn git_common_dir(workspace_root: &Path) -> Option<PathBuf> {
    let output = Command::new("git")
        .args(["rev-parse", "--git-common-dir"])
        .current_dir(workspace_root)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if raw.is_empty() {
        return None;
    }
    let path = PathBuf::from(&raw);
    let absolute = if path.is_absolute() {
        path
    } else {
        workspace_root.join(path)
    };
    Some(absolute)
}
