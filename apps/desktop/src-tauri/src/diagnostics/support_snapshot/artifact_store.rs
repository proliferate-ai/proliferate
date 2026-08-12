//! Durable, job-bound storage for one consented support snapshot.
//!
//! This owner accepts only opaque artifact IDs derived from canonical job
//! UUIDs. Paths never cross the command boundary. Final artifacts are
//! immutable; retries reopen and verify the same size and SHA-256 rather than
//! recapturing or substituting evidence.

use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::Instant,
};

use sha2::{Digest, Sha256};

pub(crate) const ARTIFACT_ROOT_LEAF: &str = "support-report-snapshots";
pub(crate) const ARTIFACT_DOMAIN: &[u8] = b"proliferate-support-snapshot-v1\0";
pub(crate) const ARTIFACT_PREFIX: &str = "ssv1_";
pub(crate) const ARTIFACT_MAX_BYTES: u64 = 26_214_400;
pub(crate) const MAX_ARTIFACT_REFERENCES: usize = 10;
pub(crate) const MAX_ATTACHMENT_REFERENCES: usize = 200;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct StoredSupportArtifact {
    pub(crate) artifact_id: String,
    pub(crate) size_bytes: u64,
    pub(crate) sha256: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct SupportArtifactReference {
    pub(crate) artifact_id: String,
    pub(crate) size_bytes: u64,
    pub(crate) sha256: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ReconciledArtifactState {
    Verified,
    Missing,
    Mismatch,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ReconciledSupportArtifact {
    pub(crate) reference: SupportArtifactReference,
    pub(crate) state: ReconciledArtifactState,
}

#[derive(Debug)]
pub(crate) enum ArtifactStoreError {
    InvalidInput,
    NotReady,
    AlreadyExists,
    Missing,
    Mismatch,
    UnsafeMetadata,
    Deadline,
    Io,
    Archive,
    Unsupported,
}

pub(crate) struct SupportArtifactStore {
    root: PathBuf,
    attachment_root: PathBuf,
    reconciled: AtomicBool,
}

impl SupportArtifactStore {
    /// Both roots come only from native app configuration. No command accepts
    /// either path from the renderer.
    pub(crate) fn new() -> Result<Self, ArtifactStoreError> {
        let app_dir = crate::app_config::app_dir_path().map_err(|_| ArtifactStoreError::Io)?;
        let attachment_root = crate::commands::support::support_attachment_dir()
            .map_err(|_| ArtifactStoreError::Io)?;
        Ok(Self::from_roots(&app_dir, &attachment_root))
    }

    fn from_roots(app_dir: &Path, attachment_root: &Path) -> Self {
        Self {
            root: app_dir.join(ARTIFACT_ROOT_LEAF),
            attachment_root: attachment_root.to_path_buf(),
            reconciled: AtomicBool::new(false),
        }
    }

    pub(crate) fn artifact_id(client_job_id: &str) -> Result<String, ArtifactStoreError> {
        let job =
            uuid::Uuid::parse_str(client_job_id).map_err(|_| ArtifactStoreError::InvalidInput)?;
        if job.to_string() != client_job_id {
            return Err(ArtifactStoreError::InvalidInput);
        }
        let mut hasher = Sha256::new();
        hasher.update(ARTIFACT_DOMAIN);
        hasher.update(client_job_id.as_bytes());
        Ok(format!("{ARTIFACT_PREFIX}{:x}", hasher.finalize()))
    }

    pub(crate) fn stage(
        &self,
        client_job_id: &str,
        preparation_id: &str,
        bytes: &[u8],
    ) -> Result<StoredSupportArtifact, ArtifactStoreError> {
        self.require_ready()?;
        let artifact_id = Self::artifact_id(client_job_id)?;
        require_canonical_uuid(preparation_id)?;
        if bytes.len() as u64 > ARTIFACT_MAX_BYTES {
            return Err(ArtifactStoreError::InvalidInput);
        }
        platform::stage(&self.root, &artifact_id, preparation_id, bytes)
    }

    pub(crate) fn verify(
        &self,
        reference: &SupportArtifactReference,
    ) -> Result<StoredSupportArtifact, ArtifactStoreError> {
        validate_reference(reference)?;
        platform::verify(&self.root, reference)
    }

    pub(crate) fn read_verified(
        &self,
        reference: &SupportArtifactReference,
    ) -> Result<Vec<u8>, ArtifactStoreError> {
        validate_reference(reference)?;
        platform::read_verified(&self.root, reference)
    }

    pub(crate) fn delete(&self, artifact_id: &str) -> Result<(), ArtifactStoreError> {
        validate_artifact_id(artifact_id)?;
        platform::delete(&self.root, artifact_id)
    }

    pub(crate) fn save_archive(
        &self,
        reference: &SupportArtifactReference,
        output_path: &Path,
    ) -> Result<(), ArtifactStoreError> {
        let bytes = self.read_verified(reference)?;
        platform::save_archive(output_path, &bytes)
    }

    /// The queue owner calls this once only after ProductStorage hydration has
    /// supplied the complete bounded reference set. A successful sweep opens
    /// preparation admission for this app boot.
    pub(crate) fn reconcile(
        &self,
        artifacts: &[SupportArtifactReference],
        referenced_attachment_paths: &[String],
        deadline: Instant,
    ) -> Result<Vec<ReconciledSupportArtifact>, ArtifactStoreError> {
        self.reconciled.store(false, Ordering::Release);
        if artifacts.len() > MAX_ARTIFACT_REFERENCES
            || referenced_attachment_paths.len() > MAX_ATTACHMENT_REFERENCES
        {
            return Err(ArtifactStoreError::InvalidInput);
        }
        let mut references = BTreeMap::new();
        for reference in artifacts {
            validate_reference(reference)?;
            if let Some(existing) = references.insert(reference.artifact_id.clone(), reference) {
                if existing != reference {
                    return Err(ArtifactStoreError::InvalidInput);
                }
            }
        }
        let states = platform::reconcile(
            &self.root,
            &self.attachment_root,
            artifacts,
            referenced_attachment_paths,
            deadline,
        )?;
        self.reconciled.store(true, Ordering::Release);
        Ok(states)
    }

    fn require_ready(&self) -> Result<(), ArtifactStoreError> {
        self.reconciled
            .load(Ordering::Acquire)
            .then_some(())
            .ok_or(ArtifactStoreError::NotReady)
    }

    #[cfg(test)]
    pub(super) fn for_test(app_dir: &Path, attachment_root: &Path) -> Self {
        Self::from_roots(app_dir, attachment_root)
    }

    #[cfg(test)]
    pub(super) fn root(&self) -> &Path {
        &self.root
    }
}

fn require_canonical_uuid(value: &str) -> Result<(), ArtifactStoreError> {
    let parsed = uuid::Uuid::parse_str(value).map_err(|_| ArtifactStoreError::InvalidInput)?;
    (parsed.to_string() == value)
        .then_some(())
        .ok_or(ArtifactStoreError::InvalidInput)
}

fn validate_reference(reference: &SupportArtifactReference) -> Result<(), ArtifactStoreError> {
    validate_artifact_id(&reference.artifact_id)?;
    if reference.size_bytes > ARTIFACT_MAX_BYTES || !valid_sha256(&reference.sha256) {
        return Err(ArtifactStoreError::InvalidInput);
    }
    Ok(())
}

fn validate_artifact_id(value: &str) -> Result<(), ArtifactStoreError> {
    let digest = value
        .strip_prefix(ARTIFACT_PREFIX)
        .ok_or(ArtifactStoreError::InvalidInput)?;
    if digest.len() != 64
        || !digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(ArtifactStoreError::InvalidInput);
    }
    Ok(())
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[cfg(unix)]
#[path = "artifact_store/unix.rs"]
mod platform;

#[cfg(not(unix))]
#[path = "artifact_store/unsupported.rs"]
mod platform;

#[cfg(test)]
#[path = "artifact_store_tests.rs"]
mod tests;
