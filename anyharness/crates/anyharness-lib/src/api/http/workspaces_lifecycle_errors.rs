//! The single place archive and unarchive failures become wire codes.
//!
//! One `From` impl per domain error, so a status or a code can only be decided
//! once. Two of the codes carry a structured payload in `ProblemDetails.extra`
//! rather than in the human `detail` sentence:
//!
//! - `WORKSPACE_GIT_LOCKED` carries the offending `file`, so the toast can name
//!   it.
//! - `WORKSPACE_UNARCHIVE_SCENARIO` carries the whole scenario body, including
//!   the `strategies` list the dialog renders its choices from.
//!
//! Everything else leaves `extra` absent.

use super::error::ApiError;
use super::workspaces_lifecycle_contract::scenario_body_to_contract;
use crate::domains::workspaces::archive::types::{ArchiveError, UnarchiveError};

impl From<ArchiveError> for ApiError {
    fn from(error: ArchiveError) -> Self {
        match error {
            ArchiveError::NotFound(_) => {
                ApiError::not_found(error.to_string(), "WORKSPACE_NOT_FOUND")
            }
            ArchiveError::OperationInFlight => {
                ApiError::conflict(error.to_string(), "WORKSPACE_OPERATION_IN_FLIGHT")
            }
            ArchiveError::GitOperationInProgress { .. } => {
                ApiError::conflict(error.to_string(), "WORKSPACE_GIT_OPERATION_IN_PROGRESS")
            }
            ArchiveError::UnbornHead => {
                ApiError::conflict(error.to_string(), "WORKSPACE_UNBORN_HEAD")
            }
            ArchiveError::HollowCheckout { .. } => {
                ApiError::conflict(error.to_string(), "WORKSPACE_HOLLOW_CHECKOUT")
            }
            ArchiveError::GitLocked { ref file } => {
                let file = file.clone();
                ApiError::conflict(error.to_string(), "WORKSPACE_GIT_LOCKED")
                    .with_extra(serde_json::json!({ "file": file }))
            }
            // Retryable by design: a mechanical failure or a quiesce deadline
            // leaves the workspace fully active and untouched, so the honest
            // answer is "try again", not "this workspace is broken".
            ArchiveError::Failed(_) => ApiError::new(
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "Internal error",
                Some(error.to_string()),
                Some("WORKSPACE_ARCHIVE_FAILED"),
            ),
        }
    }
}

impl From<UnarchiveError> for ApiError {
    fn from(error: UnarchiveError) -> Self {
        match error {
            UnarchiveError::NotFound(_) => {
                ApiError::not_found(error.to_string(), "WORKSPACE_NOT_FOUND")
            }
            UnarchiveError::OperationInFlight => {
                ApiError::conflict(error.to_string(), "WORKSPACE_OPERATION_IN_FLIGHT")
            }
            UnarchiveError::Scenario(payload) => {
                let body = scenario_body_to_contract(payload);
                ApiError::conflict(
                    "this workspace cannot be unarchived without a decision",
                    "WORKSPACE_UNARCHIVE_SCENARIO",
                )
                .with_extra(serde_json::to_value(body).unwrap_or(serde_json::Value::Null))
            }
            UnarchiveError::Failed(_) => ApiError::new(
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "Internal error",
                Some(error.to_string()),
                Some("WORKSPACE_UNARCHIVE_FAILED"),
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    use axum::http::StatusCode;

    use super::*;
    use crate::domains::workspaces::archive::types::{
        OccupantLifecycle, UnarchiveScenario, UnarchiveScenarioPayload, UnarchiveStrategy,
    };

    #[test]
    fn the_four_business_rule_refusals_answer_409_with_their_own_codes() {
        let cases: Vec<(ArchiveError, &str)> = vec![
            (
                ArchiveError::GitOperationInProgress {
                    operation: "rebase".to_string(),
                },
                "WORKSPACE_GIT_OPERATION_IN_PROGRESS",
            ),
            (ArchiveError::UnbornHead, "WORKSPACE_UNBORN_HEAD"),
            (
                ArchiveError::HollowCheckout {
                    path: "/wt/one".to_string(),
                },
                "WORKSPACE_HOLLOW_CHECKOUT",
            ),
            (
                ArchiveError::GitLocked {
                    file: "index.lock".to_string(),
                },
                "WORKSPACE_GIT_LOCKED",
            ),
        ];

        for (error, expected_code) in cases {
            let api_error: ApiError = error.into();
            assert_eq!(api_error.status(), StatusCode::CONFLICT);
            assert_eq!(api_error.code(), Some(expected_code));
        }
    }

    /// The lock file rides `extra`, not the prose: a toast that had to regex the
    /// detail sentence to name the file would break the moment the sentence
    /// changed.
    #[test]
    fn the_git_locked_body_carries_the_offending_file() {
        let api_error: ApiError = ArchiveError::GitLocked {
            file: "/wt/one/.git/index.lock".to_string(),
        }
        .into();

        assert_eq!(
            api_error.extra(),
            Some(&serde_json::json!({ "file": "/wt/one/.git/index.lock" }))
        );
    }

    /// A quiesce trip and a mechanical failure share one retryable code: both
    /// leave the workspace active and untouched, so the client's move is the
    /// same.
    #[test]
    fn mechanical_archive_failures_are_retryable_500s() {
        let api_error: ApiError =
            ArchiveError::Failed("the workspace could not be quiesced".into()).into();

        assert_eq!(api_error.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(api_error.code(), Some("WORKSPACE_ARCHIVE_FAILED"));
    }

    /// The scenario 409 is a decision, not a failure, and its whole payload
    /// rides `extra` in the casing R7 reads.
    #[test]
    fn the_scenario_409_carries_its_typed_payload() {
        let api_error: ApiError = UnarchiveError::Scenario(UnarchiveScenarioPayload {
            scenario: UnarchiveScenario::BranchDiverged,
            occupant_name: None,
            occupant_lifecycle: None,
            strategies: vec![
                UnarchiveStrategy::RecreateAtSha,
                UnarchiveStrategy::RestoreDetached,
            ],
        })
        .into();

        assert_eq!(api_error.status(), StatusCode::CONFLICT);
        assert_eq!(api_error.code(), Some("WORKSPACE_UNARCHIVE_SCENARIO"));
        let extra = api_error.extra().expect("scenario payload");
        assert_eq!(extra["scenario"], "branch_diverged");
        assert_eq!(
            extra["strategies"],
            serde_json::json!(["recreate_at_sha", "restore_detached"])
        );
    }

    #[test]
    fn a_named_occupant_reaches_the_wire_in_camel_case() {
        let api_error: ApiError = UnarchiveError::Scenario(UnarchiveScenarioPayload {
            scenario: UnarchiveScenario::PathOccupied,
            occupant_name: Some("api rewrite".to_string()),
            occupant_lifecycle: Some(OccupantLifecycle::Active),
            strategies: Vec::new(),
        })
        .into();

        let extra = api_error.extra().expect("scenario payload");
        assert_eq!(extra["occupantName"], "api rewrite");
        assert_eq!(extra["occupantLifecycle"], "active");
    }

    #[test]
    fn a_restore_failure_is_a_retryable_500() {
        let api_error: ApiError = UnarchiveError::Failed("worktree add failed".into()).into();

        assert_eq!(api_error.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(api_error.code(), Some("WORKSPACE_UNARCHIVE_FAILED"));
    }
}
