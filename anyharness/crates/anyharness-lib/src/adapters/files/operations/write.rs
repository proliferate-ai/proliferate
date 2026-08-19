use std::path::Path;

use super::super::safety::{content_version_token, resolve_safe_path};
use super::super::types::{FileServiceError, WriteWorkspaceFileResult};
use super::entry;

pub fn write_file(
    workspace_root: &Path,
    relative_path: &str,
    content: &str,
    expected_version_token: &str,
) -> Result<WriteWorkspaceFileResult, FileServiceError> {
    if relative_path.is_empty() {
        return Err(FileServiceError::NotAFile("".to_string()));
    }

    let abs = resolve_safe_path(workspace_root, relative_path)
        .map_err(|error| FileServiceError::from_safety(error, relative_path))?;

    match abs.metadata() {
        Ok(metadata) => {
            if !metadata.is_file() {
                return Err(FileServiceError::NotAFile(relative_path.to_string()));
            }
            let existing_data = std::fs::read(&abs)
                .map_err(|error| FileServiceError::from_io(error, relative_path))?;
            let current_token = content_version_token(&existing_data);
            if current_token != expected_version_token {
                return Err(FileServiceError::VersionMismatch {
                    path: relative_path.to_string(),
                    expected: expected_version_token.to_string(),
                    actual: current_token,
                });
            }
        }
        Err(error) => match FileServiceError::from_io(error, relative_path) {
            FileServiceError::NotFound(_) => {}
            error => return Err(error),
        },
    }

    let parent = abs.parent().ok_or(FileServiceError::Io)?;
    std::fs::create_dir_all(parent)
        .map_err(|error| FileServiceError::from_io(error, relative_path))?;
    let temp_path = parent.join(format!(".anyharness-write-{}", uuid::Uuid::new_v4()));

    std::fs::write(&temp_path, content.as_bytes())
        .map_err(|error| FileServiceError::from_io(error, relative_path))?;

    if let Err(error) = std::fs::rename(&temp_path, &abs) {
        let _ = std::fs::remove_file(&temp_path);
        return Err(FileServiceError::from_io(error, relative_path));
    }

    let new_data = content.as_bytes();
    let version_token = content_version_token(new_data);
    let size_bytes = new_data.len() as u64;
    let modified_at = abs
        .metadata()
        .ok()
        .and_then(|metadata| entry::modified_at(&metadata));

    Ok(WriteWorkspaceFileResult {
        path: relative_path.to_string(),
        version_token,
        size_bytes,
        modified_at,
    })
}
