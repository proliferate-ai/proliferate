use tauri::State;

use crate::agent_seed_env;
use crate::commands::keychain;
use crate::sidecar::{self, RuntimeInfo, SharedSidecar};

#[tauri::command]
pub async fn get_runtime_info(sidecar: State<'_, SharedSidecar>) -> Result<RuntimeInfo, String> {
    let guard = sidecar.lock().await;
    Ok(guard.info.clone())
}

#[tauri::command]
pub async fn restart_runtime(
    app: tauri::AppHandle,
    sidecar: State<'_, SharedSidecar>,
) -> Result<RuntimeInfo, String> {
    let mut launch_env = keychain::load_all_secrets_for_sidecar();
    launch_env.extend(agent_seed_env::launch_env(&app));
    sidecar::restart(&sidecar, launch_env).await;
    let guard = sidecar.lock().await;
    Ok(guard.info.clone())
}
