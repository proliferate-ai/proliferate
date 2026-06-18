use anyharness_contract::v1::{HealthResponse, RuntimeCapabilities};
use axum::Json;

use super::agents_contract::reconcile_summary_to_contract;
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
        capabilities: RuntimeCapabilities {
            replay: crate::domains::sessions::replay::replay_enabled(),
        },
        agent_seed: state.agent_seed_store.health(),
        agent_reconcile: reconcile_summary_to_contract(
            &state.agent_runtime.reconcile_status().await,
        ),
    })
}
