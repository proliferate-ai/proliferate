use std::path::{Path, PathBuf};

use super::paths::{artifact_root, has_managed_registry_binary_for_names};
use crate::domains::agents::managed_npm::managed_npm_install_issue;
use crate::domains::agents::model::*;
use crate::integrations::agent_cli::executable::{
    find_in_path, find_real_binary_in_path, is_valid_executable,
};

pub(super) fn resolve_native_artifact(
    spec: &NativeArtifactSpec,
    kind: &AgentKind,
    runtime_home: &Path,
) -> ResolvedArtifact {
    let managed_dir = artifact_root(runtime_home, kind, &ArtifactRole::NativeCli);

    match &spec.install {
        NativeInstallSpec::DirectBinary { .. } | NativeInstallSpec::TarballRelease { .. } => {
            let managed_path = managed_dir.join(kind.as_str());
            if is_valid_executable(&managed_path) {
                return found_artifact(ArtifactRole::NativeCli, managed_path, "managed");
            }
            if let Some(found) = find_in_path(kind.as_str()) {
                return found_artifact(ArtifactRole::NativeCli, found, "path");
            }
            not_found_artifact(
                ArtifactRole::NativeCli,
                Some(format!(
                    "Not installed. Use the install endpoint to download the {} CLI.",
                    kind.display_name()
                )),
            )
        }
        NativeInstallSpec::PathOnly {
            candidate_binaries,
            docs_url,
        } => resolve_path_only(
            ArtifactRole::NativeCli,
            candidate_binaries,
            docs_url.as_deref(),
        ),
        NativeInstallSpec::Manual { docs_url } => ResolvedArtifact {
            role: ArtifactRole::NativeCli,
            installed: false,
            source: None,
            version: None,
            path: None,
            message: Some(format!("Manual install required. See: {docs_url}")),
        },
    }
}

pub(super) fn resolve_agent_process_artifact(
    spec: &AgentProcessArtifactSpec,
    kind: &AgentKind,
    runtime_home: &Path,
) -> ResolvedArtifact {
    let managed_dir = artifact_root(runtime_home, kind, &ArtifactRole::AgentProcess);

    match &spec.install {
        AgentProcessInstallSpec::RegistryBacked { .. } => {
            let managed_candidates = managed_launcher_candidates(
                &managed_dir,
                kind,
                managed_npm_executable_relpath(&spec.install),
            );
            for path in &managed_candidates {
                if path.exists() {
                    if let Some(message) =
                        registry_backed_launcher_issue(&spec.install, kind, runtime_home, path)
                    {
                        return ResolvedArtifact {
                            role: ArtifactRole::AgentProcess,
                            installed: false,
                            source: Some("managed".into()),
                            version: None,
                            path: Some(path.clone()),
                            message: Some(message),
                        };
                    }
                    return found_artifact(ArtifactRole::AgentProcess, path.clone(), "managed");
                }
            }
            not_found_artifact(
                ArtifactRole::AgentProcess,
                Some("Not installed. Use the install endpoint to set up.".into()),
            )
        }
        AgentProcessInstallSpec::ManagedNpmPackage {
            package,
            source_build_binary_name,
            executable_relpath,
            ..
        } => {
            let managed_candidates =
                managed_launcher_candidates(&managed_dir, kind, Some(executable_relpath.as_path()));
            for path in &managed_candidates {
                if path.exists() {
                    if source_build_binary_name.is_none() {
                        if let Some(message) = managed_npm_install_issue(package, &managed_dir) {
                            return ResolvedArtifact {
                                role: ArtifactRole::AgentProcess,
                                installed: false,
                                source: Some("managed".into()),
                                version: None,
                                path: Some(path.clone()),
                                message: Some(message),
                            };
                        }
                    }
                    return found_artifact(ArtifactRole::AgentProcess, path.clone(), "managed");
                }
            }
            if let Some(binary_name) = executable_relpath
                .file_name()
                .and_then(|name| name.to_str())
            {
                if let Some(found) = find_real_binary_in_path(binary_name) {
                    return found_artifact(ArtifactRole::AgentProcess, found, "path");
                }
            }

            not_found_artifact(
                ArtifactRole::AgentProcess,
                Some("Not installed. Use the install endpoint to set up.".into()),
            )
        }
        AgentProcessInstallSpec::PathOnly {
            candidate_binaries,
            docs_url,
            ..
        } => resolve_path_only(
            ArtifactRole::AgentProcess,
            candidate_binaries,
            docs_url.as_deref(),
        ),
        AgentProcessInstallSpec::Manual { docs_url } => ResolvedArtifact {
            role: ArtifactRole::AgentProcess,
            installed: false,
            source: None,
            version: None,
            path: None,
            message: Some(format!("Manual install required. See: {docs_url}")),
        },
    }
}

pub(super) fn managed_launcher_candidates(
    managed_dir: &Path,
    kind: &AgentKind,
    executable_relpath: Option<&Path>,
) -> Vec<PathBuf> {
    let mut paths = vec![];
    paths.push(managed_dir.join(format!("{}-launcher", kind.as_str())));

    if let Some(executable_relpath) = executable_relpath {
        paths.push(managed_dir.join(executable_relpath));
    }
    paths
}

