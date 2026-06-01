use std::path::Path;

use super::super::safety::resolve_safe_entry_path;
use super::super::types::{FileServiceError, RenameWorkspaceFileEntryResult};
use super::entry::{entry_for_path, map_metadata_not_found};

pub fn rename_entry(
    workspace_root: &Path,
    relative_path: &str,
    new_relative_path: &str,
) -> Result<RenameWorkspaceFileEntryResult, FileServiceError> {
    if relative_path.is_empty() {
        return Err(FileServiceError::InvalidRenameRequest(
            "path is required".to_string(),
        ));
    }
    if new_relative_path.is_empty() {
        return Err(FileServiceError::InvalidRenameRequest(
            "new path is required".to_string(),
        ));
    }

    let abs_from =
        resolve_safe_entry_path(workspace_root, relative_path).map_err(FileServiceError::Safety)?;
    let source_metadata = std::fs::symlink_metadata(&abs_from)
        .map_err(|e| map_metadata_not_found(e, relative_path))?;

    let abs_to = resolve_safe_entry_path(workspace_root, new_relative_path)
        .map_err(FileServiceError::Safety)?;
    if std::fs::symlink_metadata(&abs_to).is_ok() {
        return Err(FileServiceError::AlreadyExists(
            new_relative_path.to_string(),
        ));
    }
    let parent = abs_to
        .parent()
        .ok_or_else(|| FileServiceError::NotADirectory(new_relative_path.to_string()))?;
    if !parent.is_dir() {
        return Err(FileServiceError::NotADirectory(
            new_relative_path.to_string(),
        ));
    }

    if source_metadata.is_dir()
        && !source_metadata.file_type().is_symlink()
        && abs_to.starts_with(&abs_from)
    {
        return Err(FileServiceError::InvalidRenameRequest(
            "directory cannot be moved inside itself".to_string(),
        ));
    }

    std::fs::rename(&abs_from, &abs_to)
        .map_err(|e| map_rename_io_error(e, relative_path, new_relative_path))?;

    Ok(RenameWorkspaceFileEntryResult {
        old_path: relative_path.to_string(),
        entry: entry_for_path(new_relative_path, &abs_to)?,
    })
}

fn map_rename_io_error(
    error: std::io::Error,
    relative_path: &str,
    new_relative_path: &str,
) -> FileServiceError {
    match error.kind() {
        std::io::ErrorKind::AlreadyExists => {
            FileServiceError::AlreadyExists(new_relative_path.to_string())
        }
        std::io::ErrorKind::NotFound => FileServiceError::NotFound(relative_path.to_string()),
        _ => FileServiceError::Io(error.to_string()),
    }
}
