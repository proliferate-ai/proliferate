use std::collections::{HashMap, HashSet};
use std::net::TcpListener;
use std::sync::OnceLock;

use sha2::{Digest, Sha256};
use tokio::sync::Mutex;

use super::{LocalMcpOAuthCode, DEFAULT_PORT_BASE, PORT_POOL_SIZE};

static PORT_LEASES: OnceLock<Mutex<PortLeaseState>> = OnceLock::new();

#[derive(Default)]
pub(super) struct PortLeaseState {
    pub(super) setup: HashSet<u16>,
    pub(super) runtime: HashMap<String, u16>,
}

impl PortLeaseState {
    pub(super) fn is_port_leased(&self, port: u16) -> bool {
        self.setup.contains(&port)
            || self
                .runtime
                .values()
                .any(|leased_port| *leased_port == port)
    }
}

pub(super) fn port_leases() -> &'static Mutex<PortLeaseState> {
    PORT_LEASES.get_or_init(|| Mutex::new(PortLeaseState::default()))
}
pub(super) async fn lease_setup_port() -> Result<u16, LocalMcpOAuthCode> {
    let base = configured_port_base();
    let mut leases = port_leases().lock().await;
    for offset in 0..PORT_POOL_SIZE {
        let Some(port) = base.checked_add(offset) else {
            continue;
        };
        if leases.is_port_leased(port) {
            continue;
        }
        if port_is_available(port) {
            leases.setup.insert(port);
            return Ok(port);
        }
    }
    Err(LocalMcpOAuthCode::PortUnavailable)
}

pub(super) async fn release_setup_port(port: u16) {
    port_leases().lock().await.setup.remove(&port);
}

pub(super) async fn lease_runtime_port(
    launch_id: &str,
    connection_id: &str,
) -> Result<u16, LocalMcpOAuthCode> {
    let key = runtime_port_lease_key(launch_id, connection_id);
    let base = configured_port_base();
    let primary_offset = hash_port_offset(launch_id, connection_id);
    let mut leases = port_leases().lock().await;
    if let Some(port) = leases.runtime.get(&key).copied() {
        return Ok(port);
    }
    for step in 0..PORT_POOL_SIZE {
        let offset = (primary_offset + step) % PORT_POOL_SIZE;
        let Some(port) = base.checked_add(offset) else {
            continue;
        };
        if leases.is_port_leased(port) {
            continue;
        }
        if port_is_available(port) {
            leases.runtime.insert(key, port);
            return Ok(port);
        }
    }
    Err(LocalMcpOAuthCode::PortUnavailable)
}

pub(super) async fn release_runtime_port(launch_id: &str, connection_id: &str) {
    port_leases()
        .lock()
        .await
        .runtime
        .remove(&runtime_port_lease_key(launch_id, connection_id));
}

pub(super) fn runtime_port_lease_key(launch_id: &str, connection_id: &str) -> String {
    format!("{launch_id}\n{connection_id}")
}

#[cfg(test)]
pub(super) fn primary_runtime_port(launch_id: &str, connection_id: &str) -> u16 {
    let base = configured_port_base();
    let primary_offset = hash_port_offset(launch_id, connection_id);
    base.saturating_add(primary_offset)
}

fn hash_port_offset(launch_id: &str, connection_id: &str) -> u16 {
    let mut hasher = Sha256::new();
    hasher.update(launch_id.as_bytes());
    hasher.update(b":");
    hasher.update(connection_id.as_bytes());
    let digest = hasher.finalize();
    u16::from_be_bytes([digest[0], digest[1]]) % PORT_POOL_SIZE
}

fn configured_port_base() -> u16 {
    std::env::var("PROLIFERATE_GOOGLE_WORKSPACE_MCP_PORT_BASE")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|value| value.checked_add(PORT_POOL_SIZE - 1).is_some())
        .unwrap_or(DEFAULT_PORT_BASE)
}

fn port_is_available(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}
