use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use url::Url;

use crate::error::{Result, WorkerError};

const DEFAULT_CLOUD_BASE_URL: &str = "http://127.0.0.1:8000";
const DEFAULT_ANYHARNESS_BASE_URL: &str = "http://127.0.0.1:8457";

#[derive(Debug, Clone)]
pub struct WorkerConfig {
    pub proliferate_home: PathBuf,
    pub worker_home: PathBuf,
    pub config_path: PathBuf,
    pub database_path: PathBuf,
    pub cloud: CloudConfig,
    pub anyharness: AnyHarnessConfig,
    pub loops: LoopConfig,
    pub logging: LoggingConfig,
}

#[derive(Debug, Clone)]
pub struct CloudConfig {
    pub base_url: Url,
    pub enrollment_token: Option<String>,
}

#[derive(Debug, Clone)]
pub struct AnyHarnessConfig {
    pub base_url: Url,
    pub bearer_token: Option<String>,
}

#[derive(Debug, Clone)]
pub struct LoopConfig {
    pub heartbeat_active: Duration,
    pub heartbeat_idle: Duration,
    pub inventory: Duration,
    pub command_poll_timeout: Duration,
    pub command_idle_sleep: Duration,
    pub sync_flush: Duration,
    pub outbox_retry: Duration,
    pub activity: Duration,
    pub updates: Duration,
}

#[derive(Debug, Clone)]
pub struct LoggingConfig {
    pub level: String,
}

impl WorkerConfig {
    pub fn load(config_path_override: Option<&Path>) -> Result<Self> {
        let proliferate_home = env::var_os("PROLIFERATE_HOME")
            .map(PathBuf::from)
            .or_else(|| dirs::home_dir().map(|home| home.join(".proliferate")))
            .ok_or_else(|| WorkerError::Config("could not determine home directory".into()))?;

        let worker_home = proliferate_home.join("worker");
        let config_path = config_path_override
            .map(PathBuf::from)
            .or_else(|| env::var_os("PROLIFERATE_WORKER_CONFIG").map(PathBuf::from))
            .unwrap_or_else(|| worker_home.join("config.toml"));
        let file_values = parse_config_file(&config_path)?;

        let database_path = env_path("PROLIFERATE_WORKER_DB")
            .or_else(|| file_path(&file_values, "worker.database_path"))
            .unwrap_or_else(|| worker_home.join("worker.sqlite"));

        let cloud_base_url = env_string("PROLIFERATE_CLOUD_URL")
            .or_else(|| file_string(&file_values, "cloud.base_url"))
            .unwrap_or_else(|| DEFAULT_CLOUD_BASE_URL.to_string());
        let anyharness_base_url = env_string("ANYHARNESS_URL")
            .or_else(|| env_string("ANYHARNESS_BASE_URL"))
            .or_else(|| file_string(&file_values, "anyharness.base_url"))
            .unwrap_or_else(|| DEFAULT_ANYHARNESS_BASE_URL.to_string());

        Ok(Self {
            proliferate_home,
            worker_home,
            config_path,
            database_path,
            cloud: CloudConfig {
                base_url: Url::parse(&cloud_base_url)?,
                enrollment_token: env_string("PROLIFERATE_WORKER_ENROLLMENT_TOKEN")
                    .or_else(|| file_string(&file_values, "cloud.enrollment_token")),
            },
            anyharness: AnyHarnessConfig {
                base_url: Url::parse(&anyharness_base_url)?,
                bearer_token: env_string("ANYHARNESS_TOKEN")
                    .or_else(|| file_string(&file_values, "anyharness.bearer_token")),
            },
            loops: LoopConfig {
                heartbeat_active: duration_env_or_file(
                    "PROLIFERATE_WORKER_HEARTBEAT_ACTIVE_SECS",
                    &file_values,
                    "loops.heartbeat_active_secs",
                    15,
                    DurationUnit::Seconds,
                ),
                heartbeat_idle: duration_env_or_file(
                    "PROLIFERATE_WORKER_HEARTBEAT_IDLE_SECS",
                    &file_values,
                    "loops.heartbeat_idle_secs",
                    60,
                    DurationUnit::Seconds,
                ),
                inventory: duration_env_or_file(
                    "PROLIFERATE_WORKER_INVENTORY_SECS",
                    &file_values,
                    "loops.inventory_secs",
                    300,
                    DurationUnit::Seconds,
                ),
                command_poll_timeout: duration_env_or_file(
                    "PROLIFERATE_WORKER_COMMAND_POLL_TIMEOUT_SECS",
                    &file_values,
                    "loops.command_poll_timeout_secs",
                    25,
                    DurationUnit::Seconds,
                ),
                command_idle_sleep: duration_env_or_file(
                    "PROLIFERATE_WORKER_COMMAND_IDLE_SLEEP_SECS",
                    &file_values,
                    "loops.command_idle_sleep_secs",
                    2,
                    DurationUnit::Seconds,
                ),
                sync_flush: duration_env_or_file(
                    "PROLIFERATE_WORKER_SYNC_FLUSH_MILLIS",
                    &file_values,
                    "loops.sync_flush_millis",
                    100,
                    DurationUnit::Millis,
                ),
                outbox_retry: duration_env_or_file(
                    "PROLIFERATE_WORKER_OUTBOX_RETRY_SECS",
                    &file_values,
                    "loops.outbox_retry_secs",
                    5,
                    DurationUnit::Seconds,
                ),
                activity: duration_env_or_file(
                    "PROLIFERATE_WORKER_ACTIVITY_SECS",
                    &file_values,
                    "loops.activity_secs",
                    30,
                    DurationUnit::Seconds,
                ),
                updates: duration_env_or_file(
                    "PROLIFERATE_WORKER_UPDATES_SECS",
                    &file_values,
                    "loops.updates_secs",
                    300,
                    DurationUnit::Seconds,
                ),
            },
            logging: LoggingConfig {
                level: env_string("PROLIFERATE_WORKER_LOG_LEVEL")
                    .or_else(|| file_string(&file_values, "logging.level"))
                    .unwrap_or_else(|| "info".to_string()),
            },
        })
    }
}

