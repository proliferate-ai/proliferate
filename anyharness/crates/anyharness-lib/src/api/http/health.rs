use anyharness_contract::v1::{
    HealthResponse, RuntimeCapabilities, RuntimeCpuPressure, RuntimeMemoryPressure,
    RuntimePressureLevel, RuntimeResourcePressure,
};
use axum::Json;

use super::agents_contract::reconcile_summary_to_contract;
use crate::app::AppState;
use crate::observability::resource_pressure::{
    collect_resource_pressure, RuntimePressureLevel as InternalRuntimePressureLevel,
    RuntimeResourcePressure as InternalRuntimeResourcePressure,
};

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
        resource_pressure: collect_resource_pressure().map(resource_pressure_to_contract),
        agent_seed: state.agent_seed_store.health(),
        agent_reconcile: reconcile_summary_to_contract(
            &state.agent_runtime.reconcile_status().await,
        ),
    })
}

fn resource_pressure_to_contract(
    pressure: InternalRuntimeResourcePressure,
) -> RuntimeResourcePressure {
    RuntimeResourcePressure {
        level: match pressure.level {
            InternalRuntimePressureLevel::Unknown => RuntimePressureLevel::Unknown,
            InternalRuntimePressureLevel::Nominal => RuntimePressureLevel::Nominal,
            InternalRuntimePressureLevel::Elevated => RuntimePressureLevel::Elevated,
            InternalRuntimePressureLevel::Critical => RuntimePressureLevel::Critical,
        },
        cpu: pressure.cpu.map(|cpu| RuntimeCpuPressure {
            load_average_1m: cpu.load_average_1m,
            normalized_percent: cpu.normalized_percent,
            ideal_max_percent: cpu.ideal_max_percent,
            logical_core_count: cpu.logical_core_count,
        }),
        memory: pressure.memory.map(|memory| RuntimeMemoryPressure {
            used_bytes: memory.used_bytes,
            total_bytes: memory.total_bytes,
            available_bytes: memory.available_bytes,
            percent: memory.percent,
            ideal_max_percent: memory.ideal_max_percent,
        }),
        pressure_percent: pressure.pressure_percent,
        collected_at: pressure.collected_at,
    }
}
