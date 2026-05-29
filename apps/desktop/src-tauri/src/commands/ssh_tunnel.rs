use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use tauri::State;

const INSTALLER_SCRIPT: &str = include_str!("../../../../../install/proliferate-target-install.sh");
const DEFAULT_SSH_PORT: u16 = 22;
const DEFAULT_ANYHARNESS_PORT: u16 = 8457;
const SSH_CONNECT_TIMEOUT_SECONDS: u16 = 12;
const SSH_PROBE_TIMEOUT: Duration = Duration::from_secs(25);
const SSH_INSTALL_TIMEOUT: Duration = Duration::from_secs(600);
const TUNNEL_READY_TIMEOUT: Duration = Duration::from_secs(12);
const TUNNEL_READY_POLL: Duration = Duration::from_millis(150);
const TUNNEL_HEALTH_REQUEST_TIMEOUT: Duration = Duration::from_millis(900);

#[derive(Default)]
pub struct SshTunnelState {
    tunnels: Mutex<HashMap<String, ManagedTunnel>>,
}

impl Drop for SshTunnelState {
    fn drop(&mut self) {
        if let Ok(mut tunnels) = self.tunnels.lock() {
            for tunnel in tunnels.values_mut() {
                let _ = tunnel.child.kill();
                let _ = tunnel.child.wait();
            }
        }
    }
}

