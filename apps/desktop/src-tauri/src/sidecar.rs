use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{atomic::AtomicBool, Arc, Mutex as StdMutex};
use std::time::Duration;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

use proliferate_diagnostics_protocol::v1::types::TerminalOutcomeV1;

use crate::agent_seed_env::current_target_triple;
use crate::app_config::{write_runtime_info_record, RuntimeInfoRecord};
use crate::desktop_telemetry_mode::{
    current_api_origin, resolve_desktop_telemetry_mode, DesktopTelemetryMode,
};
use crate::diagnostics_collector::producer::TauriDiagnosticsProducer;
use crate::diagnostics_collector::supervisor::DiagnosticsCollectorSupervisor;

const DEFAULT_HOST: &str = "127.0.0.1";
const HEALTH_POLL_INTERVAL: Duration = Duration::from_millis(250);
const HEALTH_POLL_TIMEOUT: Duration = Duration::from_secs(60);
/// Read by anyharness's route-auth render plane to guard against injecting a
/// previous server's gateway credentials right after a connect-to-server
/// switch. Must match `route_auth::CURRENT_SERVER_ORIGIN_ENV` in
/// anyharness-lib exactly.
const PROLIFERATE_API_BASE_URL_ORIGIN_ENV: &str = "PROLIFERATE_API_BASE_URL_ORIGIN";

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInfo {
    pub url: String,
    pub port: u16,
    pub status: RuntimeStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeStatus {
    Starting,
    Healthy,
    Failed,
    Stopped,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeHealthRecord {
    runtime_home: String,
    version: String,
}

pub struct SidecarProcess {
    child: Option<Child>,
    /// Parent side of the protected child diagnostics bridge; `None` for
    /// external, unprotected, or never-launched children.
    #[cfg(all(
        target_os = "macos",
        any(target_arch = "aarch64", target_arch = "x86_64")
    ))]
    diagnostics_bridge:
        Option<crate::diagnostics_collector::child_bridge::runtime::ChildDiagnosticsBridge>,
    observer_generation: u64,
    exit_observer: Option<tokio::task::JoinHandle<()>>,
    pub info: RuntimeInfo,
    pub launch_env: HashMap<String, String>,
    #[cfg(test)]
    suppress_runtime_info_persistence: bool,
}

pub struct SidecarState {
    process: Mutex<SidecarProcess>,
    terminal_shutdown_armed: AtomicBool,
    #[cfg(all(
        target_os = "macos",
        any(target_arch = "aarch64", target_arch = "x86_64")
    ))]
    child_shutdown_signal: StdMutex<
        Option<crate::diagnostics_collector::child_bridge::shutdown_signal::ChildShutdownSignal>,
    >,
}

pub type SharedSidecar = Arc<SidecarState>;

#[derive(Clone, Copy)]
enum BootOutcome {
    External,
    Succeeded,
    Failed(&'static str),
    TimedOut,
    Rejected,
    Cancelled,
}

pub fn create_sidecar(port: u16) -> SharedSidecar {
    Arc::new(SidecarState {
        process: Mutex::new(SidecarProcess::new(port)),
        terminal_shutdown_armed: AtomicBool::new(false),
        #[cfg(all(
            target_os = "macos",
            any(target_arch = "aarch64", target_arch = "x86_64")
        ))]
        child_shutdown_signal: StdMutex::new(None),
    })
}

/// Returns None when ANYHARNESS_DEV_URL is set (caller should skip spawn).
fn find_anyharness_binary() -> Option<String> {
    if std::env::var("ANYHARNESS_DEV_URL").is_ok() {
        return None;
    }

    if let Ok(p) = std::env::var("ANYHARNESS_BIN") {
        return Some(p);
    }

    // Bundled sidecar: Tauri places externalBin binaries next to the app executable.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            let target = current_target_triple();
            let sidecar_name = format!("anyharness-{target}");
            let sidecar_path = exe_dir.join(&sidecar_name);
            if sidecar_path.is_file() {
                return Some(sidecar_path.to_string_lossy().into_owned());
            }
            // Also check without target suffix (dev builds)
            let plain = exe_dir.join("anyharness");
            if plain.is_file() {
                return Some(plain.to_string_lossy().into_owned());
            }
        }
    }

    for candidate in development_anyharness_candidates() {
        if Path::new(&candidate).is_file() {
            return Some(candidate);
        }
    }
    Some("anyharness".to_string())
}

