use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{broadcast, Mutex, RwLock};

use crate::domains::terminals::model::{
    CreateTerminalOptions, ResizeTerminalOptions, RunTerminalCommandOptions,
    TerminalCommandOutputMode, TerminalCommandRunRecord, TerminalCommandRunStatus,
    TerminalOutputEvent, TerminalPurpose, TerminalRecord,
};
use crate::domains::terminals::service::{
    new_command_run_record, validate_env_vars, TerminalCommandService,
};
use crate::domains::terminals::store::TerminalStore;

use super::driver;
use super::handle::{TerminalHandle, TerminalOutputRegistry, TerminalRegistry};
use super::setup_process::{run_setup_process, set_terminal_output_suppressed, ActiveSetupTask};
use super::shell::detect_posix_shell;

const DEFAULT_SETUP_TIMEOUT: Duration = Duration::from_secs(300);

pub struct TerminalService {
    terminals: TerminalRegistry,
    output_hubs: TerminalOutputRegistry,
    command_service: TerminalCommandService,
    runtime_home: PathBuf,
    active_setup_tasks: Arc<Mutex<HashMap<String, ActiveSetupTask>>>,
}

impl TerminalService {
    pub fn new(store: TerminalStore, runtime_home: PathBuf) -> Self {
        let command_service = TerminalCommandService::new(store);
        let service = Self {
            terminals: Arc::new(RwLock::new(HashMap::new())),
            output_hubs: Arc::new(RwLock::new(HashMap::new())),
            command_service,
            runtime_home,
            active_setup_tasks: Arc::new(Mutex::new(HashMap::new())),
        };
        if let Err(error) = service.command_service.mark_active_runs_failed_on_startup() {
            tracing::warn!(error = %error, "failed to mark active terminal command-runs failed on startup");
        }
        if let Err(error) = service.command_service.prune_completed_non_setup_runs(100) {
            tracing::warn!(error = %error, "failed to prune terminal command-runs on startup");
        }
        service
    }

    pub async fn list_terminals(&self, workspace_id: &str) -> Vec<TerminalRecord> {
        let map = self.terminals.read().await;
        let mut results = Vec::new();
        for handle in map.values() {
            let h = handle.lock().await;
            if h.record.workspace_id == workspace_id {
                results.push(h.record_with_latest_command_run(&self.command_service));
            }
        }
        results.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        results
    }

    pub fn list_terminals_blocking(&self, workspace_id: &str) -> Vec<TerminalRecord> {
        let map = self.terminals.blocking_read();
        let mut results = Vec::new();
        for handle in map.values() {
            let h = handle.blocking_lock();
            if h.record.workspace_id == workspace_id {
                results.push(h.record_with_latest_command_run(&self.command_service));
            }
        }
        results.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        results
    }

    pub async fn get_terminal(&self, terminal_id: &str) -> Option<TerminalRecord> {
        let handle = self.lookup_terminal(terminal_id).await?;
        handle.snapshot().await.ok()
    }

    pub async fn lookup_terminal(&self, terminal_id: &str) -> Option<TerminalHandle> {
        let pty = {
            let map = self.terminals.read().await;
            map.get(terminal_id).cloned()
        }?;
        Some(TerminalHandle::new(
            terminal_id.to_string(),
            pty,
            self.terminals.clone(),
            self.output_hubs.clone(),
            self.command_service.clone(),
            self.runtime_home.clone(),
        ))
    }

    pub fn get_command_run(&self, id: &str) -> anyhow::Result<Option<TerminalCommandRunRecord>> {
        self.command_service.get_command_run(id)
    }

    pub fn latest_setup_run(
        &self,
        workspace_id: &str,
    ) -> anyhow::Result<Option<TerminalCommandRunRecord>> {
        self.command_service.latest_setup_run(workspace_id)
    }

    pub fn active_command_runs_for_workspace(
        &self,
        workspace_id: &str,
    ) -> anyhow::Result<Vec<TerminalCommandRunRecord>> {
        self.command_service
            .active_command_runs_for_workspace(workspace_id)
    }

