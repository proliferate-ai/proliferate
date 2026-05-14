use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::error::SupervisorError;

const UPDATE_MANIFEST_VERSION: u32 = 1;
const SUPPORTED_COMPONENTS: &[&str] = &["anyharness", "worker", "supervisor"];

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateManifest {
    pub version: u32,
    #[serde(default)]
    pub artifacts: Vec<UpdateArtifact>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateArtifact {
    pub component: String,
    pub version: String,
    pub os: String,
    pub arch: String,
    pub url: String,
    pub sha256: String,
    pub size_bytes: Option<u64>,
}

impl UpdateManifest {
    pub fn parse(contents: &str) -> Result<Self, SupervisorError> {
        let manifest: Self =
            serde_json::from_str(contents).map_err(SupervisorError::ParseUpdateManifest)?;
        if manifest.version != UPDATE_MANIFEST_VERSION {
            return Err(SupervisorError::UnsupportedUpdateManifestVersion {
                version: manifest.version,
            });
        }
        for artifact in &manifest.artifacts {
            artifact.validate()?;
        }
        Ok(manifest)
    }

    pub fn artifact_for(
        &self,
        component: &str,
        version: &str,
        os: &str,
        arch: &str,
    ) -> Result<&UpdateArtifact, SupervisorError> {
        self.artifacts
            .iter()
            .find(|artifact| {
                artifact.component == component
                    && artifact.version == version
                    && artifact.os == os
                    && artifact.arch == arch
            })
            .ok_or_else(|| SupervisorError::UpdateArtifactMissing {
                component: component.to_string(),
                version: version.to_string(),
            })
    }
}

impl UpdateArtifact {
    pub fn validate(&self) -> Result<(), SupervisorError> {
        validate_component(&self.component)?;
        validate_identifier("version", &self.version)?;
        validate_identifier("os", &self.os)?;
        validate_identifier("arch", &self.arch)?;
        validate_sha256_hex(&self.sha256)?;
        Ok(())
    }
}

pub fn verify_sha256(artifact: &UpdateArtifact, bytes: &[u8]) -> Result<(), SupervisorError> {
    artifact.validate()?;
    if let Some(expected) = artifact.size_bytes {
        if expected != bytes.len() as u64 {
            return Err(SupervisorError::UpdateArtifactSizeMismatch {
                component: artifact.component.clone(),
                version: artifact.version.clone(),
                expected,
                actual: bytes.len(),
            });
        }
    }
    let actual = format!("{:x}", Sha256::digest(bytes));
    if actual == artifact.sha256.to_ascii_lowercase() {
        return Ok(());
    }
    Err(SupervisorError::UpdateChecksumMismatch {
        component: artifact.component.clone(),
        version: artifact.version.clone(),
        expected: artifact.sha256.clone(),
        actual,
    })
}

fn validate_component(value: &str) -> Result<(), SupervisorError> {
    if SUPPORTED_COMPONENTS.contains(&value) {
        return Ok(());
    }
    Err(SupervisorError::InvalidUpdateArtifactField {
        field: "component".to_string(),
        value: value.to_string(),
    })
}

fn validate_identifier(field: &str, value: &str) -> Result<(), SupervisorError> {
    if value.is_empty()
        || value == "."
        || value == ".."
        || value.contains('/')
        || value.contains('\\')
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-' | b'+'))
    {
        return Err(SupervisorError::InvalidUpdateArtifactField {
            field: field.to_string(),
            value: value.to_string(),
        });
    }
    Ok(())
}

fn validate_sha256_hex(value: &str) -> Result<(), SupervisorError> {
    if value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Ok(());
    }
    Err(SupervisorError::InvalidUpdateArtifactField {
        field: "sha256".to_string(),
        value: value.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use sha2::{Digest, Sha256};

    use super::{verify_sha256, UpdateArtifact, UpdateManifest};

    #[test]
    fn parses_and_verifies_manifest_artifact() {
        let bytes = b"proliferate";
        let sha256 = format!("{:x}", Sha256::digest(bytes));
        let manifest = UpdateManifest::parse(&format!(
            r#"{{
                "version": 1,
                "artifacts": [{{
                    "component": "worker",
                    "version": "0.2.0",
                    "os": "linux",
                    "arch": "x86_64",
                    "url": "https://example.test/worker",
                    "sha256": "{sha256}",
                    "sizeBytes": 11
                }}]
            }}"#
        ))
        .expect("parse manifest");
        let artifact = manifest
            .artifact_for("worker", "0.2.0", "linux", "x86_64")
            .expect("artifact");
        verify_sha256(artifact, bytes).expect("checksum");
    }

    #[test]
    fn checksum_mismatch_is_rejected() {
        let artifact = UpdateArtifact {
            component: "worker".to_string(),
            version: "0.2.0".to_string(),
            os: "linux".to_string(),
            arch: "x86_64".to_string(),
            url: "https://example.test/worker".to_string(),
            sha256: "00".repeat(32),
            size_bytes: None,
        };
        assert!(verify_sha256(&artifact, b"wrong").is_err());
    }

    #[test]
    fn unsupported_manifest_version_is_rejected() {
        let error = UpdateManifest::parse(r#"{"version":2,"artifacts":[]}"#)
            .expect_err("manifest should be rejected");
        assert!(format!("{error}").contains("unsupported update manifest version"));
    }

    #[test]
    fn artifact_size_mismatch_is_rejected() {
        let bytes = b"proliferate";
        let artifact = UpdateArtifact {
            component: "worker".to_string(),
            version: "0.2.0".to_string(),
            os: "linux".to_string(),
            arch: "x86_64".to_string(),
            url: "https://example.test/worker".to_string(),
            sha256: format!("{:x}", Sha256::digest(bytes)),
            size_bytes: Some(bytes.len() as u64 + 1),
        };
        assert!(verify_sha256(&artifact, bytes).is_err());
    }
}
