use std::path::Path;

use super::super::safety::{self, content_version_token, is_likely_text, resolve_safe_path};
use super::super::types::{FileServiceError, ReadWorkspaceFileResult, WorkspaceFileKind};
use super::entry;

pub fn read_file(
    workspace_root: &Path,
    relative_path: &str,
) -> Result<ReadWorkspaceFileResult, FileServiceError> {
    if relative_path.is_empty() {
        return Err(FileServiceError::NotAFile("".to_string()));
    }

    let abs = resolve_safe_path(workspace_root, relative_path).map_err(FileServiceError::Safety)?;

    if !abs.exists() {
        return Err(FileServiceError::NotFound(relative_path.to_string()));
    }

    let metadata = abs
        .metadata()
        .map_err(|e| FileServiceError::Io(e.to_string()))?;

    if metadata.is_dir() {
        return Err(FileServiceError::NotAFile(relative_path.to_string()));
    }

    let size = metadata.len();
    let modified_at = entry::modified_at(&metadata);
    let too_large = size > safety::max_text_file_size();

    if too_large {
        return Ok(ReadWorkspaceFileResult {
            path: relative_path.to_string(),
            kind: WorkspaceFileKind::File,
            content: None,
            version_token: None,
            encoding: None,
            size_bytes: size,
            modified_at,
            is_text: false,
            too_large: true,
        });
    }

    let data = std::fs::read(&abs).map_err(|e| FileServiceError::Io(e.to_string()))?;

    let is_text = is_likely_text(&data);
    if !is_text {
        return Ok(ReadWorkspaceFileResult {
            path: relative_path.to_string(),
            kind: WorkspaceFileKind::File,
            content: None,
            version_token: Some(content_version_token(&data)),
            encoding: None,
            size_bytes: size,
            modified_at,
            is_text: false,
            too_large: false,
        });
    }

    let content = String::from_utf8(data.clone())
        .map_err(|_| FileServiceError::BinaryFile(relative_path.to_string()))?;

    Ok(ReadWorkspaceFileResult {
        path: relative_path.to_string(),
        kind: WorkspaceFileKind::File,
        content: Some(content),
        version_token: Some(content_version_token(&data)),
        encoding: Some("utf-8".into()),
        size_bytes: size,
        modified_at,
        is_text: true,
        too_large: false,
    })
}
