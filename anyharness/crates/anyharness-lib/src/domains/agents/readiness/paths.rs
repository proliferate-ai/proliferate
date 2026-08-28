use std::path::{Path, PathBuf};

use crate::domains::agents::model::{AgentKind, ArtifactRole};
use crate::integrations::agent_cli::executable::{is_valid_executable, platform_binary_filename};

pub(crate) fn artifact_root(runtime_home: &Path, kind: &AgentKind, role: &ArtifactRole) -> PathBuf {
    runtime_home
        .join("agents")
        .join(kind.as_str())
        .join(match role {
            ArtifactRole::NativeCli => "native",
            ArtifactRole::AgentProcess => "agent_process",
        })
}

/// Where a pinned `Binary`/`Archive` artifact for `kind`/`role` lives once
/// installed, correctly named for this platform (`claude` on unix,
/// `claude.exe` on Windows).
///
/// The installer places the artifact here and every resolver looks for it
/// here. Both go through this function on purpose: the previous split, where
/// the write site and the read sites each spelled `join(kind.as_str())`
/// themselves, is exactly what let the Windows `.exe` suffix go missing on one
/// side without the other noticing.
pub(crate) fn managed_pinned_binary_path(
    runtime_home: &Path,
    kind: &AgentKind,
    role: &ArtifactRole,
) -> PathBuf {
    artifact_root(runtime_home, kind, role).join(platform_binary_filename(kind.as_str()))
}

pub(crate) fn managed_registry_binary_for_names(
    runtime_home: &Path,
    kind: &AgentKind,
    expected_names: &[&str],
) -> Option<PathBuf> {
    let storage =
        artifact_root(runtime_home, kind, &ArtifactRole::AgentProcess).join("registry_binary");
    find_executable_by_name(&storage, expected_names)
}

/// The pre-#723 managed npm layout (`agent_process/registry_npm/node_modules/
/// .bin/`). No installer writes it any more; readers keep it only so a tree
/// installed before the lockfile-installer landed still resolves.
pub(crate) fn managed_registry_npm_binary_for_names(
    runtime_home: &Path,
    kind: &AgentKind,
    expected_names: &[&str],
) -> Option<PathBuf> {
    let storage = artifact_root(runtime_home, kind, &ArtifactRole::AgentProcess)
        .join("registry_npm")
        .join("node_modules")
        .join(".bin");
    find_executable_by_name(&storage, expected_names)
}

/// The CURRENT managed npm layout: `install_managed_npm_package` runs
/// `npm install --prefix <agent_process dir> <package>`, so the package's own
/// bin shims land at `agent_process/node_modules/.bin/<name>` beside the
/// generated `<kind>-launcher`. The launcher bakes the ACP args (`agent
/// stdio`), so an interactive vendor command such as `login` must exec the
/// shim itself — this is the rung that finds it.
pub(crate) fn managed_npm_binary_for_names(
    runtime_home: &Path,
    kind: &AgentKind,
    expected_names: &[&str],
) -> Option<PathBuf> {
    let storage = artifact_root(runtime_home, kind, &ArtifactRole::AgentProcess)
        .join("node_modules")
        .join(".bin");
    find_executable_by_name(&storage, expected_names)
}

pub(crate) fn has_managed_registry_binary_for_names(
    runtime_home: &Path,
    kind: &AgentKind,
    expected_names: &[String],
) -> bool {
    let expected_names = expected_names
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>();
    managed_registry_binary_for_names(runtime_home, kind, &expected_names).is_some()
}

fn find_executable_by_name(dir: &Path, expected_names: &[&str]) -> Option<PathBuf> {
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_executable_by_name(&path, expected_names) {
                return Some(found);
            }
            continue;
        }
        if !is_valid_executable(&path) {
            continue;
        }
        if path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| expected_names.iter().any(|expected| expected == &name))
        {
            return Some(path);
        }
    }
    None
}
