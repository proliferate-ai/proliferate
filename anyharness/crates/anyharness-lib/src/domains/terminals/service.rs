use super::model::{
    TerminalCommandOutputMode, TerminalCommandRunRecord, TerminalCommandRunStatus, TerminalPurpose,
};
use super::store::TerminalStore;

const MAX_COMMAND_OUTPUT_BYTES: usize = 64 * 1024;

#[derive(Clone)]
pub struct TerminalCommandService {
    store: TerminalStore,
}

impl TerminalCommandService {
    pub fn new(store: TerminalStore) -> Self {
        Self { store }
    }

    pub fn get_command_run(&self, id: &str) -> anyhow::Result<Option<TerminalCommandRunRecord>> {
        self.store.get_command_run(id)
    }

    pub fn latest_command_run_for_terminal(
        &self,
        terminal_id: &str,
    ) -> anyhow::Result<Option<TerminalCommandRunRecord>> {
        self.store.latest_command_run_for_terminal(terminal_id)
    }

    pub fn latest_setup_run(
        &self,
        workspace_id: &str,
    ) -> anyhow::Result<Option<TerminalCommandRunRecord>> {
        self.store.latest_setup_run(workspace_id)
    }

    pub fn active_command_runs_for_workspace(
        &self,
        workspace_id: &str,
    ) -> anyhow::Result<Vec<TerminalCommandRunRecord>> {
        self.store
            .list_active_command_runs_for_workspace(workspace_id)
    }

    pub fn insert_command_run(&self, record: &TerminalCommandRunRecord) -> anyhow::Result<()> {
        self.store.insert_command_run(record)
    }

    pub fn update_command_run(&self, record: &TerminalCommandRunRecord) -> anyhow::Result<()> {
        self.store.update_command_run(record)
    }

    pub fn set_latest_setup_run(
        &self,
        workspace_id: &str,
        command_run_id: &str,
    ) -> anyhow::Result<()> {
        self.store
            .set_latest_setup_run(workspace_id, command_run_id)
    }

    pub fn mark_active_runs_failed_on_startup(&self) -> anyhow::Result<()> {
        self.store.mark_active_runs_failed_on_startup()
    }

    pub fn prune_completed_non_setup_runs(&self, max_per_workspace: usize) -> anyhow::Result<()> {
        self.store.prune_completed_non_setup_runs(max_per_workspace)
    }

    pub fn is_setup_running(&self, workspace_id: &str) -> bool {
        self.latest_setup_run(workspace_id)
            .ok()
            .flatten()
            .map(|run| {
                matches!(
                    run.status,
                    TerminalCommandRunStatus::Queued | TerminalCommandRunStatus::Running
                )
            })
            .unwrap_or(false)
    }

    pub fn mark_command_interrupted(&self, command_run_id: &str) -> anyhow::Result<()> {
        if let Some(mut record) = self.store.get_command_run(command_run_id)? {
            let combined_output = record.combined_output.clone();
            let output_truncated = record.output_truncated;
            complete_command_run(
                &mut record,
                TerminalCommandRunStatus::Interrupted,
                Some(130),
                None,
                None,
                combined_output,
                output_truncated,
                None,
            );
            self.store.update_command_run(&record)?;
        }
        Ok(())
    }

    pub fn mark_command_interrupted_with_message(
        &self,
        command_run_id: &str,
        message: &str,
    ) -> anyhow::Result<()> {
        if let Some(mut record) = self.store.get_command_run(command_run_id)? {
            let output_truncated = record.output_truncated;
            let stdout = record.stdout.clone();
            let stderr = Some(match record.stderr.as_deref() {
                Some(existing) if !existing.trim().is_empty() => {
                    format!("{existing}\n{message}")
                }
                _ => message.to_string(),
            });
            let combined_output = record.combined_output.clone();
            let (stdout, stderr, combined_output) = match record.output_mode {
                TerminalCommandOutputMode::Separate => (stdout, stderr, None),
                TerminalCommandOutputMode::Combined => (None, None, combined_output),
            };
            complete_command_run(
                &mut record,
                TerminalCommandRunStatus::Interrupted,
                Some(130),
                stdout,
                stderr,
                combined_output,
                output_truncated,
                None,
            );
            self.store.update_command_run(&record)?;
        }
        Ok(())
    }
}

pub fn new_command_run_record(
    id: &str,
    workspace_id: &str,
    terminal_id: Option<&str>,
    purpose: TerminalPurpose,
    command: &str,
    output_mode: TerminalCommandOutputMode,
) -> TerminalCommandRunRecord {
    let now = chrono::Utc::now().to_rfc3339();
    TerminalCommandRunRecord {
        id: id.to_string(),
        workspace_id: workspace_id.to_string(),
        terminal_id: terminal_id.map(str::to_string),
        purpose,
        command: command.to_string(),
        status: TerminalCommandRunStatus::Queued,
        exit_code: None,
        output_mode,
        stdout: None,
        stderr: None,
        combined_output: None,
        output_truncated: false,
        started_at: None,
        completed_at: None,
        duration_ms: None,
        created_at: now.clone(),
        updated_at: now,
    }
}

pub fn complete_command_run(
    record: &mut TerminalCommandRunRecord,
    status: TerminalCommandRunStatus,
    exit_code: Option<i32>,
    stdout: Option<String>,
    stderr: Option<String>,
    combined_output: Option<String>,
    output_truncated: bool,
    duration_ms: Option<u64>,
) {
    let now = chrono::Utc::now().to_rfc3339();
    record.status = status;
    record.exit_code = exit_code;
    record.stdout = stdout;
    record.stderr = stderr;
    record.combined_output = combined_output;
    record.output_truncated = output_truncated;
    record.completed_at = Some(now.clone());
    record.updated_at = now;
    record.duration_ms = duration_ms;
}

pub fn append_bounded(target: &mut String, chunk: &str, truncated: &mut bool) {
    if target.len() >= MAX_COMMAND_OUTPUT_BYTES {
        *truncated = true;
        return;
    }
    let remaining = MAX_COMMAND_OUTPUT_BYTES - target.len();
    if chunk.len() <= remaining {
        target.push_str(chunk);
        return;
    }
    let mut end = remaining;
    while end > 0 && !chunk.is_char_boundary(end) {
        end -= 1;
    }
    target.push_str(&chunk[..end]);
    *truncated = true;
}

pub fn validate_env_vars(
    env_vars: &[(String, String)],
    reject_reserved: bool,
) -> anyhow::Result<()> {
    for (key, _) in env_vars {
        let mut chars = key.chars();
        let valid = chars
            .next()
            .map(|first| first == '_' || first.is_ascii_alphabetic())
            .unwrap_or(false)
            && chars.all(|ch| ch == '_' || ch.is_ascii_alphanumeric());
        if !valid || (reject_reserved && key.starts_with("ANYHARNESS_")) {
            anyhow::bail!("invalid setup environment variable: {key}");
        }
    }
    Ok(())
}