fn development_anyharness_candidates() -> Vec<String> {
    let mut candidates = Vec::new();
    let target = current_target_triple();

    for repo in repo_candidates() {
        candidates.push(
            repo.join("target")
                .join(target)
                .join("debug")
                .join("anyharness")
                .to_string_lossy()
                .into_owned(),
        );
        candidates.push(
            repo.join("target")
                .join(target)
                .join("release")
                .join("anyharness")
                .to_string_lossy()
                .into_owned(),
        );
        candidates.push(
            repo.join("target")
                .join("debug")
                .join("anyharness")
                .to_string_lossy()
                .into_owned(),
        );
        candidates.push(
            repo.join("target")
                .join("release")
                .join("anyharness")
                .to_string_lossy()
                .into_owned(),
        );
    }

    let home = std::env::var("HOME").unwrap_or_default();
    candidates.push(format!("{home}/.cargo/bin/anyharness"));
    candidates.push("/usr/local/bin/anyharness".to_string());

    candidates
}

fn repo_candidates() -> Vec<PathBuf> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let candidates = vec![
        manifest_dir.join("../../anyharness"),
        manifest_dir.join("../../../anyharness"),
        manifest_dir.join("../../../anyharness-acp-chat-surface"),
        manifest_dir.join("../../../anyharness-git-slice"),
        manifest_dir.join("../../../anyharness-files"),
    ];

    let mut unique = Vec::new();
    for candidate in candidates {
        if !unique
            .iter()
            .any(|existing: &PathBuf| existing == &candidate)
        {
            unique.push(candidate);
        }
    }
    unique
}

fn baked_env(key: &str) -> Option<&'static str> {
    match key {
        "ANYHARNESS_SENTRY_DSN" => option_env!("ANYHARNESS_SENTRY_DSN"),
        "ANYHARNESS_SENTRY_ENVIRONMENT" => option_env!("ANYHARNESS_SENTRY_ENVIRONMENT"),
        "ANYHARNESS_SENTRY_RELEASE" => option_env!("ANYHARNESS_SENTRY_RELEASE"),
        "ANYHARNESS_SENTRY_TRACES_SAMPLE_RATE" => {
            option_env!("ANYHARNESS_SENTRY_TRACES_SAMPLE_RATE")
        }
        _ => None,
    }
}

fn env_value(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .or_else(|| baked_env(key).map(str::to_string))
        .and_then(|value| {
            let trimmed = value.trim();
            (!trimmed.is_empty()).then(|| trimmed.to_string())
        })
}

fn default_anyharness_launch_env_for_mode<F>(
    mode: DesktopTelemetryMode,
    env_lookup: F,
) -> HashMap<String, String>
where
    F: Fn(&str) -> Option<String>,
{
    if mode != DesktopTelemetryMode::HostedProduct {
        return HashMap::new();
    }

    let mut env = HashMap::new();

    if should_use_local_proliferate_home(cfg!(debug_assertions)) {
        env.insert("PROLIFERATE_DEV".to_string(), "1".to_string());
    }

    for key in [
        "ANYHARNESS_SENTRY_DSN",
        "ANYHARNESS_SENTRY_ENVIRONMENT",
        "ANYHARNESS_SENTRY_RELEASE",
        "ANYHARNESS_SENTRY_TRACES_SAMPLE_RATE",
    ] {
        if let Some(value) = env_lookup(key) {
            env.insert(key.to_string(), value);
        }
    }

    env.insert("PROLIFERATE_RUNTIME_ENV".to_string(), "local".to_string());

    env
}

