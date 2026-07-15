pub mod child;
pub mod health;
pub mod restart;

use std::time::Duration;

use proliferate_runtime_update_protocol::UpdateRequestV1;
use tokio::{process::Child, time::sleep};
use tracing::{info, warn};

use crate::{
    config::SupervisorConfig,
    error::SupervisorError,
    update::{self, activate::ActivationHost},
};

/// Which child ended a supervised generation, so the run loop knows whether to
/// respawn AnyHarness (and its dependent Worker) or just the Worker.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum GenerationExit {
    Anyharness,
    Worker,
}

/// One iteration of the supervise loop: `Anyharness`/`Worker` exit events, or a
/// periodic `Tick` on which the mailbox is drained (R9-001). Returned by value
/// so the caller drains AFTER the wait future is dropped (no borrow overlap).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SuperviseEvent {
    Anyharness,
    Worker,
    Tick,
}

/// The two things the supervise loop needs, abstracted so the periodic-drain
/// cadence is unit-testable without real child processes: await the next child
/// exit OR a poll tick, and drain the mailbox once with a fresh host.
#[allow(async_fn_in_trait)]
trait SuperviseSeam {
    /// Await the next child exit or a poll tick (`Tick`).
    async fn wait_or_tick(&mut self, poll: Duration) -> SuperviseEvent;
    /// Drain the mailbox once.
    async fn drain(&mut self) -> Result<(), SupervisorError>;
}

/// Supervise a running generation until a child exits, draining the mailbox
/// once at entry and then on every poll tick. Without the periodic drain the
/// mailbox would only be consumed on a child respawn, so a request written to a
/// stable box would never be actioned (R9-001).
async fn supervise_generation<S: SuperviseSeam>(seam: &mut S, poll: Duration) -> GenerationExit {
    // Drain once as soon as both children are up so a request already waiting is
    // actioned immediately, not only after the first poll interval.
    if let Err(error) = seam.drain().await {
        warn!(?error, "update mailbox drain failed");
    }
    loop {
        match seam.wait_or_tick(poll).await {
            SuperviseEvent::Anyharness => return GenerationExit::Anyharness,
            SuperviseEvent::Worker => return GenerationExit::Worker,
            SuperviseEvent::Tick => {
                if let Err(error) = seam.drain().await {
                    warn!(?error, "periodic update mailbox drain failed");
                }
            }
        }
    }
}

pub async fn run(config: SupervisorConfig) -> Result<(), SupervisorError> {
    let poll = Duration::from_secs(config.update_poll_interval_seconds.max(1));
    // R9R-004: BEFORE the first spawn, reconcile any activation that a crash
    // interrupted between the two renames, so `active` is never missing when we
    // try to spawn — otherwise the loop would livelock on a missing binary
    // (spawn fails -> sleep -> retry, forever, without ever draining the
    // mailbox). Best-effort: a reconcile failure logs and we still try to spawn.
    if let Err(error) = update::activate::reconcile_activation_journal(&config) {
        warn!(?error, "failed to reconcile activation journal at startup");
    }
    loop {
        let mut anyharness = match spawn_anyharness(&config) {
            Ok(child) => child,
            Err(error) => {
                warn!(?error, "failed to start anyharness");
                // Defend against a livelock on a missing binary: reconcile the
                // journal and, failing that, restore last-good from `.prev`
                // before backing off (R9R-004).
                recover_missing_anyharness(&config);
                sleep(restart::backoff(config.restart_delay_seconds)).await;
                continue;
            }
        };
        info!("anyharness started");
        loop {
            let mut worker = match spawn_worker(&config) {
                Ok(child) => child,
                Err(error) => {
                    warn!(?error, "failed to start proliferate-worker");
                    recover_missing_worker(&config);
                    tokio::select! {
                        result = anyharness.wait() => {
                            warn!(?result, "anyharness exited while worker spawn was failing");
                            break;
                        }
                        _ = sleep(restart::backoff(config.restart_delay_seconds)) => {}
                    }
                    continue;
                }
            };
            info!("proliferate-worker started");

            let exit = {
                let mut seam = LiveSupervise {
                    config: &config,
                    anyharness: &mut anyharness,
                    worker: &mut worker,
                };
                supervise_generation(&mut seam, poll).await
            };
            match exit {
                GenerationExit::Anyharness => {
                    warn!("anyharness exited");
                    let _ = worker.kill().await;
                    let _ = worker.wait().await;
                    break;
                }
                GenerationExit::Worker => {
                    warn!("proliferate-worker exited");
                    sleep(restart::backoff(config.restart_delay_seconds)).await;
                }
            }
        }
        sleep(restart::backoff(config.restart_delay_seconds)).await;
    }
}

