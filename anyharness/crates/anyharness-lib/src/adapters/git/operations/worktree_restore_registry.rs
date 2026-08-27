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

/// Public projection for callers outside the git adapter (R4's in-use check),
/// so they read registrations through the adapter instead of re-parsing
/// `worktree list --porcelain` themselves.
pub(super) fn list_worktree_registrations_public(
    source_repo_root: &Path,
) -> Result<Vec<crate::adapters::git::types::WorktreeRegistration>, GitWorktreeRestoreError> {
    Ok(list_worktree_registrations(source_repo_root)?
        .into_iter()
        .map(
            |registration| crate::adapters::git::types::WorktreeRegistration {
                path: registration.path,
                branch: registration.branch,
                prunable: registration.prunable,
                locked: registration.locked,
            },
        )
        .collect())
}

/// Remove exactly the admin directory registered for `path`, never a
/// repo-global prune. Git has no per-path `worktree prune`, so this reads the
/// registration table directly: `<common_dir>/worktrees/<name>/gitdir` holds
/// the absolute path of that worktree's `.git` link file, whose parent is the
/// registered worktree path. Only fires when `worktree list --porcelain`
/// reports that registration `prunable`.
pub(super) fn prune_registration_for_path(
    source_repo_root: &Path,
    target_path: &Path,
) -> Result<(), GitWorktreeRestoreError> {
    let registrations = list_worktree_registrations(source_repo_root)?;
    if !registrations_for_path(&registrations, target_path)
        .any(|registration| registration.prunable)
    {
        return Ok(());
    }

    let common_dir = common_git_dir(source_repo_root)?;
    let admin_root = common_dir.join("worktrees");
    let entries = match std::fs::read_dir(&admin_root) {
        Ok(entries) => entries,
        Err(_) => return Ok(()),
    };
    for entry in entries.filter_map(Result::ok) {
        let admin_dir = entry.path();
        let gitdir_file = admin_dir.join("gitdir");
        let Ok(recorded) = std::fs::read_to_string(&gitdir_file) else {
            continue;
        };
        let recorded_worktree_git_link = PathBuf::from(recorded.trim());
        let Some(recorded_worktree_path) = recorded_worktree_git_link.parent() else {
            continue;
        };
        if canonicalize_best_effort(recorded_worktree_path) == canonicalize_best_effort(target_path)
        {
            let _ = std::fs::remove_dir_all(&admin_dir);
        }
    }
    Ok(())
}

fn common_git_dir(source_repo_root: &Path) -> Result<PathBuf, GitWorktreeRestoreError> {
    let output = Command::new("git")
        .args(["rev-parse", "--path-format=absolute", "--git-common-dir"])
        .current_dir(source_repo_root)
        .output()
        .map_err(|error| GitWorktreeRestoreError::OperationFailed {
            detail: format!("git common directory could not be resolved: {error}"),
        })?;
    if !output.status.success() {
        return Err(GitWorktreeRestoreError::AmbiguousState {
            detail: "git could not resolve its common directory".to_string(),
        });
    }
    Ok(PathBuf::from(
        String::from_utf8_lossy(&output.stdout).trim().to_string(),
    ))
}

/// Best-effort canonicalization for comparing a possibly-missing path: the
/// leaf may no longer exist (that is exactly the missing-worktree case), so
/// only the parent is canonicalized and the leaf name is rejoined.
fn canonicalize_best_effort(path: &Path) -> PathBuf {
    let Some(parent) = path.parent() else {
        return path.to_path_buf();
    };
    let Some(file_name) = path.file_name() else {
        return path.to_path_buf();
    };
    std::fs::canonicalize(parent)
        .map(|canonical_parent| canonical_parent.join(file_name))
        .unwrap_or_else(|_| path.to_path_buf())
}

/// Returns whether the target path's own stale registration must be pruned
/// before the restore proceeds. `prune_target_registration` widens that to
/// the target registrations that would otherwise refuse (a registration on
/// some other branch, or on a branch when a detached restore was asked for);
/// it never licenses touching a registration at any OTHER path.
pub(super) fn validate_missing_target_registrations(
    registrations: &[WorktreeRegistration],
    target_path: &Path,
    branch_name: Option<&str>,
    prune_target_registration: bool,
) -> Result<bool, GitWorktreeRestoreError> {
    let target_registrations =
        registrations_for_path(registrations, target_path).collect::<Vec<_>>();
    if target_registrations.len() > 1 {
        return Err(GitWorktreeRestoreError::AmbiguousState {
            detail: format!(
                "multiple Git worktree registrations refer to {}",
                target_path.display()
            ),
        });
    }

    // The branch-conflict half only applies when a branch was requested: a
    // detached restore claims no branch, so no sibling can conflict with it.
    if let Some(branch_name) = branch_name {
        for registration in registrations {
            if registration.branch.as_deref() != Some(branch_name)
                || registration.path == target_path
            {
                continue;
            }
            if registration.prunable {
                // A SIBLING path's stale registration is a refusal, never a
                // prune, in either mode: it belongs to another workspace and
                // deleting it is the one destructive cross-workspace
                // interaction this design avoids everywhere.
                return Err(GitWorktreeRestoreError::RegistrationConflict {
                    path: registration.path.display().to_string(),
                    detail: format!(
                        "the recorded branch '{branch_name}' is registered to a different missing path"
                    ),
                });
            }
            return Err(GitWorktreeRestoreError::BranchCheckedOutElsewhere {
                branch: branch_name.to_string(),
                path: registration.path.display().to_string(),
            });
        }
    }

    let Some(registration) = target_registrations.first() else {
        return Ok(false);
    };
    if registration.branch.as_deref() != branch_name && !prune_target_registration {
        let recorded = registration
            .branch
            .as_deref()
            .unwrap_or("a detached checkout");
        return Err(GitWorktreeRestoreError::RegistrationConflict {
            path: target_path.display().to_string(),
            detail: match branch_name {
                Some(branch_name) => format!(
                    "the path is registered to {recorded} instead of the recorded branch '{branch_name}'"
                ),
                None => format!(
                    "the path is registered to {recorded} instead of the recorded detached checkout"
                ),
            },
        });
    }
    if registration.locked {
        return Err(GitWorktreeRestoreError::AmbiguousState {
            detail: format!(
                "the missing worktree registration for {} is locked",
                target_path.display()
            ),
        });
    }
    if !registration.prunable {
        return Err(GitWorktreeRestoreError::AmbiguousState {
            detail: format!(
                "Git reports {} as active even though the directory is missing",
                target_path.display()
            ),
        });
    }
    Ok(true)
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
