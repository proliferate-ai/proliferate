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
