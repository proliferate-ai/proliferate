use anyharness_contract::v1::{
    RuntimeConfigPrefetchRequest, RuntimeConfigPrefetchResponse, RuntimeResolutionFulfillRequest,
    RuntimeResolutionRejectRequest, RuntimeResolutionRequest, TargetRuntimeConfigApplyResponse,
    TargetRuntimeConfigRefreshRequest, TargetRuntimeConfigResponse,
};
use axum::{
    extract::{Path, State},
    Json,
};

use crate::api::http::error::ApiError;
use crate::app::AppState;

#[utoipa::path(
    get,
    path = "/v1/runtime-config",
    responses(
        (status = 200, description = "Read current target runtime config and pending resolution requests", body = TargetRuntimeConfigResponse),
    ),
    tag = "runtime-config"
)]
pub async fn get_runtime_config(
    State(state): State<AppState>,
) -> Result<Json<TargetRuntimeConfigResponse>, ApiError> {
    state
        .runtime_config_service
        .get_config()
        .map(Json)
        .map_err(|error| ApiError::internal(error.to_string()))
}

#[utoipa::path(
    put,
    path = "/v1/runtime-config",
    request_body = TargetRuntimeConfigRefreshRequest,
    responses(
        (status = 200, description = "Apply a target runtime config revision", body = TargetRuntimeConfigApplyResponse),
        (status = 400, description = "Invalid runtime config manifest", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "runtime-config"
)]
pub async fn put_runtime_config(
    State(state): State<AppState>,
    Json(request): Json<TargetRuntimeConfigRefreshRequest>,
) -> Result<Json<TargetRuntimeConfigApplyResponse>, ApiError> {
    state
        .runtime_config_service
        .put_config(request)
        .map(Json)
        .map_err(|error| ApiError::bad_request(error.to_string(), "INVALID_RUNTIME_CONFIG"))
}

#[utoipa::path(
    post,
    path = "/v1/runtime-config/prefetch",
    request_body = RuntimeConfigPrefetchRequest,
    responses(
        (status = 200, description = "Create resolution requests for currently missing runtime config material", body = RuntimeConfigPrefetchResponse),
        (status = 409, description = "Runtime config has not been applied", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "runtime-config"
)]
pub async fn prefetch_runtime_config(
    State(state): State<AppState>,
    Json(request): Json<RuntimeConfigPrefetchRequest>,
) -> Result<Json<RuntimeConfigPrefetchResponse>, ApiError> {
    state
        .runtime_config_service
        .prefetch(request)
        .map(Json)
        .map_err(|error| ApiError::conflict(error.to_string(), "RUNTIME_CONFIG_NOT_APPLIED"))
}

#[utoipa::path(
    get,
    path = "/v1/runtime-config/resolution-requests",
    responses(
        (status = 200, description = "List pending runtime config resolution requests", body = Vec<RuntimeResolutionRequest>),
    ),
    tag = "runtime-config"
)]
pub async fn list_runtime_config_resolution_requests(
    State(state): State<AppState>,
) -> Json<Vec<RuntimeResolutionRequest>> {
    Json(state.runtime_config_service.list_resolution_requests())
}

#[utoipa::path(
    post,
    path = "/v1/runtime-config/resolution-requests/{request_id}/fulfill",
    params(("request_id" = String, Path, description = "Runtime config resolution request id")),
    request_body = RuntimeResolutionFulfillRequest,
    responses(
        (status = 200, description = "Fulfill a pending runtime config resolution request", body = RuntimeResolutionRequest),
        (status = 400, description = "Invalid fulfillment payload", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "runtime-config"
)]
pub async fn fulfill_runtime_config_resolution_request(
    State(state): State<AppState>,
    Path(request_id): Path<String>,
    Json(request): Json<RuntimeResolutionFulfillRequest>,
) -> Result<Json<RuntimeResolutionRequest>, ApiError> {
    state
        .runtime_config_service
        .fulfill_request(&request_id, request)
        .map(Json)
        .map_err(|error| {
            ApiError::bad_request(error.to_string(), "INVALID_RUNTIME_CONFIG_FULFILLMENT")
        })
}

#[utoipa::path(
    post,
    path = "/v1/runtime-config/resolution-requests/{request_id}/reject",
    params(("request_id" = String, Path, description = "Runtime config resolution request id")),
    request_body = RuntimeResolutionRejectRequest,
    responses(
        (status = 204, description = "Reject a pending runtime config resolution request"),
        (status = 404, description = "Resolution request not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "runtime-config"
)]
pub async fn reject_runtime_config_resolution_request(
    State(state): State<AppState>,
    Path(request_id): Path<String>,
    Json(request): Json<RuntimeResolutionRejectRequest>,
) -> Result<(), ApiError> {
    state
        .runtime_config_service
        .reject_request(&request_id, request)
        .map_err(|error| ApiError::not_found(error.to_string(), "RUNTIME_CONFIG_REQUEST_NOT_FOUND"))
}
