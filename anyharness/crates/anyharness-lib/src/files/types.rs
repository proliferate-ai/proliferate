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
