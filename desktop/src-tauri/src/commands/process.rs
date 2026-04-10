use std::path::PathBuf;

fn resolved_path() -> Option<String> {
    crate::sidecar::resolve_shell_path().or_else(|| std::env::var("PATH").ok())
}

#[tauri::command]
pub async fn command_exists(command: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let current_dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let result = match resolved_path() {
            Some(path) => which::which_in(command, Some(path), current_dir),
            None => which::which(command),
        };
        Ok(result.is_ok())
    })
    .await
    .map_err(|error| format!("command_exists task failed: {error}"))?
}
