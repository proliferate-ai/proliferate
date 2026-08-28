//! Resolves a direct Proliferate Worker executable for Desktop-owned launches.
//!
//! Debug preparation may build the current checkout, but it completes before
//! this module returns. Callers must create protected child descriptors only
//! after `prepare_proliferate_worker_launcher` succeeds.

use std::{
    fmt,
    path::{Path, PathBuf},
    process::ExitStatus,
};

use serde_json::Value;
use tokio::{
    io::AsyncReadExt,
    process::{Child, Command},
};

use crate::agent_seed_env::current_target_triple;
use crate::diagnostics_collector::child_bridge::native_image::{
    canonical_current_target_executable, NativeImageRejection,
};
#[cfg(test)]
use crate::diagnostics_collector::child_bridge::native_image::{
    is_elf_image, is_macho_image, is_pe_image, ELF_MACHINE_AARCH64, ELF_MACHINE_X86_64,
    MACHO_CPU_TYPE_ARM64, MACHO_CPU_TYPE_X86_64, MACHO_FAT_MAGIC_64_BE, MACHO_FAT_MAGIC_BE,
    PE_MACHINE_ARM64, PE_MACHINE_X86_64,
};

const WORKER_PACKAGE: &str = "proliferate-worker";
const WORKER_BINARY: &str = "proliferate-worker";
const WORKER_MANIFEST: &str = "anyharness/crates/proliferate-worker/Cargo.toml";
const MAX_CARGO_JSON_OUTPUT_BYTES: usize = 16 * 1024 * 1024;

const CARGO_STDOUT_CHUNK_BYTES: usize = 8192;

const DESKTOP_DEV_CARGO_RUNNER_ENV_VARS: [&str; 2] = [
    "CARGO_TARGET_AARCH64_APPLE_DARWIN_RUNNER",
    "CARGO_TARGET_X86_64_APPLE_DARWIN_RUNNER",
];

/// A canonical native executable. This type cannot represent `cargo run`, a
/// shell command, a script, or a wrapper plus arguments.
#[derive(Debug)]
pub(super) struct WorkerLauncher {
    executable: PathBuf,
}

impl WorkerLauncher {
    fn from_candidate(candidate: &Path) -> Result<Self, CandidateRejection> {
        let executable =
            canonical_current_target_executable(candidate).map_err(|error| match error {
                NativeImageRejection::Unavailable => CandidateRejection::Unavailable,
                NativeImageRejection::NotRegularFile => CandidateRejection::NotRegularFile,
                NativeImageRejection::NotExecutable => CandidateRejection::NotExecutable,
                NativeImageRejection::ImageFormatUnsupported => {
                    CandidateRejection::ImageFormatUnsupported
                }
            })?;
        Ok(Self { executable })
    }

    pub(super) fn command(&self, config_path: &Path) -> Command {
        let mut command = Command::new(&self.executable);
        command.arg("--config").arg(config_path);
        command
    }

    pub(super) fn executable(&self) -> &Path {
        &self.executable
    }
}

impl fmt::Display for WorkerLauncher {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.executable.display())
    }
}

/// Closed, non-secret reason a candidate executable was rejected. It carries
/// no path or error prose, so callers can log or count it directly.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum CandidateRejection {
    Unavailable,
    NotRegularFile,
    NotExecutable,
    ImageFormatUnsupported,
}

impl CandidateRejection {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::Unavailable => "unavailable",
            Self::NotRegularFile => "not_regular_file",
            Self::NotExecutable => "not_executable",
            Self::ImageFormatUnsupported => "image_format_unsupported",
        }
    }
}

/// Selection outcome. `invalid_override` reports, as a closed classification,
/// a `PROLIFERATE_WORKER_BIN` override that was present but rejected before
/// the debug/scan fallbacks ran.
#[derive(Debug)]
pub(super) struct WorkerLauncherSelection {
    pub(super) launcher: Option<WorkerLauncher>,
    pub(super) invalid_override: Option<CandidateRejection>,
}

#[derive(Debug)]
pub(super) enum WorkerLauncherError {
    DebugManifestUnavailable,
    DebugBuildStart(std::io::Error),
    DebugBuildFailed(ExitStatus),
    DebugBuildInterrupted,
    CargoOutputTooLarge,
    CargoOutputInvalid,
    CargoArtifactMissing,
    CargoArtifactAmbiguous,
    ExecutableRejected(CandidateRejection),
}

impl fmt::Display for WorkerLauncherError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let build = "Proliferate Worker debug build";
        match self {
            Self::DebugManifestUnavailable => write!(
                f,
                "Proliferate Worker debug manifest {WORKER_MANIFEST} is unavailable"
            ),
            Self::DebugBuildStart(error) => write!(f, "Failed to start the {build}: {error}"),
            Self::DebugBuildFailed(status) => write!(f, "{build} failed with {status}"),
            Self::DebugBuildInterrupted => write!(f, "{build} output could not be read"),
            Self::CargoOutputTooLarge => write!(f, "{build} output exceeded its bound"),
            Self::CargoOutputInvalid => write!(f, "{build} returned invalid Cargo JSON"),
            Self::CargoArtifactMissing => write!(f, "{build} returned no exact executable"),
            Self::CargoArtifactAmbiguous => write!(f, "{build} returned multiple executables"),
            Self::ExecutableRejected(rejection) => write!(
                f,
                "Proliferate Worker executable candidate was rejected: {}",
                rejection.as_str()
            ),
        }
    }
}