    pub async fn create_terminal(
        &self,
        workspace_id: &str,
        workspace_path: &str,
        request: CreateTerminalOptions,
    ) -> anyhow::Result<TerminalRecord> {
        let record = self
            .create_terminal_shell(workspace_id, workspace_path, &request)
            .await?;

        if let Some(command) = request.startup_command.clone() {
            let _ = self
                .run_terminal_command(
                    &record.id,
                    RunTerminalCommandOptions {
                        command,
                        env: request.startup_command_env,
                        interrupt: false,
                        timeout_ms: request.startup_command_timeout_ms,
                    },
                )
                .await?;
        }

        Ok(self.get_terminal(&record.id).await.unwrap_or(record))
    }

    async fn create_terminal_shell(
        &self,
        workspace_id: &str,
        workspace_path: &str,
        request: &CreateTerminalOptions,
    ) -> anyhow::Result<TerminalRecord> {
        driver::create_terminal_shell(
            &self.terminals,
            &self.output_hubs,
            &self.command_service,
            workspace_id,
            workspace_path,
            request,
        )
        .await
    }

    pub async fn run_terminal_command(
        &self,
        terminal_id: &str,
        request: RunTerminalCommandOptions,
    ) -> anyhow::Result<TerminalCommandRunRecord> {
        let handle = self
            .lookup_terminal(terminal_id)
            .await
            .ok_or_else(|| anyhow::anyhow!("terminal not found"))?;
        handle.run_command(request).await
    }

    pub async fn start_setup_command(
        &self,
        workspace_id: &str,
        workspace_path: &str,
        command: String,
        env_vars: Vec<(String, String)>,
        timeout_ms: Option<u64>,
    ) -> anyhow::Result<TerminalCommandRunRecord> {
        validate_env_vars(&env_vars, false)?;
        if let Some(active) = self.active_setup_tasks.lock().await.remove(workspace_id) {
            self.command_service.mark_command_interrupted_with_message(
                &active.command_run_id,
                "Setup command superseded by a new run",
            )?;
            active.abort_handle.abort();
        }

        let terminal = match self.find_live_setup_terminal(workspace_id).await {
            Some(record) => record,
            None => {
                self.create_terminal_shell(
                    workspace_id,
                    workspace_path,
                    &CreateTerminalOptions {
                        cwd: None,
                        shell: Some(detect_posix_shell()),
                        title: Some("Setup command".to_string()),
                        purpose: TerminalPurpose::Setup,
                        env: Vec::new(),
                        startup_command: None,
                        startup_command_env: Vec::new(),
                        startup_command_timeout_ms: None,
                        cols: 120,
                        rows: 40,
                    },
                )
                .await?
            }
        };

        let command_run_id = uuid::Uuid::new_v4().to_string();
        let mut record = new_command_run_record(
            &command_run_id,
            workspace_id,
            Some(&terminal.id),
            TerminalPurpose::Setup,
            command.trim(),
            TerminalCommandOutputMode::Separate,
        );
        record.status = TerminalCommandRunStatus::Running;
        record.started_at = Some(chrono::Utc::now().to_rfc3339());
        record.updated_at = record
            .started_at
            .clone()
            .unwrap_or_else(|| record.created_at.clone());
        self.command_service.insert_command_run(&record)?;
        self.command_service
            .set_latest_setup_run(workspace_id, &command_run_id)?;
        self.set_terminal_command_run(&terminal.id, record.clone())
            .await;
        set_terminal_output_suppressed(&self.terminals, &terminal.id, true).await;

        let command_service = self.command_service.clone();
        let terminals = self.terminals.clone();
        let hubs = self.output_hubs.clone();
        let active_setup_tasks = self.active_setup_tasks.clone();
        let terminal_id = terminal.id.clone();
        let workspace_id_owned = workspace_id.to_string();
        let workspace_path_owned = workspace_path.to_string();
        let timeout =
            Duration::from_millis(timeout_ms.unwrap_or(DEFAULT_SETUP_TIMEOUT.as_millis() as u64));
        let task_record = record.clone();
        let task_workspace_id = workspace_id_owned.clone();
        let task_command_run_id = command_run_id.clone();
        let handle = tokio::spawn(async move {
            run_setup_process(
                command_service,
                terminals,
                hubs,
                task_record,
                terminal_id,
                workspace_path_owned,
                command,
                env_vars,
                timeout,
            )
            .await;
            let mut tasks = active_setup_tasks.lock().await;
            if tasks
                .get(&task_workspace_id)
                .map(|active| active.command_run_id.as_str())
                == Some(task_command_run_id.as_str())
            {
                tasks.remove(&task_workspace_id);
            }
        });
        self.active_setup_tasks.lock().await.insert(
            workspace_id_owned,
            ActiveSetupTask {
                command_run_id,
                abort_handle: handle.abort_handle(),
            },
        );

        Ok(record)
    }

