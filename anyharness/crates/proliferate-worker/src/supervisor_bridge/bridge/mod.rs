//! The D5 one-time bridge: migrate an already-provisioned sandbox (independently
//! `nohup`'d AnyHarness + Worker) to Supervisor ownership exactly once.
//!
//! The bridging Worker writes the Supervisor (and, for a server-delivered legacy
//! migration, a supervisor-owned Worker) config, starts the Supervisor detached,
//! confirms it took ownership of the runtime (Supervisor live AND AnyHarness
//! `/health` — see [`confirm_ownership`]), then exits so the Supervisor's own
//! Worker child takes over. Idempotent + crash-safe via marker files
//! (`bridge.started`/`bridge.done`) plus a Supervisor-liveness gate on the spawn.

use std::path::{Path, PathBuf};
use std::time::Duration;

use tokio::time::sleep;
use tracing::info;

use super::now_rfc3339;
use super::SUPERVISOR_OWNED_TOPOLOGY;
use crate::{
    cloud_client::{HeartbeatResponse, SupervisorBridgeInputs},
    config::WorkerConfig,
    error::WorkerError,
};

/// Crash-safety marker filenames written under the bridge marker dir.
const MARKER_STARTED: &str = "bridge.started";
const MARKER_DONE: &str = "bridge.done";

/// Ownership-confirmation window after spawning the Supervisor: attempts × delay.
const CONFIRM_ATTEMPTS: u32 = 30;
const CONFIRM_DELAY: Duration = Duration::from_millis(500);

// ---------------------------------------------------------------------------
// D5 one-time bridge
// ---------------------------------------------------------------------------

/// The outcome of a bridge attempt. `Bridged` means this Worker performed the
/// hand-off and should exit cleanly (the Supervisor's own Worker child takes
/// over). `AlreadyBridged` and `NotRequested` mean continue the normal loop.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BridgeOutcome {
    /// The ack did not request supervisor-owned topology, or the bridge inputs
    /// are not configured — nothing to bridge.
    NotRequested,
    /// A Supervisor already owns this box (its own Worker child, or a previous
    /// bridge). No spawn; continue as a mailbox writer.
    AlreadyBridged,
    /// This Worker just handed the box over to a freshly-started Supervisor and
    /// should exit cleanly.
    Bridged,
}

/// Process-level operations the bridge performs, abstracted so the orchestration
/// is deterministically unit-testable without real processes. The real impl
/// uses the same `pgrep`/`nohup` shell shapes as the server bootstrap and
/// `anyharness_update`.
#[allow(async_fn_in_trait)]
trait BridgeHost {
    /// Is a Supervisor process running for this binary path?
    fn supervisor_live(&self, supervisor_binary: &Path) -> bool;
    /// Launch the Supervisor detached (`nohup … run &`).
    fn spawn_supervisor(
        &self,
        supervisor_binary: &Path,
        config_path: &Path,
    ) -> Result<(), WorkerError>;
    /// Does AnyHarness answer `/health` (2xx)? Part of the ownership-transfer
    /// evidence: a live Supervisor PID alone does not prove it brought AnyHarness
    /// up (R9R-003).
    async fn anyharness_healthy(&self) -> bool;
}

/// Owned bridge inputs (R9R-002): either derived from the Worker's on-disk
/// config (a Supervisor-first provision's config already carries them) or
/// materialized from server-delivered heartbeat inputs (an already-provisioned
/// LEGACY target the server is migrating, whose config has none of them). Owned
/// (not borrowed) so the two sources — `&Path`s in config vs `String`s on the
/// ack — build the same type.
struct BridgeInputs {
    supervisor_binary: PathBuf,
    supervisor_config_path: PathBuf,
    supervisor_config_toml: Option<String>,
    /// The supervisor-owned Worker config to write before spawning, so the
    /// Supervisor's spawned Worker child is a mailbox writer rather than the
    /// legacy in-place swapper. `Some` only for the server-delivered (legacy
    /// migration) path; a Supervisor-first provision's Worker config is already
    /// on disk in the right shape.
    worker_config_path: Option<PathBuf>,
    worker_config_toml: Option<String>,
    marker_dir: PathBuf,
}