/// Production seam: races the two live child waits against the poll timer and
/// builds a fresh `LiveHost` per drain.
struct LiveSupervise<'a> {
    config: &'a SupervisorConfig,
    anyharness: &'a mut Child,
    worker: &'a mut Child,
}

impl SuperviseSeam for LiveSupervise<'_> {
    async fn wait_or_tick(&mut self, poll: Duration) -> SuperviseEvent {
        tokio::select! {
            _ = self.anyharness.wait() => SuperviseEvent::Anyharness,
            _ = self.worker.wait() => SuperviseEvent::Worker,
            _ = sleep(poll) => SuperviseEvent::Tick,
        }
    }

    async fn drain(&mut self) -> Result<(), SupervisorError> {
        let mut host = LiveHost {
            config: self.config,
            anyharness: self.anyharness,
            worker: self.worker,
        };
        update::activate::run_pending(self.config, &mut host).await
    }
}

/// Best-effort recovery when AnyHarness fails to spawn because its binary is
/// missing (R9R-004): reconcile a crash-interrupted activation journal, then, if
/// the binary is still absent, restore last-good from `.prev`. This guarantees
/// forward progress instead of a livelock retrying a spawn of a missing path.
fn recover_missing_anyharness(config: &SupervisorConfig) {
    if let Err(error) = update::activate::reconcile_activation_journal(config) {
        warn!(
            ?error,
            "activation journal reconcile failed during spawn recovery"
        );
    }
    let active = &config.anyharness_binary;
    if !active.exists() {
        let mut previous = active.as_os_str().to_os_string();
        previous.push(".prev");
        let previous = std::path::PathBuf::from(previous);
        if previous.exists() {
            if let Err(error) = std::fs::rename(&previous, active) {
                warn!(
                    ?error,
                    "failed to restore anyharness from .prev during recovery"
                );
            } else {
                warn!("restored anyharness from .prev after a missing active binary");
            }
        }
    }
}

/// Best-effort recovery when the Worker fails to spawn because its binary is
/// missing (R9R3-001): symmetric with `recover_missing_anyharness`, so a
/// power-loss between the Worker component's two activation renames recovers
/// instead of livelocking the inner worker-spawn loop. Reconciles the journal,
/// then restores last-good from `.prev` if the active worker binary is absent.
fn recover_missing_worker(config: &SupervisorConfig) {
    if let Err(error) = update::activate::reconcile_activation_journal(config) {
        warn!(
            ?error,
            "activation journal reconcile failed during worker spawn recovery"
        );
    }
    let active = &config.worker_binary;
    if !active.exists() {
        let mut previous = active.as_os_str().to_os_string();
        previous.push(".prev");
        let previous = std::path::PathBuf::from(previous);
        if previous.exists() {
            if let Err(error) = std::fs::rename(&previous, active) {
                warn!(
                    ?error,
                    "failed to restore worker from .prev during recovery"
                );
            } else {
                warn!("restored worker from .prev after a missing active binary");
            }
        }
    }
}

fn spawn_anyharness(config: &SupervisorConfig) -> Result<Child, SupervisorError> {
    let anyharness_env = config
        .anyharness_env
        .iter()
        .map(|(name, value)| (name.as_str(), value.as_str()));
    child::spawn_with_env(
        config.anyharness_binary.to_string_lossy().as_ref(),
        &config.anyharness_args,
        anyharness_env,
    )
}

fn spawn_worker(config: &SupervisorConfig) -> Result<Child, SupervisorError> {
    let worker_args = [
        "--config".to_string(),
        config.worker_config.to_string_lossy().to_string(),
    ];
    let supervisor_version = env!("CARGO_PKG_VERSION");
    let mut worker_env = vec![("PROLIFERATE_SUPERVISOR_VERSION", supervisor_version)];
    worker_env.extend(
        config
            .process_env
            .iter()
            .map(|(name, value)| (name.as_str(), value.as_str())),
    );
    child::spawn_with_env(
        config.worker_binary.to_string_lossy().as_ref(),
        &worker_args,
        worker_env,
    )
}

/// Production adapter for the activation state machine: it owns the live child
/// handles the machine restarts, wires the bounded artifact fetch, and runs the
/// real health gate. Keeping this here (not in `update/activate.rs`) is what
/// lets the state machine stay free of process/network concerns and be unit
/// tested with fake seams.
struct LiveHost<'a> {
    config: &'a SupervisorConfig,
    anyharness: &'a mut Child,
    worker: &'a mut Child,
}

