use std::collections::HashMap;
use std::path::{Path, PathBuf};

use super::npm::install_managed_npm_package;
use super::{InstallError, InstallOptions, InstalledArtifactResult};
use crate::domains::agents::model::*;
use crate::domains::agents::readiness::paths::{
    artifact_root, has_managed_registry_binary_for_names,
};
use crate::domains::agents::registry::built_in_registry;
use crate::domains::agents::seed;
use crate::integrations::agent_cli::acp_registry::{self, ResolvedRegistryDistribution};
use crate::integrations::agent_cli::executable::{find_real_binary_in_path, is_valid_executable};
use crate::integrations::agent_cli::launcher::generate_launcher_script;

#[cfg(test)]
mod tests;

pub(super) fn is_agent_process_installable(spec: &AgentProcessInstallSpec) -> bool {
    matches!(
        spec,
        AgentProcessInstallSpec::RegistryBacked { .. }
            | AgentProcessInstallSpec::ManagedNpmPackage { .. }
    )
}

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

    let executable_relpath = match &descriptor.agent_process.install {
        AgentProcessInstallSpec::ManagedNpmPackage {
            executable_relpath, ..
        } => executable_relpath,
        AgentProcessInstallSpec::RegistryBacked {
            fallback:
                AgentProcessFallback::NpmPackage {
                    executable_relpath, ..
                },
            ..
        } => executable_relpath,
        _ => return Ok(None),
    };

    let exec_path = managed_dir.join(executable_relpath);
    if !exec_path.exists() {
        return Err(InstallError::MissingManagedArtifact(exec_path));
    }

    generate_launcher_script(&launcher_path, &exec_path, &[], &env, &path_prefixes)?;
    Ok(Some(InstalledArtifactResult {
        role: ArtifactRole::AgentProcess,
        path: launcher_path,
        source: "seed_launcher".into(),
        version: None,
    }))
}

pub(super) fn install_agent_process_artifact(
    spec: &AgentProcessArtifactSpec,
    kind: &AgentKind,
    _default_args: &[String],
    runtime_home: &Path,
    options: &InstallOptions,
) -> Result<Option<InstalledArtifactResult>, InstallError> {
    let managed_dir = artifact_root(runtime_home, kind, &ArtifactRole::AgentProcess);
    let launcher_path = managed_dir.join(format!("{}-launcher", kind.as_str()));
    let managed_native_binary =
        artifact_root(runtime_home, kind, &ArtifactRole::NativeCli).join(kind.as_str());
    let launcher_path_prefixes = launcher_path_prefixes(runtime_home, kind);
    let launcher_env = managed_launcher_env(kind);

    match &spec.install {
        AgentProcessInstallSpec::RegistryBacked {
            registry_id,
            fallback,
        } => {
            if should_skip_existing_agent_process_install(
                &spec.install,
                kind,
                runtime_home,
                &launcher_path,
                options.reinstall,
            ) {
                return Ok(None);
            }

            match install_from_registry(
                registry_id,
                &managed_dir,
                &launcher_path,
                options.agent_process_version.as_deref(),
                &[],
                &launcher_path_prefixes,
                &launcher_env,
            ) {
                Ok(result) => return Ok(Some(result)),
                Err(e) => {
                    tracing::warn!(
                        agent = kind.as_str(),
                        registry_id = registry_id,
                        error = %e,
                        "registry install failed, falling back to local install"
                    );
                }
            }

            install_agent_process_fallback(
                fallback,
                kind,
                &managed_dir,
                &launcher_path,
                options,
                &[],
                &launcher_path_prefixes,
                &launcher_env,
                if is_valid_executable(&managed_native_binary) {
                    Some(managed_native_binary)
                } else {
                    None
                },
            )
        }
        AgentProcessInstallSpec::ManagedNpmPackage {
            package,
            package_subdir,
            source_build_binary_name,
            executable_relpath,
        } => install_managed_npm_package(
            package,
            package_subdir.as_deref(),
            source_build_binary_name.as_deref(),
            executable_relpath,
            &managed_dir,
            &launcher_path,
            options.agent_process_version.as_deref(),
            options.reinstall,
            &[],
            &launcher_path_prefixes,
            &launcher_env,
            "managed_npm",
        ),
        AgentProcessInstallSpec::PathOnly { .. } | AgentProcessInstallSpec::Manual { .. } => {
            Ok(None)
        }
    }
}

