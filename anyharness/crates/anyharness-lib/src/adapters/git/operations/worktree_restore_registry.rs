use std::path::{Path, PathBuf};
use std::process::Command;

use crate::adapters::git::types::GitWorktreeRestoreError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct WorktreeRegistration {
    pub(super) path: PathBuf,
    pub(super) branch: Option<String>,
    pub(super) prunable: bool,
    pub(super) locked: bool,
}

pub(super) fn list_worktree_registrations(
    source_repo_root: &Path,
) -> Result<Vec<WorktreeRegistration>, GitWorktreeRestoreError> {
    let output = Command::new("git")
        .args(["worktree", "list", "--porcelain", "-z"])
        .current_dir(source_repo_root)
        .output()
        .map_err(|error| GitWorktreeRestoreError::OperationFailed {
            detail: format!("Git worktree registrations could not be inspected: {error}"),
        })?;
    if !output.status.success() {
        return Err(GitWorktreeRestoreError::AmbiguousState {
            detail: "Git could not list worktree registrations".to_string(),
        });
    }
    parse_worktree_registrations(&output.stdout)
}

fn parse_worktree_registrations(
    raw: &[u8],
) -> Result<Vec<WorktreeRegistration>, GitWorktreeRestoreError> {
    let text = std::str::from_utf8(raw).map_err(|_| GitWorktreeRestoreError::AmbiguousState {
        detail: "Git returned a non-UTF-8 worktree registration".to_string(),
    })?;
    let mut registrations = Vec::new();
    for record in text.split("\0\0").filter(|record| !record.is_empty()) {
        let mut path = None;
        let mut branch = None;
        let mut prunable = false;
        let mut locked = false;
        for field in record.split('\0').filter(|field| !field.is_empty()) {
            if let Some(value) = field.strip_prefix("worktree ") {
                if path.replace(PathBuf::from(value)).is_some() {
                    return Err(GitWorktreeRestoreError::AmbiguousState {
                        detail: "Git returned duplicate worktree path fields".to_string(),
                    });
                }
            } else if let Some(value) = field.strip_prefix("branch refs/heads/") {
                if branch.replace(value.to_string()).is_some() {
                    return Err(GitWorktreeRestoreError::AmbiguousState {
                        detail: "Git returned duplicate worktree branch fields".to_string(),
                    });
                }
            } else if field == "prunable" || field.starts_with("prunable ") {
                prunable = true;
            } else if field == "locked" || field.starts_with("locked ") {
                locked = true;
            }
        }
        let path = path.ok_or_else(|| GitWorktreeRestoreError::AmbiguousState {
            detail: "Git returned a worktree registration without a path".to_string(),
        })?;
        registrations.push(WorktreeRegistration {
            path,
            branch,
            prunable,
            locked,
        });
    }
    Ok(registrations)
}

pub(super) fn registrations_for_path<'a>(
    registrations: &'a [WorktreeRegistration],
    target_path: &'a Path,
) -> impl Iterator<Item = &'a WorktreeRegistration> {
    registrations
        .iter()
        .filter(move |registration| registration.path == target_path)
}

#[cfg(test)]
mod tests {
    use super::parse_worktree_registrations;
    use crate::adapters::git::types::GitWorktreeRestoreError;

    #[test]
    fn parser_rejects_duplicate_path_fields() {
        let error = parse_worktree_registrations(
            b"worktree /one\0worktree /two\0HEAD abc\0branch refs/heads/main\0\0",
        )
        .expect_err("duplicate paths must be ambiguous");
        assert!(matches!(
            error,
            GitWorktreeRestoreError::AmbiguousState { .. }
        ));
    }

    #[test]
    fn parser_preserves_locked_and_prunable_state() {
        let rows = parse_worktree_registrations(
            b"worktree /missing\0HEAD abc\0branch refs/heads/feature/x\0locked reason\0prunable reason\0\0",
        )
        .expect("parse registration");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].branch.as_deref(), Some("feature/x"));
        assert!(rows[0].locked);
        assert!(rows[0].prunable);
    }
}
