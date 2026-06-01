use std::path::{Path, PathBuf};

use crate::domains::agents::model::{AgentKind, ArtifactRole};
use crate::integrations::agent_cli::executable::is_valid_executable;

pub(crate) fn artifact_root(runtime_home: &Path, kind: &AgentKind, role: &ArtifactRole) -> PathBuf {
    runtime_home
        .join("agents")
        .join(kind.as_str())
        .join(match role {
            ArtifactRole::NativeCli => "native",
            ArtifactRole::AgentProcess => "agent_process",
        })
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
