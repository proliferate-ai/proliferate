use tauri::State;

use crate::agent_seed_env;
use crate::commands::keychain;
use crate::diagnostics_collector::producer::TauriDiagnosticsProducer;
use crate::diagnostics_collector::supervisor::DiagnosticsCollectorSupervisor;
use crate::sidecar::{self, RuntimeInfo, SharedSidecar};
use std::sync::Arc;

#[tauri::command]
pub async fn get_runtime_info(sidecar: State<'_, SharedSidecar>) -> Result<RuntimeInfo, String> {
    let guard = sidecar.lock().await;
    Ok(guard.info.clone())
}

#[tauri::command]
pub async fn restart_runtime(
    app: tauri::AppHandle,
    sidecar: State<'_, SharedSidecar>,
    diagnostics_supervisor: State<'_, Arc<DiagnosticsCollectorSupervisor>>,
    diagnostics_producer: State<'_, TauriDiagnosticsProducer>,
) -> Result<RuntimeInfo, String> {
    if diagnostics_supervisor.shutdown_is_armed() {
        diagnostics_producer
            .begin_lifecycle("desktop.anyharness_process.restart")
            .terminal(
                proliferate_diagnostics_protocol::v1::types::TerminalOutcomeV1::Rejected,
                Some("shutdown_armed"),
            );
        return Err("Runtime restart rejected because shutdown is armed".to_string());
    }
    let _ = diagnostics_supervisor.wait_startup_barrier().await;
    let mut launch_env = keychain::load_all_secrets_for_sidecar();
    launch_env.extend(agent_seed_env::launch_env(&app));
    sidecar::restart(
        &sidecar,
        launch_env,
        &diagnostics_producer,
        &diagnostics_supervisor,
    )
    .await?;
    let guard = sidecar.lock().await;
    Ok(guard.info.clone())
}
