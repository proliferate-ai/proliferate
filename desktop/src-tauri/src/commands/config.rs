use std::path::PathBuf;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfigRecord {
    pub api_base_url: Option<String>,
}

fn home_dir() -> Result<PathBuf, String> {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .map_err(|_| "Home directory not available".to_string())
}

fn config_path() -> Result<PathBuf, String> {
    Ok(home_dir()?.join(".proliferate").join("config.json"))
}

#[tauri::command]
pub async fn get_app_config() -> Result<Option<AppConfigRecord>, String> {
    let path = config_path()?;
    let contents = match std::fs::read_to_string(&path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Failed to read {}: {error}", path.display())),
    };

    let parsed: serde_json::Value = serde_json::from_str(&contents)
        .map_err(|error| format!("Failed to parse {}: {error}", path.display()))?;

    let api_base_url = parsed
        .get("apiBaseUrl")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    Ok(Some(AppConfigRecord { api_base_url }))
}
