//! Surfacing durable install-manifest versions on resolved artifacts — the
//! derived view reading the manifest link of the attestation chain.

use crate::domains::agents::model::{ArtifactRole, ResolvedArtifact};

/// Surface durable install-manifest versions on resolved artifacts that the
/// path probes could not version. PATH-sourced artifacts are never claimed by
/// the manifest (we attest what we don't own; we don't invent versions for it).
pub(super) fn apply_manifest_versions(
    manifest: Option<&crate::domains::agents::installer::manifest::InstallManifest>,
    native: &mut Option<ResolvedArtifact>,
    agent_process: &mut ResolvedArtifact,
) {
    let Some(manifest) = manifest else { return };
    if let Some(native) = native.as_mut() {
        if native.installed && native.version.is_none() && native.source.as_deref() != Some("path")
        {
            native.version = manifest.version_for(&ArtifactRole::NativeCli);
        }
    }
    if agent_process.installed
        && agent_process.version.is_none()
        && agent_process.source.as_deref() != Some("path")
    {
        agent_process.version = manifest.version_for(&ArtifactRole::AgentProcess);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn manifest_versions_fill_managed_artifacts_but_never_path_sourced() {
        use crate::domains::agents::installer::manifest::{
            InstallManifest, ManifestArtifact, INSTALL_MANIFEST_SCHEMA_VERSION,
        };
        let manifest = InstallManifest {
            schema_version: INSTALL_MANIFEST_SCHEMA_VERSION,
            agent: "gemini".into(),
            artifacts: vec![
                ManifestArtifact {
                    role: "agent_process".into(),
                    version: Some("2.3.4".into()),
                    sha256: None,
                    source: "registry_npm".into(),
                    installed_at: "2026-06-10T00:00:00Z".into(),
                    path: "/managed/gemini".into(),
                },
                ManifestArtifact {
                    role: "native_cli".into(),
                    version: Some("9.9.9".into()),
                    sha256: None,
                    source: "managed".into(),
                    installed_at: "2026-06-10T00:00:00Z".into(),
                    path: "/managed/gemini-cli".into(),
                },
            ],
        };
        let managed = |role: ArtifactRole, source: &str| ResolvedArtifact {
            role,
            installed: true,
            source: Some(source.into()),
            version: None,
            path: Some(PathBuf::from("/managed/x")),
            message: None,
        };

        let mut native = Some(managed(ArtifactRole::NativeCli, "managed"));
        let mut agent_process = managed(ArtifactRole::AgentProcess, "managed");
        apply_manifest_versions(Some(&manifest), &mut native, &mut agent_process);
        assert_eq!(native.unwrap().version.as_deref(), Some("9.9.9"));
        assert_eq!(agent_process.version.as_deref(), Some("2.3.4"));

        // PATH-sourced artifacts are never claimed by the manifest.
        let mut native = Some(managed(ArtifactRole::NativeCli, "path"));
        let mut agent_process = managed(ArtifactRole::AgentProcess, "path");
        apply_manifest_versions(Some(&manifest), &mut native, &mut agent_process);
        assert_eq!(native.unwrap().version, None);
        assert_eq!(agent_process.version, None);

        // Probe-provided versions are never overwritten.
        let mut native = None;
        let mut agent_process = ResolvedArtifact {
            version: Some("probe-said-1.0".into()),
            ..managed(ArtifactRole::AgentProcess, "managed")
        };
        apply_manifest_versions(Some(&manifest), &mut native, &mut agent_process);
        assert_eq!(agent_process.version.as_deref(), Some("probe-said-1.0"));
    }
}
