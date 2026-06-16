//! The fenced materializer: install EXACTLY a resolved pin's bytes, sha256
//! verified. No latest-fetch, no PATH adoption, no registry re-fetch — this is
//! the install-time half of "the catalog pin is law".
//!
//! Scope (Seam 1): `Binary` and `Archive` sources — the native CLIs and the
//! binary-distributed adapters, where the reproducibility hole and the
//! supply-chain surface live. `Npm`/`Git` sources stay on the existing
//! version/ref-pinned managed-npm path until Seam 2 deletes the legacy routes.

use std::path::Path;

use super::downloads::{curl_download_binary_verified, download_and_extract_archive_verified};
use super::install_policy::{ResolvedPinSource, ResolvedPinTarget};
use super::{InstallError, InstalledArtifactResult};
use crate::domains::agents::model::{AgentKind, ArtifactRole, Platform};
use crate::domains::agents::readiness::paths::artifact_root;
use crate::integrations::agent_cli::executable::make_executable;

/// True when this source is materialized by the fenced binary/archive path.
/// `Npm`/`Git` go through the managed-npm path (already version/ref pinned).
pub(super) fn is_binary_or_archive(source: &ResolvedPinSource) -> bool {
    matches!(
        source,
        ResolvedPinSource::Binary { .. } | ResolvedPinSource::Archive { .. }
    )
}

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
        ResolvedPinSource::Archive { targets } => {
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
}
