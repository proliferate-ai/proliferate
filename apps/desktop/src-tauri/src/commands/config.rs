use serde::Deserialize;

use crate::app_config::{load_app_config_record, set_app_config_api_base_url, AppConfigRecord};

#[tauri::command]
pub async fn get_app_config() -> Result<AppConfigRecord, String> {
    load_app_config_record()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetAppConfigInput {
    /// The self-hosted server's API base URL, or `None` to reset to the
    /// packaged default (the official hosted API).
    pub api_base_url: Option<String>,
}

/// Connect-to-server write path (self-hosting v1 §3.5, B4-desktop): rewrites
/// `apiBaseUrl` in config.json. Read-once at startup, so callers must relaunch
/// the app for the new value to take effect.
#[tauri::command]
pub async fn set_app_config(input: SetAppConfigInput) -> Result<AppConfigRecord, String> {
    set_app_config_api_base_url(input.api_base_url)
}
