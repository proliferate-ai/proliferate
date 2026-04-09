#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TerminalStatus {
    Starting,
    Running,
    Exited,
    Failed,
}

#[derive(Debug, Clone)]
pub struct TerminalRecord {
    pub id: String,
    pub workspace_id: String,
    pub title: String,
    pub cwd: String,
    pub status: TerminalStatus,
    pub exit_code: Option<i32>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct CreateTerminalOptions {
    pub cwd: Option<String>,
    pub shell: Option<String>,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, Copy)]
pub struct ResizeTerminalOptions {
    pub cols: u16,
    pub rows: u16,
}
