use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use uuid::Uuid;

use super::worktree_restore_registry::{
    list_worktree_registrations, registrations_for_path, WorktreeRegistration,
};
use crate::adapters::git::types::{GitWorktreeRestoreError, GitWorktreeRestoreOutcome};

pub fn restore_worktree(
    source_repo_root: &Path,
    target_path: &Path,
    branch_name: &str,
) -> Result<GitWorktreeRestoreOutcome, GitWorktreeRestoreError> {
    let source_repo_root = canonical_repository_root(source_repo_root)?;
    let target_path = canonical_missing_target(target_path)?;
    ensure_branch_exists(&source_repo_root, branch_name)?;

    let registrations = list_worktree_registrations(&source_repo_root)?;
    match fs::symlink_metadata(&target_path) {
        Ok(_) => {
            verify_present_worktree(&source_repo_root, &target_path, branch_name, &registrations)?;
            return Ok(GitWorktreeRestoreOutcome::AlreadyPresent);
        }
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(error) => {
            return Err(GitWorktreeRestoreError::AmbiguousState {
                detail: format!(
                    "the recorded path could not be inspected safely ({}): {error}",
                    target_path.display()
                ),
            });
        }
    }

    let matching_stale_registration =
        validate_missing_target_registrations(&registrations, &target_path, branch_name)?;
    if matching_stale_registration {
        prune_stale_worktree_registrations(&source_repo_root)?;
        let remaining = list_worktree_registrations(&source_repo_root)?;
        if registrations_for_path(&remaining, &target_path)
            .next()
            .is_some()
        {
            return Err(GitWorktreeRestoreError::RegistrationConflict {
                path: target_path.display().to_string(),
                detail: "the stale registration could not be cleared safely".to_string(),
            });
        }
    }

    match fs::symlink_metadata(&target_path) {
        Ok(_) => {
            return Err(GitWorktreeRestoreError::DestinationOccupied {
                path: target_path.display().to_string(),
            });
        }
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(error) => {
            return Err(GitWorktreeRestoreError::AmbiguousState {
                detail: format!(
                    "the recorded path changed while restoration was being prepared ({}): {error}",
                    target_path.display()
                ),
            });
        }
    }

    let staged = create_staged_worktree_path(&target_path)?;
    let output = match Command::new("git")
        .args(["worktree", "add", "--"])
        .arg(&staged.path)
        .arg(branch_name)
        .current_dir(&source_repo_root)
        .output()
    {
        Ok(output) => output,
        Err(error) => {
            cleanup_empty_staging_path(&staged);
            return Err(GitWorktreeRestoreError::OperationFailed {
                detail: format!("the Git worktree operation could not be started: {error}"),
            });
        }
    };
    if !output.status.success() {
        cleanup_empty_staging_path(&staged);
        return classify_failed_operation(
            &source_repo_root,
            &target_path,
            branch_name,
            output.status.code(),
            "git worktree add",
        );
    }

    let output = match Command::new("git")
        .args(["worktree", "move", "--"])
        .arg(&staged.path)
        .arg(target_path.parent().expect("validated target parent"))
        .current_dir(&source_repo_root)
        .output()
    {
        Ok(output) => output,
        Err(error) => {
            cleanup_staged_worktree(&source_repo_root, &staged)?;
            return Err(GitWorktreeRestoreError::OperationFailed {
                detail: format!("the staged worktree move could not be started: {error}"),
            });
        }
    };
    if !output.status.success() {
        cleanup_staged_worktree(&source_repo_root, &staged)?;
        return classify_failed_operation(
            &source_repo_root,
            &target_path,
            branch_name,
            output.status.code(),
            "git worktree move",
        );
    }
    cleanup_empty_staging_path(&staged);

    let registrations = list_worktree_registrations(&source_repo_root)?;
    verify_present_worktree(&source_repo_root, &target_path, branch_name, &registrations)?;
    Ok(GitWorktreeRestoreOutcome::Restored)
}

struct StagedWorktreePath {
    parent: PathBuf,
    path: PathBuf,
}

