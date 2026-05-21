use anyharness_contract::v1::{PushRevokedJtisRequest, PushRevokedJtisResponse};
use axum::{extract::State, Json};

use super::error::ApiError;
use crate::app::AppState;

#[utoipa::path(
    put,
    path = "/v1/auth/revoked-jtis",
    request_body = PushRevokedJtisRequest,
    responses(
        (status = 200, description = "Accepted revoked direct-attach token ids", body = PushRevokedJtisResponse),
        (status = 400, description = "Invalid revocation payload", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "auth"
)]
pub async fn push_revoked_jtis(
    State(state): State<AppState>,
    Json(req): Json<PushRevokedJtisRequest>,
) -> Result<Json<PushRevokedJtisResponse>, ApiError> {
    if req.expires_at <= 0 {
        return Err(ApiError::bad_request(
            "expiresAt must be a positive Unix timestamp",
            "INVALID_REVOKED_JTI_EXPIRY",
        ));
    }
    let accepted = state
        .auth_manager
        .push_revoked_jtis(&req.jti_hashes, req.expires_at);
    Ok(Json(PushRevokedJtisResponse { accepted }))
}
