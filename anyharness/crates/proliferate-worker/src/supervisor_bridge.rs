//! Worker-side Supervisor bridge: the mailbox write side + the D5 one-time
//! bridge to Supervisor ownership.
//!
//! On a **supervisor-owned** target (`WorkerConfig.supervisor_update_request_dir`
//! is set) the Worker is only an *observer + writer*. When a heartbeat ack
//! diverges from what the sandbox runs, the Worker writes ONE durable
//! `UpdateRequestV1` into the mailbox for the Supervisor to act on — it never
//! downloads, replaces, kills, or rolls back AnyHarness or itself in this path.
//! The request is idempotent: the `request_id` is derived deterministically from
//! `(component, version)`, so a replayed heartbeat overwrites the same file and
//! the Supervisor activates exactly once.
//!
//! The **D5 bridge** migrates an already-provisioned sandbox (independently
//! `nohup`'d AnyHarness + Worker) to Supervisor ownership exactly once: it writes
//! the Supervisor config, starts the Supervisor detached, confirms it took
//! ownership, and then the bridging Worker exits cleanly so the Supervisor's own
//! Worker child takes over. It is idempotent and crash-safe via marker files
//! (`bridge.started`/`bridge.done`) plus a Supervisor-liveness check that gates
//! the spawn so a second Supervisor is never started. Newly provisioned
//! supervisor-owned targets launch Supervisor-first (server-side) and never
//! reach the spawn branch here — their Worker child sees a live Supervisor and
//! simply continues as a mailbox writer.
//!
//! All request/result shapes, validation, and atomic IO come from the shared
//! crate `proliferate_runtime_update_protocol`; this module builds requests and
//! drives the bridge, but owns no wire schema of its own.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tokio::time::sleep;
use tracing::{info, warn};

use proliferate_runtime_update_protocol::{
    read_result, request_file_name, result_exists, result_file_name, write_request,
    UpdateComponent, UpdateOutcome, UpdateRequestV1, UpdateResultV1,
};

use crate::{
    anyharness_update,
    cloud_client::{CloudClient, HeartbeatResponse},
    config::WorkerConfig,
    error::WorkerError,
    self_update, versions,
};

/// The single `desired_topology` value the server emits for flag-enabled
/// cloud-sandbox targets. Any other value (or absence) means today's behavior.
pub const SUPERVISOR_OWNED_TOPOLOGY: &str = "supervisor_owned";

/// Published asset names on the downloads CDN (mirrors the legacy paths).
const ANYHARNESS_ASSET: &str = "anyharness";
const WORKER_ASSET: &str = "proliferate-worker";

/// Crash-safety marker filenames written under the bridge marker dir.
const MARKER_STARTED: &str = "bridge.started";
const MARKER_DONE: &str = "bridge.done";

/// Ownership-confirmation window after spawning the Supervisor: attempts × delay.
const CONFIRM_ATTEMPTS: u32 = 30;
const CONFIRM_DELAY: Duration = Duration::from_millis(500);

/// Whether this Worker is on a supervisor-owned target (routes divergence
/// through the mailbox instead of the legacy in-place swap / self-exec).
pub fn is_supervisor_owned(config: &WorkerConfig) -> bool {
    config.supervisor_update_request_dir.is_some()
}

// ---------------------------------------------------------------------------
// Mailbox write side
// ---------------------------------------------------------------------------

/// On a supervisor-owned target, record any divergence (AnyHarness runtime and
/// the Worker binary) as durable mailbox requests. The Worker never swaps or
/// self-execs here; the Supervisor consumes each request, activates, and
/// reports a result. Non-fatal: a failure to write one request logs and leaves
/// the next tick to retry. In `--once` (dry-run) mode a pending request is only
/// reported, never written.
pub async fn converge_via_mailbox(
    config: &WorkerConfig,
    cloud: &CloudClient,
    store: &crate::store::WorkerStore,
    response: &HeartbeatResponse,
    dry_run: bool,
) {
    let desired = response.desired_versions.as_ref();
    let anyharness_desired = desired.and_then(|versions| versions.anyharness.as_deref());
    let worker_desired = desired.and_then(|versions| versions.worker.as_deref());

    // Reconcile a completed activation FIRST: record what actually runs so the
    // next heartbeat reports the converged version (R9-006), and GC the
    // request+result pair so a later re-pin to the same version re-applies
    // instead of being suppressed by the stale result (R9-003). Dry runs never
    // mutate the store or the mailbox.
    if !dry_run {
        if let Some(version) = anyharness_desired {
            reconcile_converged_result(config, store, UpdateComponent::Anyharness, version);
        }
        if let Some(version) = worker_desired {
            reconcile_converged_result(config, store, UpdateComponent::Worker, version);
        }
    }

    let anyharness_running = anyharness_update::running_anyharness_version(store);
    if let Some(version) = plan_component(anyharness_running.as_deref(), anyharness_desired) {
        emit_request(config, cloud, UpdateComponent::Anyharness, &version, dry_run).await;
    }

    let worker_running = versions::worker_version();
    if let Some(version) = plan_component(worker_running.as_deref(), worker_desired) {
        emit_request(config, cloud, UpdateComponent::Worker, &version, dry_run).await;
    }
}

