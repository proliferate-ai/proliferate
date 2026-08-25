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
    /// Base URL of the co-located AnyHarness runtime HTTP API. Required for
    /// catalog sync (pushing fetched catalogs to the runtime). Defaults to
    /// `http://127.0.0.1:8457` when absent — the standard runtime port on
    /// the same host.
    #[serde(default = "default_runtime_base_url")]
    pub runtime_base_url: String,
    /// Bearer token for authenticating to the runtime's HTTP API. Read from
    /// `ANYHARNESS_BEARER_TOKEN` env at startup when not set in config.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime_bearer_token: Option<String>,
    /// The Supervisor mailbox directory this Worker writes update requests
    /// into. Set only for supervisor-owned targets (server value:
    /// `.proliferate/supervisor/updates`). When present the Worker becomes an
    /// *observer + writer*: on heartbeat divergence it writes ONE durable
    /// `UpdateRequestV1` for the Supervisor to act on. Absent (a desktop
    /// worker, whose app bundle owns both binaries) => the Worker never
    /// converges anything; it only heartbeats and syncs.
    ///
    /// On-disk configs may still carry keys from the deleted legacy
    /// convergence paths (`self_update_enabled`, `anyharness_update_enabled`,
    /// the in-place swap paths, the D5 bridge coordinates); serde ignores
    /// unknown fields, so those configs parse unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supervisor_update_request_dir: Option<PathBuf>,
    #[serde(skip)]
    pub config_path: Option<PathBuf>,
}

fn default_runtime_base_url() -> String {
    "http://127.0.0.1:8457".to_string()
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

#[cfg(test)]
mod tests {
    use super::WorkerConfig;

    const MINIMAL_CONFIG: &str = r#"
cloud_base_url = "https://cloud.test"
worker_db_path = "/tmp/worker.sqlite3"
"#;

    #[test]
    fn legacy_convergence_keys_are_ignored_not_fatal() {
        // Deployed configs (desktop writes `self_update_enabled = false`; the
        // sandbox bootstrap emitted the legacy gates and D5 bridge
        // coordinates) still carry keys from the deleted convergence paths.
        // They must parse unchanged — serde skips unknown fields.
        let contents = format!(
            "{MINIMAL_CONFIG}self_update_enabled = false\n\
             anyharness_update_enabled = false\n\
             anyharness_binary_path = \"/home/user/.proliferate/bin/anyharness\"\n\
             anyharness_launcher_path = \"/home/user/start-anyharness.sh\"\n\
             anyharness_workdir = \"/home/user/repo\"\n\
             supervisor_binary_path = \"/home/user/.proliferate/bin/proliferate-supervisor\"\n\
             supervisor_config_path = \"/home/user/.proliferate/supervisor/config.toml\"\n\
             supervisor_bridge_marker_dir = \"/home/user/.proliferate/supervisor\"\n"
        );
        let config: WorkerConfig = toml::from_str(&contents).expect("legacy-keyed config");
        assert_eq!(config.cloud_base_url, "https://cloud.test");
    }

    #[test]
    fn runtime_base_url_defaults_to_localhost() {
        let config: WorkerConfig = toml::from_str(MINIMAL_CONFIG).expect("minimal config");
        assert_eq!(config.runtime_base_url, "http://127.0.0.1:8457");
        assert_eq!(config.runtime_bearer_token, None);
    }

    #[test]
    fn runtime_base_url_overridable() {
        let contents = format!(
            "{MINIMAL_CONFIG}runtime_base_url = \"http://10.0.0.5:9000\"\nruntime_bearer_token = \"secret\"\n"
        );
        let config: WorkerConfig = toml::from_str(&contents).expect("config with runtime url");
        assert_eq!(config.runtime_base_url, "http://10.0.0.5:9000");
        assert_eq!(config.runtime_bearer_token.as_deref(), Some("secret"));
    }

    #[test]
    fn mailbox_dir_defaults_absent() {
        // A desktop worker's config never mentions the mailbox: absent =>
        // heartbeat + sync only, no convergence of any kind.
        let config: WorkerConfig = toml::from_str(MINIMAL_CONFIG).expect("minimal config");
        assert_eq!(config.supervisor_update_request_dir, None);
    }

    #[test]
    fn mailbox_dir_parses_when_present() {
        let contents = format!(
            "{MINIMAL_CONFIG}\
             supervisor_update_request_dir = \"/home/user/.proliferate/supervisor/updates\"\n"
        );
        let config: WorkerConfig = toml::from_str(&contents).expect("supervisor-owned config");
        assert_eq!(
            config.supervisor_update_request_dir.as_deref(),
            Some(std::path::Path::new(
                "/home/user/.proliferate/supervisor/updates"
            ))
        );
    }
}