struct ManagedTunnel {
    local_port: u16,
    local_url: String,
    connection_key: TunnelConnectionKey,
    child: Child,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct TunnelConnectionKey {
    ssh_host: String,
    ssh_user: String,
    ssh_port: u16,
    identity_file: Option<String>,
    remote_anyharness_port: u16,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnsureSshAnyHarnessTunnelInput {
    target_id: String,
    ssh_host: String,
    ssh_user: String,
    ssh_port: Option<u16>,
    identity_file: Option<String>,
    remote_anyharness_port: Option<u16>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeSshTargetConnectionInput {
    ssh_host: String,
    ssh_user: String,
    ssh_port: Option<u16>,
    identity_file: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProbeSshTargetConnectionResult {
    ok: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallSshTargetRuntimeInput {
    ssh_host: String,
    ssh_user: String,
    ssh_port: Option<u16>,
    identity_file: Option<String>,
    remote_anyharness_port: Option<u16>,
    cloud_base_url: String,
    enrollment_token: String,
    artifact_base_url: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstallSshTargetRuntimeResult {
    stdout: String,
    stderr: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EnsureSshAnyHarnessTunnelResult {
    local_url: String,
    local_port: u16,
}

#[derive(Debug)]
struct SshConnection {
    ssh_host: String,
    ssh_user: String,
    ssh_port: u16,
    identity_file: Option<PathBuf>,
}

struct CommandOutput {
    status: ExitStatus,
    stdout: String,
    stderr: String,
}

#[tauri::command]
pub async fn probe_ssh_target_connection(
    input: ProbeSshTargetConnectionInput,
) -> Result<ProbeSshTargetConnectionResult, String> {
    let connection = parse_ssh_connection(
        input.ssh_host,
        input.ssh_user,
        input.ssh_port,
        input.identity_file,
    )?;
    tokio::task::spawn_blocking(move || {
        let mut command = Command::new("ssh");
        append_common_ssh_options(&mut command, &connection);
        command
            .arg("--")
            .arg(ssh_destination(&connection))
            .arg("true")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let output = spawn_and_wait_for_output(command, SSH_PROBE_TIMEOUT, "SSH probe")?;
        if output.status.success() {
            Ok(ProbeSshTargetConnectionResult { ok: true })
        } else {
            Err(command_output_error(
                "SSH probe failed",
                &output.stdout,
                &output.stderr,
                None,
            ))
        }
    })
    .await
    .map_err(|error| format!("SSH probe task failed: {error}"))?
}

#[tauri::command]
pub async fn install_ssh_target_runtime(
    input: InstallSshTargetRuntimeInput,
) -> Result<InstallSshTargetRuntimeResult, String> {
    let cloud_base_url = input
        .cloud_base_url
        .trim()
        .trim_end_matches('/')
        .to_string();
    let enrollment_token = input.enrollment_token.trim().to_string();
    if cloud_base_url.is_empty() {
        return Err("Cloud base URL is required.".to_string());
    }
    if enrollment_token.is_empty() {
        return Err("Enrollment token is required.".to_string());
    }
    let artifact_base_url = input
        .artifact_base_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let remote_anyharness_port = normalize_port(
        input.remote_anyharness_port,
        DEFAULT_ANYHARNESS_PORT,
        "Remote AnyHarness port",
    )?;
    let connection = parse_ssh_connection(
        input.ssh_host,
        input.ssh_user,
        input.ssh_port,
        input.identity_file,
    )?;

    tokio::task::spawn_blocking(move || {
        let mut command = Command::new("ssh");
        append_common_ssh_options(&mut command, &connection);
        command
            .arg("--")
            .arg(ssh_destination(&connection))
            .arg("sh")
            .arg("-s")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = command
            .spawn()
            .map_err(|error| format!("Failed to start SSH installer: {error}"))?;

        {
            let mut stdin = child
                .stdin
                .take()
                .ok_or_else(|| "Failed to open SSH installer stdin.".to_string())?;
            let payload = installer_payload(
                &cloud_base_url,
                &enrollment_token,
                artifact_base_url.as_deref(),
                remote_anyharness_port,
            );
            stdin
                .write_all(payload.as_bytes())
                .map_err(|error| format!("Failed to stream installer over SSH: {error}"))?;
        }

        let output = wait_for_child_output(
            child,
            SSH_INSTALL_TIMEOUT,
            "SSH installer",
            Some(&enrollment_token),
        )?;
        let stdout = redact_token(output.stdout, &enrollment_token);
        let stderr = redact_token(output.stderr, &enrollment_token);
        if output.status.success() {
            Ok(InstallSshTargetRuntimeResult { stdout, stderr })
        } else {
            Err(command_output_error(
                "SSH installer failed",
                &stdout,
                &stderr,
                Some(&enrollment_token),
            ))
        }
    })
    .await
    .map_err(|error| format!("SSH installer task failed: {error}"))?
}

#[tauri::command]
pub async fn ensure_ssh_anyharness_tunnel(
    state: State<'_, SshTunnelState>,
    input: EnsureSshAnyHarnessTunnelInput,
) -> Result<EnsureSshAnyHarnessTunnelResult, String> {
    let target_id = input.target_id.trim().to_string();
    if target_id.is_empty() {
        return Err("target_id is required.".to_string());
    }

    let connection = parse_ssh_connection(
        input.ssh_host,
        input.ssh_user,
        input.ssh_port,
        input.identity_file,
    )?;
    let connection_key = TunnelConnectionKey {
        ssh_host: connection.ssh_host.clone(),
        ssh_user: connection.ssh_user.clone(),
        ssh_port: connection.ssh_port,
        identity_file: connection
            .identity_file
            .as_ref()
            .map(|path| path.to_string_lossy().to_string()),
        remote_anyharness_port: normalize_port(
            input.remote_anyharness_port,
            DEFAULT_ANYHARNESS_PORT,
            "Remote AnyHarness port",
        )?,
    };

    if let Some(existing) = existing_tunnel_result(&state, &target_id, &connection_key)? {
        if wait_for_anyharness(&existing.local_url).await.is_ok() {
            return Ok(existing);
        }
        remove_tunnel_for_port(&state, &target_id, existing.local_port);
    }

    let local_port = allocate_local_port()?;
    let local_url = format!("http://127.0.0.1:{local_port}");
    let mut command = Command::new("ssh");
    command.arg("-N").arg("-L").arg(format!(
        "127.0.0.1:{local_port}:127.0.0.1:{}",
        connection_key.remote_anyharness_port
    ));
    append_common_ssh_options(&mut command, &connection);
    command
        .arg("-o")
        .arg("ExitOnForwardFailure=yes")
        .arg("--")
        .arg(ssh_destination(&connection))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let child = command
        .spawn()
        .map_err(|error| format!("Failed to start SSH tunnel: {error}"))?;

    if let Some(existing) = insert_or_reuse_tunnel(
        &state,
        &target_id,
        connection_key,
        local_port,
        local_url.clone(),
        child,
    )? {
        return match wait_for_anyharness(&existing.local_url).await {
            Ok(()) => Ok(existing),
            Err(error) => {
                remove_tunnel_for_port(&state, &target_id, existing.local_port);
                Err(error)
            }
        };
    }

    match wait_for_anyharness(&local_url).await {
        Ok(()) => Ok(EnsureSshAnyHarnessTunnelResult {
            local_url,
            local_port,
        }),
        Err(error) => {
            remove_tunnel_for_port(&state, &target_id, local_port);
            Err(error)
        }
    }
}

fn insert_or_reuse_tunnel(
    state: &SshTunnelState,
    target_id: &str,
    connection_key: TunnelConnectionKey,
    local_port: u16,
    local_url: String,
    child: Child,
) -> Result<Option<EnsureSshAnyHarnessTunnelResult>, String> {
    enum LockedAction {
        Insert,
        Replace,
        Reuse(EnsureSshAnyHarnessTunnelResult),
        Error(String),
    }

    let mut pending_child = Some(child);
    let mut replaced_tunnel: Option<ManagedTunnel> = None;
    let mut child_to_kill: Option<Child> = None;
    let mut inspect_error: Option<String> = None;
    let reused = {
        let mut tunnels = state
            .tunnels
            .lock()
            .map_err(|_| "SSH tunnel state lock poisoned.".to_string())?;

        let action = match tunnels.get_mut(target_id) {
            None => LockedAction::Insert,
            Some(existing) => match existing.child.try_wait() {
                Ok(None) if existing.connection_key == connection_key => {
                    LockedAction::Reuse(EnsureSshAnyHarnessTunnelResult {
                        local_url: existing.local_url.clone(),
                        local_port: existing.local_port,
                    })
                }
                Ok(_) => LockedAction::Replace,
                Err(error) => LockedAction::Error(format!("Failed to inspect SSH tunnel: {error}")),
            },
        };

        match action {
            LockedAction::Reuse(result) => {
                child_to_kill = pending_child.take();
                Some(result)
            }
            LockedAction::Replace => {
                replaced_tunnel = tunnels.remove(target_id);
                tunnels.insert(
                    target_id.to_string(),
                    ManagedTunnel {
                        local_port,
                        local_url,
                        connection_key,
                        child: pending_child
                            .take()
                            .expect("pending SSH tunnel child disappeared"),
                    },
                );
                None
            }
            LockedAction::Insert => {
                tunnels.insert(
                    target_id.to_string(),
                    ManagedTunnel {
                        local_port,
                        local_url,
                        connection_key,
                        child: pending_child
                            .take()
                            .expect("pending SSH tunnel child disappeared"),
                    },
                );
                None
            }
            LockedAction::Error(error) => {
                replaced_tunnel = tunnels.remove(target_id);
                child_to_kill = pending_child.take();
                inspect_error = Some(error);
                None
            }
        }
    };

    if let Some(mut tunnel) = replaced_tunnel {
        let _ = tunnel.child.kill();
        let _ = tunnel.child.wait();
    }
    if let Some(mut child) = child_to_kill {
        let _ = child.kill();
        let _ = child.wait();
    }
    if let Some(error) = inspect_error {
        return Err(error);
    }
    Ok(reused)
}

fn existing_tunnel_result(
    state: &SshTunnelState,
    target_id: &str,
    expected_key: &TunnelConnectionKey,
) -> Result<Option<EnsureSshAnyHarnessTunnelResult>, String> {
    enum ExistingTunnelAction {
        Return(EnsureSshAnyHarnessTunnelResult),
        Remove,
    }

    let mut tunnels = state
        .tunnels
        .lock()
        .map_err(|_| "SSH tunnel state lock poisoned.".to_string())?;
    let Some(tunnel) = tunnels.get_mut(target_id) else {
        return Ok(None);
    };
    let action = match tunnel.child.try_wait() {
        Ok(Some(_status)) => ExistingTunnelAction::Remove,
        Ok(None) if tunnel.connection_key == *expected_key => {
            ExistingTunnelAction::Return(EnsureSshAnyHarnessTunnelResult {
                local_url: tunnel.local_url.clone(),
                local_port: tunnel.local_port,
            })
        }
        Ok(None) => ExistingTunnelAction::Remove,
        Err(error) => {
            tunnels.remove(target_id);
            return Err(format!("Failed to inspect SSH tunnel: {error}"));
        }
    };
    match action {
        ExistingTunnelAction::Return(result) => Ok(Some(result)),
        ExistingTunnelAction::Remove => {
            let Some(mut tunnel) = tunnels.remove(target_id) else {
                return Ok(None);
            };
            let _ = tunnel.child.kill();
            let _ = tunnel.child.wait();
            Ok(None)
        }
    }
}

fn remove_tunnel_for_port(state: &SshTunnelState, target_id: &str, local_port: u16) {
    let Ok(mut tunnels) = state.tunnels.lock() else {
        return;
    };
    let should_remove = tunnels
        .get(target_id)
        .is_some_and(|tunnel| tunnel.local_port == local_port);
    if should_remove {
        let Some(mut tunnel) = tunnels.remove(target_id) else {
            return;
        };
        let _ = tunnel.child.kill();
        let _ = tunnel.child.wait();
    }
}

fn allocate_local_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|error| format!("Failed to allocate local tunnel port: {error}"))?;
    listener
        .local_addr()
        .map(|addr| addr.port())
        .map_err(|error| format!("Failed to read local tunnel port: {error}"))
}

fn parse_ssh_connection(
    ssh_host: String,
    ssh_user: String,
    ssh_port: Option<u16>,
    identity_file: Option<String>,
) -> Result<SshConnection, String> {
    let ssh_host = ssh_host.trim().to_string();
    let ssh_user = ssh_user.trim().to_string();
    if ssh_host.is_empty() || ssh_user.is_empty() {
        return Err("SSH host and user are required.".to_string());
    }
    let identity_file = identity_file
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(expand_home_path)
        .transpose()?;
    Ok(SshConnection {
        ssh_host,
        ssh_user,
        ssh_port: normalize_port(ssh_port, DEFAULT_SSH_PORT, "SSH port")?,
        identity_file,
    })
}

fn normalize_port(value: Option<u16>, fallback: u16, label: &str) -> Result<u16, String> {
    match value {
        Some(0) => Err(format!("{label} must be between 1 and 65535.")),
        Some(port) => Ok(port),
        None => Ok(fallback),
    }
}

fn append_common_ssh_options(command: &mut Command, connection: &SshConnection) {
    command
        .arg("-o")
        .arg("BatchMode=yes")
        .arg("-o")
        .arg("StrictHostKeyChecking=accept-new")
        .arg("-o")
        .arg(format!("ConnectTimeout={SSH_CONNECT_TIMEOUT_SECONDS}"))
        .arg("-o")
        .arg("ServerAliveInterval=30")
        .arg("-o")
        .arg("ServerAliveCountMax=3")
        .arg("-p")
        .arg(connection.ssh_port.to_string());

    if let Some(identity_file) = &connection.identity_file {
        command.arg("-i").arg(identity_file);
    }
}

fn ssh_destination(connection: &SshConnection) -> String {
    format!("{}@{}", connection.ssh_user, connection.ssh_host)
}

fn installer_payload(
    cloud_base_url: &str,
    enrollment_token: &str,
    artifact_base_url: Option<&str>,
    remote_anyharness_port: u16,
) -> String {
    let mut payload = String::new();
    payload.push_str("set -eu\n");
    payload.push_str(&format!(
        "PROLIFERATE_CLOUD_URL={}\n",
        shell_quote(cloud_base_url),
    ));
    payload.push_str(&format!(
        "PROLIFERATE_ENROLLMENT_TOKEN={}\n",
        shell_quote(enrollment_token),
    ));
    payload.push_str(&format!(
        "PROLIFERATE_ANYHARNESS_PORT={}\n",
        shell_quote(&remote_anyharness_port.to_string()),
    ));
    payload.push_str(&format!(
        "PROLIFERATE_ANYHARNESS_BASE_URL={}\n",
        shell_quote(&format!("http://127.0.0.1:{remote_anyharness_port}")),
    ));
    if let Some(artifact_base_url) = artifact_base_url {
        payload.push_str(&format!(
            "PROLIFERATE_ARTIFACT_BASE_URL={}\n",
            shell_quote(artifact_base_url),
        ));
    }
    payload.push('\n');
    payload.push_str(INSTALLER_SCRIPT);
    payload.push('\n');
    payload
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn spawn_and_wait_for_output(
    mut command: Command,
    timeout: Duration,
    context: &str,
) -> Result<CommandOutput, String> {
    let child = command
        .spawn()
        .map_err(|error| format!("Failed to start {context}: {error}"))?;
    wait_for_child_output(child, timeout, context, None)
}

fn wait_for_child_output(
    mut child: Child,
    timeout: Duration,
    context: &str,
    token: Option<&str>,
) -> Result<CommandOutput, String> {
    let stdout_reader = spawn_reader(child.stdout.take());
    let stderr_reader = spawn_reader(child.stderr.take());
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let stdout = stdout_reader.join().unwrap_or_default();
                let stderr = stderr_reader.join().unwrap_or_default();
                return Ok(CommandOutput {
                    status,
                    stdout,
                    stderr,
                });
            }
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                let stdout = stdout_reader.join().unwrap_or_default();
                let stderr = stderr_reader.join().unwrap_or_default();
                let detail = command_output_error(context, &stdout, &stderr, token);
                return Err(format!(
                    "{context} timed out after {}s: {detail}",
                    timeout.as_secs()
                ));
            }
            Ok(None) => thread::sleep(Duration::from_millis(100)),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout_reader.join();
                let _ = stderr_reader.join();
                return Err(format!("Failed to wait for {context}: {error}"));
            }
        }
    }
}

fn spawn_reader<R>(reader: Option<R>) -> thread::JoinHandle<String>
where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let Some(mut reader) = reader else {
            return String::new();
        };
        let mut output = String::new();
        let _ = reader.read_to_string(&mut output);
        output
    })
}