/// Reconcile the Supervisor's terminal result for `component`@`version` back
/// into the Worker. On a successful activation this records what actually runs
/// — for AnyHarness into the Worker store so the next heartbeat reports the
/// converged version (R9-006); the Worker binary reports its own stamped
/// version natively after the Supervisor restarts it — and then GCs the
/// request+result pair so a re-pin back to this version re-applies rather than
/// being suppressed by the stale `Activated` result (R9-003). A terminal
/// failure (`Invalid`/`RolledBack`) is left in place: that is the legacy
/// lagging-artifact latch, cleared only when the desired version changes.
fn reconcile_converged_result(
    config: &WorkerConfig,
    store: &crate::store::WorkerStore,
    component: UpdateComponent,
    version: &str,
) {
    let request_id = request_id_for(component, version);
    let Some(result) = read_bridge_result(config, &request_id) else {
        return;
    };
    if result.outcome != UpdateOutcome::Activated {
        return;
    }
    if component == UpdateComponent::Anyharness {
        let observed = result.observed_version.as_deref().unwrap_or(version);
        if let Err(error) = store.record_anyharness_converged(observed) {
            warn!(
                ?error,
                component = component.as_str(),
                observed,
                "failed to record converged anyharness version from supervisor result"
            );
        }
    }
    gc_request_result_pair(config, component, version);
}

/// Delete the request + result files for `component`@`version` from the mailbox
/// (best-effort). Called once the Worker has observed convergence, so a later
/// re-pin mints a fresh, actionable request instead of hitting the stale result.
fn gc_request_result_pair(config: &WorkerConfig, component: UpdateComponent, version: &str) {
    let Some(dir) = config.supervisor_update_request_dir.as_deref() else {
        return;
    };
    let _ = std::fs::remove_file(dir.join(request_file_name(component, version)));
    let _ = std::fs::remove_file(dir.join(result_file_name(&request_id_for(component, version))));
}

async fn emit_request(
    config: &WorkerConfig,
    cloud: &CloudClient,
    component: UpdateComponent,
    version: &str,
    dry_run: bool,
) {
    if dry_run {
        info!(
            component = component.as_str(),
            desired = version,
            "supervisor-owned update pending; skipped in --once mode"
        );
        return;
    }
    if let Err(error) = write_update_request(config, cloud, component, version).await {
        warn!(
            ?error,
            component = component.as_str(),
            desired = version,
            "failed to write supervisor update request; the runtime keeps serving and the \
             next heartbeat retries"
        );
    }
}

/// Decide whether a supervisor-owned Worker should emit an update request for a
/// component. Mirrors the legacy planning shape exactly — skip when the pin is
/// empty/absent or already equal, act on any divergence including a downgrade —
/// but routes to the mailbox instead of the in-place swap. There is no
/// failed-pin suppression here: the deterministic `request_id` plus the
/// Supervisor's `result_exists` dedup make a lagging artifact self-heal (the
/// Supervisor writes an `Invalid` result once; the Worker re-emits only when the
/// desired version changes, which mints a new `request_id`).
fn plan_component(running: Option<&str>, desired: Option<&str>) -> Option<String> {
    let desired = desired?.trim();
    if desired.is_empty() || running == Some(desired) {
        return None;
    }
    Some(desired.to_string())
}

/// Deterministic `request_id` from `(component, version)`: a replayed heartbeat
/// reuses it, so `write_request` overwrites one file and the Supervisor
/// activates exactly once. Both fragments are path-safe (the component is an
/// enum; the version is validated by `validate_request`).
fn request_id_for(component: UpdateComponent, version: &str) -> String {
    format!("{}-{version}", component.as_str())
}

