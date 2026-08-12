use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    os::unix::{fs::OpenOptionsExt, fs::PermissionsExt},
    path::Path,
    time::Instant,
};

use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

use super::{
    digest, ArtifactStoreError, ReconciledSupportArtifact, StoredSupportArtifact,
    SupportArtifactReference, ARTIFACT_MAX_BYTES,
};

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
    artifact_id: &str,
    preparation_id: &str,
    bytes: &[u8],
) -> Result<StoredSupportArtifact, ArtifactStoreError> {
    let directory = ensure_root(root)?;
    let partial_name = format!("{artifact_id}.{preparation_id}.json.partial");
    let final_name = format!("{artifact_id}.json");
    let partial = create_private_file_at(&directory, &partial_name)?;
    let mut cleanup = PartialCleanup::new(&directory, partial_name.clone());
    let mut file = File::from(partial);
    file.write_all(bytes).map_err(|_| ArtifactStoreError::Io)?;
    file.sync_all().map_err(|_| ArtifactStoreError::Io)?;
    drop(file);
    rename_noreplace_at(&directory, &partial_name, &final_name)?;
    cleanup.track(final_name);
    sync_directory(&directory)?;
    let expected = SupportArtifactReference {
        artifact_id: artifact_id.to_owned(),
        size_bytes: bytes.len() as u64,
        sha256: digest(bytes),
    };
    verify_open(&directory, &expected)?;
    cleanup.disarm();
    Ok(StoredSupportArtifact {
        artifact_id: expected.artifact_id,
        size_bytes: expected.size_bytes,
        sha256: expected.sha256,
    })
}

pub(super) fn verify(
    root: &Path,
    reference: &SupportArtifactReference,
) -> Result<StoredSupportArtifact, ArtifactStoreError> {
    let directory = open_existing_root(root)?.ok_or(ArtifactStoreError::Missing)?;
    verify_open(&directory, reference)?;
    Ok(StoredSupportArtifact {
        artifact_id: reference.artifact_id.clone(),
        size_bytes: reference.size_bytes,
        sha256: reference.sha256.clone(),
    })
}

pub(super) fn read_verified(
    root: &Path,
    reference: &SupportArtifactReference,
) -> Result<Vec<u8>, ArtifactStoreError> {
    let directory = open_existing_root(root)?.ok_or(ArtifactStoreError::Missing)?;
    verify_open(&directory, reference)
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
    reconciliation::reconcile(root, attachment_root, artifacts, attachment_paths, deadline)
}

pub(super) fn verify_open(
    directory: &std::os::fd::OwnedFd,
    reference: &SupportArtifactReference,
) -> Result<Vec<u8>, ArtifactStoreError> {
    let name = format!("{}.json", reference.artifact_id);
    let (descriptor, size) = open_safe_file_at(directory, &name)?;
    if size != reference.size_bytes || size > ARTIFACT_MAX_BYTES {
        return Err(ArtifactStoreError::Mismatch);
    }
    let mut file = File::from(descriptor);
    let mut bytes = Vec::with_capacity(size as usize);
    file.by_ref()
        .take(size.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|_| ArtifactStoreError::Io)?;
    if bytes.len() as u64 != size || digest(&bytes) != reference.sha256 {
        return Err(ArtifactStoreError::Mismatch);
    }
    Ok(bytes)
}