fn should_use_local_proliferate_home(debug_build: bool) -> bool {
    std::env::var_os("PROLIFERATE_DEV").is_some() || debug_build
}

fn default_anyharness_launch_env() -> HashMap<String, String> {
    default_anyharness_launch_env_for_mode(resolve_desktop_telemetry_mode(), env_value)
}

fn pick_port() -> u16 {
    if let Ok(p) = std::env::var("ANYHARNESS_PORT") {
        if let Ok(n) = p.parse::<u16>() {
            return n;
        }
    }
    let listener = std::net::TcpListener::bind((DEFAULT_HOST, 0)).ok();
    listener
        .and_then(|l| l.local_addr().ok())
        .map(|a| a.port())
        .unwrap_or(8457)
}

/// Resolve the user's full shell PATH. macOS apps launched from Finder/Dock
/// inherit a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin) that doesn't include
/// node, homebrew, nvm, fnm, etc. Running `$SHELL -l -i -c 'echo $PATH'` gives
/// us the PATH the user would have in a terminal (login + interactive ensures
/// both .zprofile and .zshrc are sourced, which is needed for tools like fnm/nvm
/// that set up PATH in .zshrc).
pub(crate) fn resolve_shell_path() -> Option<String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let output = std::process::Command::new(&shell)
        .args(["-l", "-i", "-c", "echo $PATH"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() {
        None
    } else {
        Some(path)
    }
}

#[path = "sidecar/diagnostics.rs"]
mod diagnostics;
#[path = "sidecar/lifecycle.rs"]
mod lifecycle;
#[path = "sidecar/observer.rs"]
pub(crate) mod observer;
mod state;
#[cfg(test)]
#[path = "sidecar/tests.rs"]
mod tests;

use lifecycle::{boot_inner, wait_healthy};

fn build_spawn_command(binary: &str, port: u16, launch_env: &HashMap<String, String>) -> Command {
    let mut cmd = Command::new(binary);
    let mut runtime_env = default_anyharness_launch_env();
    // Every desktop install needs this so the render plane can tell a
    // stale-server state file apart from a fresh one.
    runtime_env.insert(
        PROLIFERATE_API_BASE_URL_ORIGIN_ENV.to_string(),
        current_api_origin(),
    );
    runtime_env.extend(launch_env.clone());

    if let Some(shell_path) = resolve_shell_path() {
        runtime_env.insert("PATH".to_string(), shell_path);
    }

    cmd.args(["serve", "--host", DEFAULT_HOST, "--port", &port.to_string()]);

    cmd.stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::inherit())
        .stderr(std::process::Stdio::inherit())
        .kill_on_drop(true);
    if !runtime_env.is_empty() {
        cmd.envs(runtime_env);
    }
    cmd
}

pub async fn boot(
    sidecar: &SharedSidecar,
    producer: &TauriDiagnosticsProducer,
    supervisor: &Arc<DiagnosticsCollectorSupervisor>,
) {
    let operation = producer.begin_lifecycle("desktop.anyharness_process.start");
    finish_boot_operation(operation, boot_inner(sidecar, supervisor).await);
}

fn finish_boot_operation(
    operation: crate::diagnostics_collector::producer::lifecycle::LifecycleOperation,
    outcome: BootOutcome,
) {
    match outcome {
        BootOutcome::External => operation.terminal(TerminalOutcomeV1::Skipped, None),
        BootOutcome::Succeeded => operation.terminal(TerminalOutcomeV1::Succeeded, None),
        BootOutcome::Failed(classification) => {
            operation.terminal(TerminalOutcomeV1::Failed, Some(classification));
        }
        BootOutcome::TimedOut => {
            operation.terminal(TerminalOutcomeV1::TimedOut, Some("readiness_timeout"));
        }
        BootOutcome::Rejected => {
            operation.terminal(TerminalOutcomeV1::Rejected, Some("shutdown_armed"));
        }
        BootOutcome::Cancelled => {
            operation.terminal(TerminalOutcomeV1::Cancelled, Some("shutdown_armed"));
        }
    }
}

