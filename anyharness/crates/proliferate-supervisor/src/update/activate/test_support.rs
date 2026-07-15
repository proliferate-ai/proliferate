//! Shared deterministic test seams for the activation state machine: the fake
//! `ActivationHost`, the temp-dir + config builders, and request/result
//! helpers. Lives in its own `#[cfg(test)]` module so both the flow tests
//! (`tests.rs`) and the crate can reuse one fake without duplication.

use super::*;

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};

use proliferate_runtime_update_protocol::{read_result, result_file_name};
use sha2::{Digest, Sha256};

pub(super) struct TempDir(pub(super) PathBuf);

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

static COUNTER: AtomicU64 = AtomicU64::new(0);

pub(super) fn temp_dir() -> TempDir {
    let dir = std::env::temp_dir().join(format!(
        "proliferate-supervisor-activate-{}-{}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("create temp dir");
    TempDir(dir)
}

pub(super) fn test_config(base: &Path) -> SupervisorConfig {
    fs::create_dir_all(base.join("bin")).expect("create bin dir");
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

pub(super) fn make_request(
    component: UpdateComponent,
    version: &str,
    bytes: &[u8],
) -> UpdateRequestV1 {
    UpdateRequestV1 {
        request_id: format!("{}-{}", component.as_str(), version),
        component,
        version: version.to_string(),
        target_triple: "linux-x86_64".to_string(),
        artifact_url: "https://downloads.example.test/artifact".to_string(),
        sha256: format!("{:x}", Sha256::digest(bytes)),
        size_bytes: bytes.len() as u64,
        requested_at: "2026-07-15T00:00:00Z".to_string(),
    }
}

pub(super) fn result_for(dir: &Path, request_id: &str) -> UpdateResultV1 {
    read_result(&dir.join(result_file_name(request_id))).expect("read result")
}

/// How the fake download behaves: hands back bytes, a transient transport
/// blip (leaves the request pending), or a definitive bad status (terminal).
#[derive(Default)]
pub(super) enum FetchMode {
    Bytes(Vec<u8>),
    #[default]
    Transient,
    Status,
}

#[derive(Default)]
pub(super) struct FakeHost {
    pub(super) fetch: FetchMode,
    pub(super) healthy: bool,
    pub(super) worker_live: bool,
    /// The version the modeled AnyHarness `/health` reports (`None` => the
    /// body carries no version, so any 2xx passes — mirrors real health.rs).
    pub(super) anyharness_version: Option<String>,
    pub(super) restart_log: Vec<&'static str>,
    pub(super) fetch_count: u32,
    /// The `expected_version` values passed to each health probe, so a test
    /// can assert the gate was asked to check a version (R9-008).
    pub(super) health_expected: Vec<Option<String>>,
    /// What the modeled active worker binary reports for `--version`:
    /// `None` => unprobeable (tolerated), `Some(true)` => matches the
    /// request, `Some(false)` => a different version (bytes/label mismatch,
    /// R9R-001). Default `None` keeps existing worker tests tolerant.
    pub(super) worker_reports: Option<bool>,
}

impl ActivationHost for FakeHost {
    async fn fetch_artifact(
        &mut self,
        _request: &UpdateRequestV1,
    ) -> Result<Vec<u8>, SupervisorError> {
        self.fetch_count += 1;
        match &self.fetch {
            FetchMode::Bytes(bytes) => Ok(bytes.clone()),
            FetchMode::Transient => Err(SupervisorError::DownloadTransport {
                url: "https://downloads.example.test/artifact".to_string(),
                message: "simulated transient transport failure".to_string(),
            }),
            FetchMode::Status => Err(SupervisorError::DownloadArtifact {
                url: "https://downloads.example.test/artifact".to_string(),
                message: "unexpected status 404 Not Found".to_string(),
            }),
        }
    }

    async fn restart_anyharness(&mut self) -> Result<(), SupervisorError> {
        self.restart_log.push("anyharness");
        Ok(())
    }

    async fn restart_worker(&mut self) -> Result<(), SupervisorError> {
        self.restart_log.push("worker");
        Ok(())
    }

    async fn anyharness_healthy(&mut self, expected_version: Option<&str>) -> bool {
        self.health_expected
            .push(expected_version.map(str::to_string));
        if !self.healthy {
            return false;
        }
        match expected_version {
            None => true,
            Some(expected) => match &self.anyharness_version {
                Some(running) => running == expected,
                None => true,
            },
        }
    }

    async fn worker_alive(&mut self) -> bool {
        self.worker_live
    }

    async fn worker_reports_version(&mut self, _expected: &str) -> Option<bool> {
        self.worker_reports
    }
}
