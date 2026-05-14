use std::{fs, path::PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::WorkerError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerConfig {
    pub cloud_base_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enrollment_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anyharness_base_url: Option<String>,
    pub worker_db_path: PathBuf,
    #[serde(default = "default_heartbeat_interval_seconds")]
    pub heartbeat_interval_seconds: u64,
    #[serde(skip)]
    pub config_path: Option<PathBuf>,
}

fn default_heartbeat_interval_seconds() -> u64 {
    60
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
        fs::write(&path, contents).map_err(|source| WorkerError::WriteConfig {
            path: path.clone(),
            source,
        })?;
        set_private_file_permissions(&path)
    }
}

#[cfg(unix)]
fn set_private_file_permissions(path: &PathBuf) -> Result<(), WorkerError> {
    use std::os::unix::fs::PermissionsExt;

    let permissions = fs::Permissions::from_mode(0o600);
    fs::set_permissions(path, permissions).map_err(|source| WorkerError::SetPrivatePermissions {
        path: path.clone(),
        source,
    })
}

#[cfg(not(unix))]
fn set_private_file_permissions(_path: &PathBuf) -> Result<(), WorkerError> {
    Ok(())
}

fn default_config_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".proliferate")
        .join("worker")
        .join("config.toml")
}
