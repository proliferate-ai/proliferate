use crate::app_config::{load_app_config_record, AppConfigRecord};

#[tauri::command]
pub async fn get_app_config() -> Result<AppConfigRecord, String> {
    load_app_config_record()
}
