use std::path::{Path, PathBuf};

use serde::{de::DeserializeOwned, Deserialize, Serialize};

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppConfigFile {
    api_base_url: Option<String>,
    telemetry_disabled: Option<bool>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfigRecord {
    pub api_base_url: Option<String>,
    pub telemetry_disabled: bool,
    pub native_dev_profile: bool,
}

pub fn app_dir_name_for_native_dev_profile(native_dev_profile: bool) -> &'static str {
    if native_dev_profile {
        ".proliferate-local"
    } else {
        ".proliferate"
    }
}

pub fn native_dev_profile() -> bool {
    std::env::var("PROLIFERATE_DEV").is_ok()
}

pub fn app_dir_name() -> &'static str {
    app_dir_name_for_native_dev_profile(native_dev_profile())
}

pub fn home_dir() -> Result<PathBuf, String> {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .map_err(|_| "Home directory not available".to_string())
}

pub fn app_dir_path() -> Result<PathBuf, String> {
    Ok(home_dir()?.join(app_dir_name()))
}

pub fn config_path() -> Result<PathBuf, String> {
    Ok(app_dir_path()?.join("config.json"))
}

pub fn anonymous_telemetry_install_id_path() -> Result<PathBuf, String> {
    Ok(app_dir_path()?.join("install_id"))
}

pub fn anonymous_telemetry_state_path() -> Result<PathBuf, String> {
    Ok(app_dir_path()?.join("anonymous-telemetry-desktop.json"))
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value
        .map(|candidate| candidate.trim().to_string())
        .filter(|candidate| !candidate.is_empty())
}

fn app_config_record_from_file(parsed: AppConfigFile, native_dev_profile: bool) -> AppConfigRecord {
    AppConfigRecord {
        api_base_url: normalize_optional_string(parsed.api_base_url),
        telemetry_disabled: parsed.telemetry_disabled.unwrap_or(false),
        native_dev_profile,
    }
}

pub fn read_json_file<T: DeserializeOwned>(path: &Path) -> Result<Option<T>, String> {
    let contents = match std::fs::read_to_string(path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Failed to read {}: {error}", path.display())),
    };

    serde_json::from_str(&contents)
        .map(Some)
        .map_err(|error| format!("Failed to parse {}: {error}", path.display()))
}

fn replace_file_atomic(temp_path: &Path, destination_path: &Path) -> Result<(), String> {
    match std::fs::rename(temp_path, destination_path) {
        Ok(()) => Ok(()),
        Err(_error) if destination_path.exists() => {
            std::fs::remove_file(destination_path).map_err(|remove_error| {
                format!(
                    "Failed to replace {} after rename conflict: {remove_error}",
                    destination_path.display()
                )
            })?;
            std::fs::rename(temp_path, destination_path).map_err(|rename_error| {
                format!(
                    "Failed to finalize atomic write for {}: {rename_error}",
                    destination_path.display()
                )
            })
        }
        Err(error) => Err(format!(
            "Failed to move {} into place: {error}",
            destination_path.display()
        )),
    }
}

pub fn write_json_file_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;
    }

    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("Failed to serialize {}: {error}", path.display()))?;
    let temp_path = path.with_extension(format!("tmp-{}", std::process::id()));
    std::fs::write(&temp_path, bytes)
        .map_err(|error| format!("Failed to write {}: {error}", temp_path.display()))?;
    replace_file_atomic(&temp_path, path)
}

pub fn write_string_file_atomic(path: &Path, value: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;
    }

    let temp_path = path.with_extension(format!("tmp-{}", std::process::id()));
    std::fs::write(&temp_path, value)
        .map_err(|error| format!("Failed to write {}: {error}", temp_path.display()))?;
    replace_file_atomic(&temp_path, path)
}

pub fn load_app_config_record() -> Result<AppConfigRecord, String> {
    let path = config_path()?;
    let parsed = read_json_file::<AppConfigFile>(&path)?.unwrap_or_default();
    Ok(app_config_record_from_file(parsed, native_dev_profile()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_path(file_name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be valid")
            .as_nanos();
        std::env::temp_dir()
            .join(format!("proliferate-app-config-{unique}"))
            .join(file_name)
    }

    #[test]
    fn app_dir_name_switches_between_prod_and_dev_profiles() {
        assert_eq!(app_dir_name_for_native_dev_profile(false), ".proliferate");
        assert_eq!(
            app_dir_name_for_native_dev_profile(true),
            ".proliferate-local"
        );
    }

    #[test]
    fn app_config_record_from_file_normalizes_runtime_fields() {
        let record = app_config_record_from_file(
            AppConfigFile {
                api_base_url: Some(" https://api.customer.example/ ".to_string()),
                telemetry_disabled: Some(true),
            },
            true,
        );

        assert_eq!(
            record,
            AppConfigRecord {
                api_base_url: Some("https://api.customer.example/".to_string()),
                telemetry_disabled: true,
                native_dev_profile: true,
            }
        );
    }

    #[test]
    fn write_json_file_atomic_overwrites_previous_contents() {
        let path = temp_path("config.json");
        write_json_file_atomic(&path, &json!({"apiBaseUrl": "https://one.example"}))
            .expect("first write should succeed");
        write_json_file_atomic(
            &path,
            &json!({"apiBaseUrl": "https://two.example", "telemetryDisabled": true}),
        )
        .expect("second write should succeed");

        let parsed: serde_json::Value = read_json_file(&path)
            .expect("read should succeed")
            .expect("json file should exist");
        assert_eq!(
            parsed,
            json!({"apiBaseUrl": "https://two.example", "telemetryDisabled": true})
        );

        std::fs::remove_dir_all(path.parent().expect("temp dir should exist"))
            .expect("temp dir cleanup should succeed");
    }

    #[test]
    fn write_string_file_atomic_overwrites_previous_contents() {
        let path = temp_path("install_id");
        write_string_file_atomic(&path, "install-one").expect("first write should succeed");
        write_string_file_atomic(&path, "install-two").expect("second write should succeed");

        let contents = std::fs::read_to_string(&path).expect("read should succeed");
        assert_eq!(contents, "install-two");

        std::fs::remove_dir_all(path.parent().expect("temp dir should exist"))
            .expect("temp dir cleanup should succeed");
    }
}