pub(super) fn managed_npm_executable_relpath(spec: &AgentProcessInstallSpec) -> Option<&Path> {
    match spec {
        AgentProcessInstallSpec::RegistryBacked {
            fallback:
                AgentProcessFallback::NpmPackage {
                    executable_relpath, ..
                },
            ..
        }
        | AgentProcessInstallSpec::ManagedNpmPackage {
            executable_relpath, ..
        } => Some(executable_relpath.as_path()),
        AgentProcessInstallSpec::RegistryBacked { .. }
        | AgentProcessInstallSpec::PathOnly { .. }
        | AgentProcessInstallSpec::Manual { .. } => None,
    }
}

pub(super) fn resolve_agent_process_fallback(
    descriptor: &AgentDescriptor,
    native: Option<&ResolvedArtifact>,
    current: &ResolvedArtifact,
) -> Option<(ResolvedArtifact, Option<SpawnSpec>)> {
    if current.installed {
        return None;
    }

    let AgentProcessInstallSpec::RegistryBacked { fallback, .. } =
        &descriptor.agent_process.install
    else {
        return None;
    };

    match fallback {
        AgentProcessFallback::BinaryHint {
            candidate_binaries,
            args,
        } => {
            for binary in candidate_binaries {
                if let Some(found) = find_real_binary_in_path(binary) {
                    return Some((
                        found_artifact(ArtifactRole::AgentProcess, found.clone(), "path"),
                        Some(SpawnSpec {
                            program: found,
                            args: args.clone(),
                            env: std::collections::HashMap::new(),
                            cwd: None,
                        }),
                    ));
                }
            }
            None
        }
        AgentProcessFallback::NativeSubcommand { args } => {
            let native = native?;
            let native_path = native.path.clone()?;
            Some((
                found_artifact(ArtifactRole::AgentProcess, native_path.clone(), "native"),
                Some(SpawnSpec {
                    program: native_path,
                    args: args.clone(),
                    env: std::collections::HashMap::new(),
                    cwd: None,
                }),
            ))
        }
        AgentProcessFallback::NpmPackage {
            executable_relpath, ..
        } => {
            let binary_name = executable_relpath.file_name()?.to_str()?;
            find_real_binary_in_path(binary_name).map(|found| {
                (
                    found_artifact(ArtifactRole::AgentProcess, found, "path"),
                    None,
                )
            })
        }
    }
}

pub(super) fn resolve_agent_process_path_fallback(descriptor: &AgentDescriptor) -> Option<PathBuf> {
    if uses_registry_binary_hint(&descriptor.agent_process.install) {
        return None;
    }
    find_real_binary_in_path(&descriptor.launch.executable_name)
}

fn uses_registry_binary_hint(install: &AgentProcessInstallSpec) -> bool {
    matches!(
        install,
        AgentProcessInstallSpec::RegistryBacked {
            fallback: AgentProcessFallback::BinaryHint { .. },
            ..
        }
    )
}

fn resolve_path_only(
    role: ArtifactRole,
    candidate_binaries: &[String],
    docs_url: Option<&str>,
) -> ResolvedArtifact {
    for bin in candidate_binaries {
        if let Some(found) = find_in_path(bin) {
            return found_artifact(role, found, "path");
        }
    }
    not_found_artifact(
        role,
        Some(
            docs_url
                .map(|u| format!("Not found on PATH. See: {u}"))
                .unwrap_or_else(|| "Not found on PATH.".into()),
        ),
    )
}

pub(super) fn found_artifact(role: ArtifactRole, path: PathBuf, source: &str) -> ResolvedArtifact {
    ResolvedArtifact {
        role,
        installed: true,
        source: Some(source.into()),
        version: None,
        path: Some(path),
        message: None,
    }
}

pub(super) fn not_found_artifact(role: ArtifactRole, message: Option<String>) -> ResolvedArtifact {
    ResolvedArtifact {
        role,
        installed: false,
        source: None,
        version: None,
        path: None,
        message,
    }
}

fn registry_backed_launcher_issue(
    install: &AgentProcessInstallSpec,
    kind: &AgentKind,
    runtime_home: &Path,
    launcher_path: &Path,
) -> Option<String> {
    let AgentProcessInstallSpec::RegistryBacked { fallback, .. } = install else {
        return None;
    };
    let AgentProcessFallback::BinaryHint {
        candidate_binaries, ..
    } = fallback
    else {
        return None;
    };

    if !launcher_uses_binary_hint(launcher_path, candidate_binaries) {
        return None;
    }

    if has_managed_registry_binary_for_names(runtime_home, kind, candidate_binaries)
        || candidate_binaries
            .iter()
            .any(|binary| find_real_binary_in_path(binary).is_some())
    {
        return None;
    }

    Some(format!(
        "Managed launcher exists, but none of its backing binaries were found on PATH: {}.",
        candidate_binaries.join(", ")
    ))
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
