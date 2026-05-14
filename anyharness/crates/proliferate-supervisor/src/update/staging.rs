use std::{
    fs,
    path::{Path, PathBuf},
};

use crate::{
    error::SupervisorError,
    update::manifest::{verify_sha256, UpdateArtifact},
};

#[derive(Debug, Clone)]
pub struct StagedArtifact {
    pub component: String,
    pub version: String,
    pub path: PathBuf,
}

pub fn stage_artifact_bytes(
    staging_dir: &Path,
    artifact: &UpdateArtifact,
    bytes: &[u8],
) -> Result<StagedArtifact, SupervisorError> {
    verify_sha256(artifact, bytes)?;
    fs::create_dir_all(staging_dir).map_err(|source| SupervisorError::CreateUpdateStagingDir {
        path: staging_dir.to_path_buf(),
        source,
    })?;
    let file_name = staging_file_name(artifact)?;
    let path = staging_dir.join(&file_name);
    let temp_path = staging_dir.join(format!(".{}.tmp.{}", file_name, std::process::id()));
    fs::write(&temp_path, bytes).map_err(|source| SupervisorError::WriteUpdateArtifact {
        path: temp_path.clone(),
        source,
    })?;
    fs::rename(&temp_path, &path).map_err(|source| SupervisorError::WriteUpdateArtifact {
        path: path.clone(),
        source,
    })?;
    Ok(StagedArtifact {
        component: artifact.component.clone(),
        version: artifact.version.clone(),
        path,
    })
}

pub fn stage_artifact_file(
    staging_dir: &Path,
    artifact: &UpdateArtifact,
    source_path: &Path,
) -> Result<StagedArtifact, SupervisorError> {
    let bytes = fs::read(source_path).map_err(|source| SupervisorError::ReadUpdateArtifact {
        path: source_path.to_path_buf(),
        source,
    })?;
    stage_artifact_bytes(staging_dir, artifact, &bytes)
}

fn staging_file_name(artifact: &UpdateArtifact) -> Result<String, SupervisorError> {
    artifact.validate()?;
    Ok(format!("{}-{}", artifact.component, artifact.version))
}

#[cfg(test)]
mod tests {
    use sha2::{Digest, Sha256};

    use crate::update::manifest::UpdateArtifact;

    use super::stage_artifact_bytes;

    #[test]
    fn stage_artifact_bytes_writes_verified_artifact() {
        let bytes = b"supervisor-bytes";
        let artifact = UpdateArtifact {
            component: "supervisor".to_string(),
            version: "0.2.0".to_string(),
            os: "linux".to_string(),
            arch: "x86_64".to_string(),
            url: "https://example.test/supervisor".to_string(),
            sha256: format!("{:x}", Sha256::digest(bytes)),
            size_bytes: Some(bytes.len() as u64),
        };
        let dir = std::env::temp_dir().join(format!(
            "proliferate-supervisor-stage-test-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        let staged = stage_artifact_bytes(&dir, &artifact, bytes).expect("stage artifact");
        assert_eq!(staged.component, "supervisor");
        assert_eq!(staged.version, "0.2.0");
        assert_eq!(std::fs::read(staged.path).expect("read staged"), bytes);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn stage_artifact_rejects_path_controlled_component() {
        let bytes = b"bad";
        let artifact = UpdateArtifact {
            component: "../worker".to_string(),
            version: "0.2.0".to_string(),
            os: "linux".to_string(),
            arch: "x86_64".to_string(),
            url: "https://example.test/worker".to_string(),
            sha256: format!("{:x}", Sha256::digest(bytes)),
            size_bytes: Some(bytes.len() as u64),
        };
        let dir = std::env::temp_dir().join(format!(
            "proliferate-supervisor-stage-bad-component-test-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        let result = stage_artifact_bytes(&dir, &artifact, bytes);
        assert!(result.is_err());
        let _ = std::fs::remove_dir_all(dir);
    }
}