/// Bridge inputs from the Worker's own config (Supervisor-first provision, or a
/// legacy config an operator equipped directly). `None` when any required field
/// is absent.
fn bridge_inputs(config: &WorkerConfig) -> Option<BridgeInputs> {
    Some(BridgeInputs {
        supervisor_binary: config.supervisor_binary_path.clone()?,
        supervisor_config_path: config.supervisor_config_path.clone()?,
        supervisor_config_toml: config.supervisor_config_toml.clone(),
        worker_config_path: None,
        worker_config_toml: None,
        marker_dir: config.supervisor_bridge_marker_dir.clone()?,
    })
}

/// Bridge inputs materialized from the server-delivered heartbeat inputs
/// (R9R-002): the production path for an already-provisioned legacy target,
/// whose persisted config carries no bridge fields. Carries the supervisor-owned
/// Worker config so the bridge overwrites the legacy Worker config before spawn.
fn bridge_inputs_from_delivered(delivered: &SupervisorBridgeInputs) -> BridgeInputs {
    BridgeInputs {
        supervisor_binary: PathBuf::from(&delivered.supervisor_binary_path),
        supervisor_config_path: PathBuf::from(&delivered.supervisor_config_path),
        supervisor_config_toml: Some(delivered.supervisor_config_toml.clone()),
        worker_config_path: Some(PathBuf::from(&delivered.worker_config_path)),
        worker_config_toml: Some(delivered.worker_config_toml.clone()),
        marker_dir: PathBuf::from(&delivered.marker_dir),
    }
}

/// When a heartbeat ack carries `desired_topology == "supervisor_owned"`, run
/// the one-time bridge (or confirm an existing Supervisor). See the module doc
/// and BRIEF §8 for the state machine. Bridge inputs come from the on-disk
/// config first (Supervisor-first / operator-equipped) and otherwise from the
/// server-delivered heartbeat inputs (the legacy-migration production path,
/// R9R-002).
pub async fn maybe_bridge_to_supervisor(
    config: &WorkerConfig,
    response: &HeartbeatResponse,
) -> Result<BridgeOutcome, WorkerError> {
    if response.desired_topology.as_deref() != Some(SUPERVISOR_OWNED_TOPOLOGY) {
        return Ok(BridgeOutcome::NotRequested);
    }
    let inputs = bridge_inputs(config).or_else(|| {
        response
            .supervisor_bridge
            .as_ref()
            .map(bridge_inputs_from_delivered)
    });
    let Some(inputs) = inputs else {
        // Topology requested but neither the config nor the ack carries bridge
        // inputs: nothing to hand off with. A supervisor-owned child worker that
        // only carries the mailbox (no bridge inputs) simply continues as a
        // writer.
        return Ok(BridgeOutcome::NotRequested);
    };
    let host = RealBridgeHost::from_config(config);
    bridge_with_host(&inputs, &host).await
}

/// Testable bridge core: pure orchestration over a `BridgeHost`, real marker
/// files (temp dir in tests). The Supervisor-liveness check is the primary gate
/// — a live Supervisor is never double-spawned.
async fn bridge_with_host<H: BridgeHost>(
    inputs: &BridgeInputs,
    host: &H,
) -> Result<BridgeOutcome, WorkerError> {
    let done_present = marker_path(&inputs.marker_dir, MARKER_DONE).is_file();
    if host.supervisor_live(&inputs.supervisor_binary) {
        // A Supervisor already owns this box: never start a second one. This is
        // the Supervisor's own Worker child (fresh Supervisor-first provision)
        // or a Worker that already bridged and crashed/restarted before exiting.
        // Record `done` for idempotency and continue as a mailbox writer.
        if !done_present {
            write_marker(&inputs.marker_dir, MARKER_DONE)?;
        }
        return Ok(BridgeOutcome::AlreadyBridged);
    }

    // No Supervisor is live. Perform (or resume) the bridge. Writing `started`
    // before the spawn, then materializing the config(s), then spawning, is
    // idempotent: a crash at any point leaves the box owner-less and the next
    // tick re-runs these steps safely.
    write_marker(&inputs.marker_dir, MARKER_STARTED)?;
    if let Some(toml) = inputs.supervisor_config_toml.as_deref() {
        write_supervisor_config(&inputs.supervisor_config_path, toml)?;
    }
    // R9R-002: overwrite the legacy Worker config with the supervisor-owned one
    // so the Supervisor's spawned Worker child is a mailbox writer, not the
    // legacy in-place swapper.
    if let (Some(path), Some(toml)) = (
        inputs.worker_config_path.as_deref(),
        inputs.worker_config_toml.as_deref(),
    ) {
        write_supervisor_config(path, toml)?;
    }
    host.spawn_supervisor(&inputs.supervisor_binary, &inputs.supervisor_config_path)?;

    if confirm_ownership(host, inputs).await {
        write_marker(&inputs.marker_dir, MARKER_DONE)?;
        info!("supervisor bridge complete; exiting so the supervisor's worker child takes over");
        Ok(BridgeOutcome::Bridged)
    } else {
        // Leave `started` set (no `done`) so the next tick resumes. The current
        // runtime keeps serving; the Worker does not exit and the legacy
        // topology stays running (R9R-003: no bridge.done on unproven ownership).
        Err(WorkerError::BridgeNotConfirmed)
    }
}

