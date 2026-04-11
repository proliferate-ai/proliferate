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
    Ok(home_dir()?
        .join(proliferate_home_dir_name(cfg!(debug_assertions)))
        .join("config.json"))
}

fn proliferate_home_dir_name(debug_build: bool) -> &'static str {
    if std::env::var_os("PROLIFERATE_DEV").is_some() || debug_build {
        ".proliferate-local"
    } else {
        ".proliferate"
    }
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

#[cfg(test)]
mod tests {
    use std::ffi::OsString;
    use std::sync::{Mutex, OnceLock};

    use super::proliferate_home_dir_name;

    static ENV_MUTEX: OnceLock<Mutex<()>> = OnceLock::new();

    struct ProliferateDevEnvGuard {
        previous: Option<OsString>,
    }

    impl Drop for ProliferateDevEnvGuard {
        fn drop(&mut self) {
            match self.previous.as_ref() {
                Some(value) => std::env::set_var("PROLIFERATE_DEV", value),
                None => std::env::remove_var("PROLIFERATE_DEV"),
            }
        }
    }

    fn set_proliferate_dev_env(value: Option<&str>) -> ProliferateDevEnvGuard {
        let previous = std::env::var_os("PROLIFERATE_DEV");
        match value {
            Some(flag) => std::env::set_var("PROLIFERATE_DEV", flag),
            None => std::env::remove_var("PROLIFERATE_DEV"),
        }
        ProliferateDevEnvGuard { previous }
    }

    #[test]
    fn proliferate_home_dir_name_uses_local_dir_for_debug_builds() {
        let _lock = ENV_MUTEX
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("expected env mutex");
        let _guard = set_proliferate_dev_env(None);
        assert_eq!(proliferate_home_dir_name(true), ".proliferate-local");
    }

    #[test]
    fn proliferate_home_dir_name_uses_local_dir_when_env_is_set() {
        let _lock = ENV_MUTEX
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("expected env mutex");
        let _guard = set_proliferate_dev_env(Some("1"));
        assert_eq!(proliferate_home_dir_name(false), ".proliferate-local");
    }

    #[test]
    fn proliferate_home_dir_name_uses_production_dir_for_release_without_env() {
        let _lock = ENV_MUTEX
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("expected env mutex");
        let _guard = set_proliferate_dev_env(None);
        assert_eq!(proliferate_home_dir_name(false), ".proliferate");
    }
}
