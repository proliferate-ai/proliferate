use anyharness_contract::v1::{
    MarkReviewRevisionReadyRequest, ProblemDetails, RetryReviewAssignmentRequest,
    ReviewCritiqueResponse, ReviewRunResponse, SessionReviewsResponse, StartCodeReviewRequest,
    StartPlanReviewRequest,
};
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use serde_json::Value;

use super::error::ApiError;
use crate::app::AppState;
use crate::reviews::mcp::handle_json_rpc;
use crate::reviews::service::ReviewError;

#[utoipa::path(
    post,
    path = "/v1/workspaces/{workspace_id}/plans/{plan_id}/review",
    params(
        ("workspace_id" = String, Path, description = "Workspace ID"),
        ("plan_id" = String, Path, description = "Plan ID")
    ),
    request_body = StartPlanReviewRequest,
    responses(
        (status = 200, description = "Started plan review", body = ReviewRunResponse),
        (status = 400, description = "Invalid review request", body = ProblemDetails),
        (status = 404, description = "Plan or session not found", body = ProblemDetails),
    ),
    tag = "reviews"
)]
pub async fn start_plan_review(
    State(state): State<AppState>,
    Path((workspace_id, plan_id)): Path<(String, String)>,
    Json(req): Json<StartPlanReviewRequest>,
) -> Result<Json<ReviewRunResponse>, ApiError> {
    let run = state
        .review_runtime
        .start_plan_review(&workspace_id, &plan_id, req)
        .await
        .map_err(map_review_error)?;
    Ok(Json(ReviewRunResponse { run }))
}

#[utoipa::path(
    post,
    path = "/v1/workspaces/{workspace_id}/reviews/code",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    request_body = StartCodeReviewRequest,
    responses(
        (status = 200, description = "Started code review", body = ReviewRunResponse),
        (status = 400, description = "Invalid review request", body = ProblemDetails),
    ),
    tag = "reviews"
)]
pub async fn start_code_review(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Json(req): Json<StartCodeReviewRequest>,
) -> Result<Json<ReviewRunResponse>, ApiError> {
    let run = state
        .review_runtime
        .start_code_review(&workspace_id, req)
        .await
        .map_err(map_review_error)?;
    Ok(Json(ReviewRunResponse { run }))
}

#[utoipa::path(
    get,
    path = "/v1/sessions/{session_id}/reviews",
    params(("session_id" = String, Path, description = "Session ID")),
    responses(
        (status = 200, description = "Session review runs", body = SessionReviewsResponse),
        (status = 404, description = "Session not found", body = ProblemDetails),
    ),
    tag = "reviews"
)]
pub async fn get_session_reviews(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Result<Json<SessionReviewsResponse>, ApiError> {
    let reviews = state
        .review_service
        .list_session_reviews(&session_id)
        .map_err(map_review_error)?;
    Ok(Json(SessionReviewsResponse { reviews }))
}

#[utoipa::path(
    get,
    path = "/v1/reviews/{review_run_id}/assignments/{assignment_id}/critique",
    params(
        ("review_run_id" = String, Path, description = "Review run ID"),
        ("assignment_id" = String, Path, description = "Review assignment ID")
    ),
    responses(
        (status = 200, description = "Review assignment critique", body = ReviewCritiqueResponse),
        (status = 404, description = "Review or assignment not found", body = ProblemDetails),
    ),
    tag = "reviews"
)]
pub async fn get_review_assignment_critique(
    State(state): State<AppState>,
    Path((review_run_id, assignment_id)): Path<(String, String)>,
) -> Result<Json<ReviewCritiqueResponse>, ApiError> {
    let critique = state
        .review_service
        .get_assignment_critique(&review_run_id, &assignment_id)
        .map_err(map_review_error)?;
    Ok(Json(critique))
}

#[utoipa::path(
    post,
    path = "/v1/reviews/{review_run_id}/assignments/{assignment_id}/retry",
    params(
        ("review_run_id" = String, Path, description = "Review run ID"),
        ("assignment_id" = String, Path, description = "Review assignment ID")
    ),
    request_body = RetryReviewAssignmentRequest,
    responses(
        (status = 200, description = "Retried review assignment", body = ReviewRunResponse),
        (status = 404, description = "Review or assignment not found", body = ProblemDetails),
        (status = 409, description = "Review assignment cannot be retried", body = ProblemDetails),
    ),
    tag = "reviews"
)]
pub async fn retry_review_assignment(
    State(state): State<AppState>,
    Path((review_run_id, assignment_id)): Path<(String, String)>,
    Json(req): Json<RetryReviewAssignmentRequest>,
) -> Result<Json<ReviewRunResponse>, ApiError> {
    let run = state
        .review_runtime
        .retry_assignment(&review_run_id, &assignment_id, req)
        .await
        .map_err(map_review_error)?;
    Ok(Json(ReviewRunResponse { run }))
}