pub async fn restart(
    sidecar: &SharedSidecar,
    launch_env: HashMap<String, String>,
    producer: &TauriDiagnosticsProducer,
    supervisor: &Arc<DiagnosticsCollectorSupervisor>,
) -> Result<(), String> {
    let operation = producer.begin_lifecycle("desktop.anyharness_process.restart");
    {
        let mut guard = sidecar.lock().await;
        if sidecar.shutdown_is_armed() {
            operation.terminal(TerminalOutcomeV1::Rejected, Some("shutdown_armed"));
            return Err("AnyHarness restart rejected because shutdown is armed".to_string());
        }
        let reap_deadline = tokio::time::Instant::now() + Duration::from_secs(2);
        let reaped = if let Some(ref mut child) = guard.child {
            Some(match child.try_wait() {
                Ok(Some(status)) => (
                    status,
                    crate::diagnostics_collector::child_bridge::reap::ChildReapKind::Natural,
                ),
                Ok(None) => {
                    if let Err(error) = child.start_kill() {
                        operation.terminal(TerminalOutcomeV1::Failed, Some("shutdown_failed"));
                        return Err(format!("Failed to stop AnyHarness for restart: {error}"));
                    }
                    match tokio::time::timeout_at(reap_deadline, child.wait()).await {
                        Ok(Ok(status)) => (
                            status,
                            crate::diagnostics_collector::child_bridge::reap::ChildReapKind::Forced,
                        ),
                        Ok(Err(error)) => {
                            operation.terminal(TerminalOutcomeV1::Failed, Some("shutdown_failed"));
                            return Err(format!("Failed to reap AnyHarness for restart: {error}"));
                        }
                        Err(_) => {
                            operation
                                .terminal(TerminalOutcomeV1::TimedOut, Some("shutdown_timeout"));
                            return Err("Timed out stopping AnyHarness for restart".to_string());
                        }
                    }
                }
                Err(error) => {
                    operation.terminal(TerminalOutcomeV1::Failed, Some("child_inspection_failed"));
                    return Err(format!("Failed to inspect AnyHarness for restart: {error}"));
                }
            })
        } else {
            None
        };
        if let Some((status, kind)) = reaped {
            guard
                .finish_diagnostics_reap(status, kind, reap_deadline)
                .await;
        }
        observer::cancel_locked(&mut guard);
        guard.child = None;
        guard.clear_diagnostics_bridge();
        #[cfg(all(
            target_os = "macos",
            any(target_arch = "aarch64", target_arch = "x86_64")
        ))]
        sidecar.set_child_shutdown_signal(None);
        guard.info.status = RuntimeStatus::Stopped;
        guard.launch_env = launch_env;
        persist_sidecar_runtime_info(&guard, None);
    }

    finish_boot_operation(operation, boot_inner(sidecar, supervisor).await);
    Ok(())
}

