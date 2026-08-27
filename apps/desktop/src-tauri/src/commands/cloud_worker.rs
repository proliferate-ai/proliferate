use std::{
    fs::OpenOptions,
    io,
    path::{Path, PathBuf},
    sync::{atomic::AtomicBool, Arc},
};

use fs2::FileExt;
use serde::{Deserialize, Serialize};
use tauri::State;
use tokio::{process::Child, sync::Mutex, time::Duration};

use proliferate_diagnostics_protocol::v1::types::TerminalOutcomeV1;

use crate::{
    app_config,
    diagnostics_collector::{
        producer::TauriDiagnosticsProducer, shutdown::DiagnosticsShutdownCoordinator,
        supervisor::DiagnosticsCollectorSupervisor,
    },
    sidecar::SharedSidecar,
};

#[cfg_attr(
    not(all(
        target_os = "macos",
        any(target_arch = "aarch64", target_arch = "x86_64")
    )),
    path = "cloud_worker/launcher_legacy.rs"
)]
mod launcher;
pub(crate) mod lifecycle;
mod observer;
pub(crate) mod spawn;
pub(crate) mod state;
#[cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
mod tail;
#[cfg(all(
    test,
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
mod tail_tests;

// Releases through 0.3.38 used `cloud-worker`; v2 avoids an orphaned legacy
// credential lock without inspecting or killing an unowned process.
pub(super) const WORKER_STATE_NAMESPACE: &str = "cloud-worker-v2";
pub(super) const LEGACY_WORKER_STATE_NAMESPACE: &str = "cloud-worker";
const WORKER_CREDENTIALS_LOCKED_ERROR: &str =
    "Cannot replace worker credentials while a Proliferate Worker is still running.";

#[derive(Default)]
pub struct CloudWorkerState {
    lifecycle: Mutex<CloudWorkerLifecycle>,
    terminal_shutdown_armed: AtomicBool,
    #[cfg(all(
        target_os = "macos",
        any(target_arch = "aarch64", target_arch = "x86_64")
    ))]
    child_shutdown_signal: std::sync::Mutex<
        Option<crate::diagnostics_collector::child_bridge::shutdown_signal::ChildShutdownSignal>,
    >,
}

pub type SharedCloudWorkerState = Arc<CloudWorkerState>;

#[derive(Default)]
struct CloudWorkerLifecycle {
    process: Option<CloudWorkerProcess>,
    observer_generation: u64,
    exit_observer: Option<tokio::task::JoinHandle<()>>,
    #[cfg(test)]
    injected_stop_error: Option<String>,
}

/// Identity-stable Worker owner, with bundled bridge, drainers, and tail kept
/// through verified reap on supported targets.
struct CloudWorkerProcess {
    target_id: String,
    child: Child,
    config_path: PathBuf,
    observer_generation: u64,
    #[cfg(all(
        target_os = "macos",
        any(target_arch = "aarch64", target_arch = "x86_64")
    ))]
    bridge: Option<crate::diagnostics_collector::child_bridge::runtime::ChildDiagnosticsBridge>,
    #[cfg(all(
        target_os = "macos",
        any(target_arch = "aarch64", target_arch = "x86_64")
    ))]
    drainers: Vec<tokio::task::JoinHandle<io::Result<()>>>,
    #[cfg(all(
        target_os = "macos",
        any(target_arch = "aarch64", target_arch = "x86_64")
    ))]
    tail: tail::SharedWorkerTail,
}

