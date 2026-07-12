use std::{
    fs::OpenOptions,
    io,
    path::{Path, PathBuf},
    sync::Arc,
};

use fs2::FileExt;
use serde::{Deserialize, Serialize};
use tauri::State;
use tokio::{
    process::Child,
    sync::Mutex,
    time::{sleep, Duration, Instant},
};

use crate::{
    app_config,
    diagnostics::scrub_diagnostic_text,
    sidecar::{resolve_shell_path, SharedSidecar},
};

mod launcher;

use launcher::find_proliferate_worker_launcher;

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

struct WorkerDatabaseLock {
    file: std::fs::File,
}

impl Drop for CloudWorkerProcess {
    fn drop(&mut self) {
        let _ = self.child.start_kill();
    }
}

impl Drop for WorkerDatabaseLock {
    fn drop(&mut self) {
        let _ = self.file.unlock();
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnsureDesktopDispatchWorkerInput {
    target_id: String,
    enrollment_token: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnsureDesktopDispatchWorkerResult {
    target_id: String,
    status: &'static str,
    config_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StopDesktopDispatchWorkerResult {
    stopped: bool,
}

pub fn create_cloud_worker_state() -> SharedCloudWorkerState {
    Arc::new(CloudWorkerState::default())
}

#[tauri::command]
pub async fn ensure_desktop_dispatch_worker(
    input: EnsureDesktopDispatchWorkerInput,
    sidecar: State<'_, SharedSidecar>,
    worker_state: State<'_, SharedCloudWorkerState>,
) -> Result<EnsureDesktopDispatchWorkerResult, String> {
    let target_id = non_empty("targetId", input.target_id)?;
    let cloud_base_url = configured_cloud_base_url()?;
    let integration_gateway_home = app_config::anyharness_runtime_home_path()?;
    let runtime_base_url = sidecar.lock().await.info.url.clone();
    let enrollment_token = input
        .enrollment_token
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let mut guard = worker_state.process.lock().await;
    if let Some(process) = guard.as_mut() {
        match process.child.try_wait() {
            // A fresh enrollment token is a rotation request (e.g. a different
            // user signed in on this machine): fall through to kill the tracked
            // worker and re-enroll instead of keeping the predecessor's worker
            // + gateway credentials alive under the new user.
            Ok(None) if process.target_id == target_id && enrollment_token.is_none() => {
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
    let mut mutation_lock = None;
    if enrollment_token.is_some() {
        mutation_lock = Some(acquire_worker_database_lock(&paths.database)?);
    } else {
        if worker_database_lock_is_held(&paths.database)? {
            return Ok(EnsureDesktopDispatchWorkerResult {
                target_id,
                status: "already_running_elsewhere",
                config_path: paths.config.to_string_lossy().into_owned(),
            });
        }
        if !worker_identity_exists(&paths.database)? {
            return Err(
                "Desktop dispatch worker is missing local credentials and needs a fresh enrollment token."
                    .to_string(),
            );
        }
    }
    if enrollment_token.is_some() && paths.database.exists() {
        std::fs::remove_file(&paths.database).map_err(|error| {
            format!(
                "Failed to replace stale worker identity at {}: {error}",
                paths.database.display()
            )
        })?;
    }
    write_worker_config(
        &paths.config,
        &cloud_base_url,
        enrollment_token.as_deref(),
        &paths.database,
        &integration_gateway_home,
        &runtime_base_url,
    )?;
    drop(mutation_lock);

    let (log_stdout, log_stderr) = open_worker_log(&paths.log)?;
    tracing::info!(
        launcher = %launcher,
        config_path = %paths.config.display(),
        log_path = %paths.log.display(),
        "Starting Proliferate Worker"
    );

    let mut command = launcher.command(&paths.config);
    command
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::from(log_stdout))
        .stderr(std::process::Stdio::from(log_stderr))
        .kill_on_drop(true);
    if let Some(path) = resolve_shell_path() {
        command.env("PATH", path);
    }

    let mut child = command.spawn().map_err(|error| {
        tracing::error!(launcher = %launcher, %error, "Failed to start Proliferate Worker");
        format!("Failed to start Proliferate Worker with {launcher}: {error}")
    })?;
    tracing::info!(
        launcher = %launcher,
        pid = child.id(),
        "Proliferate Worker spawned"
    );
    let startup_deadline = Instant::now() + startup_watch_window(enrollment_token.is_some());
    let startup_exit = loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("Failed to inspect Proliferate Worker startup: {error}"))?
        {
            break Some(status);
        }
        if Instant::now() >= startup_deadline {
            break None;
        }
        sleep(Duration::from_millis(100)).await;
    };
    if let Some(status) = startup_exit {
        let log_tail = read_worker_log_tail(&paths.log, 12);
        tracing::error!(
            launcher = %launcher,
            %status,
            log_path = %paths.log.display(),
            log_tail = %log_tail,
            "Proliferate Worker exited during startup"
        );
        let mut message = format!(
            "Proliferate Worker exited during startup with {status}. See {} for output.",
            paths.log.display()
        );
        if !log_tail.is_empty() {
            message.push_str("\n\nLast worker log lines:\n");
            message.push_str(&log_tail);
        }
        return Err(message);
    }

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

/// Stops the tracked dispatch worker (if any) and removes the
/// integration-gateway dotfile so local sessions lose access to the departed
/// user's integrations. Safe to call when nothing is running.
#[tauri::command]
pub async fn stop_desktop_dispatch_worker(
    state: State<'_, SharedCloudWorkerState>,
) -> Result<StopDesktopDispatchWorkerResult, String> {
    let mut guard = state.process.lock().await;
    let mut stopped = false;
    if let Some(process) = guard.as_mut() {
        let _ = process.child.start_kill();
        let _ = process.child.wait().await;
        stopped = true;
    }
    *guard = None;
    drop(guard);

    let dotfile = app_config::anyharness_runtime_home_path()?.join("integration-gateway.json");
    match std::fs::remove_file(&dotfile) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!(
                "Failed to remove integration gateway credentials at {}: {error}",
                dotfile.display()
            ));
        }
    }
    Ok(StopDesktopDispatchWorkerResult { stopped })
}

fn non_empty(name: &str, value: String) -> Result<String, String> {
    let trimmed = value.trim().to_string();
    if trimmed.is_empty() {
        Err(format!("{name} is required."))
    } else {
        Ok(trimmed)
    }
}

fn configured_cloud_base_url() -> Result<String, String> {
    let config = app_config::load_app_config_record().unwrap_or_default();
    let value = config.api_base_url.unwrap_or_else(|| {
        option_env!("PROLIFERATE_DEFAULT_API_BASE_URL")
            .unwrap_or("http://127.0.0.1:8000")
            .to_string()
    });
    non_empty("configured Cloud base URL", value)
        .map(|value| value.trim_end_matches('/').to_string())
}

struct WorkerPaths {
    config: PathBuf,
    database: PathBuf,
    log: PathBuf,
}

fn worker_paths(target_id: &str) -> Result<WorkerPaths, String> {
    let root = app_config::app_dir_path()?
        .join("cloud-worker")
        .join(sanitize_path_segment(target_id));
    Ok(WorkerPaths {
        config: root.join("config.toml"),
        database: root.join("worker.sqlite3"),
        log: root.join("worker.log"),
    })
}

fn worker_identity_exists(path: &Path) -> Result<bool, String> {
    if !path.exists() {
        return Ok(false);
    }
    let connection = match rusqlite::Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    ) {
        Ok(connection) => connection,
        Err(error) if matches!(error, rusqlite::Error::SqliteFailure(_, _)) => return Ok(false),
        Err(error) => {
            return Err(format!(
                "Failed to inspect worker identity at {}: {error}",
                path.display()
            ));
        }
    };
    match connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM identity WHERE id = 1 AND worker_token <> '')",
        [],
        |row| row.get::<_, i64>(0),
    ) {
        Ok(value) => Ok(value == 1),
        Err(rusqlite::Error::SqliteFailure(error, _))
            if error.code == rusqlite::ErrorCode::Unknown =>
        {
            Ok(false)
        }
        Err(error) => Err(format!(
            "Failed to inspect worker identity at {}: {error}",
            path.display()
        )),
    }
}

