use std::{
    fmt,
    path::{Path, PathBuf},
    sync::Arc,
};

use serde::{Deserialize, Serialize};
use tauri::State;
use tokio::{
    process::{Child, Command},
    sync::Mutex,
};

use crate::{agent_seed_env::current_target_triple, app_config, sidecar::resolve_shell_path};

#[derive(Default)]
pub struct CloudWorkerState {
    process: Mutex<Option<CloudWorkerProcess>>,
}

pub type SharedCloudWorkerState = Arc<CloudWorkerState>;

struct CloudWorkerProcess {
    target_id: String,
    child: Child,
    config_path: PathBuf,
}

impl Drop for CloudWorkerProcess {
    fn drop(&mut self) {
        let _ = self.child.start_kill();
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnsureDesktopDispatchWorkerInput {
    target_id: String,
    enrollment_token: Option<String>,
    cloud_base_url: String,
    anyharness_base_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnsureDesktopDispatchWorkerResult {
    target_id: String,
    status: &'static str,
    config_path: String,
}

pub fn create_cloud_worker_state() -> SharedCloudWorkerState {
    Arc::new(CloudWorkerState::default())
}

#[tauri::command]
pub async fn ensure_desktop_dispatch_worker(
    input: EnsureDesktopDispatchWorkerInput,
    state: State<'_, SharedCloudWorkerState>,
) -> Result<EnsureDesktopDispatchWorkerResult, String> {
    let target_id = non_empty("targetId", input.target_id)?;
    let cloud_base_url = non_empty("cloudBaseUrl", input.cloud_base_url)?;
    let anyharness_base_url = non_empty("anyharnessBaseUrl", input.anyharness_base_url)?;
    let enrollment_token = input
        .enrollment_token
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let mut guard = state.process.lock().await;
    if let Some(process) = guard.as_mut() {
        match process.child.try_wait() {
            Ok(None) if process.target_id == target_id => {
                return Ok(EnsureDesktopDispatchWorkerResult {
                    target_id,
                    status: "running",
                    config_path: process.config_path.to_string_lossy().into_owned(),
                });
            }
            Ok(None) => {
                let _ = process.child.start_kill();
                let _ = process.child.wait().await;
            }
            Ok(Some(_)) | Err(_) => {}
        }
        *guard = None;
    }

    let launcher = find_proliferate_worker_launcher()
        .ok_or_else(|| "Proliferate Worker binary was not found.".to_string())?;
    let paths = worker_paths(&target_id)?;
    write_worker_config(
        &paths.config,
        &cloud_base_url,
        enrollment_token.as_deref(),
        &anyharness_base_url,
        &paths.database,
    )?;
    if enrollment_token.is_some() && paths.database.exists() {
        std::fs::remove_file(&paths.database).map_err(|error| {
            format!(
                "Failed to replace stale worker identity at {}: {error}",
                paths.database.display()
            )
        })?;
    }

    let mut command = launcher.command(&paths.config);
    command
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::inherit())
        .stderr(std::process::Stdio::inherit())
        .kill_on_drop(true);
    if let Some(path) = resolve_shell_path() {
        command.env("PATH", path);
    }

    let child = command
        .spawn()
        .map_err(|error| format!("Failed to start Proliferate Worker with {launcher}: {error}"))?;

    let result = EnsureDesktopDispatchWorkerResult {
        target_id: target_id.clone(),
        status: "started",
        config_path: paths.config.to_string_lossy().into_owned(),
    };
    *guard = Some(CloudWorkerProcess {
        target_id,
        child,
        config_path: paths.config,
    });
    Ok(result)
}

fn non_empty(name: &str, value: String) -> Result<String, String> {
    let trimmed = value.trim().to_string();
    if trimmed.is_empty() {
        Err(format!("{name} is required."))
    } else {
        Ok(trimmed)
    }
}

struct WorkerPaths {
    config: PathBuf,
    database: PathBuf,
}

fn worker_paths(target_id: &str) -> Result<WorkerPaths, String> {
    let root = app_config::app_dir_path()?
        .join("cloud-worker")
        .join(sanitize_path_segment(target_id));
    Ok(WorkerPaths {
        config: root.join("config.toml"),
        database: root.join("worker.sqlite3"),
    })
}

fn write_worker_config(
    path: &Path,
    cloud_base_url: &str,
    enrollment_token: Option<&str>,
    anyharness_base_url: &str,
    worker_db_path: &Path,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;
        set_private_dir_permissions(parent)?;
    }
    let mut lines = vec![
        format!("cloud_base_url = {}", toml_string(cloud_base_url)),
        format!("anyharness_base_url = {}", toml_string(anyharness_base_url)),
        format!(
            "worker_db_path = {}",
            toml_string(&worker_db_path.to_string_lossy())
        ),
        "heartbeat_interval_seconds = 15".to_string(),
    ];
    if let Some(token) = enrollment_token {
        lines.insert(1, format!("enrollment_token = {}", toml_string(token)));
    }
    app_config::write_string_file_atomic(path, &format!("{}\n", lines.join("\n")))?;
    set_private_file_permissions(path)
}

fn toml_string(value: &str) -> String {
    format!(
        "\"{}\"",
        value
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('\n', "\\n")
            .replace('\r', "\\r")
    )
}

fn sanitize_path_segment(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

enum WorkerLauncher {
    Binary(PathBuf),
    CargoRun {
        cargo: PathBuf,
        workspace_root: PathBuf,
    },
}

impl WorkerLauncher {
    fn command(&self, config_path: &Path) -> Command {
        match self {
            Self::Binary(binary) => {
                let mut command = Command::new(binary);
                command.arg("--config").arg(config_path);
                command
            }
            Self::CargoRun {
                cargo,
                workspace_root,
            } => {
                let mut command = Command::new(cargo);
                command
                    .current_dir(workspace_root)
                    .arg("run")
                    .arg("-p")
                    .arg("proliferate-worker")
                    .arg("--")
                    .arg("--config")
                    .arg(config_path);
                command
            }
        }
    }
}

impl fmt::Display for WorkerLauncher {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Binary(binary) => write!(f, "{}", binary.display()),
            Self::CargoRun {
                cargo,
                workspace_root,
            } => write!(
                f,
                "{} run -p proliferate-worker from {}",
                cargo.display(),
                workspace_root.display()
            ),
        }
    }
}

