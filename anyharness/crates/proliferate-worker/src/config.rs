use std::{
    fs, io,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

use crate::error::WorkerError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerConfig {
    pub cloud_base_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enrollment_token: Option<String>,
    pub worker_db_path: PathBuf,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub integration_gateway_home: Option<PathBuf>,
    #[serde(default = "default_heartbeat_interval_seconds")]
    pub heartbeat_interval_seconds: u64,
    #[serde(skip)]
    pub config_path: Option<PathBuf>,
}

fn default_heartbeat_interval_seconds() -> u64 {
    30
}

/// Directory into which the worker writes the integration-gateway dotfile when
/// `integration_gateway_home` is not set in config. Mirrors
/// `anyharness-lib::default_runtime_home()` so the runtime and worker agree.
pub fn default_integration_gateway_home() -> PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".into());
    let dir = if std::env::var_os("PROLIFERATE_DEV").is_some() || cfg!(debug_assertions) {
        ".proliferate-local"
    } else {
        ".proliferate"
    };
    PathBuf::from(home).join(dir).join("anyharness")
}

impl WorkerConfig {
    pub fn load(path: Option<PathBuf>) -> Result<Self, WorkerError> {
        let path = path.unwrap_or_else(default_config_path);
        let contents = fs::read_to_string(&path).map_err(|source| WorkerError::ReadConfig {
            path: path.clone(),
            source,
        })?;
        let mut config: Self =
            toml::from_str(&contents).map_err(|source| WorkerError::ParseConfig {
                path: path.clone(),
                source,
            })?;
        config.config_path = Some(path);
        Ok(config)
    }

    pub fn clear_enrollment_token(&self) -> Result<(), WorkerError> {
        let Some(path) = self.config_path.clone() else {
            return Ok(());
        };
        if self.enrollment_token.is_none() {
            return Ok(());
        }
        let mut sanitized = self.clone();
        sanitized.enrollment_token = None;
        let contents =
            toml::to_string_pretty(&sanitized).map_err(|source| WorkerError::SerializeConfig {
                path: path.clone(),
                source,
            })?;
        write_private_config(&path, contents)
    }
}

fn write_private_config(path: &Path, contents: String) -> Result<(), WorkerError> {
    write_private_file(path, contents.as_bytes(), "config.toml", |path, source| {
        WorkerError::WriteConfig { path, source }
    })
}

/// Atomically write `contents` to `path` with 0600 perms, creating the parent
/// directory (0700) if needed. Shared by config + integration-gateway dotfile.
/// `write_err` maps write/rename failures to the caller's error variant.
pub(crate) fn write_private_file(
    path: &Path,
    contents: &[u8],
    fallback_name: &str,
    write_err: fn(PathBuf, io::Error) -> WorkerError,
) -> Result<(), WorkerError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|source| WorkerError::CreateParent {
            path: parent.to_path_buf(),
            source,
        })?;
        set_private_dir_permissions(parent)?;
    }
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(fallback_name);
    let tmp_path = path.with_file_name(format!(".{file_name}.tmp.{}", std::process::id()));
    fs::write(&tmp_path, contents).map_err(|source| write_err(tmp_path.clone(), source))?;
    set_private_file_permissions(&tmp_path)?;
    fs::rename(&tmp_path, path).map_err(|source| write_err(path.to_path_buf(), source))
}

#[cfg(unix)]
fn set_private_file_permissions(path: &Path) -> Result<(), WorkerError> {
    use std::os::unix::fs::PermissionsExt;

    let permissions = fs::Permissions::from_mode(0o600);
    fs::set_permissions(path, permissions).map_err(|source| WorkerError::SetPrivatePermissions {
        path: path.to_path_buf(),
        source,
    })
}

#[cfg(not(unix))]
fn set_private_file_permissions(_path: &Path) -> Result<(), WorkerError> {
    Ok(())
}

#[cfg(unix)]
fn set_private_dir_permissions(path: &Path) -> Result<(), WorkerError> {
    use std::os::unix::fs::PermissionsExt;

    let permissions = fs::Permissions::from_mode(0o700);
    fs::set_permissions(path, permissions).map_err(|source| WorkerError::SetPrivatePermissions {
        path: path.to_path_buf(),
        source,
    })
}

#[cfg(not(unix))]
fn set_private_dir_permissions(_path: &Path) -> Result<(), WorkerError> {
    Ok(())
}

fn default_config_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".proliferate")
        .join("worker")
        .join("config.toml")
}
