use std::path::Path;

use super::super::types::{FileServiceError, WorkspaceFileEntry, WorkspaceFileKind};

pub(super) fn entry_for_path(
    relative_path: &str,
    abs: &Path,
) -> Result<WorkspaceFileEntry, FileServiceError> {
    let symlink_metadata = abs
        .symlink_metadata()
        .map_err(|error| FileServiceError::from_io(error, relative_path))?;
    let is_symlink = symlink_metadata.file_type().is_symlink();
    let metadata = if is_symlink {
        None
    } else {
        Some(&symlink_metadata)
    };
    let kind = if is_symlink {
        WorkspaceFileKind::Symlink
    } else if metadata.as_ref().is_some_and(|metadata| metadata.is_dir()) {
        WorkspaceFileKind::Directory
    } else {
        WorkspaceFileKind::File
    };
    let has_children = if matches!(kind, WorkspaceFileKind::Directory) {
        Some(directory_has_children(abs, relative_path)?)
    } else {
        None
    };
    let name = Path::new(relative_path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(relative_path)
        .to_string();
    let entry_metadata = metadata.unwrap_or(&symlink_metadata);
    let modified_at = modified_at(entry_metadata);
    Ok(WorkspaceFileEntry {
        path: relative_path.to_string(),
        name,
        kind,
        has_children,
        size_bytes: if metadata.is_some_and(|metadata| metadata.is_file()) {
            metadata.map(|metadata| metadata.len())
        } else {
            None
        },
        modified_at,
        is_text: None,
    })
}

pub(super) fn directory_has_children(
    path: &Path,
    relative_path: &str,
) -> Result<bool, FileServiceError> {
    let entries =
        std::fs::read_dir(path).map_err(|error| FileServiceError::from_io(error, relative_path))?;
    let mut has_children = false;
    for entry in entries {
        entry.map_err(|error| FileServiceError::from_io(error, relative_path))?;
        has_children = true;
    }
    Ok(has_children)
}

pub(super) fn modified_at(metadata: &std::fs::Metadata) -> Option<String> {
    metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| {
            chrono::DateTime::from_timestamp(d.as_secs() as i64, d.subsec_nanos())
                .map(|dt| dt.to_rfc3339())
                .unwrap_or_default()
        })
}
