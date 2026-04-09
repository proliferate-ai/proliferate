#[derive(Debug, Clone)]
pub struct RunProcessRequest {
    pub command: Vec<String>,
    pub cwd: Option<String>,
    pub timeout_ms: Option<u64>,
    pub max_output_bytes: Option<usize>,
}

#[derive(Debug, Clone)]
pub struct RunProcessResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

#[derive(Debug)]
pub enum ProcessServiceError {
    EmptyCommand,
    CwdEscape,
    CommandFailed(String),
    TimedOut,
}

impl std::fmt::Display for ProcessServiceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProcessServiceError::EmptyCommand => write!(f, "command cannot be empty"),
            ProcessServiceError::CwdEscape => {
                write!(f, "cwd must be within the workspace boundary")
            }
            ProcessServiceError::CommandFailed(error) => write!(f, "command failed: {error}"),
            ProcessServiceError::TimedOut => write!(f, "command timed out"),
        }
    }
}

impl std::error::Error for ProcessServiceError {}
