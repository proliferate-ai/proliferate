use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::State;

const DEFAULT_SSH_PORT: u16 = 22;
const DEFAULT_ANYHARNESS_PORT: u16 = 8457;
const TUNNEL_READY_TIMEOUT: Duration = Duration::from_secs(12);
const TUNNEL_READY_POLL: Duration = Duration::from_millis(150);

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

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EnsureSshAnyHarnessTunnelResult {
    local_url: String,
    local_port: u16,
}

#[tauri::command]
pub async fn ensure_ssh_anyharness_tunnel(
    state: State<'_, SshTunnelState>,
    input: EnsureSshAnyHarnessTunnelInput,
) -> Result<EnsureSshAnyHarnessTunnelResult, String> {
    let target_id = input.target_id.trim().to_string();
    let ssh_host = input.ssh_host.trim().to_string();
    let ssh_user = input.ssh_user.trim().to_string();
    if target_id.is_empty() || ssh_host.is_empty() || ssh_user.is_empty() {
        return Err("target_id, ssh_host, and ssh_user are required.".to_string());
    }

    let identity_file = input
        .identity_file
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(expand_home_path)
        .transpose()?;
    let connection_key = TunnelConnectionKey {
        ssh_host: ssh_host.clone(),
        ssh_user: ssh_user.clone(),
        ssh_port: input.ssh_port.unwrap_or(DEFAULT_SSH_PORT),
        identity_file: identity_file
            .as_ref()
            .map(|path| path.to_string_lossy().to_string()),
        remote_anyharness_port: input
            .remote_anyharness_port
            .unwrap_or(DEFAULT_ANYHARNESS_PORT),
    };

    if let Some(existing) = existing_tunnel_result(&state, &target_id, &connection_key)? {
        if wait_for_anyharness(&existing.local_url).await.is_ok() {
            return Ok(existing);
        }
        remove_tunnel(&state, &target_id);
    }

    let local_port = allocate_local_port()?;
    let local_url = format!("http://127.0.0.1:{local_port}");
    let mut command = Command::new("ssh");
    command
        .arg("-N")
        .arg("-L")
        .arg(format!(
            "127.0.0.1:{local_port}:127.0.0.1:{}",
            connection_key.remote_anyharness_port
        ))
        .arg("-o")
        .arg("BatchMode=yes")
        .arg("-o")
        .arg("ExitOnForwardFailure=yes")
        .arg("-o")
        .arg("StrictHostKeyChecking=accept-new")
        .arg("-o")
        .arg("ServerAliveInterval=30")
        .arg("-o")
        .arg("ServerAliveCountMax=3")
        .arg("-p")
        .arg(connection_key.ssh_port.to_string());

    if let Some(identity_file) = identity_file {
        command.arg("-i").arg(identity_file);
    }

    command
        .arg(format!("{ssh_user}@{ssh_host}"))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let child = command
        .spawn()
        .map_err(|error| format!("Failed to start SSH tunnel: {error}"))?;

    {
        let mut tunnels = state
            .tunnels
            .lock()
            .map_err(|_| "SSH tunnel state lock poisoned.".to_string())?;
        tunnels.insert(
            target_id.clone(),
            ManagedTunnel {
                local_port,
                local_url: local_url.clone(),
                connection_key,
                child,
            },
        );
    }

    match wait_for_anyharness(&local_url).await {
        Ok(()) => Ok(EnsureSshAnyHarnessTunnelResult {
            local_url,
            local_port,
        }),
        Err(error) => {
            remove_tunnel(&state, &target_id);
            Err(error)
        }
    }
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

fn remove_tunnel(state: &SshTunnelState, target_id: &str) {
    let Ok(mut tunnels) = state.tunnels.lock() else {
        return;
    };
    if let Some(mut tunnel) = tunnels.remove(target_id) {
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

async fn wait_for_anyharness(local_url: &str) -> Result<(), String> {
    let deadline = Instant::now() + TUNNEL_READY_TIMEOUT;
    let client = reqwest::Client::new();
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
