use std::sync::Arc;

use crate::domains::terminals::model::TerminalCommandRunRecord;
use crate::domains::workspaces::access_gate::{WorkspaceAccessError, WorkspaceAccessGate};
use crate::domains::workspaces::model::WorkspaceRecord;
use crate::domains::workspaces::operation_gate::{WorkspaceOperationGate, WorkspaceOperationKind};
use crate::domains::workspaces::runtime::WorkspaceRuntime;
use crate::live::terminals::TerminalService;

#[derive(Clone)]
pub struct WorkspaceSetupRuntime {
    workspace_runtime: Arc<WorkspaceRuntime>,
    terminal_service: Arc<TerminalService>,
    access_gate: Arc<WorkspaceAccessGate>,
    operation_gate: Arc<WorkspaceOperationGate>,
}

#[derive(Debug, Clone)]
pub struct StartWorkspaceSetupInput {
    pub workspace_id: String,
    pub command: String,
    pub base_ref: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum WorkspaceSetupError {
    #[error("Setup command must not be empty.")]
    InvalidCommand,
    #[error("Workspace not found: {0}")]
    WorkspaceNotFound(String),
    #[error("No previous setup execution found for this workspace")]
    SetupNotFound,
    #[error(transparent)]
    Access(#[from] WorkspaceAccessError),
    #[error("workspace setup task failed: {0}")]
    TaskFailed(#[from] tokio::task::JoinError),
    #[error(transparent)]
    Unexpected(#[from] anyhow::Error),
}

impl WorkspaceSetupRuntime {
    pub fn new(
        workspace_runtime: Arc<WorkspaceRuntime>,
        terminal_service: Arc<TerminalService>,
        access_gate: Arc<WorkspaceAccessGate>,
        operation_gate: Arc<WorkspaceOperationGate>,
    ) -> Self {
        Self {
            workspace_runtime,
            terminal_service,
            access_gate,
            operation_gate,
        }
    }

    pub fn latest_setup_run(
        &self,
        workspace_id: &str,
    ) -> Result<Option<TerminalCommandRunRecord>, WorkspaceSetupError> {
        Ok(self.terminal_service.latest_setup_run(workspace_id)?)
    }

    pub async fn start_setup(
        &self,
        input: StartWorkspaceSetupInput,
    ) -> Result<TerminalCommandRunRecord, WorkspaceSetupError> {
        let command = normalize_setup_command(input.command)?;
        let _lease = self
            .operation_gate
            .acquire_shared(&input.workspace_id, WorkspaceOperationKind::SetupCommand)
            .await;
        self.access_gate
            .assert_can_mutate_for_workspace(&input.workspace_id)?;
        let record = self.load_workspace(input.workspace_id).await?;
        self.start_setup_for_record(record, command, input.base_ref)
            .await
    }

    pub async fn rerun_setup(
        &self,
        workspace_id: String,
    ) -> Result<TerminalCommandRunRecord, WorkspaceSetupError> {
        let previous = self
            .terminal_service
            .latest_setup_run(&workspace_id)?
            .ok_or(WorkspaceSetupError::SetupNotFound)?;
        self.start_setup(StartWorkspaceSetupInput {
            workspace_id,
            command: previous.command,
            base_ref: None,
        })
        .await
    }

    pub async fn start_setup_for_created_workspace(
        &self,
        workspace: WorkspaceRecord,
        command: String,
        base_ref: Option<String>,
    ) -> Result<TerminalCommandRunRecord, WorkspaceSetupError> {
        let command = normalize_setup_command(command)?;
        let _lease = self
            .operation_gate
            .acquire_shared(&workspace.id, WorkspaceOperationKind::SetupCommand)
            .await;
        self.start_setup_for_record(workspace, command, base_ref)
            .await
    }

    async fn load_workspace(
        &self,
        workspace_id: String,
    ) -> Result<WorkspaceRecord, WorkspaceSetupError> {
        let runtime = self.workspace_runtime.clone();
        let lookup_id = workspace_id.clone();
        let record = tokio::task::spawn_blocking(move || runtime.get_workspace(&lookup_id))
            .await??
            .ok_or(WorkspaceSetupError::WorkspaceNotFound(workspace_id))?;
        Ok(record)
    }

    async fn start_setup_for_record(
        &self,
        record: WorkspaceRecord,
        command: String,
        base_ref: Option<String>,
    ) -> Result<TerminalCommandRunRecord, WorkspaceSetupError> {
        let env_vars = {
            let workspace_runtime = self.workspace_runtime.clone();
            let record = record.clone();
            let base_ref = base_ref.clone();
            tokio::task::spawn_blocking(move || {
                workspace_runtime.build_workspace_env(&record, base_ref.as_deref())
            })
            .await??
        };

        Ok(self
            .terminal_service
            .start_setup_command(&record.id, &record.path, command, env_vars, None)
            .await?)
    }
}

fn normalize_setup_command(command: String) -> Result<String, WorkspaceSetupError> {
    let command = command.trim().to_string();
    if command.is_empty() {
        return Err(WorkspaceSetupError::InvalidCommand);
    }
    Ok(command)
}
