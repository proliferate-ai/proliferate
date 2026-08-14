//! Desktop Worker launch and startup watch.
//!
//! On the two accepted packaged macOS targets the bundled launch pipes both
//! child streams into the bounded in-memory tail, never opens `worker.log`,
//! and carries the protected bridge/shutdown descriptors when the launcher is
//! a direct binary. Descriptor or remap failure before a successful exec is an
//! observability outcome (`Disabled`), never a product-launch failure, and a
//! returned successful protected spawn is the point of no retry. Unsupported
//! builds keep the legacy `worker.log` writer verbatim behind this boundary;
//! it is unreachable from a supported bundled launch.

use tokio::process::Child;
use tokio::time::{sleep, Duration, Instant};

use super::launcher::{prepare_proliferate_worker_launcher, WorkerLauncher};
use super::lifecycle::{WorkerStartFailure, WorkerStartFailureKind};
use super::{startup_watch_window, CloudWorkerProcess, WorkerPaths};

#[cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
use std::sync::Arc;

#[cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
use super::tail::{drain_worker_stream, SharedWorkerTail, WorkerOutputStream, WorkerTailSnapshot};
#[cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
use crate::diagnostics::scrub_diagnostic_text;
#[cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
use crate::diagnostics_collector::child_bridge::{
    fallback_root::{resolve_fallback_root, FallbackRootOutcome},
    launch::PreparedChildDiagnosticsLaunch,
    runtime::ChildDiagnosticsBridge,
};
#[cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
use crate::diagnostics_collector::supervisor::DiagnosticsCollectorSupervisor;
#[cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
use proliferate_diagnostics_client::bridge::wire::{
    FallbackUnavailableClassification, WireComponent,
};

pub(super) enum WorkerLaunchOutcome {
    Started(CloudWorkerProcess),
    RetainedAfterInspection {
        process: CloudWorkerProcess,
        failure: WorkerStartFailure,
    },
}

pub(super) fn retained_after_startup_inspection(
    process: CloudWorkerProcess,
    failure: WorkerStartFailure,
) -> WorkerLaunchOutcome {
    WorkerLaunchOutcome::RetainedAfterInspection { process, failure }
}

/// Completes any debug build before observability descriptors exist and
/// returns only a direct native executable.
pub(super) async fn prepare_launcher() -> Result<WorkerLauncher, WorkerStartFailure> {
    let selection = prepare_proliferate_worker_launcher()
        .await
        .map_err(|error| {
            WorkerStartFailure::new(WorkerStartFailureKind::SpawnFailed, error.to_string())
        })?;
    if let Some(rejection) = selection.invalid_override {
        tracing::warn!(
            classification = rejection.as_str(),
            "Worker executable override rejected"
        );
    }
    selection.launcher.ok_or_else(|| {
        WorkerStartFailure::new(
            WorkerStartFailureKind::BinaryMissing,
            "Proliferate Worker binary was not found.".to_string(),
        )
    })
}

#[cfg(not(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
)))]
use crate::diagnostics_collector::supervisor::DiagnosticsCollectorSupervisor;
#[cfg(not(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
)))]
use std::sync::Arc;