/// Ownership is confirmed only with ACTUAL evidence the Supervisor took over the
/// runtime (R9R-003): the Supervisor process is live AND AnyHarness answers
/// `/health`. A live Supervisor PID alone is not proof — its `process::run` can
/// stay up while repeatedly failing to spawn/adopt AnyHarness — so the health
/// probe is required: a Supervisor that never brings the runtime up never
/// satisfies it, the bridge does not write `bridge.done`, and the legacy
/// topology keeps serving and retries next heartbeat.
///
/// The Supervisor's own Worker CHILD is deliberately NOT part of this in-process
/// gate. The Worker holds an exclusive, non-blocking `flock` on `worker.sqlite3`
/// (see `process_lock`), so the Supervisor's Worker child cannot acquire it —
/// and thus cannot enroll or write any handshake — until THIS bridging Worker
/// exits and releases the lock. Requiring the child before we exit would
/// deadlock (child waits for the lock; we wait for the child). AnyHarness health
/// is the ownership evidence achievable pre-handoff; the Worker child comes up
/// immediately after this Worker exits, and its non-arrival is server-observable
/// as heartbeat staleness. See BRIEF §8 / the R9R-003 note.
async fn confirm_ownership<H: BridgeHost>(host: &H, inputs: &BridgeInputs) -> bool {
    for attempt in 0..CONFIRM_ATTEMPTS {
        if host.supervisor_live(&inputs.supervisor_binary) && host.anyharness_healthy().await {
            return true;
        }
        if attempt + 1 < CONFIRM_ATTEMPTS {
            sleep(CONFIRM_DELAY).await;
        }
    }
    false
}

fn marker_path(marker_dir: &Path, name: &str) -> PathBuf {
    marker_dir.join(name)
}

fn write_marker(marker_dir: &Path, name: &str) -> Result<(), WorkerError> {
    let path = marker_path(marker_dir, name);
    let stamp = now_rfc3339();
    crate::config::write_private_file(&path, stamp.as_bytes(), name, |path, source| {
        WorkerError::BridgeMarker { path, source }
    })
}

fn write_supervisor_config(config_path: &Path, contents: &str) -> Result<(), WorkerError> {
    crate::config::write_private_file(
        config_path,
        contents.as_bytes(),
        "config.toml",
        |path, source| WorkerError::BridgeWriteConfig { path, source },
    )
}

/// The real bridge host: `pgrep`-based liveness and a detached `nohup` launch
/// replicating `bootstrap.build_detached_supervisor_launch_command`'s shape.
/// The live bridge proof is deferred (Tier 4, non-goal here); the unit tests
/// exercise the orchestration through a fake host.
struct RealBridgeHost {
    anyharness_binary: Option<PathBuf>,
    worker_binary: Option<PathBuf>,
    /// The co-located AnyHarness `/health` URL (from `runtime_base_url`), polled
    /// during ownership confirmation so a live-Supervisor-but-no-AnyHarness state
    /// never completes the bridge (R9R-003).
    health_url: String,
}

impl RealBridgeHost {
    fn from_config(config: &WorkerConfig) -> Self {
        Self {
            anyharness_binary: config.anyharness_binary_path.clone(),
            // The Worker binary path is used only to clear the stale independent
            // Worker during the launch; the bridging Worker itself is excluded
            // via `$PPID`. Best-effort: absence just skips that kill.
            worker_binary: std::env::current_exe().ok(),
            health_url: format!("{}/health", config.runtime_base_url.trim_end_matches('/')),
        }
    }
}

