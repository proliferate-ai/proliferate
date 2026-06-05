use std::{
    fs::{self, File, OpenOptions},
    io::{ErrorKind, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

use serde::Serialize;

use crate::{cloud_client::DesiredVersions, config::WorkerConfig, error::WorkerError};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupervisorUpdateRequest {
    pub update_channel: String,
    pub update_generation: i64,
    pub components: Vec<SupervisorUpdateComponent>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupervisorUpdateComponent {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone)]
pub struct StagedUpdateRequest {
    pub component: Option<String>,
    pub version: Option<String>,
    pub path: PathBuf,
    pub wrote_request: bool,
}

pub fn stage_update_request(
    config: &WorkerConfig,
    desired: &DesiredVersions,
) -> Result<StagedUpdateRequest, WorkerError> {
    let request = build_request(desired)?;
    let request_dir = request_dir(config);
    fs::create_dir_all(&request_dir).map_err(|source| WorkerError::CreateParent {
        path: request_dir.clone(),
        source,
    })?;
    set_private_dir_permissions(&request_dir)?;
    let path = request_path(config);
    let bytes = serde_json::to_vec_pretty(&request)?;
    let wrote_request = write_private_file_if_changed(&path, &bytes)?;
    let first = request.components.first();
    Ok(StagedUpdateRequest {
        component: first.map(|component| component.name.clone()),
        version: first.map(|component| component.version.clone()),
        path,
        wrote_request,
    })
}

pub fn clear_update_request(config: &WorkerConfig) -> Result<bool, WorkerError> {
    let path = request_path(config);
    match fs::remove_file(&path) {
        Ok(()) => {
            if let Some(parent) = path.parent() {
                sync_parent_dir(parent);
            }
            Ok(true)
        }
        Err(source) if source.kind() == ErrorKind::NotFound => Ok(false),
        Err(source) => Err(WorkerError::WriteConfig { path, source }),
    }
}

fn build_request(desired: &DesiredVersions) -> Result<SupervisorUpdateRequest, WorkerError> {
    let mut components = Vec::new();
    push_component(&mut components, "anyharness", &desired.anyharness_version)?;
    push_component(&mut components, "worker", &desired.worker_version)?;
    push_component(&mut components, "supervisor", &desired.supervisor_version)?;
    if components.is_empty() {
        return Err(WorkerError::Update(
            "desired update did not include any component versions".to_string(),
        ));
    }
    Ok(SupervisorUpdateRequest {
        update_channel: desired.update_channel.clone(),
        update_generation: desired.update_generation,
        components,
    })
}

fn push_component(
    components: &mut Vec<SupervisorUpdateComponent>,
    name: &str,
    version: &Option<String>,
) -> Result<(), WorkerError> {
    let Some(version) = version else {
        return Ok(());
    };
    let version = version.trim();
    if version.is_empty() {
        return Err(WorkerError::Update(format!(
            "{name} desired version cannot be empty"
        )));
    }
    components.push(SupervisorUpdateComponent {
        name: name.to_string(),
        version: version.to_string(),
    });
    Ok(())
}

fn request_path(config: &WorkerConfig) -> PathBuf {
    request_dir(config).join("desired-update.json")
}

fn request_dir(config: &WorkerConfig) -> PathBuf {
    config
        .supervisor_update_request_dir
        .clone()
        .unwrap_or_else(|| default_request_dir(config))
}

fn default_request_dir(config: &WorkerConfig) -> PathBuf {
    config
        .worker_db_path
        .parent()
        .map(|path| path.join("updates"))
        .unwrap_or_else(|| PathBuf::from(".proliferate-worker-updates"))
}

fn write_private_file_if_changed(path: &Path, bytes: &[u8]) -> Result<bool, WorkerError> {
    match fs::read(path) {
        Ok(existing) if existing == bytes => return Ok(false),
        Ok(_) => {}
        Err(source) if source.kind() == ErrorKind::NotFound => {}
        Err(source) => {
            return Err(WorkerError::ReadConfig {
                path: path.to_path_buf(),
                source,
            });
        }
    }

    let parent = path
        .parent()
        .ok_or_else(|| WorkerError::Update("update request path has no parent".to_string()))?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| WorkerError::Update("update request path has no file name".to_string()))?;
    let (temp_path, mut temp_file) = create_private_temp_file(parent, file_name)?;
    if let Err(source) = temp_file.write_all(bytes) {
        let _ = fs::remove_file(&temp_path);
        return Err(WorkerError::WriteConfig {
            path: temp_path,
            source,
        });
    }
    if let Err(source) = temp_file.sync_all() {
        let _ = fs::remove_file(&temp_path);
        return Err(WorkerError::WriteConfig {
            path: temp_path,
            source,
        });
    }
    drop(temp_file);

    fs::rename(&temp_path, path).map_err(|source| WorkerError::WriteConfig {
        path: path.to_path_buf(),
        source,
    })?;
    set_private_file_permissions(path)?;
    sync_parent_dir(parent);
    Ok(true)
}

fn create_private_temp_file(
    parent: &Path,
    file_name: &str,
) -> Result<(PathBuf, File), WorkerError> {
    for attempt in 0..16 {
        let temp_path = parent.join(temp_file_name(file_name, attempt));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        options.mode(0o600);
        match options.open(&temp_path) {
            Ok(file) => return Ok((temp_path, file)),
            Err(source) if source.kind() == ErrorKind::AlreadyExists => continue,
            Err(source) => {
                return Err(WorkerError::WriteConfig {
                    path: temp_path,
                    source,
                });
            }
        }
    }
    Err(WorkerError::WriteConfig {
        path: parent.join(format!(".{file_name}.tmp")),
        source: std::io::Error::new(
            ErrorKind::AlreadyExists,
            "could not create unique update request temp file",
        ),
    })
}

fn temp_file_name(file_name: &str, attempt: u32) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!(
        ".{file_name}.tmp.{}.{}.{}",
        std::process::id(),
        nanos,
        attempt
    )
}

