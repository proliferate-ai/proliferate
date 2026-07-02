use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::TcpListener;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::State;

use super::ssh_common::{
    append_common_ssh_options, command_output_error, normalize_port, parse_ssh_connection,
    ssh_destination, wait_for_child_output, CommandOutput, DEFAULT_ANYHARNESS_PORT,
};

const SSH_PROBE_TIMEOUT: Duration = Duration::from_secs(25);
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
    anyharness_bearer_token: Option<String>,
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

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EnsureSshAnyHarnessTunnelResult {
    local_url: String,
    local_port: u16,
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
                &[],
            ))
        }
    })
    .await
    .map_err(|error| format!("SSH probe task failed: {error}"))?
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

    let anyharness_bearer_token = input
        .anyharness_bearer_token
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let bearer = anyharness_bearer_token.as_deref();

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
        if wait_for_anyharness(&existing.local_url, bearer)
            .await
            .is_ok()
        {
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
        return match wait_for_anyharness(&existing.local_url, bearer).await {
            Ok(()) => Ok(existing),
            Err(error) => {
                remove_tunnel_for_port(&state, &target_id, existing.local_port);
                Err(error)
            }
        };
    }

    match wait_for_anyharness(&local_url, bearer).await {
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

fn spawn_and_wait_for_output(
    mut command: Command,
    timeout: Duration,
    context: &str,
) -> Result<CommandOutput, String> {
    let child = command
        .spawn()
        .map_err(|error| format!("Failed to start {context}: {error}"))?;
    wait_for_child_output(child, timeout, context, &[])
}

async fn wait_for_anyharness(local_url: &str, bearer_token: Option<&str>) -> Result<(), String> {
    let deadline = Instant::now() + TUNNEL_READY_TIMEOUT;
    let client = reqwest::Client::builder()
        .timeout(TUNNEL_HEALTH_REQUEST_TIMEOUT)
        .build()
        .map_err(|error| format!("Failed to create tunnel health client: {error}"))?;
    let health_url = format!("{}/health", local_url.trim_end_matches('/'));
    let mut last_error = String::new();
    while Instant::now() < deadline {
        match client.get(&health_url).send().await {
            Ok(response) if response.status().is_success() => {
                return verify_anyharness_access(&client, local_url, bearer_token).await;
            }
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

/// `/health` is registered outside the bearer middleware, so reachability
/// alone does not prove Desktop can use the runtime. Probe an authenticated
/// `/v1` route so enforcement mismatches fail here instead of on first use.
async fn verify_anyharness_access(
    client: &reqwest::Client,
    local_url: &str,
    bearer_token: Option<&str>,
) -> Result<(), String> {
    let verify_url = format!("{}/v1/workspaces", local_url.trim_end_matches('/'));
    let mut request = client.get(&verify_url);
    if let Some(bearer_token) = bearer_token {
        request = request.bearer_auth(bearer_token);
    }
    let response = request.send().await.map_err(|error| {
        format!("AnyHarness became reachable, but the access check failed at {verify_url}: {error}")
    })?;
    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err(if bearer_token.is_some() {
            format!(
                "AnyHarness rejected the stored runtime bearer ({status}). Reconnect the target from Compute settings to refresh its runtime credentials."
            )
        } else {
            format!(
                "AnyHarness requires a runtime bearer that Desktop does not have ({status}). Reconnect the target from Compute settings."
            )
        });
    }
    Ok(())
}