impl BridgeHost for RealBridgeHost {
    async fn anyharness_healthy(&self) -> bool {
        // A bounded, no-redirect GET of the loopback `/health`. Any transport
        // failure or non-2xx is "not healthy": ownership is not yet confirmed.
        let Ok(client) = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .redirect(reqwest::redirect::Policy::none())
            .build()
        else {
            return false;
        };
        client
            .get(&self.health_url)
            .send()
            .await
            .map(|response| response.status().is_success())
            .unwrap_or(false)
    }

    fn supervisor_live(&self, supervisor_binary: &Path) -> bool {
        let pattern = pgrep_pattern_for_path(&supervisor_binary.to_string_lossy());
        let script = format!("pgrep -f {} > /dev/null 2>&1", shell_single_quote(&pattern));
        std::process::Command::new("sh")
            .arg("-c")
            .arg(&script)
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }

    fn spawn_supervisor(
        &self,
        supervisor_binary: &Path,
        config_path: &Path,
    ) -> Result<(), WorkerError> {
        let script = detached_supervisor_launch_script(
            supervisor_binary,
            config_path,
            self.anyharness_binary.as_deref(),
            self.worker_binary.as_deref(),
        );
        let status = std::process::Command::new("bash")
            .arg("-lc")
            .arg(&script)
            .status()
            .map_err(|error| WorkerError::BridgeSpawn {
                detail: format!("failed to spawn supervisor launch shell: {error}"),
            })?;
        if !status.success() {
            return Err(WorkerError::BridgeSpawn {
                detail: format!("supervisor launch shell exited with {status}"),
            });
        }
        Ok(())
    }
}

/// Replicate the server's detached launch shape: clear the stale independent
/// AnyHarness/Worker (excluding this shell and the bridging Worker via
/// `$$`/`$PPID`), then `nohup` the Supervisor. Kept faithful for real bridges;
/// not exercised by the deterministic tests.
fn detached_supervisor_launch_script(
    supervisor_binary: &Path,
    config_path: &Path,
    anyharness_binary: Option<&Path>,
    worker_binary: Option<&Path>,
) -> String {
    let supervisor = supervisor_binary.to_string_lossy();
    let config = config_path.to_string_lossy();
    let log = config_path
        .parent()
        .map(|parent| parent.join("proliferate-supervisor.log"))
        .unwrap_or_else(|| PathBuf::from("proliferate-supervisor.log"));

    let mut kill_patterns: Vec<String> = Vec::new();
    if let Some(anyharness) = anyharness_binary {
        kill_patterns.push(pgrep_pattern_for_path(&anyharness.to_string_lossy()));
    }
    if let Some(worker) = worker_binary {
        kill_patterns.push(pgrep_pattern_for_path(&worker.to_string_lossy()));
    }

    let mut lines: Vec<String> = vec![
        "set -eu".to_string(),
        "current_pid=$$".to_string(),
        "parent_pid=$PPID".to_string(),
    ];
    for pattern in kill_patterns {
        let quoted = shell_single_quote(&pattern);
        lines.push(format!("pids=$(pgrep -f {quoted} || true)"));
        lines.push("if [ -n \"$pids\" ]; then".to_string());
        lines.push("  for pid in $pids; do".to_string());
        lines.push(
            "    if [ \"$pid\" != \"$current_pid\" ] && [ \"$pid\" != \"$parent_pid\" ]; then"
                .to_string(),
        );
        lines.push("      kill \"$pid\" || true".to_string());
        lines.push("    fi".to_string());
        lines.push("  done".to_string());
        lines.push("  sleep 1".to_string());
        lines.push("fi".to_string());
    }
    lines.push(format!(
        "nohup {} --config {} run > {} 2>&1 < /dev/null &",
        shell_single_quote(&supervisor),
        shell_single_quote(&config),
        shell_single_quote(&log.to_string_lossy()),
    ));
    lines.join("\n")
}

/// Escape a path for a `pgrep -f` pattern so the pgrep shell never matches its
/// own command line — identical to the server bootstrap's
/// `_pgrep_pattern_for_path` and `anyharness_update`'s escaper.
fn pgrep_pattern_for_path(path: &str) -> String {
    if let Some(rest) = path.strip_prefix('/') {
        format!("[/]{rest}")
    } else {
        path.to_string()
    }
}

/// Wrap a value in POSIX single quotes for safe shell interpolation.
fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

// ---------------------------------------------------------------------------
// Timestamps (dependency-free RFC3339 UTC — the Worker has no chrono/time dep)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests;