struct WorkerDatabaseLock {
    file: std::fs::File,
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
    diagnostics_supervisor: State<'_, Arc<DiagnosticsCollectorSupervisor>>,
    diagnostics_producer: State<'_, TauriDiagnosticsProducer>,
) -> Result<EnsureDesktopDispatchWorkerResult, String> {
    if input.target_id.trim().is_empty() {
        return Err("targetId is required.".to_string());
    }
    let operation = diagnostics_producer.begin_lifecycle("desktop.worker_process.start");
    if diagnostics_supervisor.shutdown_is_armed() {
        operation.terminal(TerminalOutcomeV1::Rejected, Some("shutdown_armed"));
        return Err("Worker start rejected because shutdown is armed".to_string());
    }
    let _ = diagnostics_supervisor.wait_startup_barrier().await;
    let result = ensure_desktop_dispatch_worker_inner(
        input,
        sidecar,
        worker_state,
        &diagnostics_producer,
        &diagnostics_supervisor,
    )
    .await;
    lifecycle::finish_worker_start_operation(operation, &result);
    result.map_err(|error| error.message)
}

async fn ensure_desktop_dispatch_worker_inner(
    input: EnsureDesktopDispatchWorkerInput,
    sidecar: State<'_, SharedSidecar>,
    worker_state: State<'_, SharedCloudWorkerState>,
    diagnostics_producer: &TauriDiagnosticsProducer,
    diagnostics_supervisor: &Arc<DiagnosticsCollectorSupervisor>,
) -> Result<EnsureDesktopDispatchWorkerResult, lifecycle::WorkerStartFailure> {
    let target_id = non_empty("targetId", input.target_id)?;
    let cloud_base_url = configured_cloud_base_url()?;
    let integration_gateway_home = app_config::anyharness_runtime_home_path()?;
    let runtime_base_url = sidecar.lock().await.info.url.clone();
    let enrollment_token = input
        .enrollment_token
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let Some(mut lifecycle) = lifecycle::lock_for_worker_start(&worker_state).await else {
        let config_path = worker_paths(&target_id)?.config;
        return Ok(EnsureDesktopDispatchWorkerResult {
            target_id,
            status: "terminal_shutdown_armed",
            config_path: config_path.to_string_lossy().into_owned(),
        });
    };
    let prepared = lifecycle::prepare_existing_worker_for_ensure_observed(
        &mut lifecycle,
        &target_id,
        enrollment_token.is_some(),
        diagnostics_producer,
    )
    .await;
    if let Some(config_path) = prepared? {
        return Ok(EnsureDesktopDispatchWorkerResult {
            target_id,
            status: "running",
            config_path: config_path.to_string_lossy().into_owned(),
        });
    }

    let launcher = spawn::prepare_launcher().await?;
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
            let message =
                "Desktop dispatch worker is missing local credentials and needs a fresh enrollment token.";
            return Err(message.to_string().into());
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

    let launch = spawn::launch_and_watch(
        &launcher,
        &paths,
        target_id.clone(),
        enrollment_token.is_some(),
        diagnostics_supervisor,
    )
    .await?;
    let result = EnsureDesktopDispatchWorkerResult {
        target_id,
        status: "started",
        config_path: paths.config.to_string_lossy().into_owned(),
    };
    match launch {
        spawn::WorkerLaunchOutcome::Started(process) => {
            #[cfg(all(
                target_os = "macos",
                any(target_arch = "aarch64", target_arch = "x86_64")
            ))]
            worker_state.set_child_shutdown_signal(
                process
                    .diagnostics_bridge()
                    .and_then(|bridge| bridge.shutdown_signal()),
            );
            lifecycle.process = Some(process);
            observer::start(worker_state.inner(), &mut lifecycle);
            Ok(result)
        }
        spawn::WorkerLaunchOutcome::RetainedAfterInspection { process, failure } => {
            // Ambiguity is not reap authority: retain the complete owner
            // under its observer before publishing the classified error.
            #[cfg(all(
                target_os = "macos",
                any(target_arch = "aarch64", target_arch = "x86_64")
            ))]
            worker_state.set_child_shutdown_signal(
                process
                    .diagnostics_bridge()
                    .and_then(|bridge| bridge.shutdown_signal()),
            );
            lifecycle.process = Some(process);
            observer::start(worker_state.inner(), &mut lifecycle);
            Err(failure)
        }
    }
}