#[utoipa::path(
    post,
    path = "/v1/reviews/{review_run_id}/stop",
    params(("review_run_id" = String, Path, description = "Review run ID")),
    responses(
        (status = 200, description = "Stopped review run", body = ReviewRunResponse),
        (status = 404, description = "Review run not found", body = ProblemDetails),
    ),
    tag = "reviews"
)]
pub async fn stop_review(
    State(state): State<AppState>,
    Path(review_run_id): Path<String>,
) -> Result<Json<ReviewRunResponse>, ApiError> {
    let run = state
        .review_runtime
        .stop_run(&review_run_id)
        .await
        .map_err(map_review_error)?;
    Ok(Json(ReviewRunResponse { run }))
}

#[utoipa::path(
    post,
    path = "/v1/reviews/{review_run_id}/send-feedback",
    params(("review_run_id" = String, Path, description = "Review run ID")),
    responses(
        (status = 200, description = "Sent review feedback", body = ReviewRunResponse),
        (status = 400, description = "Review feedback is not ready", body = ProblemDetails),
    ),
    tag = "reviews"
)]
pub async fn send_review_feedback(
    State(state): State<AppState>,
    Path(review_run_id): Path<String>,
) -> Result<Json<ReviewRunResponse>, ApiError> {
    let run = state
        .review_runtime
        .send_feedback(&review_run_id)
        .await
        .map_err(map_review_error)?;
    Ok(Json(ReviewRunResponse { run }))
}

#[utoipa::path(
    post,
    path = "/v1/reviews/{review_run_id}/revision-ready",
    params(("review_run_id" = String, Path, description = "Review run ID")),
    request_body = MarkReviewRevisionReadyRequest,
    responses(
        (status = 200, description = "Started next review round", body = ReviewRunResponse),
        (status = 400, description = "Revision is not ready or max rounds reached", body = ProblemDetails),
    ),
    tag = "reviews"
)]
pub async fn mark_review_revision_ready(
    State(state): State<AppState>,
    Path(review_run_id): Path<String>,
    Json(req): Json<MarkReviewRevisionReadyRequest>,
) -> Result<Json<ReviewRunResponse>, ApiError> {
    let run = state
        .review_runtime
        .mark_revision_ready(&review_run_id, req)
        .await
        .map_err(map_review_error)?;
    Ok(Json(ReviewRunResponse { run }))
}

pub async fn get_reviews_mcp_endpoint(
    State(_state): State<AppState>,
    Path((_workspace_id, _session_id)): Path<(String, String)>,
) -> impl IntoResponse {
    StatusCode::NO_CONTENT
}

pub async fn post_reviews_mcp_endpoint(
    State(state): State<AppState>,
    Path((workspace_id, session_id)): Path<(String, String)>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<impl IntoResponse, ApiError> {
    let capability_header = headers
        .get(state.review_session_hooks.capability_header_name())
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| {
            ApiError::unauthorized(
                "Missing review capability token.",
                "REVIEW_MCP_UNAUTHORIZED",
            )
        })?;
    let is_valid = state
        .review_session_hooks
        .validate_capability_token(capability_header, &workspace_id, &session_id)
        .map_err(|error| ApiError::internal(error.to_string()))?;
    if !is_valid {
        return Err(ApiError::unauthorized(
            "Invalid review capability token.",
            "REVIEW_MCP_UNAUTHORIZED",
        ));
    }

    let response = handle_json_rpc(
        state.review_runtime.as_ref(),
        &workspace_id,
        &session_id,
        body,
    )
    .await
    .map_err(|error| ApiError::bad_request(error.to_string(), "REVIEW_MCP_REQUEST_INVALID"))?;

    match response {
        Some(payload) => Ok((StatusCode::OK, Json(payload)).into_response()),
        None => Ok(StatusCode::NO_CONTENT.into_response()),
    }
}

fn map_review_error(error: ReviewError) -> ApiError {
    match error {
        ReviewError::SessionNotFound(session_id) => ApiError::not_found(
            format!("Session not found: {session_id}"),
            "SESSION_NOT_FOUND",
        ),
        ReviewError::PlanNotFound(plan_id) => {
            ApiError::not_found(format!("Plan not found: {plan_id}"), "PLAN_NOT_FOUND")
        }
        ReviewError::RunNotFound(run_id) => ApiError::not_found(
            format!("Review run not found: {run_id}"),
            "REVIEW_NOT_FOUND",
        ),
        ReviewError::AssignmentNotFound(assignment_id) => ApiError::not_found(
            format!("Review assignment not found: {assignment_id}"),
            "REVIEW_ASSIGNMENT_NOT_FOUND",
        ),
        ReviewError::ActiveReviewExists
        | ReviewError::InvalidReviewerCount
        | ReviewError::InvalidMaxRounds
        | ReviewError::NotWaitingForRevision
        | ReviewError::MaxRoundsReached
        | ReviewError::RevisedPlanRequired
        | ReviewError::AmbiguousRevisedPlan
        | ReviewError::AssignmentTerminal
        | ReviewError::ReviewSubmissionTooLarge(_)
        | ReviewError::PlanParentMismatch => {
            ApiError::bad_request(error.to_string(), "REVIEW_INVALID")
        }
        ReviewError::RetryNotAllowed => {
            ApiError::conflict(error.to_string(), "REVIEW_RETRY_NOT_ALLOWED")
        }
        other => ApiError::internal(other.to_string()),
    }
}

#[allow(dead_code)]
fn _problem_details_reference(_: ProblemDetails) {}
