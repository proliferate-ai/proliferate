use std::io::Write;
use std::path::Path;

use super::super::safety::{resolve_safe_entry_path, resolve_safe_path, SafetyError};
use super::super::types::{
    CreateWorkspaceFileEntryKind, CreateWorkspaceFileEntryResult, FileServiceError,
};
use super::entry::entry_for_path;
use super::read::read_file;

pub fn create_entry(
    workspace_root: &Path,
    relative_path: &str,
    kind: CreateWorkspaceFileEntryKind,
    content: Option<&str>,
) -> Result<CreateWorkspaceFileEntryResult, FileServiceError> {
    if relative_path.is_empty() {
        return Err(FileServiceError::InvalidCreateRequest(
            "path is required".to_string(),
        ));
    }
    if matches!(kind, CreateWorkspaceFileEntryKind::Directory) && content.is_some() {
        return Err(FileServiceError::InvalidCreateRequest(
            "directory creation does not accept content".to_string(),
        ));
    }

    let abs = resolve_safe_entry_path(workspace_root, relative_path)
        .map_err(|error| FileServiceError::from_safety(error, relative_path))?;
    let parent = abs
        .parent()
        .ok_or_else(|| FileServiceError::NotADirectory(relative_path.to_string()))?;
    let parent_metadata = match parent.metadata() {
        Ok(metadata) => metadata,
        Err(error) => match FileServiceError::from_io(error, relative_path) {
            FileServiceError::NotFound(_) => {
                return Err(FileServiceError::NotADirectory(relative_path.to_string()));
            }
            error => return Err(error),
        },
    };
    if !parent_metadata.is_dir() {
        return Err(FileServiceError::NotADirectory(relative_path.to_string()));
    }
    match abs.symlink_metadata() {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            match resolve_safe_path(workspace_root, relative_path) {
                Ok(_) | Err(SafetyError::NotFound) => {
                    return Err(FileServiceError::AlreadyExists(relative_path.to_string()));
                }
                Err(error) => {
                    return Err(FileServiceError::from_safety(error, relative_path));
                }
            }
        }
        Ok(_) => return Err(FileServiceError::AlreadyExists(relative_path.to_string())),
        Err(error) => match FileServiceError::from_io(error, relative_path) {
            FileServiceError::NotFound(_) => {}
            error => return Err(error),
        },
    }

    match kind {
        CreateWorkspaceFileEntryKind::File => {
            let bytes = content.unwrap_or("").as_bytes();
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&abs)
                .map_err(|e| map_create_io_error(e, relative_path))?;
            file.write_all(bytes)
                .map_err(|error| FileServiceError::from_io(error, relative_path))?;
            file.sync_all()
                .map_err(|error| FileServiceError::from_io(error, relative_path))?;
            let entry = entry_for_path(relative_path, &abs)?;
            let file = read_file(workspace_root, relative_path)?;
            Ok(CreateWorkspaceFileEntryResult {
                entry,
                file: Some(file),
            })
        }
        CreateWorkspaceFileEntryKind::Directory => {
            std::fs::create_dir(&abs).map_err(|e| map_create_io_error(e, relative_path))?;
            Ok(CreateWorkspaceFileEntryResult {
                entry: entry_for_path(relative_path, &abs)?,
                file: None,
            })
        }
    }
}

fn map_create_io_error(error: std::io::Error, relative_path: &str) -> FileServiceError {
    if error.kind() == std::io::ErrorKind::AlreadyExists {
        return FileServiceError::AlreadyExists(relative_path.to_string());
    }
    FileServiceError::from_io(error, relative_path)
}