fn find_proliferate_worker_launcher() -> Option<WorkerLauncher> {
    if let Ok(value) = std::env::var("PROLIFERATE_WORKER_BIN") {
        let path = PathBuf::from(value);
        if is_usable_worker_binary(&path) {
            return Some(WorkerLauncher::Binary(path));
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            let target = current_target_triple();
            for candidate in [
                exe_dir.join(format!("proliferate-worker-{target}")),
                exe_dir.join("proliferate-worker"),
            ] {
                if is_usable_worker_binary(&candidate) {
                    return Some(WorkerLauncher::Binary(candidate));
                }
            }
        }
    }

    for candidate in development_worker_candidates() {
        if is_usable_worker_binary(&candidate) {
            return Some(WorkerLauncher::Binary(candidate));
        }
    }

    if let Ok(path) = which::which("proliferate-worker") {
        if is_usable_worker_binary(&path) {
            return Some(WorkerLauncher::Binary(path));
        }
    }

    if cfg!(debug_assertions) {
        if let (Some(cargo), Some(workspace_root)) = (which::which("cargo").ok(), workspace_root())
        {
            return Some(WorkerLauncher::CargoRun {
                cargo,
                workspace_root,
            });
        }
    }

    None
}

fn development_worker_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    let target = current_target_triple();
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repos = [
        manifest_dir.join("../.."),
        manifest_dir.join("../../anyharness"),
        manifest_dir.join("../../../anyharness"),
    ];
    for repo in repos {
        candidates.push(
            repo.join("target")
                .join(&target)
                .join("debug")
                .join("proliferate-worker"),
        );
        candidates.push(
            repo.join("target")
                .join(&target)
                .join("release")
                .join("proliferate-worker"),
        );
        candidates.push(repo.join("target").join("debug").join("proliferate-worker"));
        candidates.push(
            repo.join("target")
                .join("release")
                .join("proliferate-worker"),
        );
    }
    candidates
}

fn workspace_root() -> Option<PathBuf> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let root = manifest_dir.join("../..");
    if root.join("Cargo.toml").is_file() {
        Some(root)
    } else {
        None
    }
}

fn is_usable_worker_binary(path: &Path) -> bool {
    path.is_file() && !is_placeholder_sidecar(path)
}

fn is_placeholder_sidecar(path: &Path) -> bool {
    let Ok(bytes) = std::fs::read(path) else {
        return false;
    };
    let text = String::from_utf8_lossy(&bytes);
    text.contains("sidecar is not available") || text.contains("unsupported target placeholder")
}

#[cfg(unix)]
fn set_private_file_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).map_err(|error| {
        format!(
            "Failed to set private permissions on {}: {error}",
            path.display()
        )
    })
}

#[cfg(not(unix))]
fn set_private_file_permissions(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(unix)]
fn set_private_dir_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700)).map_err(|error| {
        format!(
            "Failed to set private permissions on {}: {error}",
            path.display()
        )
    })
}

#[cfg(not(unix))]
fn set_private_dir_permissions(_path: &Path) -> Result<(), String> {
    Ok(())
}
