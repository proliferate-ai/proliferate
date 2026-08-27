//! The OpenCode targeted-fork HTTP side-door.
//!
//! `opencode acp` boots the vendor's full HTTP server as a side effect; when
//! given `--hostname`/`--port` and `OPENCODE_SERVER_PASSWORD` it is reachable
//! (with Basic auth) at a loopback address we choose. This module owns the
//! per-process spawn config (port + password) and the fail-closed readiness
//! check that decides whether the side-door capability is ever considered on.
//!
//! The (port, password) pair is process-local runtime state only: it is never
//! persisted and never logged. `SidedoorSpawnConfig`'s `Debug` impl redacts
//! the password so an incidental `{:?}` in a log line cannot leak it.

use std::fmt;
use std::net::{IpAddr, SocketAddr, TcpListener, TcpStream, UdpSocket};
use std::time::Duration;

use anyharness_contract::v1::SessionActionCapabilities;

use crate::domains::agents::model::AgentKind;
use crate::domains::sessions::model::serialize_action_capabilities;
use crate::domains::sessions::runtime::fork_qualification::sidedoor_fork_qualified;
use crate::live::sessions::model::LaunchEnv;
use crate::live::sessions::model::SessionStateDurable;

/// Spawn-time config for the OpenCode side-door: the loopback port the vendor
/// HTTP server will bind and the Basic-auth password that gates it.
#[derive(Clone)]
pub struct SidedoorSpawnConfig {
    pub port: u16,
    pub password: String,
}

impl fmt::Debug for SidedoorSpawnConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SidedoorSpawnConfig")
            .field("port", &self.port)
            .field("password", &"<redacted>")
            .finish()
    }
}

impl SidedoorSpawnConfig {
    /// Pick an ephemeral loopback port (bind-and-drop on 127.0.0.1:0) and mint
    /// a fresh Basic-auth password. Never reused across processes.
    pub fn generate() -> anyhow::Result<Self> {
        let port = pick_ephemeral_port()?;
        let password = generate_password();
        Ok(Self { port, password })
    }

    /// Args to append to the OpenCode `acp` invocation.
    pub fn spawn_args(&self) -> Vec<String> {
        vec![
            "--hostname".to_string(),
            "127.0.0.1".to_string(),
            "--port".to_string(),
            self.port.to_string(),
        ]
    }

    /// Env var to set on the spawned process. Kept as a single accessor (not
    /// a raw field read) so every call site goes through the same redaction
    /// discipline as the rest of this type.
    pub fn env_var(&self) -> (&'static str, String) {
        ("OPENCODE_SERVER_PASSWORD", self.password.clone())
    }
}

fn pick_ephemeral_port() -> anyhow::Result<u16> {
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}

/// 32 hex chars (two v4 uuids' hyphen-stripped hex, truncated) -- reuses the
/// `uuid` dependency already vendored rather than adding a `rand` dep.
fn generate_password() -> String {
    let a = uuid::Uuid::new_v4().simple().to_string();
    let b = uuid::Uuid::new_v4().simple().to_string();
    format!("{a}{b}")[..32].to_string()
}

/// Outcome of the fail-closed side-door readiness check, recorded in the
/// actor/driver state. `Refused` and `Unavailable` both keep `targeted_fork`
/// off; only `Ready` allows the capability to ever be considered.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SidedoorState {
    Ready { port: u16 },
    Refused { reason: String },
    Unavailable,
}

/// Pure decision logic for the readiness check, factored out of the actual
/// network calls so it is unit-testable without a live server.
///
/// `auth_ok` is `Some(true)` when an authenticated call to the health
/// endpoint succeeded, `Some(false)` when an UNauthenticated call to the
/// health endpoint returned 200 (password not enforced -- itself a refusal
/// condition), and `None` when the endpoint could not be reached at all.
/// `off_host_reachable` is `Some(true)` when a TCP connect to the discovered
/// non-loopback local IP succeeded on the side-door port (reachable from
/// off-host); `None` when no non-loopback interface could be determined
/// (treated as "no off-host interface" -- a pass, not a failure).
pub fn decide_sidedoor_state(
    port: u16,
    auth_ok: Option<bool>,
    unauthenticated_rejected: Option<bool>,
    off_host_reachable: Option<bool>,
) -> SidedoorState {
    match auth_ok {
        None => SidedoorState::Unavailable,
        Some(false) => SidedoorState::Refused {
            reason: "side-door health check failed with valid credentials".to_string(),
        },
        Some(true) => {
            if unauthenticated_rejected == Some(false) {
                return SidedoorState::Refused {
                    reason: "side-door accepted an unauthenticated request (password not enforced)"
                        .to_string(),
                };
            }
            if off_host_reachable == Some(true) {
                return SidedoorState::Refused {
                    reason: "side-door is reachable from a non-loopback interface".to_string(),
                };
            }
            SidedoorState::Ready { port }
        }
    }
}