fn worker_database_lock_is_held(database_path: &Path) -> Result<bool, String> {
    match acquire_worker_database_lock(database_path) {
        Ok(_lock) => Ok(false),
        Err(error) if error.contains("still running") => Ok(true),
        Err(error) => Err(error),
    }
}

fn acquire_worker_database_lock(database_path: &Path) -> Result<WorkerDatabaseLock, String> {
    let lock_path = worker_lock_path(database_path);
    if let Some(parent) = lock_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;
    }
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .open(&lock_path)
        .map_err(|error| {
            format!(
                "Failed to inspect worker lock at {}: {error}",
                lock_path.display()
            )
        })?;
    match file.try_lock_exclusive() {
        Ok(()) => Ok(WorkerDatabaseLock { file }),
        Err(error) if error.kind() == io::ErrorKind::WouldBlock => Err(
            "Cannot replace worker credentials while a Proliferate Worker is still running."
                .to_string(),
        ),
        Err(error) => Err(format!(
            "Failed to inspect worker lock at {}: {error}",
            lock_path.display()
        )),
    }
}

fn worker_lock_path(database_path: &Path) -> PathBuf {
    let database_path = canonical_database_path(database_path);
    let extension = database_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!("{value}.lock"))
        .unwrap_or_else(|| "lock".to_string());
    database_path.with_extension(extension)
}

