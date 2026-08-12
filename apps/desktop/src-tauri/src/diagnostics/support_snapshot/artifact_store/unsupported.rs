use std::{path::Path, time::Instant};

use super::{
    ArtifactStoreError, ReconciledSupportArtifact, StoredSupportArtifact, SupportArtifactReference,
};

pub(super) fn stage(
    _root: &Path,
    _artifact_id: &str,
    _preparation_id: &str,
    _bytes: &[u8],
) -> Result<StoredSupportArtifact, ArtifactStoreError> {
    Err(ArtifactStoreError::Unsupported)
}

pub(super) fn verify(
    _root: &Path,
    _reference: &SupportArtifactReference,
) -> Result<StoredSupportArtifact, ArtifactStoreError> {
    Err(ArtifactStoreError::Unsupported)
}

pub(super) fn read_verified(
    _root: &Path,
    _reference: &SupportArtifactReference,
) -> Result<Vec<u8>, ArtifactStoreError> {
    Err(ArtifactStoreError::Unsupported)
}

pub(super) fn delete(_root: &Path, _artifact_id: &str) -> Result<(), ArtifactStoreError> {
    Err(ArtifactStoreError::Unsupported)
}

pub(super) fn save_archive(_output_path: &Path, _bytes: &[u8]) -> Result<(), ArtifactStoreError> {
    Err(ArtifactStoreError::Unsupported)
}

pub(super) fn reconcile(
    _root: &Path,
    _attachment_root: &Path,
    _artifacts: &[SupportArtifactReference],
    _attachment_paths: &[String],
    _deadline: Instant,
) -> Result<Vec<ReconciledSupportArtifact>, ArtifactStoreError> {
    Err(ArtifactStoreError::Unsupported)
}
