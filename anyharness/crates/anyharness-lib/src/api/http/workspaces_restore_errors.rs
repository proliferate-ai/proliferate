use crate::adapters::git::types::GitWorktreeRestoreError;
use crate::api::http::error::ApiError;
use crate::domains::workspaces::restore_runtime::RestoreWorktreeRequestError;
use crate::domains::workspaces::runtime::RestoreWorktreeError;

impl From<RestoreWorktreeRequestError> for ApiError {
    fn from(error: RestoreWorktreeRequestError) -> Self {
        match error {
            RestoreWorktreeRequestError::TaskFailed(error) => {
                ApiError::internal(format!("worktree restore task failed: {error}"))
            }
            RestoreWorktreeRequestError::Restore(error) => error.into(),
        }
    }
}

impl From<RestoreWorktreeError> for ApiError {
    fn from(error: RestoreWorktreeError) -> Self {
        match error {
            error @ RestoreWorktreeError::WorkspaceNotFound(_) => {
                ApiError::not_found(error.to_string(), "WORKSPACE_NOT_FOUND")
            }
            error @ (RestoreWorktreeError::WorkspaceKindIneligible { .. }
            | RestoreWorktreeError::RecordedBranchMissing { .. }) => {
                ApiError::conflict(error.to_string(), "WORKTREE_RESTORE_INELIGIBLE")
            }
            error @ RestoreWorktreeError::WorkspaceNotActive { .. } => {
                ApiError::conflict(error.to_string(), "WORKSPACE_RETIRED")
            }
            error @ RestoreWorktreeError::RepositoryRecordMissing { .. } => ApiError::conflict(
                error.to_string(),
                "WORKTREE_RESTORE_REPOSITORY_RECORD_MISSING",
            ),
            error @ RestoreWorktreeError::WorkspaceRegistrationConflict { .. } => {
                ApiError::conflict(error.to_string(), "WORKTREE_RESTORE_REGISTRATION_CONFLICT")
            }
            RestoreWorktreeError::Git(error) => error.into(),
            RestoreWorktreeError::Storage(error) => {
                ApiError::internal(format!("worktree restore storage failed: {error}"))
            }
        }
    }
}

impl From<GitWorktreeRestoreError> for ApiError {
    fn from(error: GitWorktreeRestoreError) -> Self {
        let code = match &error {
            GitWorktreeRestoreError::RepositoryMissing { .. }
            | GitWorktreeRestoreError::RepositoryInvalid { .. } => {
                "WORKTREE_RESTORE_REPOSITORY_MISSING"
            }
            GitWorktreeRestoreError::BranchMissing { .. } => "WORKTREE_RESTORE_BRANCH_MISSING",
            GitWorktreeRestoreError::DestinationParentUnavailable { .. } => {
                "WORKTREE_RESTORE_PARENT_UNAVAILABLE"
            }
            GitWorktreeRestoreError::DestinationOccupied { .. } => "WORKTREE_RESTORE_PATH_OCCUPIED",
            GitWorktreeRestoreError::RegistrationConflict { .. } => {
                "WORKTREE_RESTORE_REGISTRATION_CONFLICT"
            }
            GitWorktreeRestoreError::BranchCheckedOutElsewhere { .. } => {
                "WORKTREE_RESTORE_BRANCH_CHECKED_OUT"
            }
            GitWorktreeRestoreError::AmbiguousState { .. } => "WORKTREE_RESTORE_GIT_AMBIGUOUS",
            GitWorktreeRestoreError::OperationFailed { .. } => {
                return ApiError::internal(error.to_string());
            }
        };
        ApiError::conflict(error.to_string(), code)
    }
}

#[cfg(test)]
mod tests {
    use axum::http::StatusCode;

    use super::*;

    #[test]
    fn maps_restore_failures_to_stable_actionable_codes() {
        let cases = [
            (
                GitWorktreeRestoreError::RepositoryMissing {
                    path: "/repo".to_string(),
                },
                "WORKTREE_RESTORE_REPOSITORY_MISSING",
            ),
            (
                GitWorktreeRestoreError::BranchMissing {
                    branch: "feature/x".to_string(),
                },
                "WORKTREE_RESTORE_BRANCH_MISSING",
            ),
            (
                GitWorktreeRestoreError::DestinationParentUnavailable {
                    path: "/missing-parent".to_string(),
                },
                "WORKTREE_RESTORE_PARENT_UNAVAILABLE",
            ),
            (
                GitWorktreeRestoreError::DestinationOccupied {
                    path: "/worktree".to_string(),
                },
                "WORKTREE_RESTORE_PATH_OCCUPIED",
            ),
            (
                GitWorktreeRestoreError::RegistrationConflict {
                    path: "/worktree".to_string(),
                    detail: "other branch".to_string(),
                },
                "WORKTREE_RESTORE_REGISTRATION_CONFLICT",
            ),
            (
                GitWorktreeRestoreError::BranchCheckedOutElsewhere {
                    branch: "feature/x".to_string(),
                    path: "/other".to_string(),
                },
                "WORKTREE_RESTORE_BRANCH_CHECKED_OUT",
            ),
            (
                GitWorktreeRestoreError::AmbiguousState {
                    detail: "locked".to_string(),
                },
                "WORKTREE_RESTORE_GIT_AMBIGUOUS",
            ),
        ];

        for (error, expected_code) in cases {
            let api_error: ApiError = error.into();
            assert_eq!(api_error.status(), StatusCode::CONFLICT);
            assert_eq!(api_error.code(), Some(expected_code));
            assert!(api_error.detail().is_some());
        }
    }

    #[test]
    fn distinguishes_a_missing_repository_record_from_a_missing_checkout() {
        let api_error: ApiError = RestoreWorktreeError::RepositoryRecordMissing {
            workspace_id: "workspace-1".to_string(),
        }
        .into();

        assert_eq!(api_error.status(), StatusCode::CONFLICT);
        assert_eq!(
            api_error.code(),
            Some("WORKTREE_RESTORE_REPOSITORY_RECORD_MISSING")
        );
    }
}