    pub async fn rerun_setup_command(
        &self,
        workspace_id: &str,
        workspace_path: &str,
        env_vars: Vec<(String, String)>,
    ) -> anyhow::Result<TerminalCommandRunRecord> {
        let previous = self
            .command_service
            .latest_setup_run(workspace_id)?
            .ok_or_else(|| {
                anyhow::anyhow!("No previous setup execution found for this workspace")
            })?;
        self.start_setup_command(
            workspace_id,
            workspace_path,
            previous.command,
            env_vars,
            Some(DEFAULT_SETUP_TIMEOUT.as_millis() as u64),
        )
        .await
    }

    pub async fn is_setup_running(&self, workspace_id: &str) -> bool {
        self.command_service.is_setup_running(workspace_id)
    }

    pub fn is_setup_running_blocking(&self, workspace_id: &str) -> bool {
        self.command_service.is_setup_running(workspace_id)
    }

    pub async fn update_terminal_title(
        &self,
        terminal_id: &str,
        title: String,
    ) -> anyhow::Result<TerminalRecord> {
        let handle = self
            .lookup_terminal(terminal_id)
            .await
            .ok_or_else(|| anyhow::anyhow!("terminal not found"))?;
        handle.update_title(title).await
    }

    pub async fn write_input(&self, terminal_id: &str, data: &[u8]) -> anyhow::Result<()> {
        let handle = self
            .lookup_terminal(terminal_id)
            .await
            .ok_or_else(|| anyhow::anyhow!("terminal not found"))?;
        handle.write_input(data).await
    }

    pub async fn resize_terminal(
        &self,
        terminal_id: &str,
        request: ResizeTerminalOptions,
    ) -> anyhow::Result<TerminalRecord> {
        let handle = self
            .lookup_terminal(terminal_id)
            .await
            .ok_or_else(|| anyhow::anyhow!("terminal not found"))?;
        handle.resize(request).await
    }

    pub async fn close_terminal(&self, terminal_id: &str) -> anyhow::Result<()> {
        if let Some(handle) = self.lookup_terminal(terminal_id).await {
            handle.close().await?;
        }
        Ok(())
    }

    pub fn close_terminal_blocking(&self, terminal_id: &str) -> anyhow::Result<()> {
        tokio::runtime::Handle::current().block_on(self.close_terminal(terminal_id))
    }

    pub async fn subscribe_output(
        &self,
        terminal_id: &str,
        after_seq: Option<u64>,
    ) -> Option<(
        Vec<TerminalOutputEvent>,
        broadcast::Receiver<TerminalOutputEvent>,
    )> {
        let handle = self.lookup_terminal(terminal_id).await?;
        handle.subscribe_output(after_seq).await
    }

    async fn find_live_setup_terminal(&self, workspace_id: &str) -> Option<TerminalRecord> {
        self.list_terminals(workspace_id)
            .await
            .into_iter()
            .find(|record| record.purpose == TerminalPurpose::Setup)
    }

    async fn set_terminal_command_run(&self, terminal_id: &str, run: TerminalCommandRunRecord) {
        let map = self.terminals.read().await;
        if let Some(handle) = map.get(terminal_id) {
            let mut h = handle.lock().await;
            h.set_command_run(run);
        }
    }
}

#[cfg(test)]
#[path = "manager_tests.rs"]
mod tests;
