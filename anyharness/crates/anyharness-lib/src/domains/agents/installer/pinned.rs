//! The fenced materializer: install EXACTLY a resolved pin's bytes, sha256
//! verified. No latest-fetch, no PATH adoption, no registry re-fetch — this is
//! the install-time half of "the catalog pin is law".
//!
//! Scope (Seam 1): `Binary` and `Archive` sources — the native CLIs and the
//! binary-distributed adapters, where the reproducibility hole and the
//! supply-chain surface live. `Npm`/`Git` sources stay on the existing
//! version/ref-pinned managed-npm path until Seam 2 deletes the legacy routes.

use std::path::Path;

use super::agent_process::{launcher_path_prefixes, managed_launcher_env};
use super::downloads::{
    download_and_extract_archive_tree_verified, download_and_extract_archive_verified,
    download_binary_verified,
};
use super::install_policy::{ResolvedPinSource, ResolvedPinTarget};
use super::npm::install_managed_npm_package;
use super::progress::{InstallProgressPhase, InstallProgressReporter};
use super::{InstallError, InstalledArtifactResult};
use crate::domains::agents::model::{AgentKind, ArtifactRole, Platform};
use crate::domains::agents::readiness::paths::{artifact_root, managed_pinned_binary_path};
use crate::integrations::agent_cli::executable::{
    is_valid_executable, make_executable, platform_binary_filename,
};
use crate::integrations::agent_cli::launcher::{
    generate_launcher_script, managed_launcher_file_name,
};

/// Materialize one artifact from its pinned, fenced `Binary`/`Archive` source:
/// resolve this platform's target, download it, verify the sha256, place the
/// executable at the managed artifact path. Refuses anything that doesn't match
/// the pinned checksum.
pub(super) fn install_binary_or_archive_from_pin(
    source: &ResolvedPinSource,
    version: &str,
    kind: &AgentKind,
    role: &ArtifactRole,
    runtime_home: &Path,
    reporter: Option<&InstallProgressReporter>,
) -> Result<InstalledArtifactResult, InstallError> {
    let managed_dir = artifact_root(runtime_home, kind, role);
    std::fs::create_dir_all(&managed_dir)?;
    // Named for the host, not for the catalog: Windows refuses to execute an
    // extension-less file, so the installed artifact has to land as
    // `claude.exe`/`codex.exe` there. Both arms below rename onto this one
    // path, so both inherit the suffix.
    let target_path = managed_pinned_binary_path(runtime_home, kind, role);

    match source {
        ResolvedPinSource::Binary { targets } => {
            let target = pick_target(targets)?;
            let temp_path = managed_dir.join(format!(".{}.downloading", kind.as_str()));
            download_binary_verified(
                &target.url,
                &temp_path,
                &target.sha256,
                target.download_size_bytes,
                reporter,
                role,
            )?;
            make_executable(&temp_path)?;
            std::fs::rename(&temp_path, &target_path)?;
            Ok(InstalledArtifactResult {
                role: role.clone(),
                path: target_path,
                source: "pinned_binary".into(),
                version: Some(version.to_string()),
            })
        }
        ResolvedPinSource::Archive {
            targets,
            companions,
            ..
        } => {
            let target = pick_target(targets)?;
            let expected_binary = target
                .expected_binary
                .clone()
                .unwrap_or_else(|| kind.as_str().to_string());
            download_and_extract_archive_verified(
                &target.url,
                &expected_binary,
                &managed_dir,
                &target_path,
                &target.sha256,
                target.download_size_bytes,
                reporter,
                role,
            )?;
            make_executable(&target_path)?;
            // Companions land beside the main binary so the CLI finds them on
            // `PATH` (the launcher prepends `managed_dir`). A companion the
            // pin does not resolve for this platform is skipped, never fatal:
            // the main binary is still a complete install of the pin.
            for companion in companions {
                let Some(companion_target) = current_platform_target(&companion.targets) else {
                    continue;
                };
                let companion_path = companion_path(runtime_home, kind, role, &companion.name);
                let expected_member = companion_target
                    .expected_binary
                    .clone()
                    .unwrap_or_else(|| companion.name.clone());
                download_and_extract_archive_verified(
                    &companion_target.url,
                    &expected_member,
                    &managed_dir,
                    &companion_path,
                    &companion_target.sha256,
                    companion_target.download_size_bytes,
                    reporter,
                    role,
                )?;
                make_executable(&companion_path)?;
            }
            Ok(InstalledArtifactResult {
                role: role.clone(),
                path: target_path,
                source: "pinned_archive".into(),
                version: Some(version.to_string()),
            })
        }
        ResolvedPinSource::Npm { .. } | ResolvedPinSource::Git { .. } => {
            Err(InstallError::InvalidInstallSpec(
                "npm/git pins are not materialized by the binary/archive path".into(),
            ))
        }
    }
}