/// Process-local side-door runtime state retained on the parent actor: the
/// spawn config (port + redacted password) and the decided readiness state.
/// Never persisted, never logged (the config's `Debug` redacts the password).
#[derive(Debug, Clone)]
pub struct SidedoorRuntime {
    pub config: SidedoorSpawnConfig,
    pub state: SidedoorState,
}

impl SidedoorRuntime {
    pub fn is_ready(&self) -> bool {
        matches!(self.state, SidedoorState::Ready { .. })
    }
}

/// Fail-closed readiness probe, run once after the vendor HTTP server is
/// expected up. Bounded retry (~5s) on the authenticated loopback health check,
/// then confirms the auth middleware rejects an unauthenticated request and
/// that the side-door is not reachable from a non-loopback interface. A hung or
/// unreachable side-door degrades to `Unavailable`; a leaked/misconfigured one
/// degrades to `Refused`. Only a clean pass yields `Ready`.
pub async fn probe_sidedoor_readiness(
    config: &SidedoorSpawnConfig,
    session_id: &str,
) -> SidedoorState {
    use crate::domains::sessions::runtime::opencode_sidedoor_client::OpencodeSidedoorClient;

    let client = match OpencodeSidedoorClient::new(config.port, config.password.clone()) {
        Ok(client) => client,
        Err(_) => return SidedoorState::Unavailable,
    };

    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    let mut auth_ok: Option<bool> = None;
    loop {
        match client.health_check(session_id).await {
            // Authenticated loopback call succeeded: the door is up and our
            // credentials are honored.
            Ok(true) => {
                auth_ok = Some(true);
                break;
            }
            // Reachable but our valid credentials were rejected — a refusal
            // condition, not a retry: stop probing.
            Ok(false) => {
                auth_ok = Some(false);
                break;
            }
            // Not reachable yet; keep retrying until the deadline.
            Err(_) => {}
        }
        if std::time::Instant::now() >= deadline {
            break;
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
    }

    // The negative controls only matter once the authenticated call worked;
    // otherwise the decision is already Unavailable/Refused from `auth_ok`.
    let unauthenticated_rejected = if auth_ok == Some(true) {
        match client.health_check_unauthenticated(session_id).await {
            // 200 without credentials means the password is not enforced.
            Ok(accepted) => Some(!accepted),
            // Unreachable without credentials counts as rejected.
            Err(_) => Some(true),
        }
    } else {
        None
    };
    let off_host_reachable = if auth_ok == Some(true) {
        discover_primary_local_ipv4()
            .and_then(|ip| probe_off_host_reachable(ip, config.port, Duration::from_millis(300)))
    } else {
        None
    };

    decide_sidedoor_state(
        config.port,
        auth_ok,
        unauthenticated_rejected,
        off_host_reachable,
    )
}

/// Discover the primary non-loopback local IPv4 via the UDP-connect trick: no
/// packet is actually sent (UDP `connect` just binds the route), so this is
/// cheap and side-effect-free. Returns `None` (never a hard error) when no
/// such interface exists or can't be determined -- documented as "no
/// off-host interface" and treated as a pass by the caller.
pub fn discover_primary_local_ipv4() -> Option<IpAddr> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    let addr = socket.local_addr().ok()?;
    let ip = addr.ip();
    if ip.is_loopback() {
        None
    } else {
        Some(ip)
    }
}

/// Attempt a short-timeout TCP connect to `ip:port`. `Some(true)` = reachable,
/// `Some(false)` = refused/unreachable, matching `decide_sidedoor_state`'s
/// `off_host_reachable` parameter.
pub fn probe_off_host_reachable(ip: IpAddr, port: u16, timeout: Duration) -> Option<bool> {
    let addr = SocketAddr::new(ip, port);
    Some(TcpStream::connect_timeout(&addr, timeout).is_ok())
}