impl ActivationHost for LiveHost<'_> {
    async fn fetch_artifact(
        &mut self,
        request: &UpdateRequestV1,
    ) -> Result<Vec<u8>, SupervisorError> {
        update::download::download_artifact(
            request,
            self.config.max_artifact_bytes,
            self.config.download_timeout_seconds,
        )
        .await
    }

    async fn restart_anyharness(&mut self) -> Result<(), SupervisorError> {
        // R9-012 (documented tradeoff): the activation drain kills+respawns the
        // child here, transferring parenting from the run loop's `wait` to this
        // fresh handle. The run loop is not `wait`ing during a drain, so the old
        // handle's reap is done here and the new handle becomes the one the loop
        // waits on next generation.
        let _ = self.anyharness.kill().await;
        let _ = self.anyharness.wait().await;
        *self.anyharness = spawn_anyharness(self.config)?;
        Ok(())
    }

    async fn restart_worker(&mut self) -> Result<(), SupervisorError> {
        // R9-012 (documented tradeoff): same kill+restart ownership transfer as
        // `restart_anyharness`.
        let _ = self.worker.kill().await;
        let _ = self.worker.wait().await;
        *self.worker = spawn_worker(self.config)?;
        Ok(())
    }

    async fn anyharness_healthy(&mut self, expected_version: Option<&str>) -> bool {
        health::anyharness_healthy(
            &self.config.anyharness_health_url,
            expected_version,
            self.config.health_check_attempts,
            Duration::from_secs(self.config.health_check_delay_seconds),
        )
        .await
    }

    async fn worker_alive(&mut self) -> bool {
        health::worker_alive(self.worker)
    }

    async fn worker_reports_version(&mut self, expected: &str) -> Option<bool> {
        // Probe the ACTIVE worker binary on disk (a fresh `--version`
        // subprocess), not the running child, so the answer reflects the
        // just-activated bytes rather than the request label (R9R-001). Run the
        // blocking spawn off the async runtime (R9R3-002).
        let binary = self.config.worker_binary.clone();
        let output = tokio::task::spawn_blocking(move || {
            std::process::Command::new(&binary).arg("--version").output()
        })
        .await
        .ok()?
        .ok()?;
        if !output.status.success() {
            return None;
        }
        let reported = String::from_utf8_lossy(&output.stdout);
        Some(version_output_matches(&reported, expected))
    }
}

