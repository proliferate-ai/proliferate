use super::safety::{classify_io_error, ClassifiedIoError, SafetyError};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkspaceFileKind {
    File,
    Directory,
    Symlink,
}

#[derive(Debug, Clone)]
pub struct WorkspaceFileEntry {
    pub path: String,
    pub name: String,
    pub kind: WorkspaceFileKind,
    pub has_children: Option<bool>,
    pub size_bytes: Option<u64>,
    pub modified_at: Option<String>,
    pub is_text: Option<bool>,
}

#[derive(Debug, Clone)]
pub struct ListWorkspaceFilesResult {
    pub directory_path: String,
    pub entries: Vec<WorkspaceFileEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CreateWorkspaceFileEntryKind {
    File,
    Directory,
}

#[derive(Debug, Clone)]
pub struct CreateWorkspaceFileEntryResult {
    pub entry: WorkspaceFileEntry,
    pub file: Option<ReadWorkspaceFileResult>,
}

#[derive(Debug, Clone)]
pub struct RenameWorkspaceFileEntryResult {
    pub old_path: String,
    pub entry: WorkspaceFileEntry,
}

#[derive(Debug, Clone)]
pub struct DeleteWorkspaceFileEntryResult {
    pub path: String,
    pub kind: WorkspaceFileKind,
}

#[derive(Debug, Clone)]
pub struct ReadWorkspaceFileResult {
    pub path: String,
    pub kind: WorkspaceFileKind,
    pub content: Option<String>,
    pub version_token: Option<String>,
    pub encoding: Option<String>,
    pub size_bytes: u64,
    pub modified_at: Option<String>,
    pub is_text: bool,
    pub too_large: bool,
}

#[derive(Debug, Clone)]
pub struct WriteWorkspaceFileResult {
    pub path: String,
    pub version_token: String,
    pub size_bytes: u64,
    pub modified_at: Option<String>,
}

#[derive(Debug, Clone)]
pub struct StatWorkspaceFileResult {
    pub path: String,
    pub kind: WorkspaceFileKind,
    pub size_bytes: Option<u64>,
    pub modified_at: Option<String>,
    pub is_text: Option<bool>,
}

#[derive(Debug)]
pub enum FileServiceError {
    Safety(SafetyError),
    NotFound(String),
    PermissionDenied,
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
    Io,
}

impl FileServiceError {
    pub fn from_io(error: std::io::Error, relative_path: &str) -> Self {
        match classify_io_error(&error) {
            ClassifiedIoError::NotFound => Self::NotFound(relative_path.to_string()),
            ClassifiedIoError::NotADirectory => Self::NotADirectory(relative_path.to_string()),
            ClassifiedIoError::PermissionDenied => Self::PermissionDenied,
            ClassifiedIoError::Unexpected => Self::Io,
        }
    }

    pub fn from_safety(error: SafetyError, relative_path: &str) -> Self {
        match error {
            SafetyError::NotFound => Self::NotFound(relative_path.to_string()),
            SafetyError::NotADirectory => Self::NotADirectory(relative_path.to_string()),
            SafetyError::PermissionDenied => Self::PermissionDenied,
            SafetyError::IoError => Self::Io,
            error => Self::Safety(error),
        }
    }
}

impl std::fmt::Display for FileServiceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Safety(e) => write!(f, "{e}"),
            Self::NotFound(p) => write!(f, "file not found: {p}"),
            Self::PermissionDenied => write!(f, "file access denied"),
            Self::AlreadyExists(p) => write!(f, "file already exists: {p}"),
            Self::NotAFile(p) => write!(f, "not a file: {p}"),
            Self::NotADirectory(p) => write!(f, "not a directory: {p}"),
            Self::ProtectedPath(p) => write!(f, "path is protected: {p}"),
            Self::BinaryFile(p) => write!(f, "binary file, not editable: {p}"),
            Self::FileTooLarge(p) => write!(f, "file too large for editing: {p}"),
            Self::InvalidCreateRequest(message) => write!(f, "{message}"),
            Self::InvalidRenameRequest(message) => write!(f, "{message}"),
            Self::InvalidDeleteRequest(message) => write!(f, "{message}"),
            Self::VersionMismatch { path, .. } => write!(f, "version mismatch for: {path}"),
            Self::Io => write!(f, "file operation failed"),
        }
    }
}
