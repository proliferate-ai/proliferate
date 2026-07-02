use uuid::Uuid;

use crate::app_config::{desktop_install_id_path, write_string_file_atomic};

fn load_or_create_desktop_install_id() -> Result<String, String> {
    let path = desktop_install_id_path()?;
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
pub async fn get_desktop_install_id() -> Result<String, String> {
    load_or_create_desktop_install_id()
}
