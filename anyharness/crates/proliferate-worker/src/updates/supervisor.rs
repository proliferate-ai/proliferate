use std::{fs, path::PathBuf};

use serde::Serialize;

use crate::{cloud_client::DesiredVersions, config::WorkerConfig, error::WorkerError};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupervisorUpdateRequest {
    pub update_channel: String,
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
}

pub fn stage_update_request(
    config: &WorkerConfig,
    desired: &DesiredVersions,
) -> Result<StagedUpdateRequest, WorkerError> {
    let request = build_request(desired)?;
    let request_dir = config
        .supervisor_update_request_dir
        .clone()
        .unwrap_or_else(|| default_request_dir(config));
    fs::create_dir_all(&request_dir).map_err(|source| WorkerError::CreateParent {
        path: request_dir.clone(),
        source,
    })?;
    let path = request_dir.join("desired-update.json");
    let temp_path = request_dir.join(format!(".desired-update.json.tmp.{}", std::process::id()));
    let bytes = serde_json::to_vec_pretty(&request)?;
    fs::write(&temp_path, bytes).map_err(|source| WorkerError::WriteConfig {
        path: temp_path.clone(),
        source,
    })?;
    fs::rename(&temp_path, &path).map_err(|source| WorkerError::WriteConfig {
        path: path.clone(),
        source,
    })?;
    let first = request.components.first();
    Ok(StagedUpdateRequest {
        component: first.map(|component| component.name.clone()),
        version: first.map(|component| component.version.clone()),
        path,
    })
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

fn default_request_dir(config: &WorkerConfig) -> PathBuf {
    config
        .worker_db_path
        .parent()
        .map(|path| path.join("updates"))
        .unwrap_or_else(|| PathBuf::from(".proliferate-worker-updates"))
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use crate::{cloud_client::DesiredVersions, config::WorkerConfig};

    use super::stage_update_request;

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
                anyharness_version: None,
                worker_version: Some("0.2.0".to_string()),
                supervisor_version: None,
            },
        )
        .expect("stage update");
        assert_eq!(staged.component.as_deref(), Some("worker"));
        assert_eq!(staged.version.as_deref(), Some("0.2.0"));
        assert!(staged.path.exists());
        let contents = fs::read_to_string(staged.path).expect("read request");
        assert!(contents.contains("\"worker\""));
        assert!(contents.contains("\"0.2.0\""));
        let _ = fs::remove_dir_all(PathBuf::from(root));
    }
}
