use std::{
    fs::{self, File, OpenOptions},
    io,
    io::{Read, Write},
    os::unix::{fs::OpenOptionsExt, fs::PermissionsExt},
    path::Path,
    time::Instant,
};

use sha2::{Digest, Sha256};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

use super::{
    digest, ArtifactStoreError, ReconciledSupportArtifact, StoredSupportArtifact,
    SupportArtifactReference, ARTIFACT_MAX_BYTES,
};

const VERIFY_CHUNK_BYTES: usize = 65_536;

pub(crate) trait ReconcileHooks {
    fn now(&mut self) -> Instant;
    fn read(&mut self, file: &mut File, destination: &mut [u8]) -> io::Result<usize>;
}

struct SystemReconcileHooks;

impl ReconcileHooks for SystemReconcileHooks {
    fn now(&mut self) -> Instant {
        Instant::now()
    }

    fn read(&mut self, file: &mut File, destination: &mut [u8]) -> io::Result<usize> {
        file.read(destination)
    }
}

#[path = "unix_fs.rs"]
mod fs_support;
#[path = "unix_reconcile.rs"]
mod reconciliation;

use fs_support::{
    create_private_file_at, ensure_root, map_create_error, open_existing_root, open_safe_file_at,
    rename_noreplace_at, rename_path_noreplace, safe_file_metadata_at, sync_directory,
    unlink_file_at, PartialCleanup, PathCleanup, OPEN_DIR_FLAGS,
};

pub(super) fn stage(
    root: &Path,
    client_job_id: &str,
    artifact_id: &str,
    snapshot_id: &str,
    preparation_id: &str,
    bytes: &[u8],
) -> Result<StoredSupportArtifact, ArtifactStoreError> {
    stage_with_verifier(
        root,
        client_job_id,
        artifact_id,
        snapshot_id,
        preparation_id,
        bytes,
        verify_open,
    )
}

fn stage_with_verifier(
    root: &Path,
    client_job_id: &str,
    artifact_id: &str,
    snapshot_id: &str,
    preparation_id: &str,
    bytes: &[u8],
    verify: impl FnOnce(&std::os::fd::OwnedFd, &str, u64, &str) -> Result<Vec<u8>, ArtifactStoreError>,
) -> Result<StoredSupportArtifact, ArtifactStoreError> {
    // Creation through directory durability is the staging phase. The final
    // safe reopen is the only verification phase; cleanup stays armed across
    // both so neither failure can leave this attempt's bytes behind.
    let directory = ensure_root(root).map_err(|_| ArtifactStoreError::StageFailed)?;
    let partial_name = format!("{artifact_id}.{preparation_id}.json.partial");
    let final_name = format!("{artifact_id}.json");
    let partial = create_private_file_at(&directory, &partial_name)
        .map_err(|_| ArtifactStoreError::StageFailed)?;
    let mut cleanup = PartialCleanup::new(&directory, partial_name.clone());
    let mut file = File::from(partial);
    file.write_all(bytes)
        .map_err(|_| ArtifactStoreError::StageFailed)?;
    file.sync_all()
        .map_err(|_| ArtifactStoreError::StageFailed)?;
    drop(file);
    rename_noreplace_at(&directory, &partial_name, &final_name)
        .map_err(|_| ArtifactStoreError::StageFailed)?;
    cleanup.track(final_name);
    sync_directory(&directory).map_err(|_| ArtifactStoreError::StageFailed)?;
    let size_bytes = bytes.len() as u64;
    let sha256 = digest(bytes);
    verify(&directory, artifact_id, size_bytes, &sha256)
        .map_err(|_| ArtifactStoreError::ArtifactVerificationFailed)?;
    cleanup.disarm();
    Ok(StoredSupportArtifact {
        client_job_id: client_job_id.to_owned(),
        artifact_id: artifact_id.to_owned(),
        snapshot_id: snapshot_id.to_owned(),
        size_bytes,
        sha256,
    })
}

pub(super) fn verify(
    root: &Path,
    reference: &SupportArtifactReference,
) -> Result<StoredSupportArtifact, ArtifactStoreError> {
    let directory = open_existing_root(root)?.ok_or(ArtifactStoreError::Missing)?;
    verify_open(
        &directory,
        &reference.artifact_id,
        reference.size_bytes,
        &reference.sha256,
    )?;
    Ok(StoredSupportArtifact {
        client_job_id: reference.client_job_id.clone(),
        artifact_id: reference.artifact_id.clone(),
        snapshot_id: reference.snapshot_id.clone(),
        size_bytes: reference.size_bytes,
        sha256: reference.sha256.clone(),
    })
}

