use std::path::Path;

use super::super::types::WorktreeRegistration;

/// Public projection of `git worktree list --porcelain` registrations, so
/// callers outside the git adapter (R4's in-use check) can read them without
/// re-parsing porcelain output inside the domain. A separate file: both
/// `worktrees.rs` and `worktree_restore.rs` are already near
/// `scripts/check_max_lines.py`'s 600-line cap.
pub fn list_worktree_registrations(repo_root: &Path) -> anyhow::Result<Vec<WorktreeRegistration>> {
    super::worktree_restore_registry::list_worktree_registrations_public(repo_root)
        .map_err(|error| anyhow::anyhow!(error.to_string()))
}
