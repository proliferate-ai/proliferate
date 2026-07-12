//! Locates a runnable Proliferate Worker binary (packaged sidecar, dev build,
//! PATH, or `cargo run` fallback) for the dispatch-worker commands.

use std::{
    fmt,
    path::{Path, PathBuf},
};

use tokio::process::Command;

use crate::agent_seed_env::current_target_triple;

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
                command
            }
        }
    }
}

impl fmt::Display for WorkerLauncher {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Binary(binary) => write!(f, "{}", binary.display()),
            Self::CargoRun {
                cargo,
                workspace_root,
            } => write!(
                f,
                "{} run -p proliferate-worker from {}",
                cargo.display(),
                workspace_root.display()
            ),
        }
    }
}

pub(super) fn find_proliferate_worker_launcher() -> Option<WorkerLauncher> {
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

    select_worker_launcher(explicit, debug_cargo, find_scanned_worker_launcher)
}

/// Preserves an explicit developer override while ensuring debug builds run the
/// worker from the current checkout instead of silently selecting a stale
/// target/debug or PATH binary. Release builds pass no cargo launcher and keep
/// the packaged/scanned binary behavior.
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

    if let Ok(path) = which::which("proliferate-worker") {
        if let Some(path) = usable_worker_binary(&path) {
            return Some(WorkerLauncher::Binary(path));
        }
    }

    None
}

/// Canonicalizes a candidate worker binary so the spawned path is absolute and
/// independent of the app process working directory. Returns `None` when the
/// candidate does not exist or is a placeholder sidecar.
fn usable_worker_binary(candidate: &Path) -> Option<PathBuf> {
    let path = candidate.canonicalize().ok()?;
    if is_usable_worker_binary(&path) {
        Some(path)
    } else {
        None
    }
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
                .join("proliferate-worker"),
        );
        candidates.push(
            repo.join("target")
                .join(&target)
                .join("release")
                .join("proliferate-worker"),
        );
        candidates.push(repo.join("target").join("debug").join("proliferate-worker"));
        candidates.push(
            repo.join("target")
                .join("release")
                .join("proliferate-worker"),
        );
    }
    candidates
}

fn workspace_root() -> Option<PathBuf> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let root = manifest_dir.join("../../..").canonicalize().ok()?;
    if root.join("Cargo.toml").is_file() {
        Some(root)
    } else {
        None
    }
}

fn is_usable_worker_binary(path: &Path) -> bool {
    path.is_file() && !is_placeholder_sidecar(path)
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
    use std::{cell::Cell, path::PathBuf};

    use super::{select_worker_launcher, WorkerLauncher};

    fn binary(path: &str) -> WorkerLauncher {
        WorkerLauncher::Binary(PathBuf::from(path))
    }

    fn cargo_run() -> WorkerLauncher {
        WorkerLauncher::CargoRun {
            cargo: PathBuf::from("/toolchain/cargo"),
            workspace_root: PathBuf::from("/workspace"),
        }
    }

    #[test]
    fn explicit_binary_wins_without_scanning() {
        let scanned = Cell::new(false);
        let launcher = select_worker_launcher(Some(binary("/explicit")), Some(cargo_run()), || {
            scanned.set(true);
            Some(binary("/scanned"))
        });

        assert!(
            matches!(launcher, Some(WorkerLauncher::Binary(path)) if path == PathBuf::from("/explicit"))
        );
        assert!(!scanned.get());
    }

    #[test]
    fn debug_cargo_wins_over_scanned_binaries() {
        let scanned = Cell::new(false);
        let launcher = select_worker_launcher(None, Some(cargo_run()), || {
            scanned.set(true);
            Some(binary("/stale-target-debug"))
        });

        assert!(matches!(launcher, Some(WorkerLauncher::CargoRun { .. })));
        assert!(!scanned.get());
    }

    #[test]
    fn scanned_binary_is_used_when_cargo_run_is_unavailable() {
        let launcher = select_worker_launcher(None, None, || Some(binary("/packaged")));

        assert!(
            matches!(launcher, Some(WorkerLauncher::Binary(path)) if path == PathBuf::from("/packaged"))
        );
    }
}
