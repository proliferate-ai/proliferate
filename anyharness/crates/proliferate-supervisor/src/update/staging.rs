use std::{
    fs::{self, File, OpenOptions},
    io::{ErrorKind, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

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
    set_private_dir_permissions(staging_dir)?;
    let file_name = staging_file_name(artifact)?;
    let path = staging_dir.join(&file_name);
    let (temp_path, mut temp_file) = create_private_temp_file(staging_dir, &file_name)?;
    if let Err(source) = temp_file.write_all(bytes) {
        let _ = fs::remove_file(&temp_path);
        return Err(SupervisorError::WriteUpdateArtifact {
            path: temp_path,
            source,
        });
    }
    if let Err(source) = temp_file.sync_all() {
        let _ = fs::remove_file(&temp_path);
        return Err(SupervisorError::WriteUpdateArtifact {
            path: temp_path,
            source,
        });
    }
    drop(temp_file);
    fs::rename(&temp_path, &path).map_err(|source| SupervisorError::WriteUpdateArtifact {
        path: path.clone(),
        source,
    })?;
    set_artifact_permissions(&path)?;
    sync_parent_dir(staging_dir);
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

fn create_private_temp_file(
    staging_dir: &Path,
    file_name: &str,
) -> Result<(PathBuf, File), SupervisorError> {
    for attempt in 0..16 {
        let temp_path = staging_dir.join(temp_file_name(file_name, attempt));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        options.mode(0o700);
        match options.open(&temp_path) {
            Ok(file) => return Ok((temp_path, file)),
            Err(source) if source.kind() == ErrorKind::AlreadyExists => continue,
            Err(source) => {
                return Err(SupervisorError::WriteUpdateArtifact {
                    path: temp_path,
                    source,
                });
            }
        }
    }
    Err(SupervisorError::WriteUpdateArtifact {
        path: staging_dir.join(format!(".{file_name}.tmp")),
        source: std::io::Error::new(
            ErrorKind::AlreadyExists,
            "could not create unique update artifact temp file",
        ),
    })
}

fn temp_file_name(file_name: &str, attempt: u32) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!(
        ".{file_name}.tmp.{}.{}.{}",
        std::process::id(),
        nanos,
        attempt
    )
}

fn sync_parent_dir(parent: &Path) {
    if let Ok(directory) = File::open(parent) {
        let _ = directory.sync_all();
    }
}

fn set_private_dir_permissions(path: &Path) -> Result<(), SupervisorError> {
    #[cfg(unix)]
    {
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|source| {
            SupervisorError::SetPrivatePermissions {
                path: path.to_path_buf(),
                source,
            }
        })?;
    }
    Ok(())
}

fn set_artifact_permissions(path: &Path) -> Result<(), SupervisorError> {
    #[cfg(unix)]
    {
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|source| {
            SupervisorError::SetPrivatePermissions {
                path: path.to_path_buf(),
                source,
            }
        })?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use sha2::{Digest, Sha256};

    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

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
        assert_eq!(std::fs::read(&staged.path).expect("read staged"), bytes);
        #[cfg(unix)]
        {
            let dir_mode = std::fs::metadata(&dir)
                .expect("staging dir metadata")
                .permissions()
                .mode()
                & 0o777;
            let artifact_mode = std::fs::metadata(&staged.path)
                .expect("staged artifact metadata")
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(dir_mode, 0o700);
            assert_eq!(artifact_mode, 0o700);
        }
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