impl std::error::Error for WorkerLauncherError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::DebugBuildStart(error) => Some(error),
            _ => None,
        }
    }
}

/// Resolves a direct executable. In debug builds the current-checkout build is
/// completed here; the returned command never points at Cargo.
pub(super) async fn prepare_proliferate_worker_launcher(
) -> Result<WorkerLauncherSelection, WorkerLauncherError> {
    let explicit = std::env::var_os("PROLIFERATE_WORKER_BIN").map(PathBuf::from);
    let debug_build = if cfg!(debug_assertions) {
        match (which::which("cargo").ok(), workspace_root()) {
            (Some(cargo), Some(workspace_root)) => Some(DebugBuild {
                cargo,
                workspace_root,
            }),
            _ => None,
        }
    } else {
        None
    };

    select_worker_launcher(
        explicit,
        debug_build,
        &SystemCargoBuildRunner,
        find_scanned_worker_launcher,
    )
    .await
}

struct DebugBuild {
    cargo: PathBuf,
    workspace_root: PathBuf,
}

trait CargoBuildRunner {
    fn command(&self, cargo: &Path, workspace_root: &Path) -> Command;
}

struct SystemCargoBuildRunner;

impl CargoBuildRunner for SystemCargoBuildRunner {
    fn command(&self, cargo: &Path, workspace_root: &Path) -> Command {
        cargo_build_command(cargo, workspace_root)
    }
}

fn cargo_build_command(cargo: &Path, workspace_root: &Path) -> Command {
    let mut command = Command::new(cargo);
    command
        .current_dir(workspace_root)
        .arg("build")
        .arg("--locked")
        .arg("--package")
        .arg(WORKER_PACKAGE)
        .arg("--bin")
        .arg(WORKER_BINARY)
        .arg("--message-format=json")
        .arg("--color=never")
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::inherit())
        .kill_on_drop(true);
    for env_var in DESKTOP_DEV_CARGO_RUNNER_ENV_VARS {
        command.env_remove(env_var);
    }
    command
}

async fn select_worker_launcher<R, F>(
    explicit: Option<PathBuf>,
    debug_build: Option<DebugBuild>,
    runner: &R,
    scan: F,
) -> Result<WorkerLauncherSelection, WorkerLauncherError>
where
    R: CargoBuildRunner,
    F: FnOnce() -> Option<WorkerLauncher>,
{
    let mut invalid_override = None;
    if let Some(candidate) = explicit.as_deref() {
        match WorkerLauncher::from_candidate(candidate) {
            Ok(launcher) => {
                return Ok(WorkerLauncherSelection {
                    launcher: Some(launcher),
                    invalid_override: None,
                })
            }
            Err(rejection) => invalid_override = Some(rejection),
        }
    }

    if let Some(debug_build) = debug_build {
        let launcher = prepare_debug_worker(debug_build, runner).await?;
        return Ok(WorkerLauncherSelection {
            launcher: Some(launcher),
            invalid_override,
        });
    }

    Ok(WorkerLauncherSelection {
        launcher: scan(),
        invalid_override,
    })
}