/// Build + atomically write ONE update request when a heartbeat diverges. If the
/// Supervisor has already produced a terminal result for this exact request
/// (`result_exists`), skip re-writing — that reproduces the legacy "not retried
/// until superseded" behavior for a lagging artifact without the Worker tracking
/// failures itself. Resolves `artifact_url`/`sha256`/`size_bytes` from the
/// server redirect exactly as the legacy swap did (resolve once, derive the
/// sibling `.sha256`, read the size via `HEAD`) but WRITES them for the
/// Supervisor rather than acting on them — the Worker never downloads the binary
/// in this path.
pub async fn write_update_request(
    config: &WorkerConfig,
    cloud: &CloudClient,
    component: UpdateComponent,
    desired_version: &str,
) -> Result<(), WorkerError> {
    let dir = config
        .supervisor_update_request_dir
        .as_deref()
        .ok_or_else(|| WorkerError::ResolveArtifact {
            detail: "supervisor_update_request_dir is not configured".to_string(),
        })?;
    let request_id = request_id_for(component, desired_version);
    if result_exists(dir, &request_id) {
        // The Supervisor already reached a terminal outcome for this exact
        // request. Surface it (telemetry only — convergence is reported to Cloud
        // via the heartbeat version fields) and do not re-emit until the desired
        // version changes, which would mint a new `request_id`.
        match read_bridge_result(config, &request_id) {
            Some(result) => info!(
                component = component.as_str(),
                desired = desired_version,
                %request_id,
                outcome = ?result.outcome,
                observed = ?result.observed_version,
                "supervisor already produced a result for this update request; not re-emitting"
            ),
            None => info!(
                component = component.as_str(),
                desired = desired_version,
                %request_id,
                "supervisor already produced a result for this update request; not re-emitting"
            ),
        }
        return Ok(());
    }

    let target = self_update::artifact_target()?;
    let redirect_path = redirect_path_for(component, &target);
    let location = cloud.resolve_artifact_location(&redirect_path).await?;
    let checksum_url = self_update::checksum_url_for(&location.url);
    let checksum_bytes = cloud.download_from_url(&checksum_url).await?;
    let sha256 = parse_checksum_digest(&String::from_utf8_lossy(&checksum_bytes))?;

    let request = build_update_request(
        component,
        desired_version,
        &target,
        &location.url,
        &sha256,
        location.size_bytes,
        now_rfc3339(),
    );
    let path = write_request(dir, &request)?;
    info!(
        component = component.as_str(),
        desired = desired_version,
        %request_id,
        path = %path.display(),
        "wrote supervisor update request"
    );
    Ok(())
}

/// Read the Supervisor's result for a request (logging/telemetry only;
/// convergence itself is reported to Cloud via the existing heartbeat version
/// fields, which reflect what the runtime actually serves). Returns `None` when
/// no result has been written yet or the mailbox is unconfigured.
pub fn read_bridge_result(config: &WorkerConfig, request_id: &str) -> Option<UpdateResultV1> {
    let dir = config.supervisor_update_request_dir.as_deref()?;
    let path = dir.join(proliferate_runtime_update_protocol::result_file_name(request_id));
    if !path.is_file() {
        return None;
    }
    read_result(&path).ok()
}

fn redirect_path_for(component: UpdateComponent, target: &str) -> String {
    match component {
        UpdateComponent::Anyharness => {
            format!("v1/cloud/runtime/download/{target}/{ANYHARNESS_ASSET}")
        }
        UpdateComponent::Worker => format!("v1/cloud/worker/download/{target}/{WORKER_ASSET}"),
    }
}

/// Pure request builder (network-free, unit-tested): assembles a validated-shape
/// `UpdateRequestV1` from resolved artifact coordinates.
fn build_update_request(
    component: UpdateComponent,
    version: &str,
    target_triple: &str,
    artifact_url: &str,
    sha256: &str,
    size_bytes: u64,
    requested_at: String,
) -> UpdateRequestV1 {
    UpdateRequestV1 {
        request_id: request_id_for(component, version),
        component,
        version: version.to_string(),
        target_triple: target_triple.to_string(),
        artifact_url: artifact_url.to_string(),
        sha256: sha256.to_string(),
        size_bytes,
        requested_at,
    }
}

/// Parse the lowercase hex digest out of a published `.sha256` file (a bare
/// digest or the `sha256sum` "digest  filename" form). Unlike
/// `self_update::verify_sha256`, this only extracts the digest — the Worker does
/// not have the binary bytes to hash in the supervisor-owned path; the
/// Supervisor re-verifies after it downloads.
fn parse_checksum_digest(checksum_file: &str) -> Result<String, WorkerError> {
    let digest = checksum_file
        .split_whitespace()
        .next()
        .ok_or(WorkerError::RequestChecksumMalformed)?
        .to_ascii_lowercase();
    if digest.len() != 64 || !digest.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(WorkerError::RequestChecksumMalformed);
    }
    Ok(digest)
}

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
trait BridgeHost {
    /// Is a Supervisor process running for this binary path?
    fn supervisor_live(&self, supervisor_binary: &Path) -> bool;
    /// Launch the Supervisor detached (`nohup … run &`).
    fn spawn_supervisor(
        &self,
        supervisor_binary: &Path,
        config_path: &Path,
    ) -> Result<(), WorkerError>;
}

struct BridgeInputs<'a> {
    supervisor_binary: &'a Path,
    supervisor_config_path: &'a Path,
    supervisor_config_toml: Option<&'a str>,
    marker_dir: &'a Path,
}

fn bridge_inputs(config: &WorkerConfig) -> Option<BridgeInputs<'_>> {
    Some(BridgeInputs {
        supervisor_binary: config.supervisor_binary_path.as_deref()?,
        supervisor_config_path: config.supervisor_config_path.as_deref()?,
        supervisor_config_toml: config.supervisor_config_toml.as_deref(),
        marker_dir: config.supervisor_bridge_marker_dir.as_deref()?,
    })
}

