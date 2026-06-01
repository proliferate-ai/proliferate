use std::io::Write;
use std::path::Path;

use super::super::safety::resolve_safe_path;
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

    let abs = resolve_safe_path(workspace_root, relative_path).map_err(FileServiceError::Safety)?;
    if abs.exists() {
        return Err(FileServiceError::AlreadyExists(relative_path.to_string()));
    }
    let parent = abs
        .parent()
        .ok_or_else(|| FileServiceError::NotADirectory(relative_path.to_string()))?;
    if !parent.is_dir() {
        return Err(FileServiceError::NotADirectory(
            parent
                .strip_prefix(workspace_root)
                .ok()
                .and_then(|path| path.to_str())
                .unwrap_or(relative_path)
                .to_string(),
        ));
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
                .map_err(|e| FileServiceError::Io(e.to_string()))?;
            file.sync_all()
                .map_err(|e| FileServiceError::Io(e.to_string()))?;
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
    FileServiceError::Io(error.to_string())
}