fn create_staged_worktree_path(
    target_path: &Path,
) -> Result<StagedWorktreePath, GitWorktreeRestoreError> {
    let target_parent = target_path.parent().ok_or_else(|| {
        GitWorktreeRestoreError::DestinationParentUnavailable {
            path: target_path.display().to_string(),
        }
    })?;
    let target_name = target_path.file_name().ok_or_else(|| {
        GitWorktreeRestoreError::DestinationParentUnavailable {
            path: target_path.display().to_string(),
        }
    })?;
    let parent = target_parent.join(format!(".proliferate-worktree-restore-{}", Uuid::new_v4()));
    fs::create_dir(&parent).map_err(|_| GitWorktreeRestoreError::DestinationParentUnavailable {
        path: target_parent.display().to_string(),
    })?;
    Ok(StagedWorktreePath {
        path: parent.join(target_name),
        parent,
    })
}

fn cleanup_staged_worktree(
    source_repo_root: &Path,
    staged: &StagedWorktreePath,
) -> Result<(), GitWorktreeRestoreError> {
    let output = Command::new("git")
        .args(["worktree", "remove", "--force", "--"])
        .arg(&staged.path)
        .current_dir(source_repo_root)
        .output()
        .map_err(|error| GitWorktreeRestoreError::AmbiguousState {
            detail: format!("the private staged worktree could not be cleaned up: {error}"),
        })?;
    if !output.status.success() {
        return Err(GitWorktreeRestoreError::AmbiguousState {
            detail: format!(
                "Git refused to clean up the private staged worktree at {}",
                staged.path.display()
            ),
        });
    }
    cleanup_empty_staging_path(staged);
    Ok(())
}

fn cleanup_empty_staging_path(staged: &StagedWorktreePath) {
    remove_private_empty_staging_dir(&staged.path);
    remove_private_empty_staging_dir(&staged.parent);
}

fn remove_private_empty_staging_dir(path: &Path) {
    if let Err(error) = fs::remove_dir(path) {
        if error.kind() != ErrorKind::NotFound {
            tracing::warn!(
                path = %path.display(),
                %error,
                "private worktree restore staging directory could not be removed"
            );
        }
    }
}

fn canonical_repository_root(path: &Path) -> Result<PathBuf, GitWorktreeRestoreError> {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == ErrorKind::NotFound => {
            return Err(GitWorktreeRestoreError::RepositoryMissing {
                path: path.display().to_string(),
            });
        }
        Err(error) => {
            return Err(GitWorktreeRestoreError::AmbiguousState {
                detail: format!(
                    "the repository path could not be inspected safely ({}): {error}",
                    path.display()
                ),
            });
        }
        Ok(metadata) if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() => {
            return Err(GitWorktreeRestoreError::RepositoryInvalid {
                path: path.display().to_string(),
            });
        }
        Ok(_) => {}
    }

    let canonical =
        fs::canonicalize(path).map_err(|error| GitWorktreeRestoreError::AmbiguousState {
            detail: format!(
                "the repository path could not be resolved safely ({}): {error}",
                path.display()
            ),
        })?;
    let output = run_git(&canonical, ["rev-parse", "--show-toplevel"]).map_err(|_| {
        GitWorktreeRestoreError::RepositoryInvalid {
            path: canonical.display().to_string(),
        }
    })?;
    if !output.status.success() {
        return Err(GitWorktreeRestoreError::RepositoryInvalid {
            path: canonical.display().to_string(),
        });
    }
    let reported = output_text(&output, "repository root")?;
    let reported =
        fs::canonicalize(reported).map_err(|_| GitWorktreeRestoreError::RepositoryInvalid {
            path: canonical.display().to_string(),
        })?;
    if reported != canonical {
        return Err(GitWorktreeRestoreError::RepositoryInvalid {
            path: canonical.display().to_string(),
        });
    }
    Ok(canonical)
}

fn canonical_missing_target(path: &Path) -> Result<PathBuf, GitWorktreeRestoreError> {
    if !path.is_absolute() {
        return Err(GitWorktreeRestoreError::AmbiguousState {
            detail: "the recorded worktree path is not absolute".to_string(),
        });
    }
    let parent =
        path.parent()
            .ok_or_else(|| GitWorktreeRestoreError::DestinationParentUnavailable {
                path: path.display().to_string(),
            })?;
    let file_name =
        path.file_name()
            .ok_or_else(|| GitWorktreeRestoreError::DestinationParentUnavailable {
                path: path.display().to_string(),
            })?;
    let canonical_parent = fs::canonicalize(parent).map_err(|_| {
        GitWorktreeRestoreError::DestinationParentUnavailable {
            path: parent.display().to_string(),
        }
    })?;
    if !canonical_parent.is_dir() {
        return Err(GitWorktreeRestoreError::DestinationParentUnavailable {
            path: canonical_parent.display().to_string(),
        });
    }
    Ok(canonical_parent.join(file_name))
}

