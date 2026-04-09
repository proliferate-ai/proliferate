use anyharness_contract::v1::HealthResponse;
use axum::Json;

use crate::app::AppState;

#[utoipa::path(
    get,
    path = "/health",
    responses(
        (status = 200, description = "Runtime health check", body = HealthResponse),
    ),
    tag = "health"
)]
pub async fn get_health(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        runtime_home: state.runtime_home.display().to_string(),
    })
}