/// Launches the Worker and watches its startup window. The direct launcher is
/// fully resolved by the caller before any observability descriptor exists.
#[cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
pub(super) async fn launch_and_watch(
    launcher: &WorkerLauncher,
    paths: &WorkerPaths,
    target_id: String,
    fresh_enrollment: bool,
    supervisor: &Arc<DiagnosticsCollectorSupervisor>,
) -> Result<WorkerLaunchOutcome, WorkerStartFailure> {
    tracing::info!(
        launcher = %launcher,
        config_path = %paths.config.display(),
        "Starting Proliferate Worker"
    );
    let spawned = spawn_worker(launcher, paths, supervisor).map_err(|error| {
        tracing::error!(launcher = %launcher, %error, "Failed to start Proliferate Worker");
        WorkerStartFailure::new(
            WorkerStartFailureKind::SpawnFailed,
            format!("Failed to start Proliferate Worker with {launcher}: {error}"),
        )
    })?;
    let mut process = CloudWorkerProcess {
        target_id,
        child: spawned.child,
        config_path: paths.config.clone(),
        observer_generation: 0,
        bridge: spawned.bridge,
        drainers: Vec::with_capacity(2),
        tail: SharedWorkerTail::new(),
    };
    // Both drainers start before the startup watch can wait, so a noisy
    // startup cannot fill either pipe and block the child.
    if let Some(stdout) = process.child.stdout.take() {
        process.drainers.push(tokio::spawn(drain_worker_stream(
            stdout,
            WorkerOutputStream::Stdout,
            process.tail.clone(),
        )));
    }
    if let Some(stderr) = process.child.stderr.take() {
        process.drainers.push(tokio::spawn(drain_worker_stream(
            stderr,
            WorkerOutputStream::Stderr,
            process.tail.clone(),
        )));
    }
    tracing::info!(
        launcher = %launcher,
        pid = process.child.id(),
        "Proliferate Worker spawned"
    );

    let startup_deadline = Instant::now() + startup_watch_window(fresh_enrollment);
    match watch_startup(&mut process.child, startup_deadline).await {
        Ok(Some(status)) => {
            // Snapshot only after the EOF/cancellation fence so final bytes
            // cannot race the returned message; the fence never adds a
            // tail-only wait beyond the existing startup deadline.
            process
                .finish_verified_reap(
                    status,
                    crate::diagnostics_collector::child_bridge::reap::ChildReapKind::Natural,
                    startup_deadline,
                )
                .await;
            let snapshot = process.tail.snapshot();
            tracing::error!(
                launcher = %launcher,
                %status,
                tail_incomplete = snapshot.tail_incomplete,
                "Proliferate Worker exited during startup"
            );
            Err(WorkerStartFailure::new(
                WorkerStartFailureKind::EarlyExit,
                bundled_startup_failure_message(&status.to_string(), &snapshot),
            ))
        }
        Ok(None) => Ok(WorkerLaunchOutcome::Started(process)),
        Err(failure) => Ok(retained_after_startup_inspection(process, failure)),
    }
}

#[cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
struct SpawnedWorker {
    child: Child,
    bridge: Option<ChildDiagnosticsBridge>,
}

#[cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
fn spawn_worker(
    launcher: &WorkerLauncher,
    paths: &WorkerPaths,
    supervisor: &Arc<DiagnosticsCollectorSupervisor>,
) -> std::io::Result<SpawnedWorker> {
    // Resolve the login-shell PATH and finish the complete Command before
    // any protected descriptor exists. The fallback builds a fresh command
    // only after `prepared` and every partial descriptor have dropped.
    let protected_command = build_worker_command(launcher, paths);
    if matches!(
        supervisor.state(),
        crate::diagnostics_collector::supervisor::DesktopDiagnosticsSupervisorStateV1::Unsupported { .. }
    ) {
        return spawn_unprotected(launcher, paths);
    }
    let prepared = match PreparedChildDiagnosticsLaunch::create() {
        Ok(prepared) => prepared,
        Err(error) => {
            tracing::warn!(
                error = %error,
                "diagnostics descriptors unavailable; launching Worker unprotected"
            );
            return spawn_unprotected(launcher, paths);
        }
    };
    let fallback = worker_fallback_root();
    if matches!(
        supervisor.state(),
        crate::diagnostics_collector::supervisor::DesktopDiagnosticsSupervisorStateV1::Unsupported { .. }
    ) {
        drop(prepared);
        return spawn_unprotected(launcher, paths);
    }
    match prepared.spawn(protected_command) {
        Ok(launch) => {
            let bridge = ChildDiagnosticsBridge::start(
                WireComponent::DesktopWorker,
                launch.bridge,
                launch.shutdown_writer,
                Arc::clone(supervisor),
                fallback,
            );
            Ok(SpawnedWorker {
                child: launch.child,
                bridge: Some(bridge),
            })
        }
        Err(error) => {
            tracing::warn!(
                error = %error,
                "protected Worker spawn failed before exec; retrying unprotected once"
            );
            spawn_unprotected(launcher, paths)
        }
    }
}