fn redact_token(value: String, token: &str) -> String {
    value.replace(token, "[redacted]")
}

fn command_output_error(prefix: &str, stdout: &str, stderr: &str, token: Option<&str>) -> String {
    let stdout = stdout.trim();
    let stderr = stderr.trim();
    let mut detail = String::new();
    if !stderr.is_empty() {
        detail.push_str(stderr);
    }
    if !stdout.is_empty() {
        if !detail.is_empty() {
            detail.push_str("\n\n");
        }
        detail.push_str(stdout);
    }
    if let Some(token) = token {
        detail = redact_token(detail, token);
    }
    if detail.is_empty() {
        prefix.to_string()
    } else {
        format!("{prefix}: {detail}")
    }
}

async fn wait_for_anyharness(local_url: &str) -> Result<(), String> {
    let deadline = Instant::now() + TUNNEL_READY_TIMEOUT;
    let client = reqwest::Client::builder()
        .timeout(TUNNEL_HEALTH_REQUEST_TIMEOUT)
        .build()
        .map_err(|error| format!("Failed to create tunnel health client: {error}"))?;
    let health_url = format!("{}/health", local_url.trim_end_matches('/'));
    let mut last_error = String::new();
    while Instant::now() < deadline {
        match client.get(&health_url).send().await {
            Ok(response) if response.status().is_success() => return Ok(()),
            Ok(response) => {
                last_error = format!("health returned {}", response.status());
            }
            Err(error) => {
                last_error = error.to_string();
            }
        }
        tokio::time::sleep(TUNNEL_READY_POLL).await;
    }
    Err(format!(
        "SSH tunnel started, but AnyHarness did not become reachable at {health_url}: {last_error}",
    ))
}

fn expand_home_path(path: &str) -> Result<PathBuf, String> {
    if path == "~" {
        return std::env::var_os("HOME")
            .map(PathBuf::from)
            .ok_or_else(|| "HOME is not set.".to_string());
    }
    if let Some(rest) = path.strip_prefix("~/") {
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .ok_or_else(|| "HOME is not set.".to_string())?;
        return Ok(home.join(rest));
    }
    Ok(PathBuf::from(path))
}
