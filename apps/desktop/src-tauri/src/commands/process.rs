#[tauri::command]
pub async fn command_exists(command: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(crate::platform::resolve_executable(&command).is_some())
    })
    .await
    .map_err(|error| format!("command_exists task failed: {error}"))?
}
