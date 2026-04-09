use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::process::Command;
use tokio::sync::Mutex;
use tokio::task::{AbortHandle, JoinHandle};

use super::types::{SetupScriptExecutionResult, SetupScriptExecutionStatus};

/// Maximum bytes captured per stdout/stderr stream.
const MAX_OUTPUT_BYTES: usize = 64 * 1024;

/// Default timeout for setup script execution.
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(300); // 5 minutes

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SetupJobStatus {
    Queued,
    Running,
    Succeeded,
    Failed,
}

#[derive(Debug, Clone)]
pub struct SetupJobSnapshot {
    pub job_id: String,
    pub workspace_id: String,
    pub command: String,
    pub status: SetupJobStatus,
    pub exit_code: Option<i32>,
    pub stdout: Option<String>,
    pub stderr: Option<String>,
    pub started_at: Option<Instant>,
    pub duration_ms: Option<u64>,
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

struct SetupJob {
    job_id: String,
    workspace_id: String,
    command: String,
    status: SetupJobStatus,
    exit_code: Option<i32>,
    stdout: Option<String>,
    stderr: Option<String>,
    started_at: Option<Instant>,
    duration_ms: Option<u64>,
    abort_handle: Option<AbortHandle>,
}

impl SetupJob {
    fn snapshot(&self) -> SetupJobSnapshot {
        SetupJobSnapshot {
            job_id: self.job_id.clone(),
            workspace_id: self.workspace_id.clone(),
            command: self.command.clone(),
            status: self.status.clone(),
            exit_code: self.exit_code,
            stdout: self.stdout.clone(),
            stderr: self.stderr.clone(),
            started_at: self.started_at,
            duration_ms: self.duration_ms,
        }
    }

