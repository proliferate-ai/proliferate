//! Accepted-base Worker resolution for targets without the protected bridge.
//!
//! Unsupported targets keep their prior binary/PATH/`cargo run` launch and
//! legacy `worker.log` behavior. They never create or inherit PR 5 protected
//! descriptors.

use std::{
    convert::Infallible,
    fmt,
    path::{Path, PathBuf},
};

use tokio::process::Command;

use crate::agent_seed_env::current_target_triple;

const DESKTOP_DEV_CARGO_RUNNER_ENV_VARS: [&str; 2] = [
    "CARGO_TARGET_AARCH64_APPLE_DARWIN_RUNNER",
    "CARGO_TARGET_X86_64_APPLE_DARWIN_RUNNER",
];

pub(super) enum WorkerLauncher {
    Binary(PathBuf),
    CargoRun {
        cargo: PathBuf,
        workspace_root: PathBuf,
    },
}

impl WorkerLauncher {
    pub(super) fn command(&self, config_path: &Path) -> Command {
        match self {
            Self::Binary(binary) => {
                let mut command = Command::new(binary);
                command.arg("--config").arg(config_path);
                command
            }
            Self::CargoRun {
                cargo,
                workspace_root,
            } => {
                let mut command = Command::new(cargo);
                command
                    .current_dir(workspace_root)
                    .arg("run")
                    .arg("-p")
                    .arg("proliferate-worker")
                    .arg("--")
                    .arg("--config")
                    .arg(config_path);
                for env_var in DESKTOP_DEV_CARGO_RUNNER_ENV_VARS {
                    command.env_remove(env_var);
                }
                command
            }
        }
    }
}

impl fmt::Display for WorkerLauncher {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Binary(binary) => write!(formatter, "{}", binary.display()),
            Self::CargoRun {
                cargo,
                workspace_root,
            } => write!(
                formatter,
                "{} run -p proliferate-worker from {}",
                cargo.display(),
                workspace_root.display()
            ),
        }
    }
}

pub(super) enum LegacyOverrideRejection {}

impl LegacyOverrideRejection {
    pub(super) fn as_str(&self) -> &'static str {
        match *self {}
    }
}

pub(super) struct WorkerLauncherSelection {
    pub(super) launcher: Option<WorkerLauncher>,
    pub(super) invalid_override: Option<LegacyOverrideRejection>,
}

pub(super) type WorkerLauncherError = Infallible;

pub(super) async fn prepare_proliferate_worker_launcher(
) -> Result<WorkerLauncherSelection, WorkerLauncherError> {
    let explicit = std::env::var("PROLIFERATE_WORKER_BIN")
        .ok()
        .and_then(|value| usable_worker_binary(&PathBuf::from(value)))
        .map(WorkerLauncher::Binary);
    let debug_cargo = if cfg!(debug_assertions) {
        match (which::which("cargo").ok(), workspace_root()) {
            (Some(cargo), Some(workspace_root)) => Some(WorkerLauncher::CargoRun {
                cargo,
                workspace_root,
            }),
            _ => None,
        }
    } else {
        None
    };
    Ok(WorkerLauncherSelection {
        launcher: select_worker_launcher(explicit, debug_cargo, find_scanned_worker_launcher),
        invalid_override: None,
    })
}

fn select_worker_launcher(
    explicit: Option<WorkerLauncher>,
    debug_cargo: Option<WorkerLauncher>,
    scan: impl FnOnce() -> Option<WorkerLauncher>,
) -> Option<WorkerLauncher> {
    explicit.or(debug_cargo).or_else(scan)
}

fn find_scanned_worker_launcher() -> Option<WorkerLauncher> {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            let target = current_target_triple();
            for candidate in [
                exe_dir.join(format!("proliferate-worker-{target}")),
                exe_dir.join("proliferate-worker"),
            ] {
                if let Some(path) = usable_worker_binary(&candidate) {
                    return Some(WorkerLauncher::Binary(path));
                }
            }
        }
    }
    for candidate in development_worker_candidates() {
        if let Some(path) = usable_worker_binary(&candidate) {
            return Some(WorkerLauncher::Binary(path));
        }
    }
    which::which("proliferate-worker")
        .ok()
        .and_then(|path| usable_worker_binary(&path))
        .map(WorkerLauncher::Binary)
}

fn usable_worker_binary(candidate: &Path) -> Option<PathBuf> {
    let path = candidate.canonicalize().ok()?;
    (path.is_file() && !is_placeholder_sidecar(&path)).then_some(path)
}

fn development_worker_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    let target = current_target_triple();
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    for repo in [
        manifest_dir.join("../../.."),
        manifest_dir.join("../../anyharness"),
        manifest_dir.join("../../../anyharness"),
    ] {
        for profile in ["debug", "release"] {
            candidates.push(
                repo.join("target")
                    .join(target)
                    .join(profile)
                    .join("proliferate-worker"),
            );
            candidates.push(repo.join("target").join(profile).join("proliferate-worker"));
        }
    }
    candidates
}

fn workspace_root() -> Option<PathBuf> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let root = manifest_dir.join("../../..").canonicalize().ok()?;
    root.join("Cargo.toml").is_file().then_some(root)
}

fn is_placeholder_sidecar(path: &Path) -> bool {
    let Ok(bytes) = std::fs::read(path) else {
        return false;
    };
    let text = String::from_utf8_lossy(&bytes);
    text.contains("sidecar is not available") || text.contains("unsupported target placeholder")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unsupported_debug_target_preserves_cargo_run_precedence() {
        let selected = select_worker_launcher(
            Some(WorkerLauncher::Binary(PathBuf::from("/explicit"))),
            Some(WorkerLauncher::CargoRun {
                cargo: PathBuf::from("/cargo"),
                workspace_root: PathBuf::from("/workspace"),
            }),
            || Some(WorkerLauncher::Binary(PathBuf::from("/scanned"))),
        );
        assert!(
            matches!(selected, Some(WorkerLauncher::Binary(path)) if path == Path::new("/explicit"))
        );

        let selected = select_worker_launcher(
            None,
            Some(WorkerLauncher::CargoRun {
                cargo: PathBuf::from("/cargo"),
                workspace_root: PathBuf::from("/workspace"),
            }),
            || Some(WorkerLauncher::Binary(PathBuf::from("/scanned"))),
        );
        assert!(matches!(selected, Some(WorkerLauncher::CargoRun { .. })));
    }
}
