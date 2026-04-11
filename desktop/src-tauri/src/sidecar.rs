use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

use crate::desktop_telemetry_mode::{resolve_desktop_telemetry_mode, DesktopTelemetryMode};

const DEFAULT_HOST: &str = "127.0.0.1";
const HEALTH_POLL_INTERVAL: Duration = Duration::from_millis(250);
const HEALTH_POLL_TIMEOUT: Duration = Duration::from_secs(60);

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

pub struct SidecarProcess {
    child: Option<Child>,
    pub info: RuntimeInfo,
    pub launch_env: HashMap<String, String>,
}

impl SidecarProcess {
    fn new(port: u16) -> Self {
        Self {
            child: None,
            info: RuntimeInfo {
                url: format!("http://{DEFAULT_HOST}:{port}"),
                port,
                status: RuntimeStatus::Stopped,
            },
            launch_env: HashMap::new(),
        }
    }
}

impl Drop for SidecarProcess {
    fn drop(&mut self) {
        if let Some(ref mut child) = self.child {
            let _ = child.start_kill();
        }
    }
}

pub type SharedSidecar = Arc<Mutex<SidecarProcess>>;

pub fn create_sidecar(port: u16) -> SharedSidecar {
    Arc::new(Mutex::new(SidecarProcess::new(port)))
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

fn current_target_triple() -> &'static str {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        "aarch64-apple-darwin"
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        "x86_64-apple-darwin"
    }
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        "x86_64-unknown-linux-musl"
    }
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    {
        "aarch64-unknown-linux-musl"
    }
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        "x86_64-pc-windows-msvc"
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn hosted_env_lookup(key: &str) -> Option<String> {
        match key {
            "ANYHARNESS_SENTRY_DSN" => Some("https://example.invalid/1".to_string()),
            "ANYHARNESS_SENTRY_ENVIRONMENT" => Some("production".to_string()),
            "ANYHARNESS_SENTRY_RELEASE" => Some("anyharness@1.2.3".to_string()),
            "ANYHARNESS_SENTRY_TRACES_SAMPLE_RATE" => Some("0.5".to_string()),
            _ => None,
        }
    }

    #[test]
    fn sidecar_launch_env_is_empty_outside_hosted_product() {
        assert!(default_anyharness_launch_env_for_mode(
            DesktopTelemetryMode::Disabled,
            hosted_env_lookup
        )
        .is_empty());
        assert!(default_anyharness_launch_env_for_mode(
            DesktopTelemetryMode::LocalDev,
            hosted_env_lookup
        )
        .is_empty());
        assert!(default_anyharness_launch_env_for_mode(
            DesktopTelemetryMode::SelfManaged,
            hosted_env_lookup,
        )
        .is_empty());
    }

    #[test]
    fn sidecar_launch_env_includes_sentry_values_in_hosted_product() {
        let env = default_anyharness_launch_env_for_mode(
            DesktopTelemetryMode::HostedProduct,
            hosted_env_lookup,
        );

        assert_eq!(
            env.get("ANYHARNESS_SENTRY_DSN"),
            Some(&"https://example.invalid/1".to_string())
        );
        assert_eq!(
            env.get("ANYHARNESS_SENTRY_ENVIRONMENT"),
            Some(&"production".to_string())
        );
        assert_eq!(
            env.get("ANYHARNESS_SENTRY_RELEASE"),
            Some(&"anyharness@1.2.3".to_string())
        );
        assert_eq!(
            env.get("ANYHARNESS_SENTRY_TRACES_SAMPLE_RATE"),
            Some(&"0.5".to_string())
        );
    }
}

