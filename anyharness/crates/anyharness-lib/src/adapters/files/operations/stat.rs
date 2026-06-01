use std::path::Path;

use super::super::safety::resolve_safe_path;
use super::super::types::{FileServiceError, StatWorkspaceFileResult, WorkspaceFileKind};
use super::entry;

pub fn stat_file(
    workspace_root: &Path,
    relative_path: &str,
) -> Result<StatWorkspaceFileResult, FileServiceError> {
    let abs = resolve_safe_path(workspace_root, relative_path).map_err(FileServiceError::Safety)?;

    if !abs.exists() {
        return Err(FileServiceError::NotFound(relative_path.to_string()));
    }

    let metadata = abs
        .metadata()
        .map_err(|e| FileServiceError::Io(e.to_string()))?;

    let symlink_meta = abs.symlink_metadata().ok();
    let is_symlink = symlink_meta
        .as_ref()
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false);

    let kind = if is_symlink {
        WorkspaceFileKind::Symlink
    } else if metadata.is_dir() {
        WorkspaceFileKind::Directory
    } else {
        WorkspaceFileKind::File
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
