//! Forks ADR rung 2: the targeted-fork HTTP reason taxonomy (ADR §4.8) maps to
//! stable codes/statuses. Lives beside `sessions_errors.rs` to keep that file
//! under the repo-shape line budget.

use axum::http::StatusCode;
use axum::response::IntoResponse;

use crate::domains::sessions::runtime::ForkSessionError;

#[test]
fn targeted_fork_taxonomy_maps_to_stable_reasons() {
    let cases = [
        (
            ForkSessionError::InvalidForkTarget("item_id required".to_string()),
            StatusCode::BAD_REQUEST,
            "INVALID_FORK_TARGET",
        ),
        (ForkSessionError::TargetNotFound, StatusCode::NOT_FOUND, "TARGET_NOT_FOUND"),
        (ForkSessionError::BoundaryNotCommitted, StatusCode::CONFLICT, "BOUNDARY_NOT_COMMITTED"),
        (ForkSessionError::IdempotencyConflict, StatusCode::CONFLICT, "IDEMPOTENCY_CONFLICT"),
        (
            ForkSessionError::NativeOutcomeUnknown,
            StatusCode::CONFLICT,
            "FORK_NATIVE_OUTCOME_UNKNOWN",
        ),
    ];
    for (source, status, code) in cases {
        let error = super::sessions_errors::map_fork_session_error(source);
        assert_eq!(error.code(), Some(code));
        assert_eq!(error.into_response().status(), status);
    }
}
