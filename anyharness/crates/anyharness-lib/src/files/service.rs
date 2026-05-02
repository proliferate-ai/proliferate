use std::io::Write;
use std::path::Path;

use super::safety::{
    self, content_version_token, is_likely_text, resolve_safe_entry_path, resolve_safe_path,
    SafetyError,
};
use super::types::{
    CreateWorkspaceFileEntryKind, CreateWorkspaceFileEntryResult, DeleteWorkspaceFileEntryResult,
    ListWorkspaceFilesResult, ReadWorkspaceFileResult, RenameWorkspaceFileEntryResult,
    StatWorkspaceFileResult, WorkspaceFileEntry, WorkspaceFileKind, WriteWorkspaceFileResult,
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
            let modified_at = entry_metadata
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
                size_bytes: if metadata.as_ref().is_some_and(|metadata| metadata.is_file()) {
                    metadata.as_ref().map(|metadata| metadata.len())
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

        let abs =
            resolve_safe_path(workspace_root, relative_path).map_err(FileServiceError::Safety)?;
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
                let file = Self::read_file(workspace_root, relative_path)?;
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

    pub fn rename_entry(
        workspace_root: &Path,
        relative_path: &str,
        new_relative_path: &str,
    ) -> Result<RenameWorkspaceFileEntryResult, FileServiceError> {
        if relative_path.is_empty() {
            return Err(FileServiceError::InvalidRenameRequest(
                "path is required".to_string(),
            ));
        }
        if new_relative_path.is_empty() {
            return Err(FileServiceError::InvalidRenameRequest(
                "new path is required".to_string(),
            ));
        }

        let abs_from = resolve_safe_entry_path(workspace_root, relative_path)
            .map_err(FileServiceError::Safety)?;
        let source_metadata = std::fs::symlink_metadata(&abs_from)
            .map_err(|e| map_metadata_not_found(e, relative_path))?;

        let abs_to = resolve_safe_entry_path(workspace_root, new_relative_path)
            .map_err(FileServiceError::Safety)?;
        if std::fs::symlink_metadata(&abs_to).is_ok() {
            return Err(FileServiceError::AlreadyExists(
                new_relative_path.to_string(),
            ));
        }
        let parent = abs_to
            .parent()
            .ok_or_else(|| FileServiceError::NotADirectory(new_relative_path.to_string()))?;
        if !parent.is_dir() {
            return Err(FileServiceError::NotADirectory(
                new_relative_path.to_string(),
            ));
        }

        if source_metadata.is_dir()
            && !source_metadata.file_type().is_symlink()
            && abs_to.starts_with(&abs_from)
        {
            return Err(FileServiceError::InvalidRenameRequest(
                "directory cannot be moved inside itself".to_string(),
            ));
        }

        std::fs::rename(&abs_from, &abs_to)
            .map_err(|e| map_rename_io_error(e, relative_path, new_relative_path))?;

        Ok(RenameWorkspaceFileEntryResult {
            old_path: relative_path.to_string(),
            entry: entry_for_path(new_relative_path, &abs_to)?,
        })
    }

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
            .map_err(FileServiceError::Safety)?;
        std::fs::symlink_metadata(&abs).map_err(|e| map_metadata_not_found(e, relative_path))?;

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

fn map_create_io_error(error: std::io::Error, relative_path: &str) -> FileServiceError {
    if error.kind() == std::io::ErrorKind::AlreadyExists {
        return FileServiceError::AlreadyExists(relative_path.to_string());
    }
    FileServiceError::Io(error.to_string())
}

fn map_rename_io_error(
    error: std::io::Error,
    relative_path: &str,
    new_relative_path: &str,
) -> FileServiceError {
    match error.kind() {
        std::io::ErrorKind::AlreadyExists => {
            FileServiceError::AlreadyExists(new_relative_path.to_string())
        }
        std::io::ErrorKind::NotFound => FileServiceError::NotFound(relative_path.to_string()),
        _ => FileServiceError::Io(error.to_string()),
    }
}

fn map_delete_io_error(error: std::io::Error, relative_path: &str) -> FileServiceError {
    match error.kind() {
        std::io::ErrorKind::NotFound => FileServiceError::NotFound(relative_path.to_string()),
        _ => FileServiceError::Io(error.to_string()),
    }
}

fn map_metadata_not_found(error: std::io::Error, relative_path: &str) -> FileServiceError {
    match error.kind() {
        std::io::ErrorKind::NotFound => FileServiceError::NotFound(relative_path.to_string()),
        _ => FileServiceError::Io(error.to_string()),
    }
}

fn entry_for_path(relative_path: &str, abs: &Path) -> Result<WorkspaceFileEntry, FileServiceError> {
    let symlink_metadata = abs
        .symlink_metadata()
        .map_err(|e| FileServiceError::Io(e.to_string()))?;
    let is_symlink = symlink_metadata.file_type().is_symlink();
    let metadata = if is_symlink {
        None
    } else {
        Some(
            abs.metadata()
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
    let has_children = if matches!(kind, WorkspaceFileKind::Directory) {
        Some(
            std::fs::read_dir(abs)
                .map(|rd| rd.count() > 0)
                .unwrap_or(false),
        )
    } else {
        None
    };
    let name = Path::new(relative_path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(relative_path)
        .to_string();
    let entry_metadata = metadata.as_ref().unwrap_or(&symlink_metadata);
    let modified_at = entry_metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| {
            chrono::DateTime::from_timestamp(d.as_secs() as i64, d.subsec_nanos())
                .map(|dt| dt.to_rfc3339())
                .unwrap_or_default()
        });
    Ok(WorkspaceFileEntry {
        path: relative_path.to_string(),
        name,
        kind,
        has_children,
        size_bytes: if metadata.as_ref().is_some_and(|metadata| metadata.is_file()) {
            metadata.as_ref().map(|metadata| metadata.len())
        } else {
            None
        },
        modified_at,
        is_text: None,
    })
}

#[derive(Debug)]
pub enum FileServiceError {
    Safety(SafetyError),
    NotFound(String),
    AlreadyExists(String),
    NotAFile(String),
    NotADirectory(String),
    ProtectedPath(String),
    BinaryFile(String),
    FileTooLarge(String),
    InvalidCreateRequest(String),
    InvalidRenameRequest(String),
    InvalidDeleteRequest(String),
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
            Self::AlreadyExists(_) => "FILE_ALREADY_EXISTS",
            Self::NotAFile(_) => "NOT_A_FILE",
            Self::NotADirectory(_) => "NOT_A_DIRECTORY",
            Self::ProtectedPath(_) => "FILE_PATH_PROTECTED",
            Self::BinaryFile(_) => "BINARY_FILE",
            Self::FileTooLarge(_) => "FILE_TOO_LARGE",
            Self::InvalidCreateRequest(_) => "INVALID_CREATE_REQUEST",
            Self::InvalidRenameRequest(_) => "INVALID_RENAME_REQUEST",
            Self::InvalidDeleteRequest(_) => "INVALID_DELETE_REQUEST",
            Self::VersionMismatch { .. } => "VERSION_MISMATCH",
            Self::Io(_) => "FILE_IO_ERROR",
        }
    }

    pub fn status_code(&self) -> u16 {
        match self {
            Self::Safety(_) => 400,
            Self::NotFound(_) => 404,
            Self::AlreadyExists(_) => 409,
            Self::NotAFile(_) => 400,
            Self::NotADirectory(_) => 400,
            Self::ProtectedPath(_) => 409,
            Self::BinaryFile(_) => 400,
            Self::FileTooLarge(_) => 400,
            Self::InvalidCreateRequest(_) => 400,
            Self::InvalidRenameRequest(_) => 400,
            Self::InvalidDeleteRequest(_) => 400,
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
            Self::AlreadyExists(p) => write!(f, "file already exists: {p}"),
            Self::NotAFile(p) => write!(f, "not a file: {p}"),
            Self::NotADirectory(p) => write!(f, "not a directory: {p}"),
            Self::ProtectedPath(p) => write!(f, "path is protected in cowork: {p}"),
            Self::BinaryFile(p) => write!(f, "binary file, not editable: {p}"),
            Self::FileTooLarge(p) => write!(f, "file too large for editing: {p}"),
            Self::InvalidCreateRequest(message) => write!(f, "{message}"),
            Self::InvalidRenameRequest(message) => write!(f, "{message}"),
            Self::InvalidDeleteRequest(message) => write!(f, "{message}"),
            Self::VersionMismatch { path, .. } => write!(f, "version mismatch for: {path}"),
            Self::Io(e) => write!(f, "file I/O error: {e}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};

    #[test]
    fn create_entry_creates_new_file_with_read_metadata() {
        let dir = TestWorkspace::new();
        std::fs::create_dir(dir.path().join("src")).expect("seed parent");

        let result = WorkspaceFilesService::create_entry(
            dir.path(),
            "src/main.rs",
            CreateWorkspaceFileEntryKind::File,
            Some("fn main() {}\n"),
        )
        .expect("create file");

        assert_eq!(result.entry.path, "src/main.rs");
        assert_eq!(result.entry.kind, WorkspaceFileKind::File);
        let file = result.file.expect("created file read response");
        assert_eq!(file.path, "src/main.rs");
        assert_eq!(file.content.as_deref(), Some("fn main() {}\n"));
        assert!(file.version_token.is_some());
    }

    #[test]
    fn create_entry_creates_new_directory_without_file_response() {
        let dir = TestWorkspace::new();

        let result = WorkspaceFilesService::create_entry(
            dir.path(),
            "src",
            CreateWorkspaceFileEntryKind::Directory,
            None,
        )
        .expect("create directory");

        assert_eq!(result.entry.path, "src");
        assert_eq!(result.entry.kind, WorkspaceFileKind::Directory);
        assert!(result.file.is_none());
    }

    #[test]
    fn create_entry_fails_for_existing_path() {
        let dir = TestWorkspace::new();
        std::fs::write(dir.path().join("README.md"), "hello").expect("seed file");

        let error = WorkspaceFilesService::create_entry(
            dir.path(),
            "README.md",
            CreateWorkspaceFileEntryKind::File,
            None,
        )
        .expect_err("existing path should fail");

        assert!(matches!(error, FileServiceError::AlreadyExists(path) if path == "README.md"));
    }

    #[test]
    fn create_entry_fails_when_parent_is_missing() {
        let dir = TestWorkspace::new();

        let error = WorkspaceFilesService::create_entry(
            dir.path(),
            "missing/file.txt",
            CreateWorkspaceFileEntryKind::File,
            None,
        )
        .expect_err("missing parent should fail");

        assert!(matches!(error, FileServiceError::NotADirectory(_)));
    }

    #[test]
    fn create_entry_rejects_directory_content() {
        let dir = TestWorkspace::new();

        let error = WorkspaceFilesService::create_entry(
            dir.path(),
            "src",
            CreateWorkspaceFileEntryKind::Directory,
            Some("nope"),
        )
        .expect_err("directory content should fail");

        assert!(matches!(error, FileServiceError::InvalidCreateRequest(_)));
    }

    #[test]
    fn create_entry_rejects_git_paths() {
        let dir = TestWorkspace::new();

        let error = WorkspaceFilesService::create_entry(
            dir.path(),
            ".git/config",
            CreateWorkspaceFileEntryKind::File,
            None,
        )
        .expect_err(".git should be protected");

        assert!(matches!(
            error,
            FileServiceError::Safety(SafetyError::GitDirectory)
        ));
    }

    #[cfg(unix)]
    #[test]
    fn create_entry_rejects_git_symlink_parent() {
        let dir = TestWorkspace::new();
        std::fs::create_dir(dir.path().join(".git")).expect("seed git dir");
        std::os::unix::fs::symlink(".git", dir.path().join("gitlink")).expect("seed git symlink");

        let error = WorkspaceFilesService::create_entry(
            dir.path(),
            "gitlink/new-file",
            CreateWorkspaceFileEntryKind::File,
            None,
        )
        .expect_err("git symlink parent should be protected");

        assert!(matches!(
            error,
            FileServiceError::Safety(SafetyError::GitDirectory)
        ));
        assert!(!dir.path().join(".git/new-file").exists());
    }

    #[test]
    fn rename_entry_moves_file_to_new_path() {
        let dir = TestWorkspace::new();
        std::fs::create_dir(dir.path().join("src")).expect("seed parent");
        std::fs::write(dir.path().join("README.md"), "hello").expect("seed file");

        let result = WorkspaceFilesService::rename_entry(dir.path(), "README.md", "src/README.md")
            .expect("rename file");

        assert_eq!(result.old_path, "README.md");
        assert_eq!(result.entry.path, "src/README.md");
        assert_eq!(result.entry.kind, WorkspaceFileKind::File);
        assert!(!dir.path().join("README.md").exists());
        assert_eq!(
            std::fs::read_to_string(dir.path().join("src/README.md")).expect("read renamed file"),
            "hello"
        );
    }

    #[test]
    fn rename_entry_fails_for_existing_destination() {
        let dir = TestWorkspace::new();
        std::fs::write(dir.path().join("a.txt"), "a").expect("seed source");
        std::fs::write(dir.path().join("b.txt"), "b").expect("seed destination");

        let error = WorkspaceFilesService::rename_entry(dir.path(), "a.txt", "b.txt")
            .expect_err("existing destination should fail");

        assert!(matches!(error, FileServiceError::AlreadyExists(path) if path == "b.txt"));
    }

    #[test]
    fn rename_entry_fails_when_destination_parent_is_missing() {
        let dir = TestWorkspace::new();
        std::fs::write(dir.path().join("a.txt"), "a").expect("seed source");

        let error = WorkspaceFilesService::rename_entry(dir.path(), "a.txt", "missing/a.txt")
            .expect_err("missing parent should fail");

        assert!(matches!(error, FileServiceError::NotADirectory(_)));
    }

    #[test]
    fn rename_entry_rejects_git_paths() {
        let dir = TestWorkspace::new();
        std::fs::write(dir.path().join("a.txt"), "a").expect("seed source");

        let error = WorkspaceFilesService::rename_entry(dir.path(), "a.txt", ".git/a.txt")
            .expect_err(".git should be protected");

        assert!(matches!(
            error,
            FileServiceError::Safety(SafetyError::GitDirectory)
        ));
    }

    #[cfg(unix)]
    #[test]
    fn rename_entry_moves_symlink_without_moving_target() {
        let dir = TestWorkspace::new();
        std::fs::write(dir.path().join("target.txt"), "target").expect("seed target");
        std::os::unix::fs::symlink("target.txt", dir.path().join("link.txt"))
            .expect("seed symlink");

        let result = WorkspaceFilesService::rename_entry(dir.path(), "link.txt", "renamed.txt")
            .expect("rename symlink");

        assert_eq!(result.old_path, "link.txt");
        assert_eq!(result.entry.path, "renamed.txt");
        assert_eq!(result.entry.kind, WorkspaceFileKind::Symlink);
        assert!(!dir.path().join("link.txt").exists());
        assert!(dir
            .path()
            .join("renamed.txt")
            .symlink_metadata()
            .expect("renamed link")
            .file_type()
            .is_symlink());
        assert_eq!(
            std::fs::read_to_string(dir.path().join("target.txt")).expect("target remains"),
            "target"
        );
    }

    #[test]
    fn delete_entry_removes_file() {
        let dir = TestWorkspace::new();
        std::fs::write(dir.path().join("README.md"), "hello").expect("seed file");

        let result =
            WorkspaceFilesService::delete_entry(dir.path(), "README.md").expect("delete file");

        assert_eq!(result.path, "README.md");
        assert_eq!(result.kind, WorkspaceFileKind::File);
        assert!(!dir.path().join("README.md").exists());
    }

    #[test]
    fn delete_entry_removes_directory_recursively() {
        let dir = TestWorkspace::new();
        std::fs::create_dir_all(dir.path().join("src/nested")).expect("seed dir");
        std::fs::write(dir.path().join("src/nested/main.rs"), "fn main() {}")
            .expect("seed nested file");

        let result =
            WorkspaceFilesService::delete_entry(dir.path(), "src").expect("delete directory");

        assert_eq!(result.path, "src");
        assert_eq!(result.kind, WorkspaceFileKind::Directory);
        assert!(!dir.path().join("src").exists());
    }

    #[cfg(unix)]
    #[test]
    fn delete_entry_removes_symlink_without_deleting_target_file() {
        let dir = TestWorkspace::new();
        std::fs::write(dir.path().join("target.txt"), "target").expect("seed target");
        std::os::unix::fs::symlink("target.txt", dir.path().join("link.txt"))
            .expect("seed symlink");

        let result =
            WorkspaceFilesService::delete_entry(dir.path(), "link.txt").expect("delete symlink");

        assert_eq!(result.path, "link.txt");
        assert_eq!(result.kind, WorkspaceFileKind::Symlink);
        assert!(!dir.path().join("link.txt").exists());
        assert_eq!(
            std::fs::read_to_string(dir.path().join("target.txt")).expect("target remains"),
            "target"
        );
    }

    #[cfg(unix)]
    #[test]
    fn delete_entry_removes_directory_symlink_without_deleting_target_directory() {
        let dir = TestWorkspace::new();
        std::fs::create_dir_all(dir.path().join("target-dir/nested")).expect("seed target dir");
        std::fs::write(dir.path().join("target-dir/nested/file.txt"), "target")
            .expect("seed nested target");
        std::os::unix::fs::symlink("target-dir", dir.path().join("dir-link"))
            .expect("seed directory symlink");

        let result =
            WorkspaceFilesService::delete_entry(dir.path(), "dir-link").expect("delete symlink");

        assert_eq!(result.path, "dir-link");
        assert_eq!(result.kind, WorkspaceFileKind::Symlink);
        assert!(!dir.path().join("dir-link").exists());
        assert_eq!(
            std::fs::read_to_string(dir.path().join("target-dir/nested/file.txt"))
                .expect("target directory remains"),
            "target"
        );
    }

    #[cfg(unix)]
    #[test]
    fn delete_entry_allows_symlink_to_external_target() {
        let dir = TestWorkspace::new();
        let external = std::env::temp_dir().join(format!(
            "anyharness-files-external-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::write(&external, "outside").expect("seed external target");
        std::os::unix::fs::symlink(&external, dir.path().join("external-link"))
            .expect("seed external symlink");

        let result = WorkspaceFilesService::delete_entry(dir.path(), "external-link")
            .expect("delete external symlink");

        assert_eq!(result.path, "external-link");
        assert_eq!(result.kind, WorkspaceFileKind::Symlink);
        assert!(!dir.path().join("external-link").exists());
        assert_eq!(
            std::fs::read_to_string(&external).expect("external target remains"),
            "outside"
        );
        let _ = std::fs::remove_file(external);
    }

    #[cfg(unix)]
    #[test]
    fn delete_entry_rejects_git_symlink_descendant_but_allows_link_entry() {
        let dir = TestWorkspace::new();
        std::fs::create_dir(dir.path().join(".git")).expect("seed git dir");
        std::fs::write(dir.path().join(".git/config"), "git config").expect("seed git config");
        std::os::unix::fs::symlink(".git", dir.path().join("gitlink")).expect("seed git symlink");

        let error = WorkspaceFilesService::delete_entry(dir.path(), "gitlink/config")
            .expect_err("git symlink descendant should be protected");

        assert!(matches!(
            error,
            FileServiceError::Safety(SafetyError::GitDirectory)
        ));
        assert_eq!(
            std::fs::read_to_string(dir.path().join(".git/config")).expect("git config remains"),
            "git config"
        );

        let result = WorkspaceFilesService::delete_entry(dir.path(), "gitlink")
            .expect("delete git symlink entry");

        assert_eq!(result.path, "gitlink");
        assert_eq!(result.kind, WorkspaceFileKind::Symlink);
        assert!(dir.path().join("gitlink").symlink_metadata().is_err());
        assert_eq!(
            std::fs::read_to_string(dir.path().join(".git/config")).expect("git config remains"),
            "git config"
        );
    }

    #[cfg(unix)]
    #[test]
    fn rename_entry_rejects_git_symlink_descendant() {
        let dir = TestWorkspace::new();
        std::fs::create_dir(dir.path().join(".git")).expect("seed git dir");
        std::fs::write(dir.path().join(".git/config"), "git config").expect("seed git config");
        std::os::unix::fs::symlink(".git", dir.path().join("gitlink")).expect("seed git symlink");

        let error =
            WorkspaceFilesService::rename_entry(dir.path(), "gitlink/config", "config-copy")
                .expect_err("git symlink descendant should be protected");

        assert!(matches!(
            error,
            FileServiceError::Safety(SafetyError::GitDirectory)
        ));
        assert_eq!(
            std::fs::read_to_string(dir.path().join(".git/config")).expect("git config remains"),
            "git config"
        );
        assert!(!dir.path().join("config-copy").exists());
    }

    #[test]
    fn delete_entry_rejects_git_paths() {
        let dir = TestWorkspace::new();

        let error = WorkspaceFilesService::delete_entry(dir.path(), ".git/config")
            .expect_err(".git should be protected");

        assert!(matches!(
            error,
            FileServiceError::Safety(SafetyError::GitDirectory)
        ));
    }

    struct TestWorkspace {
        path: PathBuf,
    }

    impl TestWorkspace {
        fn new() -> Self {
            let path = std::env::temp_dir()
                .join(format!("anyharness-files-test-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir(&path).expect("create temp workspace");
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TestWorkspace {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }
}