/// For OpenCode only, provision the HTTP side-door. Mint a fresh loopback
/// port + Basic-auth password, point the vendor `acp` server at them
/// (`--hostname 127.0.0.1 --port <port>` plus `OPENCODE_SERVER_PASSWORD`),
/// and hand back the config to retain as process-local actor state.
/// `settings_extra_args` is appended after the descriptor's own launch args
/// at spawn, and the password rides the session env layer. The (port,
/// password) pair is never persisted, never logged. `agent_kind` other than
/// OpenCode always yields `None`.
pub fn provision_sidedoor_spawn(agent_kind: &str, env: &mut LaunchEnv, session_id: &str) -> Option<SidedoorSpawnConfig> {
    if agent_kind != AgentKind::OpenCode.as_str() {
        return None;
    }
    match SidedoorSpawnConfig::generate() {
        Ok(config_sd) => {
            let (env_key, env_value) = config_sd.env_var();
            env.session.insert(env_key.to_string(), env_value);
            env.settings_extra_args.extend(config_sd.spawn_args());
            Some(config_sd)
        }
        Err(error) => {
            tracing::warn!(
                session_id = %session_id,
                error = %error,
                "failed to provision OpenCode side-door spawn config; targeted fork stays disabled"
            );
            None
        }
    }
}

/// With the vendor server up (native session established), run the
/// fail-closed side-door readiness check and derive `targeted_fork` for
/// OpenCode. `targeted_fork` = registry-qualified for the resolved vendor
/// version AND the side-door proved Ready. Because the shipped registry is
/// `qualified:false`, this leaves `targeted_fork` off today — flipping the
/// JSON record is the only enable step.
///
/// Returns the `SidedoorRuntime` to retain on the actor and mutates
/// `action_capabilities.targeted_fork` in place; if it flips on, re-persists
/// the durable capability row (the initial persist ran before readiness).
pub async fn derive_sidedoor_capability(
    config_sd: SidedoorSpawnConfig,
    native_session_id: &str,
    session_id: &str,
    workspace_id: &str,
    resolved_native_version: Option<&str>,
    action_capabilities: &mut SessionActionCapabilities,
    store: &dyn SessionStateDurable,
) -> SidedoorRuntime {
    let state = probe_sidedoor_readiness(&config_sd, native_session_id).await;
    if let SidedoorState::Refused { reason } = &state {
        tracing::warn!(
            session_id = %session_id,
            workspace_id = %workspace_id,
            side_door_state = "refused",
            reason = %reason,
            "OpenCode side-door refused; targeted fork stays disabled"
        );
    }
    let ready = matches!(state, SidedoorState::Ready { .. });
    let qualified = resolved_native_version
        .map(|version| sidedoor_fork_qualified(AgentKind::OpenCode.as_str(), version))
        .unwrap_or(false);
    action_capabilities.targeted_fork = qualified && ready;
    if action_capabilities.targeted_fork {
        persist_action_capabilities_value(store, session_id, *action_capabilities);
    }
    SidedoorRuntime {
        config: config_sd,
        state,
    }
}

