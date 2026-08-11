//! Resolves a direct Proliferate Worker executable for Desktop-owned launches.
//!
//! Debug preparation may build the current checkout, but it completes before
//! this module returns. Callers must create protected child descriptors only
//! after `prepare_proliferate_worker_launcher` succeeds.

use std::{
    fmt,
    fs::File,
    io::Read,
    path::{Path, PathBuf},
    process::ExitStatus,
};

use serde_json::Value;
use tokio::process::Command;

use crate::agent_seed_env::current_target_triple;

const WORKER_PACKAGE: &str = "proliferate-worker";
const WORKER_BINARY: &str = "proliferate-worker";
const WORKER_MANIFEST: &str = "anyharness/crates/proliferate-worker/Cargo.toml";
const MAX_CARGO_JSON_OUTPUT_BYTES: usize = 16 * 1024 * 1024;

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
    fn from_candidate(candidate: &Path) -> Result<Self, WorkerLauncherError> {
        let executable = candidate.canonicalize().map_err(|source| {
            WorkerLauncherError::ExecutableUnavailable {
                candidate: candidate.to_path_buf(),
                source,
            }
        })?;
        let metadata =
            executable
                .metadata()
                .map_err(|source| WorkerLauncherError::ExecutableUnavailable {
                    candidate: executable.clone(),
                    source,
                })?;
        if !metadata.file_type().is_file()
            || !has_execute_permission(&metadata)
            || !has_native_executable_header(&executable)
        {
            return Err(WorkerLauncherError::ExecutableInvalid(executable));
        }
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

#[derive(Debug)]
pub(super) enum WorkerLauncherError {
    DebugBuildStart(std::io::Error),
    DebugBuildFailed(ExitStatus),
    CargoOutputTooLarge,
    CargoOutputInvalid,
    CargoArtifactMissing,
    CargoArtifactAmbiguous,
    ExecutableUnavailable {
        candidate: PathBuf,
        source: std::io::Error,
    },
    ExecutableInvalid(PathBuf),
}

impl fmt::Display for WorkerLauncherError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::DebugBuildStart(error) => {
                write!(
                    f,
                    "Failed to start the Proliferate Worker debug build: {error}"
                )
            }
            Self::DebugBuildFailed(status) => {
                write!(f, "Proliferate Worker debug build failed with {status}")
            }
            Self::CargoOutputTooLarge => {
                f.write_str("Proliferate Worker debug build output exceeded its bound")
            }
            Self::CargoOutputInvalid => {
                f.write_str("Proliferate Worker debug build returned invalid Cargo JSON")
            }
            Self::CargoArtifactMissing => {
                f.write_str("Proliferate Worker debug build returned no exact executable")
            }
            Self::CargoArtifactAmbiguous => {
                f.write_str("Proliferate Worker debug build returned multiple executables")
            }
            Self::ExecutableUnavailable { candidate, source } => write!(
                f,
                "Proliferate Worker executable {} is unavailable: {source}",
                candidate.display()
            ),
            Self::ExecutableInvalid(path) => write!(
                f,
                "Proliferate Worker executable {} is not a native regular executable",
                path.display()
            ),
        }
    }
}

impl std::error::Error for WorkerLauncherError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::DebugBuildStart(error) => Some(error),
            Self::ExecutableUnavailable { source, .. } => Some(source),
            _ => None,
        }
    }
}

/// Resolves a direct executable. In debug builds the current-checkout build is
/// completed here; the returned command never points at Cargo.
pub(super) async fn prepare_proliferate_worker_launcher(
) -> Result<Option<WorkerLauncher>, WorkerLauncherError> {
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
) -> Result<Option<WorkerLauncher>, WorkerLauncherError>
where
    R: CargoBuildRunner,
    F: FnOnce() -> Option<WorkerLauncher>,
{
    if let Some(launcher) = explicit
        .as_deref()
        .and_then(|candidate| WorkerLauncher::from_candidate(candidate).ok())
    {
        return Ok(Some(launcher));
    }

    if let Some(debug_build) = debug_build {
        return prepare_debug_worker(debug_build, runner).await.map(Some);
    }

    Ok(scan())
}

async fn prepare_debug_worker<R: CargoBuildRunner>(
    debug_build: DebugBuild,
    runner: &R,
) -> Result<WorkerLauncher, WorkerLauncherError> {
    let expected_manifest = debug_build
        .workspace_root
        .join(WORKER_MANIFEST)
        .canonicalize()
        .map_err(|source| WorkerLauncherError::ExecutableUnavailable {
            candidate: debug_build.workspace_root.join(WORKER_MANIFEST),
            source,
        })?;
    let output = runner
        .command(&debug_build.cargo, &debug_build.workspace_root)
        .output()
        .await
        .map_err(WorkerLauncherError::DebugBuildStart)?;
    if !output.status.success() {
        return Err(WorkerLauncherError::DebugBuildFailed(output.status));
    }
    if output.stdout.len() > MAX_CARGO_JSON_OUTPUT_BYTES {
        return Err(WorkerLauncherError::CargoOutputTooLarge);
    }

    let artifact = exact_worker_artifact(&output.stdout, &expected_manifest)?;
    WorkerLauncher::from_candidate(&artifact)
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
                .join(&target)
                .join("debug")
                .join(WORKER_BINARY),
        );
        candidates.push(
            repo.join("target")
                .join(&target)
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

fn has_native_executable_header(path: &Path) -> bool {
    let Ok(mut file) = File::open(path) else {
        return false;
    };
    let mut header = [0_u8; 4];
    let Ok(read) = file.read(&mut header) else {
        return false;
    };
    is_native_executable_header(&header[..read])
}

fn is_native_executable_header(header: &[u8]) -> bool {
    matches!(
        header,
        [0x7f, b'E', b'L', b'F', ..]
            | [b'M', b'Z', ..]
            | [0xfe, 0xed, 0xfa, 0xce, ..]
            | [0xfe, 0xed, 0xfa, 0xcf, ..]
            | [0xce, 0xfa, 0xed, 0xfe, ..]
            | [0xcf, 0xfa, 0xed, 0xfe, ..]
            | [0xca, 0xfe, 0xba, 0xbe, ..]
            | [0xca, 0xfe, 0xba, 0xbf, ..]
            | [0xbe, 0xba, 0xfe, 0xca, ..]
            | [0xbf, 0xba, 0xfe, 0xca, ..]
    )
}

#[cfg(unix)]
fn has_execute_permission(metadata: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;

    metadata.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn has_execute_permission(_metadata: &std::fs::Metadata) -> bool {
    true
}

#[cfg(test)]
#[path = "launcher_tests.rs"]
mod tests;