/// When a heartbeat ack carries `desired_topology == "supervisor_owned"`, run
/// the one-time bridge (or confirm an existing Supervisor). See the module doc
/// and BRIEF §8 for the state machine.
pub async fn maybe_bridge_to_supervisor(
    config: &WorkerConfig,
    response: &HeartbeatResponse,
) -> Result<BridgeOutcome, WorkerError> {
    if response.desired_topology.as_deref() != Some(SUPERVISOR_OWNED_TOPOLOGY) {
        return Ok(BridgeOutcome::NotRequested);
    }
    let Some(inputs) = bridge_inputs(config) else {
        // Topology requested but the bridge inputs are incomplete: nothing to
        // hand off with. A supervisor-owned child worker that only carries the
        // mailbox (no bridge inputs) simply continues as a writer.
        return Ok(BridgeOutcome::NotRequested);
    };
    let host = RealBridgeHost::from_config(config);
    bridge_with_host(&inputs, &host).await
}

/// Testable bridge core: pure orchestration over a `BridgeHost`, real marker
/// files (temp dir in tests). The Supervisor-liveness check is the primary gate
/// — a live Supervisor is never double-spawned.
async fn bridge_with_host<H: BridgeHost>(
    inputs: &BridgeInputs<'_>,
    host: &H,
) -> Result<BridgeOutcome, WorkerError> {
    let done_present = marker_path(inputs.marker_dir, MARKER_DONE).is_file();
    if host.supervisor_live(inputs.supervisor_binary) {
        // A Supervisor already owns this box: never start a second one. This is
        // the Supervisor's own Worker child (fresh Supervisor-first provision)
        // or a Worker that already bridged and crashed/restarted before exiting.
        // Record `done` for idempotency and continue as a mailbox writer.
        if !done_present {
            write_marker(inputs.marker_dir, MARKER_DONE)?;
        }
        return Ok(BridgeOutcome::AlreadyBridged);
    }

    // No Supervisor is live. Perform (or resume) the bridge. Writing `started`
    // before the spawn, then materializing the config, then spawning, is
    // idempotent: a crash at any point leaves the box owner-less and the next
    // tick re-runs these steps safely.
    write_marker(inputs.marker_dir, MARKER_STARTED)?;
    if let Some(toml) = inputs.supervisor_config_toml {
        write_supervisor_config(inputs.supervisor_config_path, toml)?;
    }
    host.spawn_supervisor(inputs.supervisor_binary, inputs.supervisor_config_path)?;

    if confirm_ownership(host, inputs.supervisor_binary).await {
        write_marker(inputs.marker_dir, MARKER_DONE)?;
        info!("supervisor bridge complete; exiting so the supervisor's worker child takes over");
        Ok(BridgeOutcome::Bridged)
    } else {
        // Leave `started` set (no `done`) so the next tick resumes. The current
        // runtime keeps serving; the Worker does not exit.
        Err(WorkerError::BridgeNotConfirmed)
    }
}