fn launcher_path_prefixes(runtime_home: &Path, kind: &AgentKind) -> Vec<PathBuf> {
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

fn managed_launcher_env(kind: &AgentKind) -> HashMap<String, String> {
    let mut env = HashMap::new();
    if *kind == AgentKind::Claude {
        env.insert("DISABLE_AUTOUPDATER".into(), "1".into());
    }
    env
}

pub(super) fn should_skip_existing_agent_process_install(
    install: &AgentProcessInstallSpec,
    kind: &AgentKind,
    runtime_home: &Path,
    launcher_path: &Path,
    reinstall: bool,
) -> bool {
    if reinstall || !launcher_path.exists() {
        return false;
    }

    let AgentProcessInstallSpec::RegistryBacked { fallback, .. } = install else {
        return true;
    };
    let AgentProcessFallback::BinaryHint {
        candidate_binaries, ..
    } = fallback
    else {
        return true;
    };

    if !launcher_uses_binary_hint(launcher_path, candidate_binaries) {
        return true;
    }

    has_managed_registry_binary_for_names(runtime_home, kind, candidate_binaries)
        || candidate_binaries
            .iter()
            .any(|binary| find_real_binary_in_path(binary).is_some())
}

fn launcher_uses_binary_hint(launcher_path: &Path, candidate_binaries: &[String]) -> bool {
    let Ok(contents) = std::fs::read_to_string(launcher_path) else {
        return false;
    };
    candidate_binaries.iter().any(|binary| {
        contents.contains(&format!("exec \"{binary}\""))
            || contents.contains(&format!("exec {binary}"))
    })
}

fn install_from_registry(
    registry_id: &str,
    managed_dir: &Path,
    launcher_path: &Path,
    version_override: Option<&str>,
    launcher_args: &[String],
    path_prefixes: &[PathBuf],
    launcher_env: &HashMap<String, String>,
) -> Result<InstalledArtifactResult, InstallError> {
    let resolved = acp_registry::resolve_from_registry(registry_id, version_override)
        .map_err(|e| InstallError::RegistryFailed(e.to_string()))?;

    std::fs::create_dir_all(managed_dir)?;

    match resolved {
        ResolvedRegistryDistribution::Npx {
            package,
            args,
            env,
            version,
        } => {
            let storage = managed_dir.join("registry_npm");
            if storage.exists() {
                let _ = std::fs::remove_dir_all(&storage);
            }
            acp_registry::install_npm_package(&storage, &package).map_err(|e| {
                InstallError::CommandFailed {
                    program: "npm".into(),
                    message: e,
                }
            })?;

            let bin_hint = registry_id.strip_suffix("-acp").unwrap_or(registry_id);
            let bin_name = format!("{bin_hint}");
            let npm_bin = storage.join("node_modules").join(".bin").join(&bin_name);
            let cmd_path = if npm_bin.exists() {
                npm_bin
            } else {
                find_npm_bin(&storage, registry_id)
                    .ok_or_else(|| InstallError::MissingManagedArtifact(npm_bin))?
            };

            let env = {
                let mut merged = env.clone();
                merged.extend(launcher_env.clone());
                merged
            };
            generate_launcher_script(
                launcher_path,
                &cmd_path,
                &merge_launch_args(&args, launcher_args),
                &env,
                path_prefixes,
            )?;

            Ok(InstalledArtifactResult {
                role: ArtifactRole::AgentProcess,
                path: launcher_path.to_path_buf(),
                source: "registry_npm".into(),
                version,
            })
        }
        ResolvedRegistryDistribution::Binary {
            archive_url,
            cmd,
            args,
            env,
            version,
        } => {
            let storage = managed_dir.join("registry_binary");
            let cmd_path = acp_registry::install_binary_archive(&archive_url, &cmd, &storage)
                .map_err(|e| InstallError::FetchFailed {
                    url: archive_url,
                    message: e,
                })?;

            let env = {
                let mut merged = env.clone();
                merged.extend(launcher_env.clone());
                merged
            };
            generate_launcher_script(
                launcher_path,
                &cmd_path,
                &merge_launch_args(&args, launcher_args),
                &env,
                path_prefixes,
            )?;

            Ok(InstalledArtifactResult {
                role: ArtifactRole::AgentProcess,
                path: launcher_path.to_path_buf(),
                source: "registry_binary".into(),
                version,
            })
        }
    }
}

fn find_npm_bin(storage_root: &Path, hint: &str) -> Option<PathBuf> {
    let bin_dir = storage_root.join("node_modules").join(".bin");
    if !bin_dir.exists() {
        return None;
    }
    for entry in std::fs::read_dir(&bin_dir).ok()?.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str.contains(hint) {
            return Some(entry.path());
        }
    }
    std::fs::read_dir(&bin_dir)
        .ok()?
        .flatten()
        .next()
        .map(|e| e.path())
}

