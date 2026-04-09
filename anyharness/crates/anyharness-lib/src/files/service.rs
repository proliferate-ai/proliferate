use std::path::Path;

use super::safety::{self, content_version_token, is_likely_text, resolve_safe_path, SafetyError};
use super::types::{
    ListWorkspaceFilesResult, ReadWorkspaceFileResult, StatWorkspaceFileResult, WorkspaceFileEntry,
    WorkspaceFileKind, WriteWorkspaceFileResult,
};

pub struct WorkspaceFilesService;

impl WorkspaceFilesService {
    pub fn list_entries(
        workspace_root: &Path,
        relative_dir: &str,
    ) -> Result<ListWorkspaceFilesResult, FileServiceError> {
        let abs =
            resolve_safe_path(workspace_root, relative_dir).map_err(FileServiceError::Safety)?;

        if !abs.is_dir() {
            return Err(FileServiceError::NotADirectory(relative_dir.to_string()));
        }

        let mut entries = Vec::new();
        let read_dir = std::fs::read_dir(&abs).map_err(|e| FileServiceError::Io(e.to_string()))?;

        for entry in read_dir {
            let entry = entry.map_err(|e| FileServiceError::Io(e.to_string()))?;
            let file_name = entry.file_name();
            let name = file_name.to_string_lossy().to_string();

            // Always hide .git
            if name == ".git" {
                continue;
            }

            let metadata = entry
                .metadata()
                .map_err(|e| FileServiceError::Io(e.to_string()))?;
            let symlink_meta = entry.path().symlink_metadata().ok();

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

            let child_path = if relative_dir.is_empty() {
                name.clone()
            } else {
                format!("{}/{}", relative_dir, name)
            };

            let has_children = if metadata.is_dir() {
                Some(
                    std::fs::read_dir(entry.path())
                        .map(|rd| rd.count() > 0)
                        .unwrap_or(false),
                )
            } else {
                None
            };

            let modified_at = metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| {
                    chrono::DateTime::from_timestamp(d.as_secs() as i64, d.subsec_nanos())
                        .map(|dt| dt.to_rfc3339())
                        .unwrap_or_default()
                });

            entries.push(WorkspaceFileEntry {
                path: child_path,
                name,
                kind,
                has_children,
                size_bytes: if metadata.is_file() {
                    Some(metadata.len())
                } else {
                    None
                },
                modified_at,
                is_text: None,
            });
        }

        // Sort: directories first, then files, case-insensitive alphabetical
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

    pub fn read_file(
        workspace_root: &Path,
        relative_path: &str,
    ) -> Result<ReadWorkspaceFileResult, FileServiceError> {
        if relative_path.is_empty() {
            return Err(FileServiceError::NotAFile("".to_string()));
        }

        let abs =
            resolve_safe_path(workspace_root, relative_path).map_err(FileServiceError::Safety)?;

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
        let modified_at = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| {
                chrono::DateTime::from_timestamp(d.as_secs() as i64, d.subsec_nanos())
                    .map(|dt| dt.to_rfc3339())
                    .unwrap_or_default()
            });

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