async fn confirm_ownership<H: BridgeHost>(host: &H, supervisor_binary: &Path) -> bool {
    for attempt in 0..CONFIRM_ATTEMPTS {
        if host.supervisor_live(supervisor_binary) {
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
}

impl RealBridgeHost {
    fn from_config(config: &WorkerConfig) -> Self {
        Self {
            anyharness_binary: config.anyharness_binary_path.clone(),
            // The Worker binary path is used only to clear the stale independent
            // Worker during the launch; the bridging Worker itself is excluded
            // via `$PPID`. Best-effort: absence just skips that kill.
            worker_binary: std::env::current_exe().ok(),
        }
    }
}

impl BridgeHost for RealBridgeHost {
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
        lines
            .push("    if [ \"$pid\" != \"$current_pid\" ] && [ \"$pid\" != \"$parent_pid\" ]; then"
                .to_string());
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

fn now_rfc3339() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    format_rfc3339_utc(secs)
}

/// `<unix seconds>` -> `YYYY-MM-DDThh:mm:ssZ` (UTC). Uses Howard Hinnant's
/// `civil_from_days` so it is exact and needs no date crate.
fn format_rfc3339_utc(unix_secs: u64) -> String {
    let days = (unix_secs / 86_400) as i64;
    let rem = unix_secs % 86_400;
    let (hour, minute, second) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let (year, month, day) = civil_from_days(days);
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let year = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32; // [1, 12]
    (if month <= 2 { year + 1 } else { year }, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::cell::Cell;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    struct TempDir(PathBuf);

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    fn temp_dir() -> TempDir {
        let dir = std::env::temp_dir().join(format!(
            "proliferate-worker-bridge-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create temp dir");
        TempDir(dir)
    }

    // --- planning (unchanged semantics vs. the legacy swap) ---

    #[test]
    fn plan_component_is_noop_on_equality_absence_and_empty() {
        assert_eq!(plan_component(Some("0.5.0"), Some("0.5.0")), None);
        assert_eq!(plan_component(Some("0.5.0"), None), None);
        assert_eq!(plan_component(Some("0.5.0"), Some("   ")), None);
        // Unknown running version still converges onto a concrete pin.
        assert_eq!(plan_component(None, Some("0.6.0")), Some("0.6.0".to_string()));
    }

    #[test]
    fn plan_component_acts_on_any_divergence_including_downgrade() {
        assert_eq!(
            plan_component(Some("0.5.0"), Some("0.6.0")),
            Some("0.6.0".to_string())
        );
        // A downgrade is a divergence too (matches legacy self-update/anyharness).
        assert_eq!(
            plan_component(Some("0.6.0"), Some("0.5.0")),
            Some("0.5.0".to_string())
        );
        // Trimmed to match the legacy planners.
        assert_eq!(
            plan_component(Some("0.5.0"), Some(" 0.6.0 ")),
            Some("0.6.0".to_string())
        );
    }

    // --- request building + idempotency ---

    #[test]
    fn request_id_is_deterministic_and_path_safe() {
        assert_eq!(
            request_id_for(UpdateComponent::Anyharness, "0.2.16"),
            "anyharness-0.2.16"
        );
        assert_eq!(
            request_id_for(UpdateComponent::Worker, "0.3.0"),
            "worker-0.3.0"
        );
        // The same inputs always map to the same id (idempotency foundation).
        assert_eq!(
            request_id_for(UpdateComponent::Anyharness, "0.2.16"),
            request_id_for(UpdateComponent::Anyharness, "0.2.16"),
        );
    }

    fn sample_coords() -> (String, String, u64) {
        (
            "https://downloads.example.test/runtime/stable/0.2.16/linux-x86_64/anyharness"
                .to_string(),
            "a".repeat(64),
            4096,
        )
    }

    #[test]
    fn built_request_validates_and_carries_coordinates() {
        let (url, sha, size) = sample_coords();
        let request = build_update_request(
            UpdateComponent::Anyharness,
            "0.2.16",
            "linux-x86_64",
            &url,
            &sha,
            size,
            "2026-07-15T00:00:00Z".to_string(),
        );
        // The Supervisor's read side validates on read; a built request must pass.
        proliferate_runtime_update_protocol::validate_request(&request).expect("valid request");
        assert_eq!(request.request_id, "anyharness-0.2.16");
        assert_eq!(request.component, UpdateComponent::Anyharness);
        assert_eq!(request.artifact_url, url);
        assert_eq!(request.sha256, sha);
        assert_eq!(request.size_bytes, size);
    }

    #[test]
    fn replayed_request_write_yields_one_file() {
        let dir = temp_dir();
        let (url, sha, size) = sample_coords();
        let request = build_update_request(
            UpdateComponent::Anyharness,
            "0.2.16",
            "linux-x86_64",
            &url,
            &sha,
            size,
            "2026-07-15T00:00:00Z".to_string(),
        );
        // Two "heartbeats" produce the same request_id → the same file overwrites.
        let first = write_request(&dir.0, &request).expect("first write");
        let second = write_request(&dir.0, &request).expect("replayed write");
        assert_eq!(first, second);
        let files = proliferate_runtime_update_protocol::list_request_files(&dir.0).expect("list");
        assert_eq!(files.len(), 1, "a replayed heartbeat must not accumulate files");
    }

    #[test]
    fn parse_checksum_digest_accepts_bare_and_sha256sum_forms() {
        let hex = "b".repeat(64);
        assert_eq!(parse_checksum_digest(&hex).expect("bare"), hex);
        assert_eq!(
            parse_checksum_digest(&format!("{hex}  anyharness\n")).expect("sha256sum form"),
            hex
        );
        assert_eq!(
            parse_checksum_digest(&format!("{}  x", hex.to_ascii_uppercase())).expect("uppercased"),
            hex
        );
    }

    #[test]
    fn parse_checksum_digest_rejects_malformed() {
        for malformed in ["", "   \n", "not-hex", "abc123", "<html>404</html>"] {
            assert!(matches!(
                parse_checksum_digest(malformed),
                Err(WorkerError::RequestChecksumMalformed)
            ));
        }
    }

    // --- timestamps ---

    #[test]
    fn rfc3339_matches_known_epochs() {
        assert_eq!(format_rfc3339_utc(0), "1970-01-01T00:00:00Z");
        assert_eq!(format_rfc3339_utc(1_600_000_000), "2020-09-13T12:26:40Z");
        assert_eq!(format_rfc3339_utc(946_684_800), "2000-01-01T00:00:00Z");
    }

    // --- bridge orchestration (fake host, real marker files) ---

    /// Scriptable fake: `live_at` controls what `supervisor_live` returns on the
    /// Nth call; `spawns` counts spawn invocations (guards "no double Supervisor").
    struct FakeHost {
        live_sequence: Vec<bool>,
        call: Cell<usize>,
        spawns: Cell<u32>,
        spawn_starts_supervisor: bool,
    }

    impl FakeHost {
        fn new(live_sequence: Vec<bool>, spawn_starts_supervisor: bool) -> Self {
            Self {
                live_sequence,
                call: Cell::new(0),
                spawns: Cell::new(0),
                spawn_starts_supervisor,
            }
        }
        /// Always-live (an existing Supervisor already owns the box).
        fn already_live() -> Self {
            Self::new(vec![true], false)
        }
    }

    impl BridgeHost for FakeHost {
        fn supervisor_live(&self, _supervisor_binary: &Path) -> bool {
            let index = self.call.get();
            self.call.set(index + 1);
            // If a spawn already succeeded, the Supervisor is live thereafter.
            if self.spawns.get() > 0 && self.spawn_starts_supervisor {
                return true;
            }
            *self.live_sequence.get(index).unwrap_or_else(|| {
                self.live_sequence
                    .last()
                    .expect("live_sequence is non-empty")
            })
        }
        fn spawn_supervisor(
            &self,
            _supervisor_binary: &Path,
            _config_path: &Path,
        ) -> Result<(), WorkerError> {
            self.spawns.set(self.spawns.get() + 1);
            Ok(())
        }
    }

    /// Build bridge inputs whose marker dir and Supervisor config path both live
    /// under the test's temp dir, so writing the config + markers touches only
    /// the temp tree (never a real absolute path).
    fn inputs<'a>(
        dir: &'a Path,
        config_path: &'a Path,
        config_toml: Option<&'a str>,
    ) -> BridgeInputs<'a> {
        BridgeInputs {
            supervisor_binary: Path::new("/home/user/.proliferate/bin/proliferate-supervisor"),
            supervisor_config_path: config_path,
            supervisor_config_toml: config_toml,
            marker_dir: dir,
        }
    }

    /// A legacy (non-supervisor-owned) worker config: no mailbox, no bridge
    /// inputs. The base for the fence + bridge-gate tests.
    fn legacy_config() -> WorkerConfig {
        WorkerConfig {
            cloud_base_url: "https://cloud.test".to_string(),
            enrollment_token: None,
            worker_db_path: PathBuf::from("/tmp/w.sqlite3"),
            integration_gateway_home: None,
            heartbeat_interval_seconds: 30,
            self_update_enabled: false,
            anyharness_update_enabled: false,
            anyharness_binary_path: None,
            anyharness_launcher_path: None,
            anyharness_workdir: None,
            runtime_base_url: "http://127.0.0.1:8457".to_string(),
            runtime_bearer_token: None,
            supervisor_update_request_dir: None,
            supervisor_binary_path: None,
            supervisor_config_path: None,
            supervisor_config_toml: None,
            supervisor_bridge_marker_dir: None,
            config_path: None,
        }
    }

    #[test]
    fn is_supervisor_owned_gates_on_the_mailbox_dir() {
        // The fence (decision 7, Rust half): the mailbox dir alone flips a Worker
        // from the legacy in-place swap path to the observer+writer path. A
        // legacy config never routes through the mailbox; a config carrying the
        // dir always does — so a supervisor-owned Worker never invokes the legacy
        // `converge_anyharness_runtime` / `self_update` swap.
        let mut config = legacy_config();
        assert!(!is_supervisor_owned(&config));
        config.supervisor_update_request_dir =
            Some(PathBuf::from("/home/user/.proliferate/supervisor/updates"));
        assert!(is_supervisor_owned(&config));
    }

    #[tokio::test]
    async fn bridge_not_requested_without_topology() {
        let config = legacy_config();
        let response = HeartbeatResponse {
            worker_id: "w".to_string(),
            status: None,
            server_time: None,
            desired_versions: None,
            desired_topology: None,
        };
        let outcome = maybe_bridge_to_supervisor(&config, &response)
            .await
            .expect("bridge");
        assert_eq!(outcome, BridgeOutcome::NotRequested);
    }

    #[tokio::test]
    async fn bridge_spawns_once_then_marks_done() {
        let dir = temp_dir();
        let config_path = dir.0.join("config.toml");
        let config_toml = "anyharness_binary = \"/x\"\n";
        // Supervisor starts dead; the spawn brings it up (spawn_starts_supervisor).
        let host = FakeHost::new(vec![false], true);
        let outcome = bridge_with_host(&inputs(&dir.0, &config_path, Some(config_toml)), &host)
            .await
            .expect("bridge");
        assert_eq!(outcome, BridgeOutcome::Bridged);
        assert_eq!(host.spawns.get(), 1, "exactly one supervisor spawn");
        assert!(marker_path(&dir.0, MARKER_STARTED).is_file());
        assert!(marker_path(&dir.0, MARKER_DONE).is_file());
        // The bridge materialized the Supervisor config on disk before spawning.
        assert_eq!(
            fs::read_to_string(&config_path).expect("config written"),
            config_toml
        );
    }

    #[tokio::test]
    async fn bridge_is_idempotent_when_supervisor_already_live() {
        let dir = temp_dir();
        let config_path = dir.0.join("config.toml");
        // Two acks in a row with a live Supervisor → no spawn, done recorded.
        let host = FakeHost::already_live();
        let first = bridge_with_host(&inputs(&dir.0, &config_path, None), &host)
            .await
            .expect("first");
        let second = bridge_with_host(&inputs(&dir.0, &config_path, None), &host)
            .await
            .expect("second");
        assert_eq!(first, BridgeOutcome::AlreadyBridged);
        assert_eq!(second, BridgeOutcome::AlreadyBridged);
        assert_eq!(host.spawns.get(), 0, "a live supervisor is never re-spawned");
        assert!(marker_path(&dir.0, MARKER_DONE).is_file());
    }

    #[tokio::test]
    async fn bridge_recovers_from_started_without_done_when_supervisor_dead() {
        let dir = temp_dir();
        let config_path = dir.0.join("config.toml");
        // Simulate a crash mid-bridge: `started` present, no `done`, supervisor dead.
        write_marker(&dir.0, MARKER_STARTED).expect("seed started");
        let host = FakeHost::new(vec![false], true);
        let outcome = bridge_with_host(&inputs(&dir.0, &config_path, None), &host)
            .await
            .expect("recovery bridge");
        // Dead supervisor → re-spawn to restore ownership, then done.
        assert_eq!(outcome, BridgeOutcome::Bridged);
        assert_eq!(host.spawns.get(), 1);
        assert!(marker_path(&dir.0, MARKER_DONE).is_file());
    }

    #[tokio::test]
    async fn bridge_adopts_live_supervisor_after_crash_without_second_spawn() {
        let dir = temp_dir();
        let config_path = dir.0.join("config.toml");
        // Crash mid-bridge but the spawned Supervisor survived: `started` present,
        // no `done`, supervisor LIVE. Must adopt (write done) and NOT spawn again.
        write_marker(&dir.0, MARKER_STARTED).expect("seed started");
        let host = FakeHost::already_live();
        let outcome = bridge_with_host(&inputs(&dir.0, &config_path, None), &host)
            .await
            .expect("adopt");
        assert_eq!(outcome, BridgeOutcome::AlreadyBridged);
        assert_eq!(host.spawns.get(), 0, "never a second supervisor");
        assert!(marker_path(&dir.0, MARKER_DONE).is_file());
    }

    #[tokio::test]
    async fn bridge_errors_when_spawn_is_not_confirmed() {
        let dir = temp_dir();
        let config_path = dir.0.join("config.toml");
        // Spawn never brings the Supervisor up: confirmation fails.
        let host = FakeHost::new(vec![false], false);
        let result = bridge_with_host(&inputs(&dir.0, &config_path, None), &host).await;
        assert!(matches!(result, Err(WorkerError::BridgeNotConfirmed)));
        // `started` is left so the next tick resumes; `done` is not written.
        assert!(marker_path(&dir.0, MARKER_STARTED).is_file());
        assert!(!marker_path(&dir.0, MARKER_DONE).is_file());
    }

    #[tokio::test]
    async fn legacy_config_with_bridge_inputs_reaches_the_bridge_and_is_idempotent() {
        // R9-007: a legacy independent-launch Worker (NO mailbox dir, so
        // `is_supervisor_owned` is false) that an operator equipped with bridge
        // inputs must still reach the bridge — the bridge is gated on bridge
        // inputs, not on the mailbox that flips the supervisor-owned path.
        let dir = temp_dir();
        let config_path = dir.0.join("config.toml");
        let mut legacy = legacy_config();
        legacy.supervisor_binary_path =
            Some(PathBuf::from("/home/user/.proliferate/bin/proliferate-supervisor"));
        legacy.supervisor_config_path = Some(config_path.clone());
        legacy.supervisor_bridge_marker_dir = Some(dir.0.clone());
        assert!(!is_supervisor_owned(&legacy), "no mailbox -> not supervisor-owned");
        assert!(
            bridge_inputs(&legacy).is_some(),
            "bridge inputs are derivable from a legacy config"
        );

        // A dead Supervisor that the spawn brings up -> the legacy Worker bridges.
        let host = FakeHost::new(vec![false], true);
        let first = bridge_with_host(&inputs(&dir.0, &config_path, None), &host)
            .await
            .expect("bridge");
        assert_eq!(first, BridgeOutcome::Bridged);
        assert_eq!(host.spawns.get(), 1);

        // Replay while the Supervisor is live -> AlreadyBridged, never a second spawn.
        let live = FakeHost::already_live();
        let second = bridge_with_host(&inputs(&dir.0, &config_path, None), &live)
            .await
            .expect("replay");
        assert_eq!(second, BridgeOutcome::AlreadyBridged);
        assert_eq!(live.spawns.get(), 0, "idempotent: no double supervisor on replay");
    }

    #[test]
    fn reconcile_records_converged_anyharness_and_gcs_the_pair() {
        // R9-006: an Activated result records the observed version into the store
        // (so the next heartbeat reports it). R9-003: the request+result pair is
        // GC'd so a re-pin back to this version re-applies instead of being
        // suppressed by the stale Activated result.
        use crate::store::WorkerStore;

        let dir = temp_dir();
        let updates = dir.0.join("updates");
        let mut config = legacy_config();
        config.supervisor_update_request_dir = Some(updates.clone());
        config.worker_db_path = dir.0.join("worker.sqlite3");
        let store = WorkerStore::open(config.worker_db_path.clone()).expect("open store");

        let (url, sha, size) = sample_coords();
        let request = build_update_request(
            UpdateComponent::Anyharness,
            "0.2.16",
            "linux-x86_64",
            &url,
            &sha,
            size,
            "2026-07-15T00:00:00Z".to_string(),
        );
        write_request(&updates, &request).expect("write request");
        let result = UpdateResultV1 {
            request_id: request_id_for(UpdateComponent::Anyharness, "0.2.16"),
            outcome: UpdateOutcome::Activated,
            observed_version: Some("0.2.16".to_string()),
            error: None,
        };
        proliferate_runtime_update_protocol::write_result(&updates, &result).expect("write result");

        reconcile_converged_result(&config, &store, UpdateComponent::Anyharness, "0.2.16");

        assert_eq!(
            store.anyharness_converged_version().unwrap().as_deref(),
            Some("0.2.16"),
            "the converged version surfaces to the heartbeat via the store"
        );
        assert!(
            !result_exists(&updates, &result.request_id),
            "the result is GC'd so a re-pin re-applies"
        );
        assert!(
            !updates
                .join(request_file_name(UpdateComponent::Anyharness, "0.2.16"))
                .exists(),
            "the request file is GC'd too"
        );
    }

    #[test]
    fn reconcile_leaves_a_terminal_failure_latched() {
        // A RolledBack/Invalid result is the lagging-artifact latch: reconcile
        // must NOT record convergence or GC it (that would re-emit and loop).
        use crate::store::WorkerStore;

        let dir = temp_dir();
        let updates = dir.0.join("updates");
        let mut config = legacy_config();
        config.supervisor_update_request_dir = Some(updates.clone());
        config.worker_db_path = dir.0.join("worker.sqlite3");
        let store = WorkerStore::open(config.worker_db_path.clone()).expect("open store");

        let request_id = request_id_for(UpdateComponent::Anyharness, "0.2.16");
        let result = UpdateResultV1 {
            request_id: request_id.clone(),
            outcome: UpdateOutcome::RolledBack,
            observed_version: None,
            error: Some("unhealthy after activation".to_string()),
        };
        proliferate_runtime_update_protocol::write_result(&updates, &result).expect("write result");

        reconcile_converged_result(&config, &store, UpdateComponent::Anyharness, "0.2.16");

        assert_eq!(
            store.anyharness_converged_version().unwrap(),
            None,
            "a failed result never records convergence"
        );
        assert!(
            result_exists(&updates, &request_id),
            "the latch is preserved so it is not retried until the pin changes"
        );
    }

    #[test]
    fn launch_script_targets_supervisor_and_guards_self() {
        let script = detached_supervisor_launch_script(
            Path::new("/home/user/.proliferate/bin/proliferate-supervisor"),
            Path::new("/home/user/.proliferate/supervisor/config.toml"),
            Some(Path::new("/home/user/.proliferate/bin/anyharness")),
            Some(Path::new("/home/user/.proliferate/bin/proliferate-worker")),
        );
        // The Supervisor is the nohup launch target: single-quoted, real path
        // (nohup must exec it), NOT a `[/]`-escaped pgrep pattern.
        assert!(script
            .contains("nohup '/home/user/.proliferate/bin/proliferate-supervisor' --config"));
        // The stale independent AnyHarness/Worker are kill targets: pgrep
        // patterns escaped so the pgrep command never matches its own line.
        assert!(script.contains("[/]home/user/.proliferate/bin/anyharness"));
        assert!(script.contains("[/]home/user/.proliferate/bin/proliferate-worker"));
        assert!(script.contains("current_pid=$$"));
        assert!(script.contains("parent_pid=$PPID"));
        // The kill patterns never contain the raw (unescaped) target substring
        // as a pgrep argument.
        assert!(!script.contains("pgrep -f '/home/user/.proliferate/bin/anyharness'"));
    }
}
