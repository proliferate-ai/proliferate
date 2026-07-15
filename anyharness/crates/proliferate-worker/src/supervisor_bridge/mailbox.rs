//! Worker-side mailbox WRITE side of the Supervisor bridge: on a supervisor-owned
//! target the Worker is only an *observer + writer*, recording divergence as ONE
//! durable idempotent `UpdateRequestV1` (never downloading, replacing, killing,
//! or rolling back AnyHarness or itself here).

use tracing::{info, warn};

use proliferate_runtime_update_protocol::{
    read_result, request_file_name, result_exists, result_file_name, write_request,
    UpdateComponent, UpdateOutcome, UpdateRequestV1, UpdateResultV1,
};

use super::now_rfc3339;
use crate::cloud_client::{CloudClient, HeartbeatResponse};
use crate::{anyharness_update, config::WorkerConfig, error::WorkerError, self_update, versions};

/// Published asset names on the downloads CDN (mirrors the legacy paths).
const ANYHARNESS_ASSET: &str = "anyharness";
const WORKER_ASSET: &str = "proliferate-worker";

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
        emit_request(
            config,
            cloud,
            UpdateComponent::Anyharness,
            &version,
            dry_run,
        )
        .await;
    }

    let worker_running = versions::worker_version();
    if let Some(version) = plan_component(worker_running.as_deref(), worker_desired) {
        emit_request(config, cloud, UpdateComponent::Worker, &version, dry_run).await;
    }
}

/// Reconcile the Supervisor's terminal result for `component`@`version` back
/// into the Worker. A successful AnyHarness activation records the observed
/// version into the store so the next heartbeat reports convergence (R9-006),
/// then GCs the request+result pair so a re-pin to this version re-applies
/// rather than being suppressed by the stale `Activated` result (R9-003). A
/// terminal failure (`Invalid`/`RolledBack`) is left in place as the legacy
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
    // R9R-001: the redirect path encodes the EXACT desired version so the server
    // resolves that version (fail-closed if unpublished) rather than the global
    // pin. A sandbox pinned to B can no longer be handed A behind an unversioned
    // redirect that resolves whatever "stable" currently points at.
    let redirect_path = redirect_path_for(component, &target, desired_version);
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
    let path = dir.join(proliferate_runtime_update_protocol::result_file_name(
        request_id,
    ));
    if !path.is_file() {
        return None;
    }
    read_result(&path).ok()
}

/// The version-specific server download path the Supervisor-owned Worker
/// resolves for an update request. The `version` segment makes the server
/// resolve the EXACT requested version (fail-closed on an unpublished version,
/// never a rolling-`stable` fallback), so the artifact coordinates the request
/// carries always name the sandbox's pinned version — not the global pin
/// (R9R-001).
fn redirect_path_for(component: UpdateComponent, target: &str, version: &str) -> String {
    match component {
        UpdateComponent::Anyharness => {
            format!("v1/cloud/runtime/download/{target}/{version}/{ANYHARNESS_ASSET}")
        }
        UpdateComponent::Worker => {
            format!("v1/cloud/worker/download/{target}/{version}/{WORKER_ASSET}")
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    use std::fs;
    use std::path::PathBuf;
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
            "proliferate-worker-mailbox-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create temp dir");
        TempDir(dir)
    }

    // --- planning (unchanged semantics vs. the legacy swap) ---

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
    fn plan_component_is_noop_on_equality_absence_and_empty() {
        assert_eq!(plan_component(Some("0.5.0"), Some("0.5.0")), None);
        assert_eq!(plan_component(Some("0.5.0"), None), None);
        assert_eq!(plan_component(Some("0.5.0"), Some("   ")), None);
        // Unknown running version still converges onto a concrete pin.
        assert_eq!(
            plan_component(None, Some("0.6.0")),
            Some("0.6.0".to_string())
        );
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
    fn redirect_path_encodes_the_exact_version() {
        // R9R-001: the version segment makes the server resolve the requested
        // version (fail-closed), never the global pin behind an unversioned path.
        assert_eq!(
            redirect_path_for(UpdateComponent::Anyharness, "linux-x86_64", "0.2.16"),
            "v1/cloud/runtime/download/linux-x86_64/0.2.16/anyharness"
        );
        assert_eq!(
            redirect_path_for(UpdateComponent::Worker, "macos-aarch64", "0.3.0"),
            "v1/cloud/worker/download/macos-aarch64/0.3.0/proliferate-worker"
        );
    }

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
        assert_eq!(
            files.len(),
            1,
            "a replayed heartbeat must not accumulate files"
        );
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
}