fn sync_parent_dir(parent: &Path) {
    if let Ok(directory) = File::open(parent) {
        let _ = directory.sync_all();
    }
}

fn set_private_dir_permissions(path: &Path) -> Result<(), WorkerError> {
    #[cfg(unix)]
    {
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|source| {
            WorkerError::SetPrivatePermissions {
                path: path.to_path_buf(),
                source,
            }
        })?;
    }
    Ok(())
}

fn set_private_file_permissions(path: &Path) -> Result<(), WorkerError> {
    #[cfg(unix)]
    {
        fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|source| {
            WorkerError::SetPrivatePermissions {
                path: path.to_path_buf(),
                source,
            }
        })?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    use crate::{cloud_client::DesiredVersions, config::WorkerConfig};

    use super::{clear_update_request, stage_update_request};

    #[test]
    fn stage_update_request_writes_supervisor_mailbox_file() {
        let root = std::env::temp_dir().join(format!(
            "proliferate-worker-update-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("create root");
        let config = WorkerConfig {
            cloud_base_url: "http://127.0.0.1:8000".to_string(),
            enrollment_token: None,
            anyharness_base_url: None,
            anyharness_bearer_token: None,
            worker_db_path: root.join("worker.sqlite"),
            materialization_root: None,
            supervisor_update_request_dir: Some(root.join("updates")),
            supervisor_version: None,
            heartbeat_interval_seconds: 60,
            config_path: None,
        };
        let staged = stage_update_request(
            &config,
            &DesiredVersions {
                should_update: true,
                update_channel: "stable".to_string(),
                update_generation: 7,
                anyharness_version: None,
                worker_version: Some("0.2.0".to_string()),
                supervisor_version: None,
            },
        )
        .expect("stage update");
        assert_eq!(staged.component.as_deref(), Some("worker"));
        assert_eq!(staged.version.as_deref(), Some("0.2.0"));
        assert!(staged.wrote_request);
        assert!(staged.path.exists());
        let contents = fs::read_to_string(&staged.path).expect("read request");
        assert!(contents.contains("\"worker\""));
        assert!(contents.contains("\"0.2.0\""));
        assert!(contents.contains("\"updateGeneration\": 7"));
        #[cfg(unix)]
        {
            let dir_mode = fs::metadata(root.join("updates"))
                .expect("update dir metadata")
                .permissions()
                .mode()
                & 0o777;
            let file_mode = fs::metadata(&staged.path)
                .expect("update file metadata")
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(dir_mode, 0o700);
            assert_eq!(file_mode, 0o600);
        }
        let _ = fs::remove_dir_all(PathBuf::from(root));
    }

    #[test]
    fn stage_update_request_is_idempotent_for_same_payload() {
        let root = std::env::temp_dir().join(format!(
            "proliferate-worker-update-idempotent-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("create root");
        let config = WorkerConfig {
            cloud_base_url: "http://127.0.0.1:8000".to_string(),
            enrollment_token: None,
            anyharness_base_url: None,
            anyharness_bearer_token: None,
            worker_db_path: root.join("worker.sqlite"),
            materialization_root: None,
            supervisor_update_request_dir: Some(root.join("updates")),
            supervisor_version: None,
            heartbeat_interval_seconds: 60,
            config_path: None,
        };
        let desired = DesiredVersions {
            should_update: true,
            update_channel: "stable".to_string(),
            update_generation: 8,
            anyharness_version: None,
            worker_version: Some("0.2.0".to_string()),
            supervisor_version: None,
        };
        let first = stage_update_request(&config, &desired).expect("stage update");
        assert!(first.wrote_request);
        let second = stage_update_request(&config, &desired).expect("stage update again");
        assert!(!second.wrote_request);
        assert_eq!(first.path, second.path);
        let _ = fs::remove_dir_all(PathBuf::from(root));
    }

    #[test]
    fn clear_update_request_removes_stale_mailbox_file() {
        let root = std::env::temp_dir().join(format!(
            "proliferate-worker-update-clear-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("create root");
        let config = WorkerConfig {
            cloud_base_url: "http://127.0.0.1:8000".to_string(),
            enrollment_token: None,
            anyharness_base_url: None,
            anyharness_bearer_token: None,
            worker_db_path: root.join("worker.sqlite"),
            materialization_root: None,
            supervisor_update_request_dir: Some(root.join("updates")),
            supervisor_version: None,
            heartbeat_interval_seconds: 60,
            config_path: None,
        };
        let staged = stage_update_request(
            &config,
            &DesiredVersions {
                should_update: true,
                update_channel: "stable".to_string(),
                update_generation: 9,
                anyharness_version: None,
                worker_version: Some("0.2.0".to_string()),
                supervisor_version: None,
            },
        )
        .expect("stage update");
        assert!(staged.path.exists());
        assert!(clear_update_request(&config).expect("clear update"));
        assert!(!staged.path.exists());
        assert!(!clear_update_request(&config).expect("clear missing update"));
        let _ = fs::remove_dir_all(PathBuf::from(root));
    }
}