async fn prepare_debug_worker<R: CargoBuildRunner>(
    debug_build: DebugBuild,
    runner: &R,
) -> Result<WorkerLauncher, WorkerLauncherError> {
    let expected_manifest = debug_build
        .workspace_root
        .join(WORKER_MANIFEST)
        .canonicalize()
        .map_err(|_| WorkerLauncherError::DebugManifestUnavailable)?;
    let mut command = runner.command(&debug_build.cargo, &debug_build.workspace_root);
    command.stdout(std::process::Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(WorkerLauncherError::DebugBuildStart)?;
    let stdout = collect_bounded_child_stdout(&mut child, MAX_CARGO_JSON_OUTPUT_BYTES).await?;
    let status = child
        .wait()
        .await
        .map_err(|_| WorkerLauncherError::DebugBuildInterrupted)?;
    if !status.success() {
        return Err(WorkerLauncherError::DebugBuildFailed(status));
    }

    let artifact = exact_worker_artifact(&stdout, &expected_manifest)?;
    WorkerLauncher::from_candidate(&artifact).map_err(WorkerLauncherError::ExecutableRejected)
}

/// Reads the child's piped stdout in fixed chunks while the child runs; on
/// reaching `max_bytes` the child is killed and reaped before returning.
async fn collect_bounded_child_stdout(
    child: &mut Child,
    max_bytes: usize,
) -> Result<Vec<u8>, WorkerLauncherError> {
    let Some(mut stdout) = child.stdout.take() else {
        return Err(WorkerLauncherError::DebugBuildInterrupted);
    };
    let mut collected = Vec::new();
    let mut chunk = [0_u8; CARGO_STDOUT_CHUNK_BYTES];
    loop {
        let read = match stdout.read(&mut chunk).await {
            Ok(0) => return Ok(collected),
            Ok(read) => read,
            Err(_) => {
                kill_and_reap(child).await;
                return Err(WorkerLauncherError::DebugBuildInterrupted);
            }
        };
        if collected.len() + read > max_bytes {
            kill_and_reap(child).await;
            return Err(WorkerLauncherError::CargoOutputTooLarge);
        }
        collected.extend_from_slice(&chunk[..read]);
    }
}

async fn kill_and_reap(child: &mut Child) {
    let _ = child.start_kill();
    let _ = child.wait().await;
}

fn exact_worker_artifact(
    cargo_stdout: &[u8],
    expected_manifest: &Path,
) -> Result<PathBuf, WorkerLauncherError> {
    let mut artifact = None;
    for line in cargo_stdout.split(|byte| *byte == b'\n') {
        let line = trim_ascii(line);
        if line.first() != Some(&b'{') {
            continue;
        }
        let message: Value =
            serde_json::from_slice(line).map_err(|_| WorkerLauncherError::CargoOutputInvalid)?;
        let Some(candidate) = exact_artifact_from_message(&message, expected_manifest)? else {
            continue;
        };
        if artifact.replace(candidate).is_some() {
            return Err(WorkerLauncherError::CargoArtifactAmbiguous);
        }
    }
    artifact.ok_or(WorkerLauncherError::CargoArtifactMissing)
}

fn exact_artifact_from_message(
    message: &Value,
    expected_manifest: &Path,
) -> Result<Option<PathBuf>, WorkerLauncherError> {
    if message.get("reason").and_then(Value::as_str) != Some("compiler-artifact") {
        return Ok(None);
    }
    let Some(target) = message.get("target") else {
        return Ok(None);
    };
    let exact_name = target.get("name").and_then(Value::as_str) == Some(WORKER_BINARY);
    let exact_kind = target
        .get("kind")
        .and_then(Value::as_array)
        .is_some_and(|kinds| {
            kinds.len() == 1 && kinds.first().and_then(Value::as_str) == Some("bin")
        });
    if !exact_name || !exact_kind {
        return Ok(None);
    }

    let manifest = message
        .get("manifest_path")
        .and_then(Value::as_str)
        .ok_or(WorkerLauncherError::CargoOutputInvalid)?;
    let manifest = Path::new(manifest)
        .canonicalize()
        .map_err(|_| WorkerLauncherError::CargoOutputInvalid)?;
    if manifest != expected_manifest {
        return Ok(None);
    }

    let executable = message
        .get("executable")
        .and_then(Value::as_str)
        .ok_or(WorkerLauncherError::CargoOutputInvalid)?;
    Ok(Some(PathBuf::from(executable)))
}

fn trim_ascii(mut bytes: &[u8]) -> &[u8] {
    while bytes.first().is_some_and(u8::is_ascii_whitespace) {
        bytes = &bytes[1..];
    }
    while bytes.last().is_some_and(u8::is_ascii_whitespace) {
        bytes = &bytes[..bytes.len() - 1];
    }
    bytes
}

fn find_scanned_worker_launcher() -> Option<WorkerLauncher> {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            let target = current_target_triple();
            for candidate in [
                exe_dir.join(format!("proliferate-worker-{target}")),
                exe_dir.join(WORKER_BINARY),
            ] {
                if let Some(launcher) = usable_worker_launcher(&candidate) {
                    return Some(launcher);
                }
            }
        }
    }

    for candidate in development_worker_candidates() {
        if let Some(launcher) = usable_worker_launcher(&candidate) {
            return Some(launcher);
        }
    }

    which::which(WORKER_BINARY)
        .ok()
        .and_then(|path| usable_worker_launcher(&path))
}

fn usable_worker_launcher(candidate: &Path) -> Option<WorkerLauncher> {
    WorkerLauncher::from_candidate(candidate).ok()
}

fn development_worker_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    let target = current_target_triple();
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repos = [
        manifest_dir.join("../../.."),
        manifest_dir.join("../../anyharness"),
        manifest_dir.join("../../../anyharness"),
    ];
    for repo in repos {
        candidates.push(
            repo.join("target")
                .join(target)
                .join("debug")
                .join(WORKER_BINARY),
        );
        candidates.push(
            repo.join("target")
                .join(target)
                .join("release")
                .join(WORKER_BINARY),
        );
        candidates.push(repo.join("target").join("debug").join(WORKER_BINARY));
        candidates.push(repo.join("target").join("release").join(WORKER_BINARY));
    }
    candidates
}

fn workspace_root() -> Option<PathBuf> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let root = manifest_dir.join("../../..").canonicalize().ok()?;
    root.join("Cargo.toml").is_file().then_some(root)
}

#[cfg(test)]
#[path = "launcher_tests.rs"]
mod tests;
