use tauri::State;

use crate::commands::keychain;
use crate::sidecar::{self, RuntimeInfo, SharedSidecar};

#[tauri::command]
pub async fn get_runtime_info(sidecar: State<'_, SharedSidecar>) -> Result<RuntimeInfo, String> {
    let guard = sidecar.lock().await;
    Ok(guard.info.clone())
}

#[tauri::command]
pub async fn restart_runtime(sidecar: State<'_, SharedSidecar>) -> Result<RuntimeInfo, String> {
    let launch_env = keychain::load_all_secrets_for_sidecar();
    sidecar::restart(&sidecar, launch_env).await;
    let guard = sidecar.lock().await;
    Ok(guard.info.clone())
}