pub async fn stop(
    sidecar: &SharedSidecar,
    producer: &TauriDiagnosticsProducer,
) -> Result<bool, String> {
    let operation = producer.begin_lifecycle("desktop.anyharness_process.stop");
    sidecar.arm_terminal_shutdown();
    let mut guard = sidecar.lock().await;
    let Some(child) = guard.child.as_mut() else {
        guard.info.status = RuntimeStatus::Stopped;
        persist_sidecar_runtime_info(&guard, None);
        operation.terminal(TerminalOutcomeV1::Skipped, None);
        return Ok(false);
    };
    let reap_deadline = tokio::time::Instant::now() + Duration::from_secs(2);
    let (reaped, reap_kind) = match child.try_wait() {
        Ok(Some(status)) => (
            status,
            crate::diagnostics_collector::child_bridge::reap::ChildReapKind::Orderly,
        ),
        Ok(None) => {
            if let Err(error) = child.start_kill() {
                operation.terminal(TerminalOutcomeV1::Failed, Some("shutdown_failed"));
                return Err(format!("Failed to stop AnyHarness: {error}"));
            }
            match tokio::time::timeout_at(reap_deadline, child.wait()).await {
                Ok(Ok(status)) => (
                    status,
                    crate::diagnostics_collector::child_bridge::reap::ChildReapKind::Forced,
                ),
                Ok(Err(error)) => {
                    operation.terminal(TerminalOutcomeV1::Failed, Some("shutdown_failed"));
                    return Err(format!("Failed to reap AnyHarness: {error}"));
                }
                Err(_) => {
                    operation.terminal(TerminalOutcomeV1::TimedOut, Some("shutdown_timeout"));
                    return Err("Timed out stopping AnyHarness".to_string());
                }
            }
        }
        Err(error) => {
            operation.terminal(TerminalOutcomeV1::Failed, Some("child_inspection_failed"));
            return Err(format!("Failed to inspect AnyHarness shutdown: {error}"));
        }
    };
    guard
        .finish_diagnostics_reap(reaped, reap_kind, reap_deadline)
        .await;
    observer::cancel_locked(&mut guard);
    guard.child = None;
    guard.clear_diagnostics_bridge();
    #[cfg(all(
        target_os = "macos",
        any(target_arch = "aarch64", target_arch = "x86_64")
    ))]
    sidecar.set_child_shutdown_signal(None);
    guard.info.status = RuntimeStatus::Stopped;
    persist_sidecar_runtime_info(&guard, None);
    operation.terminal(TerminalOutcomeV1::Succeeded, None);
    Ok(true)
}

pub(crate) fn arm_terminal_shutdown(sidecar: &SharedSidecar) {
    sidecar.arm_terminal_shutdown();
}

#[cfg(test)]
pub(crate) async fn install_shutdown_test_child(sidecar: &SharedSidecar, child: Child) {
    let mut guard = sidecar.lock().await;
    guard.child = Some(child);
    guard.info.status = RuntimeStatus::Healthy;
    guard.suppress_runtime_info_persistence = true;
}

#[cfg(test)]
pub(crate) async fn suppress_shutdown_test_persistence(sidecar: &SharedSidecar) {
    sidecar.lock().await.suppress_runtime_info_persistence = true;
}

fn runtime_health_url(runtime_url: &str) -> String {
    format!("{}/health", runtime_url.trim_end_matches('/'))
}

fn runtime_url_port(runtime_url: &str) -> Option<u16> {
    reqwest::Url::parse(runtime_url)
        .ok()
        .and_then(|url| url.port_or_known_default())
}

pub fn create_sidecar_with_auto_port() -> SharedSidecar {
    let port = pick_port();
    create_sidecar(port)
}

fn runtime_status_label(status: &RuntimeStatus) -> &'static str {
    match status {
        RuntimeStatus::Starting => "starting",
        RuntimeStatus::Healthy => "healthy",
        RuntimeStatus::Failed => "failed",
        RuntimeStatus::Stopped => "stopped",
    }
}

fn persist_runtime_info(info: &RuntimeInfo, health: Option<&RuntimeHealthRecord>) {
    let record = RuntimeInfoRecord {
        url: info.url.clone(),
        port: info.port,
        status: runtime_status_label(&info.status).to_string(),
        runtime_home: health.map(|value| value.runtime_home.clone()),
        version: health.map(|value| value.version.clone()),
    };

    if let Err(error) = write_runtime_info_record(&record) {
        tracing::warn!(error = %error, "Failed to persist runtime info");
    }
}

fn persist_sidecar_runtime_info(process: &SidecarProcess, health: Option<&RuntimeHealthRecord>) {
    #[cfg(test)]
    if process.suppress_runtime_info_persistence {
        return;
    }
    persist_runtime_info(&process.info, health);
}
