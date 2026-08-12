use std::{
    collections::BTreeSet,
    os::{fd::OwnedFd, unix::ffi::OsStrExt},
    path::{Component, Path},
    time::Instant,
};

use super::super::{
    validate_artifact_id, ArtifactStoreError, ReconciledArtifactState, ReconciledSupportArtifact,
    SupportArtifactReference,
};
use super::{
    fs_support::{
        cstring_component, ensure_root, for_each_entry, open_compat_directory_at,
        open_existing_compat_directory, remove_directory_if_empty, safe_compat_file_metadata_cstr,
        safe_file_metadata_at, sync_directory, unlink_cstr, unlink_file_at,
    },
    verify_open,
};

pub(super) fn reconcile(
    root: &Path,
    attachment_root: &Path,
    artifacts: &[SupportArtifactReference],
    attachment_paths: &[String],
    deadline: Instant,
) -> Result<Vec<ReconciledSupportArtifact>, ArtifactStoreError> {
    require_time(deadline)?;
    let directory = ensure_root(root)?;
    let referenced = artifacts
        .iter()
        .map(|item| item.artifact_id.as_str())
        .collect::<BTreeSet<_>>();
    let mut states = Vec::with_capacity(artifacts.len());
    for reference in artifacts {
        require_time(deadline)?;
        let state = match verify_open(&directory, reference) {
            Ok(_) => ReconciledArtifactState::Verified,
            Err(ArtifactStoreError::Missing) => ReconciledArtifactState::Missing,
            Err(
                ArtifactStoreError::Mismatch
                | ArtifactStoreError::UnsafeMetadata
                | ArtifactStoreError::Io,
            ) => ReconciledArtifactState::Mismatch,
            Err(error) => return Err(error),
        };
        states.push(ReconciledSupportArtifact {
            reference: reference.clone(),
            state,
        });
    }
    require_time(deadline)?;
    sweep_artifacts(&directory, &referenced, deadline)?;
    require_time(deadline)?;
    sweep_attachments(attachment_root, attachment_paths, deadline)?;
    require_time(deadline)?;
    Ok(states)
}

fn sweep_artifacts(
    directory: &OwnedFd,
    referenced: &BTreeSet<&str>,
    deadline: Instant,
) -> Result<(), ArtifactStoreError> {
    require_time(deadline)?;
    for_each_entry(directory, |name| {
        require_time(deadline)?;
        let Some(name_text) = std::str::from_utf8(name).ok() else {
            return Ok(());
        };
        let removable = if let Some(artifact_id) = final_artifact_id(name_text) {
            !referenced.contains(artifact_id)
        } else {
            valid_partial_name(name_text)
        };
        if removable {
            match safe_file_metadata_at(directory, name_text) {
                Ok(_) => unlink_file_at(directory, name_text)?,
                Err(ArtifactStoreError::Missing | ArtifactStoreError::UnsafeMetadata) => {}
                Err(error) => return Err(error),
            }
        }
        Ok(())
    })?;
    require_time(deadline)?;
    sync_directory(directory)
}

fn sweep_attachments(
    root: &Path,
    referenced_paths: &[String],
    deadline: Instant,
) -> Result<(), ArtifactStoreError> {
    require_time(deadline)?;
    let referenced = attachment_reference_keys(root, referenced_paths)?;
    let Some(root_fd) = open_existing_compat_directory(root)? else {
        return Ok(());
    };
    for_each_entry(&root_fd, |directory_name| {
        require_time(deadline)?;
        let Ok(child) = open_compat_directory_at(&root_fd, directory_name) else {
            return Ok(());
        };
        for_each_entry(&child, |file_name| {
            require_time(deadline)?;
            let key = attachment_key(directory_name, file_name);
            if !referenced.contains(&key) {
                let file_name = cstring_component(file_name)?;
                match safe_compat_file_metadata_cstr(&child, &file_name) {
                    Ok(_) => unlink_cstr(&child, &file_name)?,
                    Err(ArtifactStoreError::Missing | ArtifactStoreError::UnsafeMetadata) => {}
                    Err(error) => return Err(error),
                }
            }
            Ok(())
        })?;
        sync_directory(&child)?;
        let _ = remove_directory_if_empty(&root_fd, directory_name);
        Ok(())
    })?;
    require_time(deadline)?;
    sync_directory(&root_fd)
}

fn attachment_reference_keys(
    root: &Path,
    paths: &[String],
) -> Result<BTreeSet<Vec<u8>>, ArtifactStoreError> {
    let mut keys = BTreeSet::new();
    for value in paths {
        let path = Path::new(value);
        if !path.is_absolute() {
            return Err(ArtifactStoreError::InvalidInput);
        }
        let relative = path
            .strip_prefix(root)
            .map_err(|_| ArtifactStoreError::InvalidInput)?;
        let mut components = relative.components();
        let (Some(Component::Normal(directory)), Some(Component::Normal(file)), None) =
            (components.next(), components.next(), components.next())
        else {
            return Err(ArtifactStoreError::InvalidInput);
        };
        keys.insert(attachment_key(directory.as_bytes(), file.as_bytes()));
    }
    Ok(keys)
}

fn attachment_key(directory: &[u8], file: &[u8]) -> Vec<u8> {
    let mut key = Vec::with_capacity(directory.len() + file.len() + 1);
    key.extend_from_slice(directory);
    key.push(b'/');
    key.extend_from_slice(file);
    key
}

fn final_artifact_id(name: &str) -> Option<&str> {
    let id = name.strip_suffix(".json")?;
    validate_artifact_id(id).ok().map(|_| id)
}

fn valid_partial_name(name: &str) -> bool {
    let Some(body) = name.strip_suffix(".json.partial") else {
        return false;
    };
    let Some((artifact_id, preparation)) = body.split_once('.') else {
        return false;
    };
    validate_artifact_id(artifact_id).is_ok()
        && uuid::Uuid::parse_str(preparation).is_ok_and(|value| value.to_string() == preparation)
}

fn require_time(deadline: Instant) -> Result<(), ArtifactStoreError> {
    (Instant::now() < deadline)
        .then_some(())
        .ok_or(ArtifactStoreError::Deadline)
}