pub(super) fn read_verified(
    root: &Path,
    reference: &SupportArtifactReference,
) -> Result<Vec<u8>, ArtifactStoreError> {
    let directory = open_existing_root(root)?.ok_or(ArtifactStoreError::Missing)?;
    verify_open(
        &directory,
        &reference.artifact_id,
        reference.size_bytes,
        &reference.sha256,
    )
}

pub(super) fn delete(root: &Path, artifact_id: &str) -> Result<(), ArtifactStoreError> {
    let Some(directory) = open_existing_root(root)? else {
        return Ok(());
    };
    let name = format!("{artifact_id}.json");
    match safe_file_metadata_at(&directory, &name) {
        Ok(_) => unlink_file_at(&directory, &name)?,
        Err(ArtifactStoreError::Missing) => return Ok(()),
        Err(error) => return Err(error),
    }
    sync_directory(&directory)
}

pub(super) fn save_archive(output_path: &Path, bytes: &[u8]) -> Result<(), ArtifactStoreError> {
    let parent = output_path
        .parent()
        .ok_or(ArtifactStoreError::InvalidInput)?;
    if !output_path.is_absolute() {
        return Err(ArtifactStoreError::InvalidInput);
    }
    let file_name = output_path
        .file_name()
        .filter(|name| !name.is_empty())
        .ok_or(ArtifactStoreError::InvalidInput)?;
    let partial_path = parent.join(format!(
        ".{}.{}.partial",
        file_name.to_string_lossy(),
        uuid::Uuid::new_v4()
    ));
    let partial = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW)
        .open(&partial_path)
        .map_err(map_create_error)?;
    let mut cleanup = PathCleanup::new(partial_path.clone());
    partial
        .set_permissions(fs::Permissions::from_mode(0o600))
        .map_err(|_| ArtifactStoreError::Io)?;
    let mut zip = ZipWriter::new(partial);
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o600);
    zip.start_file("diagnostics.json", options)
        .map_err(|_| ArtifactStoreError::Archive)?;
    zip.write_all(bytes)
        .map_err(|_| ArtifactStoreError::Archive)?;
    let file = zip.finish().map_err(|_| ArtifactStoreError::Archive)?;
    file.sync_all().map_err(|_| ArtifactStoreError::Io)?;
    drop(file);
    rename_path_noreplace(&partial_path, output_path)?;
    cleanup.track(output_path.to_path_buf());
    let parent_file = OpenOptions::new()
        .read(true)
        .custom_flags(OPEN_DIR_FLAGS)
        .open(parent)
        .map_err(|_| ArtifactStoreError::Io)?;
    parent_file.sync_all().map_err(|_| ArtifactStoreError::Io)?;
    cleanup.disarm();
    Ok(())
}

pub(super) fn reconcile(
    root: &Path,
    attachment_root: &Path,
    artifacts: &[SupportArtifactReference],
    attachment_paths: &[String],
    deadline: Instant,
) -> Result<Vec<ReconciledSupportArtifact>, ArtifactStoreError> {
    reconciliation::reconcile_with_hooks(
        root,
        attachment_root,
        artifacts,
        attachment_paths,
        deadline,
        &mut SystemReconcileHooks,
    )
}

#[cfg(test)]
pub(super) fn reconcile_with_hooks(
    root: &Path,
    attachment_root: &Path,
    artifacts: &[SupportArtifactReference],
    attachment_paths: &[String],
    deadline: Instant,
    hooks: &mut impl ReconcileHooks,
) -> Result<Vec<ReconciledSupportArtifact>, ArtifactStoreError> {
    reconciliation::reconcile_with_hooks(
        root,
        attachment_root,
        artifacts,
        attachment_paths,
        deadline,
        hooks,
    )
}

pub(super) fn verify_open(
    directory: &std::os::fd::OwnedFd,
    artifact_id: &str,
    expected_size: u64,
    expected_sha256: &str,
) -> Result<Vec<u8>, ArtifactStoreError> {
    let name = format!("{artifact_id}.json");
    let (descriptor, size) = open_safe_file_at(directory, &name)?;
    if size != expected_size || size > ARTIFACT_MAX_BYTES {
        return Err(ArtifactStoreError::Mismatch);
    }
    let mut file = File::from(descriptor);
    let mut bytes = Vec::with_capacity(size as usize);
    Read::by_ref(&mut file)
        .take(size.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|_| ArtifactStoreError::Io)?;
    if bytes.len() as u64 != size || digest(&bytes) != expected_sha256 {
        return Err(ArtifactStoreError::Mismatch);
    }
    Ok(bytes)
}

