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
    /// Mailbox directory the Worker writes update requests into and the
    /// Supervisor consumes. Server value: `.proliferate/supervisor/updates`
    /// (`bootstrap.supervisor_update_request_dir`).
    #[serde(default = "default_update_request_dir")]
    pub update_request_dir: PathBuf,
    /// Private staging directory for downloaded, re-verified artifacts before
    /// the atomic activate. Server value under `.proliferate/supervisor/staging`.
    #[serde(default = "default_staging_dir")]
    pub staging_dir: PathBuf,
    /// AnyHarness `/health` URL the activation health-gate polls after a
    /// restart. Server value: `http://127.0.0.1:<runtime_port>/health`.
    #[serde(default = "default_anyharness_health_url")]
    pub anyharness_health_url: String,
    /// How many times the health gate polls `/health` before giving up.
    #[serde(default = "default_health_check_attempts")]
    pub health_check_attempts: u32,
    /// Delay between health-gate polls, in seconds.
    #[serde(default = "default_health_check_delay_seconds")]
    pub health_check_delay_seconds: u64,
    /// Upper bound on a downloaded artifact, in bytes. A larger body is
    /// rejected mid-stream (never buffered whole).
    #[serde(default = "default_max_artifact_bytes")]
    pub max_artifact_bytes: u64,
    /// Whole-download timeout for the bounded artifact fetch, in seconds.
    #[serde(default = "default_download_timeout_seconds")]
    pub download_timeout_seconds: u64,
}

fn default_anyharness_args() -> Vec<String> {
    vec!["serve".to_string()]
}

fn default_restart_delay_seconds() -> u64 {
    5
}

fn default_update_request_dir() -> PathBuf {
    supervisor_state_dir().join("updates")
}

fn default_staging_dir() -> PathBuf {
    supervisor_state_dir().join("staging")
}

fn default_anyharness_health_url() -> String {
    "http://127.0.0.1:8457/health".to_string()
}

fn default_health_check_attempts() -> u32 {
    30
}

fn default_health_check_delay_seconds() -> u64 {
    2
}

fn default_max_artifact_bytes() -> u64 {
    512 * 1024 * 1024
}

fn default_download_timeout_seconds() -> u64 {
    300
}

fn supervisor_state_dir() -> PathBuf {
    dirs_fallback_home()
        .join(".proliferate")
        .join("supervisor")
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
    supervisor_state_dir().join("config.toml")
}

fn dirs_fallback_home() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}
