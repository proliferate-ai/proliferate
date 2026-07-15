//! install-manifest.json: the durable proof of what the installer (or seed
//! hydration) placed on disk — per agent, per artifact role: version, sha256,
//! source, timestamp. The middle link of the attestation chain:
//! catalog pin (declared) -> install manifest (on disk) -> agent_info (running).
//!
//! Writes are atomic (tmp + rename) and best-effort at call sites: a manifest
//! failure never fails an install.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::InstalledArtifactResult;
use crate::domains::agents::model::ArtifactRole;

pub const INSTALL_MANIFEST_SCHEMA_VERSION: u32 = 1;
const MANIFEST_FILE_NAME: &str = "install-manifest.json";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallManifest {
    pub schema_version: u32,
    pub agent: String,
    pub artifacts: Vec<ManifestArtifact>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestArtifact {
    /// "native_cli" | "agent_process"
    pub role: String,
    pub version: Option<String>,
    pub sha256: Option<String>,
    /// Install mechanism that produced the artifact (e.g. "managed_npm",
    /// "registry_binary", "binary_hint", "seed").
    pub source: String,
    pub installed_at: String,
    pub path: String,
}

impl InstallManifest {
    pub fn version_for(&self, role: &ArtifactRole) -> Option<String> {
        let role = role_name(role);
        self.artifacts
            .iter()
            .find(|artifact| artifact.role == role)
            .and_then(|artifact| artifact.version.clone())
    }
}

pub fn manifest_path(runtime_home: &Path, kind: &str) -> PathBuf {
    runtime_home
        .join("agents")
        .join(kind)
        .join(MANIFEST_FILE_NAME)
}

/// Read the manifest if present and parseable; any failure reads as absent.
pub fn read_manifest(runtime_home: &Path, kind: &str) -> Option<InstallManifest> {
    let text = std::fs::read_to_string(manifest_path(runtime_home, kind)).ok()?;
    serde_json::from_str(&text).ok()
}

/// Merge newly installed artifacts into the manifest (one entry per role),
/// atomically. Mints the timestamp — this is the effects layer.
pub fn record_artifacts(
    runtime_home: &Path,
    kind: &str,
    artifacts: &[InstalledArtifactResult],
) -> std::io::Result<()> {
    if artifacts.is_empty() {
        return Ok(());
    }
    let installed_at = chrono::Utc::now().to_rfc3339();
    let entries: Vec<ManifestArtifact> = artifacts
        .iter()
        .map(|artifact| ManifestArtifact {
            role: role_name(&artifact.role).to_string(),
            version: artifact.version.clone(),
            sha256: sha256_of_file(&artifact.path),
            source: artifact.source.clone(),
            installed_at: installed_at.clone(),
            path: artifact.path.display().to_string(),
        })
        .collect();
    record_entries(runtime_home, kind, entries)
}

/// Merge pre-built entries (seed hydration path) into the manifest, atomically.
pub fn record_entries(
    runtime_home: &Path,
    kind: &str,
    entries: Vec<ManifestArtifact>,
) -> std::io::Result<()> {
    if entries.is_empty() {
        return Ok(());
    }
    let mut manifest = read_manifest(runtime_home, kind).unwrap_or_else(|| InstallManifest {
        schema_version: INSTALL_MANIFEST_SCHEMA_VERSION,
        agent: kind.to_string(),
        artifacts: Vec::new(),
    });
    for entry in entries {
        manifest
            .artifacts
            .retain(|existing| existing.role != entry.role);
        manifest.artifacts.push(entry);
    }
    write_manifest_atomic(runtime_home, kind, &manifest)
}

pub fn role_name(role: &ArtifactRole) -> &'static str {
    match role {
        ArtifactRole::NativeCli => "native_cli",
        ArtifactRole::AgentProcess => "agent_process",
    }
}

fn write_manifest_atomic(
    runtime_home: &Path,
    kind: &str,
    manifest: &InstallManifest,
) -> std::io::Result<()> {
    let path = manifest_path(runtime_home, kind);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(manifest)
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json)?;
    std::fs::rename(&tmp, &path)
}

/// Content hash for file artifacts; directories and unreadable paths read as
/// None (the launcher/binary the result points at is what gets hashed).
pub(super) fn sha256_of_file(path: &Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    Some(format!("{:x}", hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_home(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).expect("create temp dir");
        path
    }

    fn result(role: ArtifactRole, path: PathBuf, version: Option<&str>) -> InstalledArtifactResult {
        InstalledArtifactResult {
            role,
            path,
            source: "managed_npm".into(),
            version: version.map(String::from),
        }
    }

    #[test]
    fn records_and_reads_back_artifacts_with_hashes() {
        let home = temp_home("manifest-roundtrip");
        let artifact_path = home.join("launcher");
        std::fs::write(&artifact_path, "#!/bin/sh\nexit 0\n").expect("write artifact");

        record_artifacts(
            &home,
            "codex",
            &[result(
                ArtifactRole::AgentProcess,
                artifact_path.clone(),
                Some("0.12.0"),
            )],
        )
        .expect("record");

        let manifest = read_manifest(&home, "codex").expect("manifest");
        assert_eq!(manifest.schema_version, INSTALL_MANIFEST_SCHEMA_VERSION);
        assert_eq!(manifest.agent, "codex");
        assert_eq!(manifest.artifacts.len(), 1);
        let entry = &manifest.artifacts[0];
        assert_eq!(entry.role, "agent_process");
        assert_eq!(entry.version.as_deref(), Some("0.12.0"));
        assert!(entry.sha256.as_deref().is_some_and(|h| h.len() == 64));
        assert_eq!(
            manifest.version_for(&ArtifactRole::AgentProcess).as_deref(),
            Some("0.12.0")
        );

        let _ = std::fs::remove_dir_all(home);
    }

    #[test]
    fn rerecording_a_role_replaces_the_entry_and_keeps_others() {
        let home = temp_home("manifest-merge");
        let native = home.join("native");
        let process = home.join("process");
        std::fs::write(&native, "native-v1").expect("write");
        std::fs::write(&process, "process-v1").expect("write");

        record_artifacts(
            &home,
            "claude",
            &[
                result(ArtifactRole::NativeCli, native.clone(), Some("1.0.0")),
                result(ArtifactRole::AgentProcess, process.clone(), Some("0.1.0")),
            ],
        )
        .expect("record both");
        record_artifacts(
            &home,
            "claude",
            &[result(ArtifactRole::AgentProcess, process, Some("0.2.0"))],
        )
        .expect("re-record process");

        let manifest = read_manifest(&home, "claude").expect("manifest");
        assert_eq!(manifest.artifacts.len(), 2);
        assert_eq!(
            manifest.version_for(&ArtifactRole::NativeCli).as_deref(),
            Some("1.0.0")
        );
        assert_eq!(
            manifest.version_for(&ArtifactRole::AgentProcess).as_deref(),
            Some("0.2.0")
        );

        let _ = std::fs::remove_dir_all(home);
    }

    #[test]
    fn unreadable_manifest_reads_as_absent() {
        let home = temp_home("manifest-corrupt");
        let path = manifest_path(&home, "grok");
        std::fs::create_dir_all(path.parent().unwrap()).expect("dirs");
        std::fs::write(&path, "{not json").expect("write");
        assert!(read_manifest(&home, "grok").is_none());
        let _ = std::fs::remove_dir_all(home);
    }
}