pub(super) fn verify_open_until(
    directory: &std::os::fd::OwnedFd,
    reference: &SupportArtifactReference,
    deadline: Instant,
    hooks: &mut impl ReconcileHooks,
) -> Result<(), ArtifactStoreError> {
    require_deadline(deadline, hooks)?;
    let name = format!("{}.json", reference.artifact_id);
    let (descriptor, size) = open_safe_file_at(directory, &name)?;
    if size != reference.size_bytes || size > ARTIFACT_MAX_BYTES {
        return Err(ArtifactStoreError::Mismatch);
    }
    let mut file = File::from(descriptor);
    let mut hasher = Sha256::new();
    let mut remaining = size;
    let mut buffer = [0_u8; VERIFY_CHUNK_BYTES];
    while remaining > 0 {
        require_deadline(deadline, hooks)?;
        let requested = usize::try_from(remaining.min(VERIFY_CHUNK_BYTES as u64))
            .map_err(|_| ArtifactStoreError::Mismatch)?;
        let read = hooks
            .read(&mut file, &mut buffer[..requested])
            .map_err(|_| ArtifactStoreError::Io)?;
        if read == 0 || read > requested {
            return Err(ArtifactStoreError::Mismatch);
        }
        hasher.update(&buffer[..read]);
        remaining -= read as u64;
        require_deadline(deadline, hooks)?;
    }
    require_deadline(deadline, hooks)?;
    let mut extra = [0_u8; 1];
    let extra_read = hooks
        .read(&mut file, &mut extra)
        .map_err(|_| ArtifactStoreError::Io)?;
    require_deadline(deadline, hooks)?;
    let actual_sha256 = format!("{:x}", hasher.finalize());
    if extra_read != 0 || actual_sha256 != reference.sha256 {
        return Err(ArtifactStoreError::Mismatch);
    }
    Ok(())
}

fn require_deadline(
    deadline: Instant,
    hooks: &mut impl ReconcileHooks,
) -> Result<(), ArtifactStoreError> {
    (hooks.now() < deadline)
        .then_some(())
        .ok_or(ArtifactStoreError::Deadline)
}

#[cfg(test)]
mod stage_tests {
    use super::super::SupportArtifactStore;
    use super::*;

    fn fixture_root() -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "proliferate-support-stage-phase-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir(&root).expect("create stage fixture root");
        root
    }

    #[test]
    fn rename_conflict_is_stage_failed_and_cleans_only_its_partial() {
        let app = fixture_root();
        let root = app.join("artifacts");
        let client_job_id = uuid::Uuid::new_v4().to_string();
        let artifact_id = SupportArtifactStore::artifact_id(&client_job_id).expect("artifact id");
        stage(
            &root,
            &client_job_id,
            &artifact_id,
            "snapshot-one",
            &uuid::Uuid::new_v4().to_string(),
            b"original",
        )
        .expect("first stage");
        let second_preparation = uuid::Uuid::new_v4().to_string();
        assert!(matches!(
            stage(
                &root,
                &client_job_id,
                &artifact_id,
                "snapshot-two",
                &second_preparation,
                b"replacement",
            ),
            Err(ArtifactStoreError::StageFailed)
        ));
        assert_eq!(
            fs::read(root.join(format!("{artifact_id}.json"))).expect("existing final"),
            b"original"
        );
        assert!(!root
            .join(format!("{artifact_id}.{second_preparation}.json.partial"))
            .exists());
        fs::remove_dir_all(app).ok();
    }

    #[test]
    fn verification_failure_is_distinct_and_cleans_renamed_final() {
        let app = fixture_root();
        let root = app.join("artifacts");
        let client_job_id = uuid::Uuid::new_v4().to_string();
        let artifact_id = SupportArtifactStore::artifact_id(&client_job_id).expect("artifact id");
        let preparation_id = uuid::Uuid::new_v4().to_string();
        let final_path = root.join(format!("{artifact_id}.json"));
        let expected_sha256 = digest(b"diagnostics");
        assert!(matches!(
            stage_with_verifier(
                &root,
                &client_job_id,
                &artifact_id,
                "snapshot",
                &preparation_id,
                b"diagnostics",
                |_, received_artifact_id, size, sha256| {
                    assert_eq!(received_artifact_id, artifact_id.as_str());
                    assert_eq!(size, b"diagnostics".len() as u64);
                    assert_eq!(sha256, expected_sha256.as_str());
                    assert_eq!(
                        fs::read(&final_path).expect("renamed final"),
                        b"diagnostics"
                    );
                    Err(ArtifactStoreError::Mismatch)
                },
            ),
            Err(ArtifactStoreError::ArtifactVerificationFailed)
        ));
        assert!(!final_path.exists());
        assert!(!root
            .join(format!("{artifact_id}.{preparation_id}.json.partial"))
            .exists());
        fs::remove_dir_all(app).ok();
    }
}
