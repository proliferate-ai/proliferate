use anyharness_contract::v1::{
    ApplyRuntimeConfigRequest, ApplyRuntimeConfigResponse, RuntimeConfigStatusResponse,
};
use axum::{extract::State, Json};

use super::error::ApiError;
use crate::app::AppState;
use crate::domains::runtime_config::service::RuntimeConfigError;

#[utoipa::path(
    put,
    path = "/v1/runtime-config",
    request_body = ApplyRuntimeConfigRequest,
    responses(
        (status = 200, description = "Applied runtime config", body = ApplyRuntimeConfigResponse),
        (status = 400, description = "Invalid runtime config", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "runtime-config"
)]
pub async fn apply_runtime_config(
    State(state): State<AppState>,
    Json(req): Json<ApplyRuntimeConfigRequest>,
) -> Result<Json<ApplyRuntimeConfigResponse>, ApiError> {
    state
        .runtime_config_service
        .apply_config(req)
        .map(Json)
        .map_err(map_runtime_config_error)
}

#[utoipa::path(
    get,
    path = "/v1/runtime-config",
    responses(
        (status = 200, description = "Current runtime config", body = RuntimeConfigStatusResponse),
    ),
    tag = "runtime-config"
)]
pub async fn get_runtime_config(
    State(state): State<AppState>,
) -> Result<Json<RuntimeConfigStatusResponse>, ApiError> {
    state
        .runtime_config_service
        .status()
        .map(Json)
        .map_err(map_runtime_config_error)
}

pub fn map_runtime_config_error(error: RuntimeConfigError) -> ApiError {
    match error {
        RuntimeConfigError::Missing => {
            ApiError::conflict("runtime config is missing", "RUNTIME_CONFIG_MISSING")
        }
        RuntimeConfigError::Stale => {
            ApiError::conflict("runtime config revision is stale", "RUNTIME_CONFIG_STALE")
        }
        RuntimeConfigError::UnresolvedCredentials => ApiError::conflict(
            "runtime config contains unresolved credentials",
            "RUNTIME_CONFIG_UNRESOLVED_CREDENTIALS",
        ),
        RuntimeConfigError::MissingCredentials(_) => ApiError::conflict(
            "runtime config credentials must be fulfilled before launch",
            "RUNTIME_CONFIG_RESOLUTION_REQUIRED",
        ),
        RuntimeConfigError::InlineSecretLiteral(field) => ApiError::bad_request(
            format!("runtime config contains inline secret-bearing launch value: {field}"),
            "RUNTIME_CONFIG_INLINE_SECRET_LITERAL",
        ),
        RuntimeConfigError::MissingArtifact(hash) => ApiError::bad_request(
            format!("runtime config artifact is missing: {hash}"),
            "RUNTIME_CONFIG_ARTIFACT_MISSING",
        ),
        RuntimeConfigError::UnmaterializedValue => ApiError::conflict(
            "runtime config contains an unmaterialized launch value",
            "RUNTIME_CONFIG_UNMATERIALIZED_VALUE",
        ),
        RuntimeConfigError::Internal(error) => ApiError::internal(error.to_string()),
    }
}