#[cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
fn spawn_unprotected(
    launcher: &WorkerLauncher,
    paths: &WorkerPaths,
) -> std::io::Result<SpawnedWorker> {
    Ok(SpawnedWorker {
        child: build_worker_command(launcher, paths).spawn()?,
        bridge: None,
    })
}

#[cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
fn build_worker_command(launcher: &WorkerLauncher, paths: &WorkerPaths) -> tokio::process::Command {
    let mut command = launcher.command(&paths.config);
    command
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    if let Some(path) = crate::sidecar::resolve_shell_path() {
        command.env("PATH", path);
    }
    command
}

/// The fixed Worker fallback authority:
/// `<desktop logs dir>/diagnostics-fallback`.
#[cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
fn worker_fallback_root() -> FallbackRootOutcome {
    match crate::app_config::logs_dir_path() {
        Ok(logs) => resolve_fallback_root(&logs, &[]),
        Err(_) => FallbackRootOutcome::Unavailable(
            FallbackUnavailableClassification::DirectoryUnavailable,
        ),
    }
}

/// Joins both drainers through EOF with only the time remaining on the
/// caller's existing deadline; at the deadline the drainers are cancelled and
/// the tail declares `tail_incomplete`.
#[cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
pub(super) async fn fence_worker_tail(
    drainers: &mut Vec<tokio::task::JoinHandle<std::io::Result<()>>>,
    tail: &SharedWorkerTail,
    deadline: Instant,
) {
    let mut cancelled = false;
    for mut drainer in drainers.drain(..) {
        match tokio::time::timeout_at(deadline, &mut drainer).await {
            Ok(_) => {}
            Err(_) => {
                drainer.abort();
                let _ = drainer.await;
                cancelled = true;
            }
        }
    }
    if cancelled {
        tail.mark_incomplete_and_finalize();
    }
}

/// Path-free failure prose: the bounded snapshot is scrubbed with the existing
/// outward-facing scrubber; no log path exists in bundled mode.
#[cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
fn bundled_startup_failure_message(status: &str, snapshot: &WorkerTailSnapshot) -> String {
    let mut message = format!("Proliferate Worker exited during startup with {status}.");
    let rendered = scrub_diagnostic_text(&snapshot.render());
    if !rendered.is_empty() {
        message.push_str("\n\nLast worker output lines:\n");
        message.push_str(&rendered);
    }
    if snapshot.tail_incomplete {
        message.push_str("\n\n(worker output tail is incomplete)");
    }
    message
}

impl CloudWorkerProcess {
    #[cfg(all(
        target_os = "macos",
        any(target_arch = "aarch64", target_arch = "x86_64")
    ))]
    pub(crate) fn diagnostics_bridge(&self) -> Option<&ChildDiagnosticsBridge> {
        self.bridge.as_ref()
    }

    /// The EOF/cancellation fence run after the owner has verified the child
    /// result and before the owner is released.
    #[cfg(all(
        target_os = "macos",
        any(target_arch = "aarch64", target_arch = "x86_64")
    ))]
    pub(super) async fn fence_tail(&mut self, deadline: Instant) {
        fence_worker_tail(&mut self.drainers, &self.tail, deadline).await;
    }

    #[cfg(not(all(
        target_os = "macos",
        any(target_arch = "aarch64", target_arch = "x86_64")
    )))]
    pub(super) async fn fence_tail(&mut self, _deadline: Instant) {}

    /// Consumes one identity-stable reap proof after the Worker output fence,
    /// then permits producer-death control only through the bridge's matching
    /// ordered delivery fence. Unsupported/unprotected launches stop after
    /// the legacy/no-op tail fence.
    pub(super) async fn finish_verified_reap(
        &mut self,
        status: std::process::ExitStatus,
        kind: crate::diagnostics_collector::child_bridge::reap::ChildReapKind,
        deadline: Instant,
    ) {
        self.fence_tail(deadline).await;
        #[cfg(all(
            target_os = "macos",
            any(target_arch = "aarch64", target_arch = "x86_64")
        ))]
        if let Some(bridge) = self.bridge.as_ref() {
            let proof = crate::diagnostics_collector::child_bridge::reap::VerifiedChildReap::new(
                status, kind,
            );
            let _ = bridge.finish_verified_reap(proof, deadline).await;
        }
        #[cfg(not(all(
            target_os = "macos",
            any(target_arch = "aarch64", target_arch = "x86_64")
        )))]
        let _ = (status, kind);
    }
}