    pub fn write_file(
        workspace_root: &Path,
        relative_path: &str,
        content: &str,
        expected_version_token: &str,
    ) -> Result<WriteWorkspaceFileResult, FileServiceError> {
        if relative_path.is_empty() {
            return Err(FileServiceError::NotAFile("".to_string()));
        }

        let abs =
            resolve_safe_path(workspace_root, relative_path).map_err(FileServiceError::Safety)?;

        if abs.is_dir() {
            return Err(FileServiceError::NotAFile(relative_path.to_string()));
        }

        // Check version token if the file exists
        if abs.exists() {
            let existing_data =
                std::fs::read(&abs).map_err(|e| FileServiceError::Io(e.to_string()))?;
            let current_token = content_version_token(&existing_data);
            if current_token != expected_version_token {
                return Err(FileServiceError::VersionMismatch {
                    path: relative_path.to_string(),
                    expected: expected_version_token.to_string(),
                    actual: current_token,
                });
            }
        }

        // Atomic write: write to temp then rename
        let parent = abs
            .parent()
            .ok_or_else(|| FileServiceError::Io("cannot determine parent directory".to_string()))?;
        std::fs::create_dir_all(parent).map_err(|e| FileServiceError::Io(e.to_string()))?;
        let temp_path = parent.join(format!(".anyharness-write-{}", uuid::Uuid::new_v4()));

        std::fs::write(&temp_path, content.as_bytes())
            .map_err(|e| FileServiceError::Io(e.to_string()))?;

        if let Err(e) = std::fs::rename(&temp_path, &abs) {
            let _ = std::fs::remove_file(&temp_path);
            return Err(FileServiceError::Io(e.to_string()));
        }

        let new_data = content.as_bytes();
        let version_token = content_version_token(new_data);
        let size_bytes = new_data.len() as u64;

        let modified_at = abs
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| {
                chrono::DateTime::from_timestamp(d.as_secs() as i64, d.subsec_nanos())
                    .map(|dt| dt.to_rfc3339())
                    .unwrap_or_default()
            });

        Ok(WriteWorkspaceFileResult {
            path: relative_path.to_string(),
            version_token,
            size_bytes,
            modified_at,
        })
    }

    pub fn stat_file(
        workspace_root: &Path,
        relative_path: &str,
    ) -> Result<StatWorkspaceFileResult, FileServiceError> {
        let abs =
            resolve_safe_path(workspace_root, relative_path).map_err(FileServiceError::Safety)?;

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

        let modified_at = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| {
                chrono::DateTime::from_timestamp(d.as_secs() as i64, d.subsec_nanos())
                    .map(|dt| dt.to_rfc3339())
                    .unwrap_or_default()
            });

        Ok(StatWorkspaceFileResult {
            path: relative_path.to_string(),
            kind,
            size_bytes: if metadata.is_file() {
                Some(metadata.len())
            } else {
                None
            },
            modified_at,
            is_text: None,
        })
    }
}

#[derive(Debug)]
pub enum FileServiceError {
    Safety(SafetyError),
    NotFound(String),
    NotAFile(String),
    NotADirectory(String),
    BinaryFile(String),
    FileTooLarge(String),
    VersionMismatch {
        path: String,
        expected: String,
        actual: String,
    },
    Io(String),
}

impl FileServiceError {
    pub fn problem_code(&self) -> &'static str {
        match self {
            Self::Safety(e) => e.problem_code(),
            Self::NotFound(_) => "FILE_NOT_FOUND",
            Self::NotAFile(_) => "NOT_A_FILE",
            Self::NotADirectory(_) => "NOT_A_DIRECTORY",
            Self::BinaryFile(_) => "BINARY_FILE",
            Self::FileTooLarge(_) => "FILE_TOO_LARGE",
            Self::VersionMismatch { .. } => "VERSION_MISMATCH",
            Self::Io(_) => "FILE_IO_ERROR",
        }
    }

    pub fn status_code(&self) -> u16 {
        match self {
            Self::Safety(_) => 400,
            Self::NotFound(_) => 404,
            Self::NotAFile(_) => 400,
            Self::NotADirectory(_) => 400,
            Self::BinaryFile(_) => 400,
            Self::FileTooLarge(_) => 400,
            Self::VersionMismatch { .. } => 409,
            Self::Io(_) => 500,
        }
    }
}

impl std::fmt::Display for FileServiceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Safety(e) => write!(f, "{e}"),
            Self::NotFound(p) => write!(f, "file not found: {p}"),
            Self::NotAFile(p) => write!(f, "not a file: {p}"),
            Self::NotADirectory(p) => write!(f, "not a directory: {p}"),
            Self::BinaryFile(p) => write!(f, "binary file, not editable: {p}"),
            Self::FileTooLarge(p) => write!(f, "file too large for editing: {p}"),
            Self::VersionMismatch { path, .. } => write!(f, "version mismatch for: {path}"),
            Self::Io(e) => write!(f, "file I/O error: {e}"),
        }
    }
}