pub(super) fn install_agent_process_fallback(
    fallback: &AgentProcessFallback,
    kind: &AgentKind,
    managed_dir: &Path,
    launcher_path: &Path,
    options: &InstallOptions,
    launcher_args: &[String],
    path_prefixes: &[PathBuf],
    launcher_env: &HashMap<String, String>,
    managed_native_binary: Option<PathBuf>,
) -> Result<Option<InstalledArtifactResult>, InstallError> {
    match fallback {
        AgentProcessFallback::NpmPackage {
            package,
            package_subdir,
            source_build_binary_name,
            executable_relpath,
        } => install_managed_npm_package(
            package,
            package_subdir.as_deref(),
            source_build_binary_name.as_deref(),
            executable_relpath,
            managed_dir,
            launcher_path,
            options.agent_process_version.as_deref(),
            options.reinstall,
            launcher_args,
            path_prefixes,
            launcher_env,
            "fallback_npm",
        ),
        AgentProcessFallback::NativeSubcommand { args } => {
            std::fs::create_dir_all(managed_dir)?;
            let native_exec = managed_native_binary.unwrap_or_else(|| PathBuf::from(kind.as_str()));
            generate_launcher_script(
                launcher_path,
                &native_exec,
                &merge_launch_args(args, launcher_args),
                launcher_env,
                path_prefixes,
            )?;

            Ok(Some(InstalledArtifactResult {
                role: ArtifactRole::AgentProcess,
                path: launcher_path.to_path_buf(),
                source: "native_subcommand".into(),
                version: None,
            }))
        }
        AgentProcessFallback::BinaryHint {
            candidate_binaries,
            args,
        } => {
            let Some(bin) = candidate_binaries
                .iter()
                .find_map(|binary| find_real_binary_in_path(binary))
            else {
                return Err(InstallError::NotInstallable);
            };
            std::fs::create_dir_all(managed_dir)?;
            generate_launcher_script(
                launcher_path,
                &bin,
                &merge_launch_args(args, launcher_args),
                launcher_env,
                path_prefixes,
            )?;

            Ok(Some(InstalledArtifactResult {
                role: ArtifactRole::AgentProcess,
                path: launcher_path.to_path_buf(),
                source: "binary_hint".into(),
                version: None,
            }))
        }
    }
}

fn merge_launch_args(prefix_args: &[String], default_args: &[String]) -> Vec<String> {
    let mut args = prefix_args.to_vec();
    args.extend(default_args.iter().cloned());
    args
}