fn canonical_database_path(database_path: &Path) -> PathBuf {
    if let Ok(path) = database_path.canonicalize() {
        return path;
    }
    let Some(parent) = database_path.parent() else {
        return database_path.to_path_buf();
    };
    let Ok(parent) = parent.canonicalize() else {
        return database_path.to_path_buf();
    };
    match database_path.file_name() {
        Some(file_name) => parent.join(file_name),
        None => database_path.to_path_buf(),
    }
}

fn write_worker_config(
    path: &Path,
    cloud_base_url: &str,
    enrollment_token: Option<&str>,
    worker_db_path: &Path,
    integration_gateway_home: &Path,
    runtime_base_url: &str,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;
        set_private_dir_permissions(parent)?;
    }
    let mut lines = vec![format!("cloud_base_url = {}", toml_string(cloud_base_url))];
    if let Some(token) = enrollment_token {
        lines.push(format!("enrollment_token = {}", toml_string(token)));
    }
    lines.push(format!(
        "worker_db_path = {}",
        toml_string(&worker_db_path.to_string_lossy())
    ));
    lines.push("heartbeat_interval_seconds = 30".to_string());
    lines.push(format!(
        "integration_gateway_home = {}",
        toml_string(&integration_gateway_home.to_string_lossy())
    ));
    lines.push(format!(
        "runtime_base_url = {}",
        toml_string(runtime_base_url)
    ));
    // The desktop app bundle owns the worker binary; the worker must never
    // self-swap here. Explicit (the worker also defaults to false) so the
    // on-disk config documents the gate.
    lines.push("self_update_enabled = false".to_string());
    app_config::write_string_file_atomic(path, &format!("{}\n", lines.join("\n")))?;
    set_private_file_permissions(path)
}

/// Opens (and truncates) the worker log file, returning independent handles
/// for the child's stdout and stderr so both streams land in the same file.
fn open_worker_log(path: &Path) -> Result<(std::fs::File, std::fs::File), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;
    }
    let file = std::fs::File::create(path)
        .map_err(|error| format!("Failed to open worker log at {}: {error}", path.display()))?;
    set_private_file_permissions(path)?;
    let clone = file
        .try_clone()
        .map_err(|error| format!("Failed to open worker log at {}: {error}", path.display()))?;
    Ok((file, clone))
}

fn startup_watch_window(fresh_enrollment: bool) -> Duration {
    if fresh_enrollment {
        // A fresh enrollment must survive its first control-plane roundtrip.
        // This catches contract mismatches that exit after the old 150ms watch.
        Duration::from_secs(3)
    } else {
        Duration::from_millis(500)
    }
}

/// Best-effort context for a startup error returned to the renderer. The
/// worker log is truncated for every launch, so reading it here remains
/// bounded to the failed startup attempt.
fn read_worker_log_tail(path: &Path, max_lines: usize) -> String {
    let Ok(contents) = std::fs::read_to_string(path) else {
        return String::new();
    };
    let lines = contents.lines().collect::<Vec<_>>();
    let start = lines.len().saturating_sub(max_lines);
    scrub_diagnostic_text(&lines[start..].join("\n"))
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

#[cfg(test)]
mod tests;