/// `--version` prints e.g. `proliferate-worker 0.3.0`; match on whitespace
/// tokens (tolerating a leading `v`) rather than the exact line so the check
/// survives formatting changes. Mirrors the Worker crate's `self_update`
/// matcher so the two agree on what "reports this version" means.
fn version_output_matches(output: &str, expected: &str) -> bool {
    output
        .split_whitespace()
        .any(|token| token == expected || token.strip_prefix('v') == Some(expected))
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::{
        cell::Cell,
        collections::BTreeMap,
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
    };

    use proliferate_runtime_update_protocol::{
        result_exists, write_request, UpdateComponent, UpdateOutcome, UpdateRequestV1,
        UpdateResultV1,
    };
    use sha2::{Digest, Sha256};

    use crate::update::activate::ActivationHost;

    struct TempDir(PathBuf);

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    fn temp_dir() -> TempDir {
        let dir = std::env::temp_dir().join(format!(
            "proliferate-supervisor-process-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create temp dir");
        TempDir(dir)
    }

    fn test_config(base: &std::path::Path) -> SupervisorConfig {
        std::fs::create_dir_all(base.join("bin")).expect("create bin dir");
        SupervisorConfig {
            anyharness_binary: base.join("bin/anyharness"),
            worker_binary: base.join("bin/worker"),
            worker_config: base.join("worker.toml"),
            anyharness_args: vec!["serve".to_string()],
            anyharness_env: BTreeMap::new(),
            process_env: BTreeMap::new(),
            restart_delay_seconds: 1,
            update_request_dir: base.join("updates"),
            staging_dir: base.join("staging"),
            anyharness_health_url: "http://127.0.0.1:8457/health".to_string(),
            health_check_attempts: 1,
            health_check_delay_seconds: 0,
            max_artifact_bytes: 1024,
            download_timeout_seconds: 5,
            update_poll_interval_seconds: 1,
        }
    }

    /// A trivial activation host that always fetches the same healthy bytes and
    /// reports healthy — the drain itself is exercised by `update::activate`
    /// tests; here we only care that a periodic drain HAPPENS.
    struct TestActivationHost {
        bytes: Vec<u8>,
    }

    impl ActivationHost for TestActivationHost {
        async fn fetch_artifact(
            &mut self,
            _request: &UpdateRequestV1,
        ) -> Result<Vec<u8>, SupervisorError> {
            Ok(self.bytes.clone())
        }
        async fn restart_anyharness(&mut self) -> Result<(), SupervisorError> {
            Ok(())
        }
        async fn restart_worker(&mut self) -> Result<(), SupervisorError> {
            Ok(())
        }
        async fn anyharness_healthy(&mut self, _expected: Option<&str>) -> bool {
            true
        }
        async fn worker_alive(&mut self) -> bool {
            true
        }
        async fn worker_reports_version(&mut self, _expected: &str) -> Option<bool> {
            None
        }
    }

    #[test]
    fn recover_missing_worker_restores_last_good_from_prev() {
        // Simulates a power loss between the Worker component's two activation
        // renames (R9R3-001): active worker binary absent, `.prev` present, and
        // an unrelated journal absent. Recovery must restore `.prev` -> active so
        // the inner worker-spawn loop cannot livelock on a missing binary.
        let dir = temp_dir();
        let config = test_config(&dir.0);
        std::fs::create_dir_all(config.worker_binary.parent().unwrap()).unwrap();
        let mut prev = config.worker_binary.as_os_str().to_os_string();
        prev.push(".prev");
        std::fs::write(&prev, b"last-good-worker-bytes").unwrap();
        assert!(!config.worker_binary.exists(), "active worker starts absent");

        recover_missing_worker(&config);

        assert!(
            config.worker_binary.exists(),
            "recovery restored the active worker binary"
        );
        assert_eq!(
            std::fs::read(&config.worker_binary).unwrap(),
            b"last-good-worker-bytes"
        );
    }

    /// A supervise seam whose children never exit (healthy) for the first calls:
    /// on the first tick it writes a request (a request "arriving while children
    /// are healthy"), and later reports a Worker exit so the generation ends.
    struct FakeSeam<'a> {
        config: &'a SupervisorConfig,
        host: &'a mut TestActivationHost,
        request: UpdateRequestV1,
        calls: Cell<u32>,
    }

    impl SuperviseSeam for FakeSeam<'_> {
        async fn wait_or_tick(&mut self, poll: Duration) -> SuperviseEvent {
            // Honor the poll interval so the test reflects the bounded cadence.
            sleep(poll).await;
            let n = self.calls.get();
            self.calls.set(n + 1);
            match n {
                0 => {
                    // A request arrives AFTER the entry drain, while both children
                    // are still healthy (no exit). Only a periodic drain can pick
                    // it up.
                    write_request(&self.config.update_request_dir, &self.request)
                        .expect("write request");
                    SuperviseEvent::Tick
                }
                1 => SuperviseEvent::Tick,
                _ => SuperviseEvent::Worker,
            }
        }

        async fn drain(&mut self) -> Result<(), SupervisorError> {
            update::activate::run_pending(self.config, self.host).await
        }
    }

    #[tokio::test]
    async fn periodic_drain_activates_a_request_written_while_children_are_healthy() {
        let dir = temp_dir();
        let config = test_config(&dir.0);
        std::fs::write(&config.anyharness_binary, b"old-anyharness").expect("seed active");
        let new_bytes = b"new-anyharness-binary".to_vec();
        let request = UpdateRequestV1 {
            request_id: "anyharness-0.2.16".to_string(),
            component: UpdateComponent::Anyharness,
            version: "0.2.16".to_string(),
            target_triple: "linux-x86_64".to_string(),
            artifact_url: "https://downloads.example.test/anyharness".to_string(),
            sha256: format!("{:x}", Sha256::digest(&new_bytes)),
            size_bytes: new_bytes.len() as u64,
            requested_at: "2026-07-15T00:00:00Z".to_string(),
        };

        let mut host = TestActivationHost {
            bytes: new_bytes.clone(),
        };
        let mut seam = FakeSeam {
            config: &config,
            host: &mut host,
            request: request.clone(),
            calls: Cell::new(0),
        };

        // A short poll keeps the test fast; the cadence is what matters, not the
        // absolute interval (the config default is validated separately).
        let poll = Duration::from_millis(1);
        let exit = supervise_generation(&mut seam, poll).await;

        assert_eq!(exit, GenerationExit::Worker);
        // The request that arrived while children were healthy was drained on a
        // poll tick and activated.
        assert!(result_exists(
            &config.update_request_dir,
            &request.request_id
        ));
        let result: UpdateResultV1 =
            proliferate_runtime_update_protocol::read_result(&config.update_request_dir.join(
                proliferate_runtime_update_protocol::result_file_name(&request.request_id),
            ))
            .expect("read result");
        assert_eq!(result.outcome, UpdateOutcome::Activated);
        assert_eq!(std::fs::read(&config.anyharness_binary).unwrap(), new_bytes);
    }
}