    fn to_execution_result(&self) -> Option<SetupScriptExecutionResult> {
        match self.status {
            SetupJobStatus::Succeeded | SetupJobStatus::Failed => {
                Some(SetupScriptExecutionResult {
                    command: self.command.clone(),
                    status: if self.status == SetupJobStatus::Succeeded {
                        SetupScriptExecutionStatus::Succeeded
                    } else {
                        SetupScriptExecutionStatus::Failed
                    },
                    exit_code: self.exit_code.unwrap_or(-1),
                    stdout: self.stdout.clone().unwrap_or_default(),
                    stderr: self.stderr.clone().unwrap_or_default(),
                    duration_ms: self.duration_ms.unwrap_or(0),
                })
            }
            _ => None,
        }
    }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/// Manages background setup script executions for workspaces.
///
/// State is in-memory only. On runtime restart, all job state is lost.
/// The frontend should handle "no job found" gracefully (show "unknown"
/// or re-offer the setup option).
pub struct SetupExecutionService {
    jobs: Arc<Mutex<HashMap<String, SetupJob>>>,
}

impl SetupExecutionService {
    pub fn new() -> Self {
        Self {
            jobs: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Start a setup script for a workspace. If a job is already running
    /// for this workspace, it is cancelled first (idempotency).
    ///
    /// Returns the job ID immediately. The script runs in a background task.
    pub async fn start(
        &self,
        workspace_id: String,
        workspace_path: String,
        command: String,
        env_vars: Vec<(String, String)>,
    ) -> String {
        let job_id = format!(
            "{}-{}",
            workspace_id,
            chrono::Utc::now().timestamp_millis()
        );

        // Cancel any existing job for this workspace
        self.cancel_for_workspace(&workspace_id).await;

        let job = SetupJob {
            job_id: job_id.clone(),
            workspace_id: workspace_id.clone(),
            command: command.clone(),
            status: SetupJobStatus::Queued,
            exit_code: None,
            stdout: None,
            stderr: None,
            started_at: None,
            duration_ms: None,
            abort_handle: None,
        };

        {
            let mut jobs = self.jobs.lock().await;
            jobs.insert(workspace_id.clone(), job);
        }

        // Spawn the execution task
        let jobs = self.jobs.clone();
        let ws_id = workspace_id.clone();
        let jid = job_id.clone();
        let task: JoinHandle<()> = tokio::spawn(async move {
            run_setup_task(&jobs, &ws_id, &jid, &command, &workspace_path, &env_vars).await;
        });

        // Store the abort handle so we can cancel if needed
        {
            let mut jobs = self.jobs.lock().await;
            if let Some(job) = jobs.get_mut(&workspace_id) {
                job.abort_handle = Some(task.abort_handle());
            }
        }

        job_id
    }

    /// Get the current status snapshot for a workspace's setup job.
    pub async fn get_status(&self, workspace_id: &str) -> Option<SetupJobSnapshot> {
        let jobs = self.jobs.lock().await;
        jobs.get(workspace_id).map(|job| job.snapshot())
    }

    /// Get the execution result if the job is in a terminal state.
    pub async fn get_result(&self, workspace_id: &str) -> Option<SetupScriptExecutionResult> {
        let jobs = self.jobs.lock().await;
        jobs.get(workspace_id).and_then(|job| job.to_execution_result())
    }

    /// Cancel and remove any running job for a workspace.
    pub async fn cancel_for_workspace(&self, workspace_id: &str) {
        let mut jobs = self.jobs.lock().await;
        if let Some(job) = jobs.remove(workspace_id) {
            if let Some(handle) = job.abort_handle {
                handle.abort();
                tracing::info!(
                    workspace_id = %workspace_id,
                    job_id = %job.job_id,
                    "setup execution cancelled"
                );
            }
        }
    }

    /// Check if a job is currently running for a workspace.
    pub async fn is_running(&self, workspace_id: &str) -> bool {
        let jobs = self.jobs.lock().await;
        jobs.get(workspace_id)
            .map(|j| matches!(j.status, SetupJobStatus::Queued | SetupJobStatus::Running))
            .unwrap_or(false)
    }
}

// ---------------------------------------------------------------------------
// Background execution task
// ---------------------------------------------------------------------------

async fn run_setup_task(
    jobs: &Arc<Mutex<HashMap<String, SetupJob>>>,
    workspace_id: &str,
    job_id: &str,
    command: &str,
    workspace_path: &str,
    env_vars: &[(String, String)],
) {
    let started_at = Instant::now();

    // Transition to Running
    {
        let mut jobs_guard = jobs.lock().await;
        if let Some(job) = jobs_guard.get_mut(workspace_id) {
            if job.job_id != job_id {
                return; // replaced by another job
            }
            job.status = SetupJobStatus::Running;
            job.started_at = Some(started_at);
        } else {
            return; // cancelled before we started
        }
    }

    tracing::info!(
        workspace_id = %workspace_id,
        job_id = %job_id,
        "setup script execution started"
    );

    let result = execute_script(command, workspace_path, env_vars).await;

    let duration_ms = started_at.elapsed().as_millis() as u64;

    // Transition to terminal state
    {
        let mut jobs_guard = jobs.lock().await;
        if let Some(job) = jobs_guard.get_mut(workspace_id) {
            if job.job_id != job_id {
                return; // replaced
            }
            match result {
                Ok((exit_code, stdout, stderr)) => {
                    let success = exit_code == 0;
                    job.status = if success {
                        SetupJobStatus::Succeeded
                    } else {
                        SetupJobStatus::Failed
                    };
                    job.exit_code = Some(exit_code);
                    job.stdout = Some(truncate_output(&stdout, MAX_OUTPUT_BYTES));
                    job.stderr = Some(truncate_output(&stderr, MAX_OUTPUT_BYTES));
                    job.duration_ms = Some(duration_ms);
                    tracing::info!(
                        workspace_id = %workspace_id,
                        job_id = %job_id,
                        exit_code,
                        success,
                        duration_ms,
                        "setup script execution completed"
                    );
                }
                Err(error) => {
                    job.status = SetupJobStatus::Failed;
                    job.exit_code = Some(-1);
                    job.stdout = Some(String::new());
                    job.stderr = Some(format!("failed to run setup script: {error}"));
                    job.duration_ms = Some(duration_ms);
                    tracing::warn!(
                        workspace_id = %workspace_id,
                        job_id = %job_id,
                        error = %error,
                        duration_ms,
                        "setup script execution failed"
                    );
                }
            }
        }
    }
}

async fn execute_script(
    script: &str,
    working_dir: &str,
    env_vars: &[(String, String)],
) -> anyhow::Result<(i32, String, String)> {
    let (shell, args) = resolve_shell_command(script);

    let mut cmd = Command::new(&shell);
    cmd.args(&args);
    cmd.current_dir(working_dir);
    for (key, value) in env_vars {
        cmd.env(key, value);
    }
    // Capture output
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let child = cmd.spawn()
        .map_err(|e| anyhow::anyhow!("failed to spawn setup script: {e}"))?;

    // Wait with timeout
    let output = tokio::time::timeout(DEFAULT_TIMEOUT, child.wait_with_output())
        .await
        .map_err(|_| anyhow::anyhow!("setup script timed out after {}s", DEFAULT_TIMEOUT.as_secs()))?
        .map_err(|e| anyhow::anyhow!("setup script execution error: {e}"))?;

    let exit_code = output.status.code().unwrap_or(-1);
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();

    Ok((exit_code, stdout, stderr))
}

#[cfg(not(windows))]
fn resolve_shell_command(script: &str) -> (String, Vec<String>) {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
    (shell, vec!["-lc".to_string(), script.to_string()])
}

#[cfg(windows)]
fn resolve_shell_command(script: &str) -> (String, Vec<String>) {
    ("cmd".to_string(), vec!["/C".to_string(), script.to_string()])
}

fn truncate_output(output: &str, max_bytes: usize) -> String {
    if output.len() <= max_bytes {
        return output.to_string();
    }

    let mut end = max_bytes;
    while end > 0 && !output.is_char_boundary(end) {
        end -= 1;
    }

    let mut truncated = output[..end].to_string();
    truncated.push_str("\n[output truncated]");
    truncated
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_start_and_get_status() {
        let service = SetupExecutionService::new();
        let job_id = service
            .start(
                "ws-1".into(),
                "/tmp".into(),
                "echo hello".into(),
                vec![],
            )
            .await;

        assert!(!job_id.is_empty());

        // Give the task a moment to start
        tokio::time::sleep(Duration::from_millis(100)).await;

        let snapshot = service.get_status("ws-1").await;
        assert!(snapshot.is_some());
    }

    #[tokio::test]
    async fn test_completion() {
        let service = SetupExecutionService::new();
        service
            .start(
                "ws-2".into(),
                "/tmp".into(),
                "echo done".into(),
                vec![],
            )
            .await;

        // Wait for completion
        tokio::time::sleep(Duration::from_millis(500)).await;

        let snapshot = service.get_status("ws-2").await.unwrap();
        assert_eq!(snapshot.status, SetupJobStatus::Succeeded);
        assert_eq!(snapshot.exit_code, Some(0));
        assert!(snapshot.stdout.unwrap().contains("done"));
    }

    #[tokio::test]
    async fn test_failure() {
        let service = SetupExecutionService::new();
        service
            .start(
                "ws-3".into(),
                "/tmp".into(),
                "exit 1".into(),
                vec![],
            )
            .await;

        tokio::time::sleep(Duration::from_millis(500)).await;

        let snapshot = service.get_status("ws-3").await.unwrap();
        assert_eq!(snapshot.status, SetupJobStatus::Failed);
        assert_eq!(snapshot.exit_code, Some(1));
    }

    #[tokio::test]
    async fn test_cancel() {
        let service = SetupExecutionService::new();
        service
            .start(
                "ws-4".into(),
                "/tmp".into(),
                "sleep 60".into(),
                vec![],
            )
            .await;

        tokio::time::sleep(Duration::from_millis(100)).await;
        service.cancel_for_workspace("ws-4").await;

        let snapshot = service.get_status("ws-4").await;
        assert!(snapshot.is_none()); // cancelled = removed
    }

    #[tokio::test]
    async fn test_idempotent_restart() {
        let service = SetupExecutionService::new();
        let job1 = service
            .start(
                "ws-5".into(),
                "/tmp".into(),
                "sleep 60".into(),
                vec![],
            )
            .await;

        tokio::time::sleep(Duration::from_millis(100)).await;

        // Start a new job for the same workspace — should cancel the first
        let job2 = service
            .start(
                "ws-5".into(),
                "/tmp".into(),
                "echo replaced".into(),
                vec![],
            )
            .await;

        assert_ne!(job1, job2);

        tokio::time::sleep(Duration::from_millis(500)).await;

        let snapshot = service.get_status("ws-5").await.unwrap();
        assert_eq!(snapshot.job_id, job2);
        assert_eq!(snapshot.status, SetupJobStatus::Succeeded);
    }
}
