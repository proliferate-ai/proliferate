use std::collections::HashMap;
use std::path::{Path, PathBuf};

use super::npm::platform_binary_filename;
use super::{InstallError, InstalledArtifactResult};
use crate::domains::agents::installer::seed;
use crate::domains::agents::model::*;
use crate::domains::agents::readiness::paths::artifact_root;
use crate::domains::agents::registry::built_in_registry;
use crate::integrations::agent_cli::executable::is_valid_executable;
use crate::integrations::agent_cli::launcher::generate_launcher_script;

pub(super) fn regenerate_seeded_agent_launchers(
    runtime_home: &Path,
    seeded_agents: &[String],
) -> Result<Vec<InstalledArtifactResult>, InstallError> {
    let registry = built_in_registry();
    let mut regenerated = Vec::new();
    for agent in seeded_agents {
        let Some(kind) = AgentKind::parse(agent) else {
            continue;
        };
        let Some(descriptor) = registry.iter().find(|descriptor| descriptor.kind == kind) else {
            continue;
        };
        if let Some(result) = regenerate_agent_process_launcher(descriptor, runtime_home)? {
            regenerated.push(result);
        }
    }
    Ok(regenerated)
}

fn regenerate_agent_process_launcher(
    descriptor: &AgentDescriptor,
    runtime_home: &Path,
) -> Result<Option<InstalledArtifactResult>, InstallError> {
    let kind = &descriptor.kind;
    let managed_dir = artifact_root(runtime_home, kind, &ArtifactRole::AgentProcess);
    let launcher_path = managed_dir.join(format!("{}-launcher", kind.as_str()));
    let path_prefixes = launcher_path_prefixes(runtime_home, kind);
    let env = managed_launcher_env(kind);

    let (executable_relpath, source_build_binary_name) = match &descriptor.agent_process.install {
        AgentProcessInstallSpec::ManagedNpmPackage {
            executable_relpath,
            source_build_binary_name,
            ..
        } => (executable_relpath, source_build_binary_name),
        AgentProcessInstallSpec::RegistryBacked {
            fallback:
                AgentProcessFallback::NpmPackage {
                    executable_relpath,
                    source_build_binary_name,
                    ..
                },
            ..
        } => (executable_relpath, source_build_binary_name),
        _ => return Ok(None),
    };

    // Mirror the managed-npm exec-path resolution: source-built binaries live at
    // the managed dir root, not under node_modules. Fall back to the
    // node_modules layout rather than failing the whole seed apply.
    let mut exec_candidates = Vec::new();
    if let Some(binary_name) = source_build_binary_name {
        exec_candidates.push(managed_dir.join(platform_binary_filename(binary_name)));
    }
    exec_candidates.push(managed_dir.join(executable_relpath));
    let Some(exec_path) = exec_candidates.iter().find(|path| path.exists()).cloned() else {
        return Err(InstallError::MissingManagedArtifact(
            exec_candidates.remove(0),
        ));
    };

    generate_launcher_script(&launcher_path, &exec_path, &[], &env, &path_prefixes)?;
    Ok(Some(InstalledArtifactResult {
        role: ArtifactRole::AgentProcess,
        path: launcher_path,
        source: "seed_launcher".into(),
        version: None,
    }))
}

pub(super) fn launcher_path_prefixes(runtime_home: &Path, kind: &AgentKind) -> Vec<PathBuf> {
    let mut prefixes = Vec::new();
    let managed_native_dir = artifact_root(runtime_home, kind, &ArtifactRole::NativeCli);
    let managed_native_binary = managed_native_dir.join(kind.as_str());
    if is_valid_executable(&managed_native_binary) {
        prefixes.push(managed_native_dir);
    }
    if let Some(node_dir) = seed::bundled_node_bin_dir(runtime_home) {
        prefixes.push(node_dir);
    }
    prefixes
}

pub(super) fn managed_launcher_env(kind: &AgentKind) -> HashMap<String, String> {
    let mut env = HashMap::new();
    if *kind == AgentKind::Claude {
        env.insert("DISABLE_AUTOUPDATER".into(), "1".into());
    }
    env
}
