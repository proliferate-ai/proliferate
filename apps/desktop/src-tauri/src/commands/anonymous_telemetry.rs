use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use uuid::Uuid;

use crate::app_config::{
    anonymous_telemetry_install_id_path, anonymous_telemetry_state_path, read_json_file,
    write_json_file_atomic, write_string_file_atomic,
};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnonymousUsageCountersRecord {
    pub sessions_started: u64,
    pub prompts_submitted: u64,
    pub workspaces_created_local: u64,
    pub workspaces_created_cloud: u64,
    pub credentials_synced: u64,
    pub connectors_installed: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnonymousTelemetryStateRecord {
    pub schema_version: u32,
    pub sent_milestones: Vec<String>,
    pub pending_milestones: Vec<String>,
    pub usage_counters: AnonymousUsageCountersRecord,
    pub last_usage_flushed_at: Option<String>,
}

impl Default for AnonymousTelemetryStateRecord {
    fn default() -> Self {
        Self {
            schema_version: 1,
            sent_milestones: Vec::new(),
            pending_milestones: Vec::new(),
            usage_counters: AnonymousUsageCountersRecord::default(),
            last_usage_flushed_at: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnonymousTelemetryBootstrapRecord {
    pub install_id: String,
    pub app_version: String,
    pub platform: String,
    pub arch: String,
    pub state: AnonymousTelemetryStateRecord,
}

fn load_or_create_install_id() -> Result<String, String> {
    let path = anonymous_telemetry_install_id_path()?;
    let existing = match std::fs::read_to_string(&path) {
        Ok(value) => value.trim().to_string(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(format!("Failed to read {}: {error}", path.display())),
    };

    if !existing.is_empty() {
        return Ok(existing);
    }

    let install_id = Uuid::new_v4().to_string();
    write_string_file_atomic(&path, &install_id)?;
    Ok(install_id)
}

#[tauri::command]
pub async fn load_anonymous_telemetry_bootstrap(
    app: AppHandle,
) -> Result<AnonymousTelemetryBootstrapRecord, String> {
    let state_path = anonymous_telemetry_state_path()?;
    let state = read_json_file::<AnonymousTelemetryStateRecord>(&state_path)?.unwrap_or_default();

    Ok(AnonymousTelemetryBootstrapRecord {
        install_id: load_or_create_install_id()?,
        app_version: app.package_info().version.to_string(),
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        state,
    })
}

#[tauri::command]
pub async fn save_anonymous_telemetry_state(
    state: AnonymousTelemetryStateRecord,
) -> Result<(), String> {
    let path = anonymous_telemetry_state_path()?;
    write_json_file_atomic(&path, &state)
}