fn parse_config_file(path: &Path) -> Result<BTreeMap<String, String>> {
    if !path.exists() {
        return Ok(BTreeMap::new());
    }

    let content = fs::read_to_string(path)?;
    let mut values = BTreeMap::new();
    let mut section = String::new();

    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if line.starts_with('[') && line.ends_with(']') {
            section = line
                .trim_start_matches('[')
                .trim_end_matches(']')
                .trim()
                .to_string();
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        let value = value
            .trim()
            .trim_matches('"')
            .trim_matches('\'')
            .to_string();
        let full_key = if section.is_empty() {
            key.to_string()
        } else {
            format!("{section}.{key}")
        };
        values.insert(full_key, value);
    }

    Ok(values)
}

fn duration_env_or_file(
    env_key: &str,
    values: &BTreeMap<String, String>,
    file_key: &str,
    default_value: u64,
    unit: DurationUnit,
) -> Duration {
    let raw = env_string(env_key).or_else(|| file_string(values, file_key));
    let value = raw
        .as_deref()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(default_value);
    match unit {
        DurationUnit::Seconds => Duration::from_secs(value),
        DurationUnit::Millis => Duration::from_millis(value),
    }
}

enum DurationUnit {
    Seconds,
    Millis,
}

fn env_string(key: &str) -> Option<String> {
    env::var(key).ok().filter(|value| !value.trim().is_empty())
}

fn env_path(key: &str) -> Option<PathBuf> {
    env::var_os(key).map(PathBuf::from)
}

fn file_string(values: &BTreeMap<String, String>, key: &str) -> Option<String> {
    values
        .get(key)
        .cloned()
        .filter(|value| !value.trim().is_empty())
}

fn file_path(values: &BTreeMap<String, String>, key: &str) -> Option<PathBuf> {
    file_string(values, key).map(PathBuf::from)
}

#[cfg(test)]
mod tests {
    use super::parse_config_file;

    #[test]
    fn missing_config_file_is_empty() {
        let values = parse_config_file(std::path::Path::new("/tmp/not-a-worker-config.toml"))
            .expect("parse config");
        assert!(values.is_empty());
    }
}
