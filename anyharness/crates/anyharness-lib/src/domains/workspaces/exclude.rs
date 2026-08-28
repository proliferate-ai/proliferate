//! The one runtime-written git exclude entry: a root-relative
//! `/.proliferate/` line in the clone's SHARED `info/exclude`. Worktrees
//! share the common `.git` dir's exclude file, so one write covers the root
//! checkout and every worktree cut from that clone, and it never touches the
//! user's `.gitignore`. Idempotent: repeated calls write the entry once.

use std::io::Write;
use std::path::{Path, PathBuf};

use crate::adapters::git::executor::{run_git, GitOutput};

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
///
/// Only a genuine not-a-repo probe reports [`ExcludeOutcome::NotAGitRepo`];
/// any other git failure (dubious ownership, permissions, corrupt repo, git
/// unrunnable) is an error, because returning "nothing to exclude" for a real
/// repo would let the context folder leak into the user's next commit.
pub fn ensure_proliferate_excluded(workspace_root: &Path) -> anyhow::Result<ExcludeOutcome> {
    let probe = run_git(workspace_root, &["rev-parse", "--git-common-dir"])?;
    let Some(common_dir) = classify_common_dir_probe(workspace_root, &probe)? else {
        return Ok(ExcludeOutcome::NotAGitRepo);
    };
    let info_dir = common_dir.join("info");
    let exclude_path = info_dir.join("exclude");
    let existing = match std::fs::read_to_string(&exclude_path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(anyhow::anyhow!("read {}: {error}", exclude_path.display())),
    };
    if existing
        .lines()
        .any(|line| line.trim() == PROLIFERATE_EXCLUDE_ENTRY)
    {
        return Ok(ExcludeOutcome::AlreadyPresent);
    }
    std::fs::create_dir_all(&info_dir)
        .map_err(|error| anyhow::anyhow!("create {}: {error}", info_dir.display()))?;
    // Append rather than rewrite: a concurrent materialization into the same
    // clone can at worst duplicate the entry (harmless), never erase a line
    // written between our read and our write.
    let mut addition = String::new();
    if !existing.is_empty() && !existing.ends_with('\n') {
        addition.push('\n');
    }
    addition.push_str(PROLIFERATE_EXCLUDE_ENTRY);
    addition.push('\n');
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&exclude_path)
        .map_err(|error| anyhow::anyhow!("open {}: {error}", exclude_path.display()))?;
    file.write_all(addition.as_bytes())
        .map_err(|error| anyhow::anyhow!("write {}: {error}", exclude_path.display()))?;
    Ok(ExcludeOutcome::Written)
}

/// Classify the `git rev-parse --git-common-dir` probe: `Ok(Some(dir))` for a
/// repo, `Ok(None)` only for the genuine not-a-repo answer, `Err` for every
/// other failure (git failing is NOT the same as no repo being present).
pub(crate) fn classify_common_dir_probe(
    workspace_root: &Path,
    probe: &GitOutput,
) -> anyhow::Result<Option<PathBuf>> {
    if !probe.success {
        if probe
            .stderr
            .to_ascii_lowercase()
            .contains("not a git repository")
        {
            return Ok(None);
        }
        anyhow::bail!(
            "git rev-parse --git-common-dir failed in {}: {}",
            workspace_root.display(),
            probe.stderr.trim()
        );
    }
    let raw = probe.stdout.trim();
    if raw.is_empty() {
        anyhow::bail!(
            "git rev-parse --git-common-dir returned no path in {}",
            workspace_root.display()
        );
    }
    let path = PathBuf::from(raw);
    let absolute = if path.is_absolute() {
        path
    } else {
        workspace_root.join(path)
    };
    Ok(Some(absolute))
}