/// Install the ACP adapter (agent_process) from its fenced pin and generate the
/// managed launcher.
///
/// The launcher bakes ONLY the pin's ACP-mode `args` (e.g. `acp`, `--acp`) —
/// the args required to invoke the binary as an ACP server. The catalog's
/// session `default_args` (e.g. codex `-c` flags) are deliberately NOT baked;
/// the runtime applies them at session spawn (see
/// `managed_npm_install_leaves_catalog_default_args_for_runtime_spawn`).
pub(super) fn install_agent_process_from_pin(
    source: &ResolvedPinSource,
    version: Option<&str>,
    kind: &AgentKind,
    executable_name: &str,
    runtime_home: &Path,
    reinstall: bool,
    reporter: Option<&InstallProgressReporter>,
) -> Result<Option<InstalledArtifactResult>, InstallError> {
    let managed_dir = artifact_root(runtime_home, kind, &ArtifactRole::AgentProcess);
    let launcher_path = managed_dir.join(managed_launcher_file_name(kind.as_str()));
    let path_prefixes = launcher_path_prefixes(runtime_home, kind);
    let launcher_env = managed_launcher_env(kind);

    match source {
        // Our adapter forks are ACP servers by default — no baked args; codex's
        // session `-c` flags are applied by the runtime, not here.
        ResolvedPinSource::Git {
            repo,
            git_ref,
            package_subdir,
            executable_relpath,
        } => {
            if let Some(reporter) = reporter {
                reporter.report(
                    &ArtifactRole::AgentProcess,
                    InstallProgressPhase::Installing,
                    0,
                    None,
                )
            }
            let package = format!("git+{repo}#{git_ref}");
            install_managed_npm_package(
                &package,
                package_subdir.as_deref().map(Path::new),
                None,
                Path::new(executable_relpath),
                &managed_dir,
                &launcher_path,
                None,
                reinstall,
                &[],
                &path_prefixes,
                &launcher_env,
                "pinned_git",
            )
        }
        ResolvedPinSource::Npm { package, args, .. } => {
            if let Some(reporter) = reporter {
                reporter.report(
                    &ArtifactRole::AgentProcess,
                    InstallProgressPhase::Installing,
                    0,
                    None,
                )
            }
            let executable_relpath = format!("node_modules/.bin/{executable_name}");
            install_managed_npm_package(
                package,
                None,
                None,
                Path::new(&executable_relpath),
                &managed_dir,
                &launcher_path,
                None,
                reinstall,
                args,
                &path_prefixes,
                &launcher_env,
                "pinned_npm",
            )
        }
        ResolvedPinSource::Archive { targets, args, .. } => {
            if is_valid_executable(&launcher_path) && !reinstall {
                return Ok(None);
            }
            // Preserve the WHOLE extracted tree: a registry-backed adapter binary
            // (e.g. cursor's `dist-package/cursor-agent`) execs its sibling files,
            // so we extract into a managed dir and point the launcher inside it.
            let target = pick_target(targets)?;
            let storage = managed_dir.join("registry_binary");
            let mut activation = download_and_extract_archive_tree_verified(
                &target.url,
                &storage,
                &target.sha256,
                target.download_size_bytes,
                reporter,
                &ArtifactRole::AgentProcess,
                Some(&launcher_path),
            )?;
            let prepared = (|| -> Result<InstalledArtifactResult, InstallError> {
                let expected = target
                    .expected_binary
                    .clone()
                    .unwrap_or_else(|| kind.as_str().to_string());
                let exec_path = storage.join(&expected);
                if !exec_path.exists() {
                    return Err(InstallError::MissingManagedArtifact(exec_path));
                }
                make_executable(&exec_path)?;
                let downloaded = target.download_size_bytes.unwrap_or(0);
                if let Some(reporter) = reporter {
                    reporter.report(
                        &ArtifactRole::AgentProcess,
                        InstallProgressPhase::Finalizing,
                        downloaded,
                        target.download_size_bytes,
                    )
                }
                let staged_launcher = managed_dir.join(format!(".{}-launcher.next", kind.as_str()));
                let _ = std::fs::remove_file(&staged_launcher);
                generate_launcher_script(
                    &staged_launcher,
                    &exec_path,
                    args,
                    &launcher_env,
                    &path_prefixes,
                )?;
                activation.activate_launcher(&staged_launcher)?;
                Ok(InstalledArtifactResult {
                    role: ArtifactRole::AgentProcess,
                    path: launcher_path,
                    source: "pinned_archive".into(),
                    version: version.map(String::from),
                })
            })();

            match prepared {
                Ok(result) => {
                    activation.commit()?;
                    Ok(Some(result))
                }
                Err(error) => Err(activation.rollback_after(error)),
            }
        }
        ResolvedPinSource::Binary { .. } => Err(InstallError::InvalidInstallSpec(
            "an agent_process pin cannot be a bare Binary source".into(),
        )),
    }
}

/// Resolve this platform's pinned download, or refuse (no silent fallback).
fn pick_target(
    targets: &std::collections::BTreeMap<String, ResolvedPinTarget>,
) -> Result<&ResolvedPinTarget, InstallError> {
    let platform = Platform::detect().ok_or(InstallError::UnsupportedPlatform)?;
    targets
        .get(platform.registry_key())
        .ok_or_else(|| InstallError::NoPinForPlatform(platform.registry_key().to_string()))
}

/// Like `pick_target`, but absence is not an error: companions are optional
/// per platform.
fn current_platform_target(
    targets: &std::collections::BTreeMap<String, ResolvedPinTarget>,
) -> Option<&ResolvedPinTarget> {
    let platform = Platform::detect()?;
    targets.get(platform.registry_key())
}

/// Where a pinned companion binary lives once installed: beside the main
/// artifact, named for the host platform (`.exe` on Windows). Readiness
/// planning reads this path to detect a missing sidecar.
pub(super) fn companion_path(
    runtime_home: &Path,
    kind: &AgentKind,
    role: &ArtifactRole,
    name: &str,
) -> std::path::PathBuf {
    artifact_root(runtime_home, kind, role).join(platform_binary_filename(name))
}

#[cfg(test)]
#[path = "pinned_tests.rs"]
mod tests;