/// Persist an already-resolved capability set (used by the OpenCode side-door
/// bridge after the side-door readiness check derives `targeted_fork`, which
/// the ACP-only initial persist cannot know at handshake time).
fn persist_action_capabilities_value(
    store: &dyn SessionStateDurable,
    session_id: &str,
    capabilities: SessionActionCapabilities,
) {
    let Ok(json) = serialize_action_capabilities(capabilities) else {
        tracing::warn!(
            session_id,
            "failed to serialize session action capabilities"
        );
        return;
    };
    let now = chrono::Utc::now().to_rfc3339();
    if let Err(error) = store.update_action_capabilities_json(session_id, Some(json), &now) {
        tracing::warn!(
            session_id,
            error = %error,
            "failed to persist session action capabilities"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_config_has_valid_port_and_password() {
        let config = SidedoorSpawnConfig::generate().expect("generate config");
        assert!(config.port > 0);
        assert_eq!(config.password.len(), 32);
        assert!(config.password.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn debug_redacts_password() {
        let config = SidedoorSpawnConfig {
            port: 12345,
            password: "super-secret-value".to_string(),
        };
        let debug = format!("{config:?}");
        assert!(!debug.contains("super-secret-value"));
        assert!(debug.contains("redacted"));
    }

    #[test]
    fn two_generated_passwords_differ() {
        let a = SidedoorSpawnConfig::generate().unwrap();
        let b = SidedoorSpawnConfig::generate().unwrap();
        assert_ne!(a.password, b.password);
    }

    #[test]
    fn unreachable_health_check_is_unavailable() {
        assert_eq!(
            decide_sidedoor_state(1, None, None, None),
            SidedoorState::Unavailable
        );
    }

    #[test]
    fn failed_authenticated_call_is_refused() {
        assert!(matches!(
            decide_sidedoor_state(1, Some(false), None, None),
            SidedoorState::Refused { .. }
        ));
    }

    #[test]
    fn unauthenticated_200_is_refused() {
        assert!(matches!(
            decide_sidedoor_state(1, Some(true), Some(false), Some(false)),
            SidedoorState::Refused { .. }
        ));
    }

    #[test]
    fn off_host_reachable_is_refused() {
        assert!(matches!(
            decide_sidedoor_state(1, Some(true), Some(true), Some(true)),
            SidedoorState::Refused { .. }
        ));
    }

    #[test]
    fn no_off_host_interface_and_auth_enforced_is_ready() {
        assert_eq!(
            decide_sidedoor_state(4096, Some(true), Some(true), None),
            SidedoorState::Ready { port: 4096 }
        );
    }

    #[test]
    fn off_host_unreachable_and_auth_enforced_is_ready() {
        assert_eq!(
            decide_sidedoor_state(4096, Some(true), Some(true), Some(false)),
            SidedoorState::Ready { port: 4096 }
        );
    }
}

#[cfg(test)]
mod readiness_tests {
    //! Fail-closed readiness against an in-process fake side-door.
    //! These pin the two leak conditions that must knock the side-door down to
    //! `Refused` — an unenforced password and off-host reachability — plus the
    //! clean loopback pass.

    use std::io::{Read, Write};
    use std::net::TcpListener;

    use super::{probe_sidedoor_readiness, SidedoorSpawnConfig, SidedoorState};

    /// Spawns a detached fake side-door health endpoint. `enforce_auth=false`
    /// models the middleware NO-OP (200 even without credentials); `true`
    /// returns 401 for an unauthenticated request. Bound at `bind` so the
    /// off-host reachability probe can be exercised (`0.0.0.0`).
    fn spawn_health_server(bind: &str, enforce_auth: bool) -> u16 {
        let listener = TcpListener::bind((bind, 0)).expect("bind fake health server");
        let port = listener.local_addr().expect("addr").port();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let mut buf = [0u8; 2048];
                let read = stream.read(&mut buf).unwrap_or(0);
                let request = String::from_utf8_lossy(&buf[..read]);
                let has_auth = request
                    .lines()
                    .any(|line| line.to_ascii_lowercase().starts_with("authorization:"));
                let ok = !enforce_auth || has_auth;
                let response = if ok {
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n[]"
                } else {
                    "HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                };
                let _ = stream.write_all(response.as_bytes());
            }
        });
        port
    }

    fn config(port: u16) -> SidedoorSpawnConfig {
        SidedoorSpawnConfig {
            port,
            password: "test-password-0000000000000000".to_string(),
        }
    }

    #[tokio::test]
    async fn loopback_enforced_and_not_off_host_is_ready() {
        let port = spawn_health_server("127.0.0.1", true);
        let state = probe_sidedoor_readiness(&config(port), "native_session").await;
        // A server bound to loopback only is never reachable off-host, so with
        // auth enforced this is the clean Ready pass.
        assert_eq!(state, SidedoorState::Ready { port });
    }

    #[tokio::test]
    async fn unenforced_password_is_refused() {
        let port = spawn_health_server("127.0.0.1", false);
        let state = probe_sidedoor_readiness(&config(port), "native_session").await;
        assert!(
            matches!(state, SidedoorState::Refused { .. }),
            "an unauthenticated 200 must refuse: {state:?}"
        );
    }

    #[tokio::test]
    async fn off_host_reachable_is_refused() {
        // Only meaningful when the machine has a non-loopback interface; the
        // pure decision logic already pins the None (no-interface) case.
        if super::discover_primary_local_ipv4().is_none() {
            return;
        }
        let port = spawn_health_server("0.0.0.0", true);
        let state = probe_sidedoor_readiness(&config(port), "native_session").await;
        assert!(
            matches!(state, SidedoorState::Refused { .. }),
            "an off-host-reachable side-door must refuse: {state:?}"
        );
    }
}
