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
    if let Ok(value) = std::env::var("PROLIFERATE_WORKER_BIN") {
        if let Some(path) = usable_worker_binary(&PathBuf::from(value)) {
            return Some(WorkerLauncher::Binary(path));
        }
    }

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

    if cfg!(debug_assertions) {
        if let (Some(cargo), Some(workspace_root)) = (which::which("cargo").ok(), workspace_root())
        {
            return Some(WorkerLauncher::CargoRun {
                cargo,
                workspace_root,
            });
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
