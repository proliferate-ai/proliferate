//! Deterministic bridge orchestration tests: idempotency, crash recovery,
//! ownership confirmation (R9R-003), and the server-delivered legacy-migration
//! path (R9R-002), all exercised through a fake `BridgeHost` with real marker
//! files under a temp dir.

use super::*;

use std::cell::Cell;
use std::fs;
use std::sync::atomic::{AtomicU64, Ordering};

use crate::supervisor_bridge::is_supervisor_owned;

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

struct FakeHost {
    live_sequence: Vec<bool>,
    call: Cell<usize>,
    spawns: Cell<u32>,
    spawn_starts_supervisor: bool,
    /// Whether AnyHarness `/health` passes (the R9R-003 ownership evidence).
    healthy: bool,
}

impl FakeHost {
    /// A spawn that fully transfers ownership: the Supervisor comes up AND it
    /// brings AnyHarness to health.
    fn spawning() -> Self {
        Self {
            live_sequence: vec![false],
            call: Cell::new(0),
            spawns: Cell::new(0),
            spawn_starts_supervisor: true,
            healthy: true,
        }
    }
    /// Always-live (an existing Supervisor already owns the box).
    fn already_live() -> Self {
        Self {
            live_sequence: vec![true],
            call: Cell::new(0),
            spawns: Cell::new(0),
            spawn_starts_supervisor: false,
            healthy: true,
        }
    }
    /// A spawn that never brings the Supervisor up at all.
    fn spawn_fails() -> Self {
        Self {
            live_sequence: vec![false],
            call: Cell::new(0),
            spawns: Cell::new(0),
            spawn_starts_supervisor: false,
            healthy: false,
        }
    }
    /// A spawn where the Supervisor PID comes up but keeps failing to bring
    /// AnyHarness up — /health never passes (R9R-003: a live PID is not proof
    /// ownership transferred).
    fn spawn_supervisor_only() -> Self {
        Self {
            live_sequence: vec![false],
            call: Cell::new(0),
            spawns: Cell::new(0),
            spawn_starts_supervisor: true,
            healthy: false,
        }
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
    async fn anyharness_healthy(&self) -> bool {
        self.healthy
    }
}

/// Build bridge inputs whose marker dir and Supervisor config path both live
/// under the test's temp dir, so writing the config + markers touches only
/// the temp tree (never a real absolute path).
fn inputs(dir: &Path, config_path: &Path, config_toml: Option<&str>) -> BridgeInputs {
    BridgeInputs {
        supervisor_binary: PathBuf::from("/home/user/.proliferate/bin/proliferate-supervisor"),
        supervisor_config_path: config_path.to_path_buf(),
        supervisor_config_toml: config_toml.map(str::to_string),
        worker_config_path: None,
        worker_config_toml: None,
        marker_dir: dir.to_path_buf(),
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
        supervisor_bridge: None,
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
    // Supervisor starts dead; the spawn brings it up, AnyHarness is healthy,
    // and the Worker child writes its ownership handshake (R9R-003).
    let host = FakeHost::spawning();
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
    assert_eq!(
        host.spawns.get(),
        0,
        "a live supervisor is never re-spawned"
    );
    assert!(marker_path(&dir.0, MARKER_DONE).is_file());
}

#[tokio::test]
async fn bridge_recovers_from_started_without_done_when_supervisor_dead() {
    let dir = temp_dir();
    let config_path = dir.0.join("config.toml");
    // Simulate a crash mid-bridge: `started` present, no `done`, supervisor dead.
    write_marker(&dir.0, MARKER_STARTED).expect("seed started");
    let host = FakeHost::spawning();
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
    let host = FakeHost::spawn_fails();
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
    legacy.supervisor_binary_path = Some(PathBuf::from(
        "/home/user/.proliferate/bin/proliferate-supervisor",
    ));
    legacy.supervisor_config_path = Some(config_path.clone());
    legacy.supervisor_bridge_marker_dir = Some(dir.0.clone());
    assert!(
        !is_supervisor_owned(&legacy),
        "no mailbox -> not supervisor-owned"
    );
    assert!(
        bridge_inputs(&legacy).is_some(),
        "bridge inputs are derivable from a legacy config"
    );

    // A dead Supervisor that the spawn brings up -> the legacy Worker bridges.
    let host = FakeHost::spawning();
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
    assert_eq!(
        live.spawns.get(),
        0,
        "idempotent: no double supervisor on replay"
    );
}

#[tokio::test]
async fn bridge_does_not_complete_when_supervisor_up_but_children_fail() {
    // R9R-003: a Supervisor whose PID is live but which keeps failing to
    // spawn AnyHarness/Worker must NOT complete the bridge. The old Worker
    // must not write bridge.done or exit; the legacy topology keeps running
    // and the next heartbeat retries.
    let dir = temp_dir();
    let config_path = dir.0.join("config.toml");
    // PID comes up, but the Supervisor keeps failing to bring AnyHarness up,
    // so /health never passes.
    let host = FakeHost::spawn_supervisor_only();
    let result = bridge_with_host(&inputs(&dir.0, &config_path, None), &host).await;
    assert!(matches!(result, Err(WorkerError::BridgeNotConfirmed)));
    assert_eq!(host.spawns.get(), 1);
    // Started but NOT done: ownership was never proven, so the box is not
    // handed off and the bridging Worker does not exit.
    assert!(marker_path(&dir.0, MARKER_STARTED).is_file());
    assert!(!marker_path(&dir.0, MARKER_DONE).is_file());
}

#[tokio::test]
async fn legacy_persisted_config_bridges_from_server_delivered_inputs() {
    // R9R-002: an already-provisioned LEGACY target whose PERSISTED config
    // (parsed from a legacy-shaped TOML, not mutated in-test) carries no
    // bridge fields still bridges when the server delivers the inputs via the
    // heartbeat. The bridge materializes BOTH the Supervisor config and a
    // supervisor-owned Worker config before spawning.
    let legacy_toml = "\
cloud_base_url = \"https://cloud.test\"\n\
worker_db_path = \"/home/user/.proliferate/worker/worker.sqlite3\"\n\
self_update_enabled = true\n\
anyharness_update_enabled = true\n\
anyharness_binary_path = \"/home/user/.proliferate/bin/anyharness\"\n\
anyharness_launcher_path = \"/home/user/start-anyharness.sh\"\n\
anyharness_workdir = \"/home/user/repo\"\n";
    let config: WorkerConfig = toml::from_str(legacy_toml).expect("legacy config");
    // The legacy persisted config yields NO bridge inputs on its own.
    assert!(bridge_inputs(&config).is_none());

    let dir = temp_dir();
    let supervisor_config = dir.0.join("supervisor-config.toml");
    let worker_config = dir.0.join("worker-config.toml");
    let delivered = SupervisorBridgeInputs {
        supervisor_binary_path: "/home/user/.proliferate/bin/proliferate-supervisor".to_string(),
        supervisor_config_path: supervisor_config.to_string_lossy().to_string(),
        supervisor_config_toml: "anyharness_binary = \"/home/user/.proliferate/bin/anyharness\"\n"
            .to_string(),
        worker_config_path: worker_config.to_string_lossy().to_string(),
        worker_config_toml:
            "supervisor_update_request_dir = \"/home/user/.proliferate/supervisor/updates\"\n"
                .to_string(),
        marker_dir: dir.0.to_string_lossy().to_string(),
    };
    let bridge = bridge_inputs_from_delivered(&delivered);
    let host = FakeHost::spawning();
    let outcome = bridge_with_host(&bridge, &host).await.expect("bridge");

    assert_eq!(outcome, BridgeOutcome::Bridged);
    assert_eq!(host.spawns.get(), 1);
    // Both configs were materialized on disk before the spawn.
    assert!(
        supervisor_config.is_file(),
        "supervisor config materialized"
    );
    assert!(
        worker_config.is_file(),
        "supervisor-owned worker config materialized"
    );
    assert!(fs::read_to_string(&worker_config)
        .unwrap()
        .contains("supervisor_update_request_dir"));
    assert!(marker_path(&dir.0, MARKER_DONE).is_file());
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
    assert!(script.contains("nohup '/home/user/.proliferate/bin/proliferate-supervisor' --config"));
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
