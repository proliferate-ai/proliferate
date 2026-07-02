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
    curl_download_binary_verified, download_and_extract_archive_tree_verified,
    download_and_extract_archive_verified,
};
use super::install_policy::{ResolvedPinSource, ResolvedPinTarget};
use super::npm::install_managed_npm_package;
use super::{InstallError, InstalledArtifactResult};
use crate::domains::agents::model::{AgentKind, ArtifactRole, Platform};
use crate::domains::agents::readiness::paths::artifact_root;
use crate::integrations::agent_cli::executable::{is_valid_executable, make_executable};
use crate::integrations::agent_cli::launcher::generate_launcher_script;

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
) -> Result<InstalledArtifactResult, InstallError> {
    let managed_dir = artifact_root(runtime_home, kind, role);
    std::fs::create_dir_all(&managed_dir)?;
    let target_path = managed_dir.join(kind.as_str());

    match source {
        ResolvedPinSource::Binary { targets } => {
            let target = pick_target(targets)?;
            let temp_path = managed_dir.join(format!(".{}.downloading", kind.as_str()));
            curl_download_binary_verified(&target.url, &temp_path, &target.sha256)?;
            make_executable(&temp_path)?;
            std::fs::rename(&temp_path, &target_path)?;
            Ok(InstalledArtifactResult {
                role: role.clone(),
                path: target_path,
                source: "pinned_binary".into(),
                version: Some(version.to_string()),
            })
        }
        ResolvedPinSource::Archive { targets, .. } => {
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
            )?;
            make_executable(&target_path)?;
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
) -> Result<Option<InstalledArtifactResult>, InstallError> {
    let managed_dir = artifact_root(runtime_home, kind, &ArtifactRole::AgentProcess);
    let launcher_path = managed_dir.join(format!("{}-launcher", kind.as_str()));
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
        ResolvedPinSource::Archive { targets, args } => {
            if is_valid_executable(&launcher_path) && !reinstall {
                return Ok(None);
            }
            // Preserve the WHOLE extracted tree: a registry-backed adapter binary
            // (e.g. cursor's `dist-package/cursor-agent`) execs its sibling files,
            // so we extract into a managed dir and point the launcher inside it.
            let target = pick_target(targets)?;
            let storage = managed_dir.join("registry_binary");
            download_and_extract_archive_tree_verified(&target.url, &storage, &target.sha256)?;
            let expected = target
                .expected_binary
                .clone()
                .unwrap_or_else(|| kind.as_str().to_string());
            let exec_path = storage.join(&expected);
            if !exec_path.exists() {
                // Don't leave a populated-but-unusable tree behind.
                let _ = std::fs::remove_dir_all(&storage);
                return Err(InstallError::MissingManagedArtifact(exec_path));
            }
            make_executable(&exec_path)?;
            generate_launcher_script(
                &launcher_path,
                &exec_path,
                args,
                &launcher_env,
                &path_prefixes,
            )?;
            Ok(Some(InstalledArtifactResult {
                role: ArtifactRole::AgentProcess,
                path: launcher_path,
                source: "pinned_archive".into(),
                version: version.map(String::from),
            }))
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

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::collections::BTreeMap;

    fn sha256_hex(bytes: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(bytes);
        format!("{:x}", hasher.finalize())
    }

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).expect("create temp dir");
        path
    }

    fn binary_pin(url: &str, sha256: &str) -> ResolvedPinSource {
        let platform = Platform::detect().expect("supported test platform");
        let mut targets = BTreeMap::new();
        targets.insert(
            platform.registry_key().to_string(),
            ResolvedPinTarget {
                url: url.to_string(),
                sha256: sha256.to_string(),
                expected_binary: None,
            },
        );
        ResolvedPinSource::Binary { targets }
    }

    #[test]
    fn correct_sha_installs_the_pinned_binary() {
        let scratch = temp_dir("pinned-ok");
        let source_file = scratch.join("claude-payload");
        let bytes = b"#!/bin/sh\necho claude\n";
        std::fs::write(&source_file, bytes).expect("write payload");
        let url = format!("file://{}", source_file.display());

        let home = scratch.join("home");
        let result = install_binary_or_archive_from_pin(
            &binary_pin(&url, &sha256_hex(bytes)),
            "2.1.170",
            &AgentKind::Claude,
            &ArtifactRole::NativeCli,
            &home,
        )
        .expect("pinned install");

        assert_eq!(result.version.as_deref(), Some("2.1.170"));
        assert!(result.path.exists(), "installed binary should exist");
        assert_eq!(std::fs::read(&result.path).expect("read"), bytes);
        let _ = std::fs::remove_dir_all(&scratch);
    }

    #[test]
    fn wrong_sha_is_refused_and_nothing_is_installed() {
        let scratch = temp_dir("pinned-bad");
        let source_file = scratch.join("claude-payload");
        std::fs::write(&source_file, b"tampered bytes").expect("write payload");
        let url = format!("file://{}", source_file.display());

        let home = scratch.join("home");
        let err = install_binary_or_archive_from_pin(
            &binary_pin(&url, &"0".repeat(64)),
            "2.1.170",
            &AgentKind::Claude,
            &ArtifactRole::NativeCli,
            &home,
        )
        .expect_err("checksum mismatch must fail");

        assert!(
            matches!(err, InstallError::ChecksumMismatch { .. }),
            "expected ChecksumMismatch, got {err:?}"
        );
        let target = artifact_root(&home, &AgentKind::Claude, &ArtifactRole::NativeCli)
            .join(AgentKind::Claude.as_str());
        assert!(!target.exists(), "no artifact may survive a bad checksum");
        let _ = std::fs::remove_dir_all(&scratch);
    }

    #[test]
    fn npm_adapter_pin_bakes_acp_launch_args() {
        // A registry-backed npm adapter (e.g. gemini) must bake its ACP-mode
        // args (`--acp`) into the managed launcher — this is the bug an earlier
        // pass introduced by baking session default_args instead.
        let scratch = temp_dir("npm-adapter");
        let pkg = scratch.join("pkg");
        std::fs::create_dir_all(pkg.join("bin")).expect("bin dir");
        std::fs::write(
            pkg.join("package.json"),
            "{\"name\":\"fake-acp-agent\",\"version\":\"0.0.1\",\
             \"bin\":{\"fake-acp-agent\":\"bin/cli.js\"},\"files\":[\"bin\"]}",
        )
        .expect("package.json");
        std::fs::write(pkg.join("bin/cli.js"), "#!/usr/bin/env node\n").expect("cli");

        let home = scratch.join("home");
        let source = ResolvedPinSource::Npm {
            package: format!("file:{}", pkg.display()),
            sha256: None,
            args: vec!["--acp".to_string()],
        };
        let result = install_agent_process_from_pin(
            &source,
            Some("0.46.0"),
            &AgentKind::Gemini,
            "fake-acp-agent",
            &home,
            true,
        )
        .expect("adapter install")
        .expect("installed launcher");

        let launcher = std::fs::read_to_string(&result.path).expect("read launcher");
        assert!(
            launcher.contains("--acp"),
            "ACP launch arg must be baked into the launcher: {launcher}"
        );
        let _ = std::fs::remove_dir_all(&scratch);
    }

    #[test]
    fn archive_adapter_pin_preserves_sibling_files() {
        // Regression guard: a registry-backed adapter binary (cursor) execs its
        // sibling files, so the whole extracted tree must survive — not just the
        // entry binary.
        let scratch = temp_dir("archive-adapter");
        let payload = scratch.join("payload");
        std::fs::create_dir_all(payload.join("pkg")).expect("payload dirs");
        std::fs::write(
            payload.join("pkg/agent"),
            b"#!/bin/sh\nexec \"$(dirname \"$0\")/helper\"\n",
        )
        .expect("agent");
        std::fs::write(payload.join("pkg/helper"), b"#!/bin/sh\necho ok\n").expect("helper");

        let archive = scratch.join("bundle.tar.gz");
        let status = std::process::Command::new("tar")
            .arg("czf")
            .arg(&archive)
            .arg("-C")
            .arg(&payload)
            .arg("pkg")
            .status()
            .expect("tar");
        assert!(status.success(), "tar must succeed");
        let sha = sha256_hex(&std::fs::read(&archive).expect("read archive"));

        let mut targets = BTreeMap::new();
        targets.insert(
            Platform::detect()
                .expect("platform")
                .registry_key()
                .to_string(),
            ResolvedPinTarget {
                url: format!("file://{}", archive.display()),
                sha256: sha,
                expected_binary: Some("pkg/agent".to_string()),
            },
        );
        let source = ResolvedPinSource::Archive {
            targets,
            args: vec!["acp".to_string()],
        };

        let home = scratch.join("home");
        let result = install_agent_process_from_pin(
            &source,
            Some("1.0.0"),
            &AgentKind::Cursor,
            "cursor-agent",
            &home,
            true,
        )
        .expect("adapter install")
        .expect("installed launcher");

        let storage = artifact_root(&home, &AgentKind::Cursor, &ArtifactRole::AgentProcess)
            .join("registry_binary");
        assert!(
            storage.join("pkg/agent").exists(),
            "entry binary must survive"
        );
        assert!(
            storage.join("pkg/helper").exists(),
            "sibling file must survive — the cursor regression this guards"
        );
        let launcher = std::fs::read_to_string(&result.path).expect("read launcher");
        assert!(
            launcher.contains("acp"),
            "ACP arg must be baked: {launcher}"
        );
        let _ = std::fs::remove_dir_all(&scratch);
    }
}
