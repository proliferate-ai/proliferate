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

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInfoRecord {
    pub url: String,
    pub port: u16,
    pub status: String,
    pub runtime_home: Option<String>,
    pub version: Option<String>,
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

fn dev_home_override_path() -> Option<PathBuf> {
    if !native_dev_profile() {
        return None;
    }

    std::env::var("PROLIFERATE_DEV_HOME")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

pub fn home_dir() -> Result<PathBuf, String> {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .map_err(|_| "Home directory not available".to_string())
}

pub fn app_dir_path() -> Result<PathBuf, String> {
    if let Some(path) = dev_home_override_path() {
        return Ok(path);
    }

    Ok(home_dir()?.join(app_dir_name()))
}

pub fn config_path() -> Result<PathBuf, String> {
    Ok(app_dir_path()?.join("config.json"))
}

pub fn logs_dir_path() -> Result<PathBuf, String> {
    Ok(app_dir_path()?.join("logs"))
}

pub fn runtime_info_path() -> Result<PathBuf, String> {
    Ok(app_dir_path()?.join("runtime-info.json"))
}

pub fn default_anyharness_runtime_home_path() -> Result<PathBuf, String> {
    Ok(app_dir_path()?.join("anyharness"))
}

/// The runtime home the local AnyHarness instance is actually using.
///
/// Dev profiles launch the harness with `--runtime-home
/// ~/.proliferate-local/runtimes/<profile>`, which the dev tooling also
/// exports as `ANYHARNESS_DEV_RUNTIME_HOME` so anything the app writes for the
/// harness (for example the worker's integration gateway dotfile) lands where
/// the harness actually looks. Falls back to the packaged default.
pub fn anyharness_runtime_home_path() -> Result<PathBuf, String> {
    if let Some(path) = dev_runtime_home_override() {
        return Ok(path);
    }
    default_anyharness_runtime_home_path()
}

fn dev_runtime_home_override() -> Option<PathBuf> {
    if !native_dev_profile() {
        return None;
    }
    dev_runtime_home_override_from(std::env::var("ANYHARNESS_DEV_RUNTIME_HOME").ok())
}

fn dev_runtime_home_override_from(value: Option<String>) -> Option<PathBuf> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

pub fn anonymous_telemetry_install_id_path() -> Result<PathBuf, String> {
    Ok(app_dir_path()?.join("install_id"))
}

pub fn desktop_install_id_path() -> Result<PathBuf, String> {
    Ok(app_dir_path()?.join("desktop_install_id"))
}

pub fn anonymous_telemetry_state_path() -> Result<PathBuf, String> {
    Ok(app_dir_path()?.join("anonymous-telemetry-desktop.json"))
}

pub fn load_runtime_info_record() -> Result<Option<RuntimeInfoRecord>, String> {
    read_json_file(&runtime_info_path()?)
}

pub fn write_runtime_info_record(value: &RuntimeInfoRecord) -> Result<(), String> {
    write_json_file_atomic(&runtime_info_path()?, value)
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

/// Validate + normalize a candidate `apiBaseUrl`: must parse as an absolute
/// `http`/`https` URL with a host. Trailing slash stripped so downstream path
/// joins (`{base}/meta`, `{base}/v1/...`) never produce a double slash.
fn validate_api_base_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Server URL is required.".to_string());
    }
    let parsed = url::Url::parse(trimmed).map_err(|_| "Enter a valid server URL.".to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("Server URL must start with http:// or https://.".to_string());
    }
    if parsed.host_str().unwrap_or("").is_empty() {
        return Err("Server URL must include a host.".to_string());
    }
    Ok(trimmed.trim_end_matches('/').to_string())
}

/// Read-modify-write `apiBaseUrl` into config.json, preserving every other key
/// already in the file (telemetry preference, and any future field). `None`
/// clears the override (reverting to the packaged default base URL). The
/// write is atomic via [`write_json_file_atomic`].
pub fn set_app_config_api_base_url(
    api_base_url: Option<String>,
) -> Result<AppConfigRecord, String> {
    set_app_config_api_base_url_at(&config_path()?, api_base_url)
}

/// Path-parameterized core of [`set_app_config_api_base_url`] so the
/// read-modify-write + unknown-field preservation can be unit tested against
/// a temp file instead of the real `~/.proliferate` home.
fn set_app_config_api_base_url_at(
    path: &Path,
    api_base_url: Option<String>,
) -> Result<AppConfigRecord, String> {
    let normalized = match api_base_url {
        Some(raw) => Some(validate_api_base_url(&raw)?),
        None => None,
    };

    let mut document =
        read_json_file::<serde_json::Map<String, serde_json::Value>>(path)?.unwrap_or_default();

    match &normalized {
        Some(value) => {
            document.insert(
                "apiBaseUrl".to_string(),
                serde_json::Value::String(value.clone()),
            );
        }
        None => {
            document.remove("apiBaseUrl");
        }
    }

    write_json_file_atomic(path, &document)?;

    let telemetry_disabled = document
        .get("telemetryDisabled")
        .and_then(serde_json::Value::as_bool);
    Ok(app_config_record_from_file(
        AppConfigFile {
            api_base_url: normalized,
            telemetry_disabled,
        },
        native_dev_profile(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_path(file_name: &str) -> PathBuf {
        // Nanos alone can collide across parallel tests (coarse clock granularity),
        // letting one test's remove_dir_all delete another's live dir; a process-wide
        // counter breaks the tie.
        static NEXT_TEMP_DIR_ID: std::sync::atomic::AtomicU64 =
            std::sync::atomic::AtomicU64::new(0);
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be valid")
            .as_nanos();
        let seq = NEXT_TEMP_DIR_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        std::env::temp_dir()
            .join(format!("proliferate-app-config-{unique}-{seq}"))
            .join(file_name)
    }

    #[test]
    fn dev_runtime_home_override_prefers_non_empty_env_value() {
        assert_eq!(
            dev_runtime_home_override_from(Some(
                "/Users/dev/.proliferate-local/runtimes/main".to_string()
            )),
            Some(PathBuf::from("/Users/dev/.proliferate-local/runtimes/main"))
        );
        assert_eq!(
            dev_runtime_home_override_from(Some("  /trimmed/home  ".to_string())),
            Some(PathBuf::from("/trimmed/home"))
        );
        assert_eq!(
            dev_runtime_home_override_from(Some("   ".to_string())),
            None
        );
        assert_eq!(dev_runtime_home_override_from(Some(String::new())), None);
        assert_eq!(dev_runtime_home_override_from(None), None);
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
    fn runtime_info_record_round_trips() {
        let path = temp_path("runtime-info.json");
        let record = RuntimeInfoRecord {
            url: "http://127.0.0.1:8457".to_string(),
            port: 8457,
            status: "healthy".to_string(),
            runtime_home: Some("/tmp/runtime-home".to_string()),
            version: Some("0.1.0".to_string()),
        };

        write_json_file_atomic(&path, &record).expect("write should succeed");
        let parsed: RuntimeInfoRecord = read_json_file(&path)
            .expect("read should succeed")
            .expect("file should exist");
        assert_eq!(parsed, record);

        std::fs::remove_dir_all(path.parent().expect("temp dir should exist"))
            .expect("temp dir cleanup should succeed");
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

    #[test]
    fn set_app_config_api_base_url_writes_to_a_fresh_file() {
        let path = temp_path("config-fresh.json");
        let record = set_app_config_api_base_url_at(
            &path,
            Some("https://proliferate.corp.example/".to_string()),
        )
        .expect("set should succeed");

        assert_eq!(
            record.api_base_url,
            Some("https://proliferate.corp.example".to_string())
        );

        let on_disk: serde_json::Value = read_json_file(&path)
            .expect("read should succeed")
            .expect("file should exist");
        assert_eq!(
            on_disk,
            json!({ "apiBaseUrl": "https://proliferate.corp.example" })
        );

        std::fs::remove_dir_all(path.parent().expect("temp dir should exist"))
            .expect("temp dir cleanup should succeed");
    }

    #[test]
    fn set_app_config_api_base_url_is_atomic_and_preserves_unknown_fields() {
        let path = temp_path("config-preserve.json");
        write_json_file_atomic(
            &path,
            &json!({
                "apiBaseUrl": "https://old.example",
                "telemetryDisabled": true,
                "someFutureField": { "nested": 1 }
            }),
        )
        .expect("seed write should succeed");

        let record = set_app_config_api_base_url_at(
            &path,
            Some("https://new.example".to_string()),
        )
        .expect("set should succeed");

        assert_eq!(record.api_base_url, Some("https://new.example".to_string()));
        assert!(record.telemetry_disabled);

        let on_disk: serde_json::Value = read_json_file(&path)
            .expect("read should succeed")
            .expect("file should exist");
        assert_eq!(
            on_disk,
            json!({
                "apiBaseUrl": "https://new.example",
                "telemetryDisabled": true,
                "someFutureField": { "nested": 1 }
            })
        );

        std::fs::remove_dir_all(path.parent().expect("temp dir should exist"))
            .expect("temp dir cleanup should succeed");
    }

    #[test]
    fn set_app_config_api_base_url_none_clears_the_override_but_keeps_other_fields() {
        let path = temp_path("config-clear.json");
        write_json_file_atomic(
            &path,
            &json!({ "apiBaseUrl": "https://old.example", "telemetryDisabled": true }),
        )
        .expect("seed write should succeed");

        let record =
            set_app_config_api_base_url_at(&path, None).expect("clearing should succeed");

        assert_eq!(record.api_base_url, None);
        assert!(record.telemetry_disabled);

        let on_disk: serde_json::Value = read_json_file(&path)
            .expect("read should succeed")
            .expect("file should exist");
        assert_eq!(on_disk, json!({ "telemetryDisabled": true }));

        std::fs::remove_dir_all(path.parent().expect("temp dir should exist"))
            .expect("temp dir cleanup should succeed");
    }

    #[test]
    fn set_app_config_api_base_url_rejects_invalid_urls_and_leaves_file_untouched() {
        let path = temp_path("config-invalid.json");
        write_json_file_atomic(&path, &json!({ "apiBaseUrl": "https://old.example" }))
            .expect("seed write should succeed");

        for invalid in [
            "not a url",
            "ftp://proliferate.corp.example",
            "https://",
            "   ",
        ] {
            let error = set_app_config_api_base_url_at(&path, Some(invalid.to_string()))
                .expect_err(&format!("{invalid} should be rejected"));
            assert!(!error.is_empty());
        }

        let on_disk: serde_json::Value = read_json_file(&path)
            .expect("read should succeed")
            .expect("file should exist");
        assert_eq!(on_disk, json!({ "apiBaseUrl": "https://old.example" }));

        std::fs::remove_dir_all(path.parent().expect("temp dir should exist"))
            .expect("temp dir cleanup should succeed");
    }
}
