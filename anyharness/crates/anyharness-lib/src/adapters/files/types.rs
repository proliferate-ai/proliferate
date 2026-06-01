use super::safety::SafetyError;

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

impl std::fmt::Display for FileServiceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Safety(e) => write!(f, "{e}"),
            Self::NotFound(p) => write!(f, "file not found: {p}"),
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
            Self::Io(e) => write!(f, "file I/O error: {e}"),
        }
    }
}
