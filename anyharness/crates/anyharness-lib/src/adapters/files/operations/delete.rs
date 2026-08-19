use std::path::Path;

use super::super::safety::resolve_safe_entry_path;
use super::super::types::{DeleteWorkspaceFileEntryResult, FileServiceError, WorkspaceFileKind};
use super::entry::entry_for_path;

pub fn delete_entry(
    workspace_root: &Path,
    relative_path: &str,
) -> Result<DeleteWorkspaceFileEntryResult, FileServiceError> {
    if relative_path.is_empty() {
        return Err(FileServiceError::InvalidDeleteRequest(
            "path is required".to_string(),
        ));
    }

    let abs = resolve_safe_entry_path(workspace_root, relative_path)
        .map_err(|error| FileServiceError::from_safety(error, relative_path))?;
    std::fs::symlink_metadata(&abs)
        .map_err(|error| FileServiceError::from_io(error, relative_path))?;

    let entry = entry_for_path(relative_path, &abs)?;
    match entry.kind {
        WorkspaceFileKind::Directory => {
            std::fs::remove_dir_all(&abs).map_err(|e| map_delete_io_error(e, relative_path))?;
        }
        WorkspaceFileKind::File | WorkspaceFileKind::Symlink => {
            std::fs::remove_file(&abs).map_err(|e| map_delete_io_error(e, relative_path))?;
        }
    }

    Ok(DeleteWorkspaceFileEntryResult {
        path: relative_path.to_string(),
        kind: entry.kind,
    })
}

fn map_delete_io_error(error: std::io::Error, relative_path: &str) -> FileServiceError {
    FileServiceError::from_io(error, relative_path)
}