/// Stops the tracked dispatch worker (if any) and removes the
/// integration-gateway dotfile so local sessions lose access to the departed
/// user's integrations. Safe to call when nothing is running.
#[tauri::command]
pub async fn stop_desktop_dispatch_worker(
    state: State<'_, SharedCloudWorkerState>,
    diagnostics_producer: State<'_, TauriDiagnosticsProducer>,
) -> Result<StopDesktopDispatchWorkerResult, String> {
    let operation = diagnostics_producer.begin_lifecycle("desktop.worker_process.stop");
    let stop_result = lifecycle::stop_tracked_desktop_dispatch_worker(&state).await;

    let credential_cleanup_result = match app_config::anyharness_runtime_home_path() {
        Ok(runtime_home) => {
            let dotfile = runtime_home.join("integration-gateway.json");
            match std::fs::remove_file(&dotfile) {
                Ok(()) => Ok(()),
                Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
                Err(error) => Err(format!(
                    "Failed to remove integration gateway credentials at {}: {error}",
                    dotfile.display()
                )),
            }
        }
        Err(error) => Err(error),
    };
    let result = match (stop_result, credential_cleanup_result) {
        (Ok(stopped), Ok(())) => Ok(StopDesktopDispatchWorkerResult { stopped }),
        (Err(stop_error), Ok(())) => Err(stop_error),
        (Ok(_), Err(cleanup_error)) => Err(cleanup_error),
        (Err(stop_error), Err(cleanup_error)) => {
            Err(format!("{stop_error}; additionally, {cleanup_error}"))
        }
    };
    lifecycle::finish_worker_stop_operation(operation, &result);
    result
}

#[tauri::command]
pub async fn prepare_desktop_dispatch_worker_update(
    shutdown: State<'_, Arc<DiagnosticsShutdownCoordinator>>,
) -> Result<(), String> {
    if !cfg!(target_os = "windows") {
        return Ok(());
    }
    shutdown.shutdown().await
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

/// Bundled macOS creates no `worker.log`; unsupported targets preserve it.
struct WorkerPaths {
    config: PathBuf,
    database: PathBuf,
    #[cfg(not(all(
        target_os = "macos",
        any(target_arch = "aarch64", target_arch = "x86_64")
    )))]
    log: PathBuf,
}

fn worker_paths(target_id: &str) -> Result<WorkerPaths, String> {
    Ok(worker_paths_in_namespace(
        &app_config::app_dir_path()?,
        WORKER_STATE_NAMESPACE,
        target_id,
    ))
}

fn worker_paths_in_namespace(app_dir: &Path, namespace: &str, target_id: &str) -> WorkerPaths {
    let root = app_dir
        .join(namespace)
        .join(sanitize_path_segment(target_id));
    WorkerPaths {
        config: root.join("config.toml"),
        database: root.join("worker.sqlite3"),
        #[cfg(not(all(
            target_os = "macos",
            any(target_arch = "aarch64", target_arch = "x86_64")
        )))]
        log: root.join("worker.log"),
    }
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
        Err(rusqlite::Error::SqliteFailure(_, _)) => return Ok(false),
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
        Err(error) if error == WORKER_CREDENTIALS_LOCKED_ERROR => Ok(true),
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
        // Lock files are contended by design; never truncate — another holder
        // may have it open, and the byte content is unused.
        .truncate(false)
        .open(&lock_path)
        .map_err(|error| {
            format!(
                "Failed to inspect worker lock at {}: {error}",
                lock_path.display()
            )
        })?;
    match file.try_lock_exclusive() {
        Ok(()) => Ok(WorkerDatabaseLock { file }),
        Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
            Err(WORKER_CREDENTIALS_LOCKED_ERROR.to_string())
        }
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

fn startup_watch_window(fresh_enrollment: bool) -> Duration {
    if fresh_enrollment {
        // A fresh enrollment must survive its first control-plane roundtrip.
        // This catches contract mismatches that exit after the old 150ms watch.
        Duration::from_secs(3)
    } else {
        Duration::from_millis(500)
    }
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

pub(super) fn sanitize_path_segment(value: &str) -> String {
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
