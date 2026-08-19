use std::path::Path;

use super::super::safety::resolve_safe_path;
use super::super::types::{FileServiceError, StatWorkspaceFileResult, WorkspaceFileKind};
use super::entry;

pub fn stat_file(
    workspace_root: &Path,
    relative_path: &str,
) -> Result<StatWorkspaceFileResult, FileServiceError> {
    let abs = resolve_safe_path(workspace_root, relative_path)
        .map_err(|error| FileServiceError::from_safety(error, relative_path))?;

    let metadata = abs
        .metadata()
        .map_err(|error| FileServiceError::from_io(error, relative_path))?;

    let kind = if metadata.is_dir() {
        WorkspaceFileKind::Directory
    } else if metadata.is_file() {
        WorkspaceFileKind::File
    } else {
        return Err(FileServiceError::NotAFile(relative_path.to_string()));
    };

    Ok(StatWorkspaceFileResult {
        path: relative_path.to_string(),
        kind,
        size_bytes: if metadata.is_file() {
            Some(metadata.len())
        } else {
            None
        },
        modified_at: entry::modified_at(&metadata),
        is_text: None,
    })
}