/// Legacy launch for unsupported Unix/non-Unix builds: activation is
/// `Disabled`, `worker.log` keeps its current truncate-and-append behavior,
/// and the file tail keeps feeding startup-failure prose.
#[cfg(not(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
)))]
pub(super) async fn launch_and_watch(
    launcher: &WorkerLauncher,
    paths: &WorkerPaths,
    target_id: String,
    fresh_enrollment: bool,
    _supervisor: &Arc<DiagnosticsCollectorSupervisor>,
) -> Result<WorkerLaunchOutcome, WorkerStartFailure> {
    use super::lifecycle::{read_worker_log_tail, worker_startup_failure_message};

    let (log_stdout, log_stderr) = open_worker_log(&paths.log)?;
    tracing::info!(
        launcher = %launcher,
        config_path = %paths.config.display(),
        log_path = %paths.log.display(),
        "Starting Proliferate Worker"
    );

    let mut command = launcher.command(&paths.config);
    command
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::from(log_stdout))
        .stderr(std::process::Stdio::from(log_stderr))
        .kill_on_drop(true);
    if let Some(path) = crate::sidecar::resolve_shell_path() {
        command.env("PATH", path);
    }

    let child = command.spawn().map_err(|error| {
        tracing::error!(launcher = %launcher, %error, "Failed to start Proliferate Worker");
        WorkerStartFailure::new(
            WorkerStartFailureKind::SpawnFailed,
            format!("Failed to start Proliferate Worker with {launcher}: {error}"),
        )
    })?;
    tracing::info!(
        launcher = %launcher,
        pid = child.id(),
        "Proliferate Worker spawned"
    );

    let mut process = CloudWorkerProcess {
        target_id,
        child,
        config_path: paths.config.clone(),
        observer_generation: 0,
    };
    let startup_deadline = Instant::now() + startup_watch_window(fresh_enrollment);
    match watch_startup(&mut process.child, startup_deadline).await {
        Ok(Some(status)) => {
            let log_tail = read_worker_log_tail(&paths.log, 12);
            let scrubbed_log_path =
                crate::diagnostics::scrub_diagnostic_text(&paths.log.to_string_lossy());
            tracing::error!(
                launcher = %launcher,
                %status,
                log_path = %scrubbed_log_path,
                log_tail = %log_tail,
                "Proliferate Worker exited during startup"
            );
            Err(WorkerStartFailure::new(
                WorkerStartFailureKind::EarlyExit,
                worker_startup_failure_message(&status.to_string(), &paths.log, &log_tail),
            ))
        }
        Ok(None) => Ok(WorkerLaunchOutcome::Started(process)),
        Err(failure) => Ok(retained_after_startup_inspection(process, failure)),
    }
}

/// Opens (and truncates) the worker log file, returning independent handles
/// for the child's stdout and stderr so both streams land in the same file.
#[cfg(not(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
)))]
fn open_worker_log(path: &std::path::Path) -> Result<(std::fs::File, std::fs::File), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;
    }
    let file = std::fs::File::create(path)
        .map_err(|error| format!("Failed to open worker log at {}: {error}", path.display()))?;
    super::set_private_file_permissions(path)?;
    let clone = file
        .try_clone()
        .map_err(|error| format!("Failed to open worker log at {}: {error}", path.display()))?;
    Ok((file, clone))
}

async fn watch_startup(
    child: &mut Child,
    deadline: Instant,
) -> Result<Option<std::process::ExitStatus>, WorkerStartFailure> {
    loop {
        if let Some(status) = child.try_wait().map_err(|error| {
            WorkerStartFailure::new(
                WorkerStartFailureKind::InspectionFailed,
                format!("Failed to inspect Proliferate Worker startup: {error}"),
            )
        })? {
            return Ok(Some(status));
        }
        if Instant::now() >= deadline {
            return Ok(None);
        }
        sleep(Duration::from_millis(100)).await;
    }
}