fn ensure_branch_exists(
    source_repo_root: &Path,
    branch_name: &str,
) -> Result<(), GitWorktreeRestoreError> {
    if branch_name.trim().is_empty() || branch_name != branch_name.trim() {
        return Err(GitWorktreeRestoreError::BranchMissing {
            branch: branch_name.to_string(),
        });
    }
    let branch_ref = format!("refs/heads/{branch_name}");
    let output = Command::new("git")
        .args(["show-ref", "--verify", "--quiet"])
        .arg(&branch_ref)
        .current_dir(source_repo_root)
        .output()
        .map_err(|error| GitWorktreeRestoreError::OperationFailed {
            detail: format!("the recorded branch could not be inspected: {error}"),
        })?;
    match output.status.code() {
        Some(0) => Ok(()),
        Some(1) => Err(GitWorktreeRestoreError::BranchMissing {
            branch: branch_name.to_string(),
        }),
        _ => Err(GitWorktreeRestoreError::AmbiguousState {
            detail: "Git could not determine whether the recorded branch exists".to_string(),
        }),
    }
}

fn validate_missing_target_registrations(
    registrations: &[WorktreeRegistration],
    target_path: &Path,
    branch_name: &str,
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

    for registration in registrations {
        if registration.branch.as_deref() != Some(branch_name) || registration.path == target_path {
            continue;
        }
        if registration.prunable {
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

    let Some(registration) = target_registrations.first() else {
        return Ok(false);
    };
    if registration.branch.as_deref() != Some(branch_name) {
        return Err(GitWorktreeRestoreError::RegistrationConflict {
            path: target_path.display().to_string(),
            detail: format!(
                "the path is registered to {} instead of the recorded branch '{branch_name}'",
                registration
                    .branch
                    .as_deref()
                    .unwrap_or("a detached checkout")
            ),
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

fn verify_present_worktree(
    source_repo_root: &Path,
    target_path: &Path,
    branch_name: &str,
    registrations: &[WorktreeRegistration],
) -> Result<(), GitWorktreeRestoreError> {
    let metadata = fs::symlink_metadata(target_path).map_err(|error| {
        GitWorktreeRestoreError::AmbiguousState {
            detail: format!(
                "the restored path could not be inspected ({}): {error}",
                target_path.display()
            ),
        }
    })?;
    if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
        return Err(GitWorktreeRestoreError::DestinationOccupied {
            path: target_path.display().to_string(),
        });
    }

    let target_root = git_stdout(target_path, ["rev-parse", "--show-toplevel"]).map_err(|_| {
        GitWorktreeRestoreError::DestinationOccupied {
            path: target_path.display().to_string(),
        }
    })?;
    let target_root = fs::canonicalize(target_root).map_err(|_| {
        GitWorktreeRestoreError::DestinationOccupied {
            path: target_path.display().to_string(),
        }
    })?;
    if target_root != target_path {
        return Err(GitWorktreeRestoreError::DestinationOccupied {
            path: target_path.display().to_string(),
        });
    }

    let source_common = canonical_common_git_dir(source_repo_root)?;
    let target_common = canonical_common_git_dir(target_path).map_err(|_| {
        GitWorktreeRestoreError::DestinationOccupied {
            path: target_path.display().to_string(),
        }
    })?;
    if source_common != target_common {
        return Err(GitWorktreeRestoreError::DestinationOccupied {
            path: target_path.display().to_string(),
        });
    }

    let target_registrations =
        registrations_for_path(registrations, target_path).collect::<Vec<_>>();
    if target_registrations.len() != 1 {
        return Err(GitWorktreeRestoreError::DestinationOccupied {
            path: target_path.display().to_string(),
        });
    }
    let registration = target_registrations[0];
    if registration.prunable
        || registration.locked
        || registration.branch.as_deref() != Some(branch_name)
    {
        return Err(GitWorktreeRestoreError::RegistrationConflict {
            path: target_path.display().to_string(),
            detail: "the existing checkout does not match the recorded branch registration"
                .to_string(),
        });
    }

    let current_branch =
        git_stdout(target_path, ["symbolic-ref", "--short", "HEAD"]).map_err(|_| {
            GitWorktreeRestoreError::RegistrationConflict {
                path: target_path.display().to_string(),
                detail: "the registered checkout has no usable branch".to_string(),
            }
        })?;
    if current_branch != branch_name {
        return Err(GitWorktreeRestoreError::RegistrationConflict {
            path: target_path.display().to_string(),
            detail: format!(
                "the existing checkout is on '{current_branch}', not the recorded branch '{branch_name}'"
            ),
        });
    }

    Ok(())
}

fn classify_failed_operation(
    source_repo_root: &Path,
    target_path: &Path,
    branch_name: &str,
    exit_code: Option<i32>,
    operation: &str,
) -> Result<GitWorktreeRestoreOutcome, GitWorktreeRestoreError> {
    let registrations = list_worktree_registrations(source_repo_root)?;
    if fs::symlink_metadata(target_path).is_ok() {
        if verify_present_worktree(source_repo_root, target_path, branch_name, &registrations)
            .is_ok()
        {
            return Ok(GitWorktreeRestoreOutcome::AlreadyPresent);
        }
        return Err(GitWorktreeRestoreError::DestinationOccupied {
            path: target_path.display().to_string(),
        });
    }
    for registration in &registrations {
        if registration.branch.as_deref() == Some(branch_name)
            && registration.path != target_path
            && !registration.prunable
        {
            return Err(GitWorktreeRestoreError::BranchCheckedOutElsewhere {
                branch: branch_name.to_string(),
                path: registration.path.display().to_string(),
            });
        }
    }
    if registrations_for_path(&registrations, target_path)
        .next()
        .is_some()
    {
        return Err(GitWorktreeRestoreError::RegistrationConflict {
            path: target_path.display().to_string(),
            detail: "Git retained a conflicting registration after the restore attempt".to_string(),
        });
    }
    Err(GitWorktreeRestoreError::OperationFailed {
        detail: match exit_code {
            Some(code) => format!("{operation} exited with status {code}"),
            None => format!("{operation} ended without an exit status"),
        },
    })
}

fn prune_stale_worktree_registrations(
    source_repo_root: &Path,
) -> Result<(), GitWorktreeRestoreError> {
    let output = Command::new("git")
        .args(["worktree", "prune", "--expire", "now"])
        .current_dir(source_repo_root)
        .output()
        .map_err(|error| GitWorktreeRestoreError::OperationFailed {
            detail: format!("stale Git worktree metadata could not be pruned: {error}"),
        })?;
    if !output.status.success() {
        return Err(GitWorktreeRestoreError::AmbiguousState {
            detail: "Git refused to clear the stale worktree registration".to_string(),
        });
    }
    Ok(())
}

fn canonical_common_git_dir(path: &Path) -> Result<PathBuf, GitWorktreeRestoreError> {
    let raw = git_stdout(
        path,
        ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )?;
    fs::canonicalize(&raw).map_err(|_| GitWorktreeRestoreError::AmbiguousState {
        detail: format!(
            "Git common directory could not be resolved for {}",
            path.display()
        ),
    })
}

fn git_stdout<const N: usize>(
    cwd: &Path,
    args: [&str; N],
) -> Result<String, GitWorktreeRestoreError> {
    let output = run_git(cwd, args).map_err(|error| GitWorktreeRestoreError::OperationFailed {
        detail: error.to_string(),
    })?;
    output_text(&output, "Git command")
}

fn run_git<const N: usize>(cwd: &Path, args: [&str; N]) -> Result<Output, std::io::Error> {
    Command::new("git").args(args).current_dir(cwd).output()
}

fn output_text(output: &Output, operation: &str) -> Result<String, GitWorktreeRestoreError> {
    if !output.status.success() {
        return Err(GitWorktreeRestoreError::AmbiguousState {
            detail: format!("{operation} failed"),
        });
    }
    let value = std::str::from_utf8(&output.stdout).map_err(|_| {
        GitWorktreeRestoreError::AmbiguousState {
            detail: format!("{operation} returned non-UTF-8 output"),
        }
    })?;
    Ok(value.trim().to_string())
}
