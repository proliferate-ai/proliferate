#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TerminalStatus {
    Starting,
    Running,
    Exited,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TerminalPurpose {
    General,
    Run,
    Setup,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShellKind {
    Bash,
    Zsh,
    Sh,
    Other,
}

impl ShellKind {
    pub fn is_posix(self) -> bool {
        matches!(self, ShellKind::Bash | ShellKind::Zsh | ShellKind::Sh)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TerminalCommandRunStatus {
    Queued,
    Running,
    Succeeded,
    Failed,
    Interrupted,
    TimedOut,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TerminalCommandOutputMode {
    Separate,
    Combined,
}

#[derive(Debug, Clone)]
pub struct TerminalCommandRunRecord {
    pub id: String,
    pub workspace_id: String,
    pub terminal_id: Option<String>,
    pub purpose: TerminalPurpose,
    pub command: String,
    pub status: TerminalCommandRunStatus,
    pub exit_code: Option<i32>,
    pub output_mode: TerminalCommandOutputMode,
    pub stdout: Option<String>,
    pub stderr: Option<String>,
    pub combined_output: Option<String>,
    pub output_truncated: bool,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub duration_ms: Option<u64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct TerminalRecord {
    pub id: String,
    pub workspace_id: String,
    pub title: String,
    pub purpose: TerminalPurpose,
    pub cwd: String,
    pub status: TerminalStatus,
    pub exit_code: Option<i32>,
    pub created_at: String,
    pub updated_at: String,
    pub command_run: Option<TerminalCommandRunRecord>,
}

#[derive(Debug, Clone)]
pub struct CreateTerminalOptions {
    pub cwd: Option<String>,
    pub shell: Option<String>,
    pub title: Option<String>,
    pub purpose: TerminalPurpose,
    pub env: Vec<(String, String)>,
    pub startup_command: Option<String>,
    pub startup_command_env: Vec<(String, String)>,
    pub startup_command_timeout_ms: Option<u64>,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, Copy)]
pub struct ResizeTerminalOptions {
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone)]
pub struct RunTerminalCommandOptions {
    pub command: String,
    pub env: Vec<(String, String)>,
    pub interrupt: bool,
    pub timeout_ms: Option<u64>,
}
