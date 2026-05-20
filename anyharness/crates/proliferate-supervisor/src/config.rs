use std::{collections::BTreeMap, fs, path::PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::SupervisorError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupervisorConfig {
    pub anyharness_binary: PathBuf,
    pub worker_binary: PathBuf,
    pub worker_config: PathBuf,
    #[serde(default = "default_anyharness_args")]
    pub anyharness_args: Vec<String>,
    #[serde(default)]
    pub anyharness_env: BTreeMap<String, String>,
    #[serde(default)]
    pub process_env: BTreeMap<String, String>,
    #[serde(default = "default_restart_delay_seconds")]
    pub restart_delay_seconds: u64,
}

fn default_anyharness_args() -> Vec<String> {
    vec!["serve".to_string()]
}

fn default_restart_delay_seconds() -> u64 {
    5
}

impl SupervisorConfig {
    pub fn load(path: Option<PathBuf>) -> Result<Self, SupervisorError> {
        let path = path.unwrap_or_else(default_config_path);
        let contents = fs::read_to_string(&path).map_err(|source| SupervisorError::ReadConfig {
            path: path.clone(),
            source,
        })?;
        toml::from_str(&contents).map_err(|source| SupervisorError::ParseConfig { path, source })
    }
}

fn default_config_path() -> PathBuf {
    dirs_fallback_home()
        .join(".proliferate")
        .join("supervisor")
        .join("config.toml")
}

fn dirs_fallback_home() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}
