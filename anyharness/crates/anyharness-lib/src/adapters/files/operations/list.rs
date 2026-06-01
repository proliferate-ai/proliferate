use std::path::Path;

use super::super::safety::resolve_safe_path;
use super::super::types::{
    FileServiceError, ListWorkspaceFilesResult, WorkspaceFileEntry, WorkspaceFileKind,
};
use super::entry;

pub fn list_entries(
    workspace_root: &Path,
    relative_dir: &str,
) -> Result<ListWorkspaceFilesResult, FileServiceError> {
    let abs = resolve_safe_path(workspace_root, relative_dir).map_err(FileServiceError::Safety)?;

    if !abs.is_dir() {
        return Err(FileServiceError::NotADirectory(relative_dir.to_string()));
    }

    let mut entries = Vec::new();
    let read_dir = std::fs::read_dir(&abs).map_err(|e| FileServiceError::Io(e.to_string()))?;

    for entry in read_dir {
        let entry = entry.map_err(|e| FileServiceError::Io(e.to_string()))?;
        let file_name = entry.file_name();
        let name = file_name.to_string_lossy().to_string();

        if name == ".git" {
            continue;
        }

        let entry_path = entry.path();
        let symlink_metadata = entry_path
            .symlink_metadata()
            .map_err(|e| FileServiceError::Io(e.to_string()))?;
        let is_symlink = symlink_metadata.file_type().is_symlink();
        let metadata = if is_symlink {
            None
        } else {
            Some(
                entry
                    .metadata()
                    .map_err(|e| FileServiceError::Io(e.to_string()))?,
            )
        };

        let kind = if is_symlink {
            WorkspaceFileKind::Symlink
        } else if metadata.as_ref().is_some_and(|metadata| metadata.is_dir()) {
            WorkspaceFileKind::Directory
        } else {
            WorkspaceFileKind::File
        };

        let child_path = if relative_dir.is_empty() {
            name.clone()
        } else {
            format!("{}/{}", relative_dir, name)
        };

        let has_children = if matches!(kind, WorkspaceFileKind::Directory) {
            Some(
                std::fs::read_dir(entry.path())
                    .map(|rd| rd.count() > 0)
                    .unwrap_or(false),
            )
        } else {
            None
        };

        let entry_metadata = metadata.as_ref().unwrap_or(&symlink_metadata);

        entries.push(WorkspaceFileEntry {
            path: child_path,
            name,
            kind,
            has_children,
            size_bytes: if metadata.as_ref().is_some_and(|metadata| metadata.is_file()) {
                metadata.as_ref().map(|metadata| metadata.len())
            } else {
                None
            },
            modified_at: entry::modified_at(entry_metadata),
            is_text: None,
        });
    }

    entries.sort_by(|a, b| {
        let a_is_dir = matches!(a.kind, WorkspaceFileKind::Directory);
        let b_is_dir = matches!(b.kind, WorkspaceFileKind::Directory);
        match (a_is_dir, b_is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    Ok(ListWorkspaceFilesResult {
        directory_path: relative_dir.to_string(),
        entries,
    })
}