fn build_spawn_command(binary: &str, port: u16, launch_env: &HashMap<String, String>) -> Command {
    let mut cmd = Command::new(binary);
    let mut runtime_env = default_anyharness_launch_env();
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

pub async fn boot(sidecar: &SharedSidecar) {
    // Dev-URL mode: point at an externally running AnyHarness, skip spawn.
    if let Ok(dev_url) = std::env::var("ANYHARNESS_DEV_URL") {
        tracing::info!(
            runtime_url = %dev_url,
            "ANYHARNESS_DEV_URL set, using external runtime"
        );
        let mut guard = sidecar.lock().await;
        guard.info.url = dev_url;
        guard.info.status = RuntimeStatus::Healthy;
        return;
    }

    let (port, launch_env) = {
        let guard = sidecar.lock().await;
        (guard.info.port, guard.launch_env.clone())
    };

    let binary = match find_anyharness_binary() {
        Some(b) => b,
        None => {
            tracing::error!("No AnyHarness binary found and no dev URL set");
            let mut guard = sidecar.lock().await;
            guard.info.status = RuntimeStatus::Failed;
            return;
        }
    };

    {
        let mut guard = sidecar.lock().await;
        guard.info.status = RuntimeStatus::Starting;
    }

    tracing::info!(
        binary = %binary,
        port,
        "Launching AnyHarness sidecar"
    );

    let child_result = build_spawn_command(&binary, port, &launch_env).spawn();

    match child_result {
        Ok(child) => {
            tracing::info!("AnyHarness sidecar spawned; waiting for health");
            {
                let mut guard = sidecar.lock().await;
                guard.child = Some(child);
                guard.info.status = RuntimeStatus::Starting;
            }
            wait_healthy(sidecar).await;
        }
        Err(e) => {
            tracing::error!(
                binary = %binary,
                error = %e,
                "Failed to spawn AnyHarness sidecar"
            );
            let mut guard = sidecar.lock().await;
            guard.info.status = RuntimeStatus::Failed;
        }
    }
}

pub async fn restart(sidecar: &SharedSidecar, launch_env: HashMap<String, String>) {
    {
        let mut guard = sidecar.lock().await;
        if let Some(ref mut child) = guard.child {
            let _ = child.start_kill();
            let _ = child.wait().await;
        }
        guard.child = None;
        guard.info.status = RuntimeStatus::Stopped;
        guard.launch_env = launch_env;
    }

    boot(sidecar).await;
}

async fn wait_healthy(sidecar: &SharedSidecar) {
    let start = std::time::Instant::now();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .unwrap_or_default();

    loop {
        let url = {
            let mut guard = sidecar.lock().await;
            if let Some(child) = guard.child.as_mut() {
                match child.try_wait() {
                    Ok(Some(status)) => {
                        guard.info.status = RuntimeStatus::Failed;
                        tracing::error!(
                            exit_status = %status,
                            "AnyHarness sidecar exited before becoming healthy"
                        );
                        return;
                    }
                    Ok(None) => {}
                    Err(error) => {
                        guard.info.status = RuntimeStatus::Failed;
                        tracing::error!(
                            error = %error,
                            "Failed to inspect AnyHarness sidecar process state"
                        );
                        return;
                    }
                }
            } else {
                guard.info.status = RuntimeStatus::Stopped;
                tracing::error!("AnyHarness sidecar handle missing during startup");
                return;
            }

            format!("{}/health", guard.info.url)
        };

        if start.elapsed() > HEALTH_POLL_TIMEOUT {
            let mut guard = sidecar.lock().await;
            guard.info.status = RuntimeStatus::Failed;
            tracing::error!(
                timeout_ms = HEALTH_POLL_TIMEOUT.as_millis(),
                "AnyHarness sidecar failed to become healthy in time"
            );
            return;
        }

        match client.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => {
                tracing::info!(health_url = %url, "AnyHarness sidecar is healthy");
                let mut guard = sidecar.lock().await;
                guard.info.status = RuntimeStatus::Healthy;
                return;
            }
            _ => {}
        }

        tokio::time::sleep(HEALTH_POLL_INTERVAL).await;
    }
}

pub fn create_sidecar_with_auto_port() -> SharedSidecar {
    let port = pick_port();
    create_sidecar(port)
}
