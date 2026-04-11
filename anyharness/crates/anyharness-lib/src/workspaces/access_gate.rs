use std::sync::Arc;

use super::access_model::{WorkspaceAccessMode, WorkspaceAccessRecord};
use super::access_store::WorkspaceAccessStore;
use super::store::WorkspaceStore;
use crate::sessions::store::SessionStore;
use crate::terminals::service::TerminalService;

#[derive(Debug, thiserror::Error)]
pub enum WorkspaceAccessError {
    #[error("workspace not found: {0}")]
    WorkspaceNotFound(String),
    #[error("session not found: {0}")]
    SessionNotFound(String),
    #[error("terminal not found: {0}")]
    TerminalNotFound(String),
    #[error("workspace {workspace_id} is not writable while mode={mode}")]
    MutationBlocked {
        workspace_id: String,
        mode: WorkspaceAccessMode,
    },
    #[error("workspace {workspace_id} cannot start live sessions while mode={mode}")]
    LiveSessionStartBlocked {
        workspace_id: String,
        mode: WorkspaceAccessMode,
    },
}

#[derive(Clone)]
pub struct WorkspaceAccessGate {
    workspace_store: WorkspaceStore,
    session_store: SessionStore,
    access_store: WorkspaceAccessStore,
    terminal_service: Arc<TerminalService>,
}

impl WorkspaceAccessGate {
    pub fn new(
        workspace_store: WorkspaceStore,
        session_store: SessionStore,
        access_store: WorkspaceAccessStore,
        terminal_service: Arc<TerminalService>,
    ) -> Self {
        Self {
            workspace_store,
            session_store,
            access_store,
            terminal_service,
        }
    }

    pub fn runtime_state(
        &self,
        workspace_id: &str,
    ) -> Result<WorkspaceAccessRecord, WorkspaceAccessError> {
        let workspace = self
            .workspace_store
            .find_by_id(workspace_id)
            .map_err(|error| WorkspaceAccessError::WorkspaceNotFound(error.to_string()))?
            .ok_or_else(|| WorkspaceAccessError::WorkspaceNotFound(workspace_id.to_string()))?;
        Ok(self
            .access_store
            .find_by_workspace(workspace_id)
            .map_err(|error| WorkspaceAccessError::WorkspaceNotFound(error.to_string()))?
            .unwrap_or_else(|| WorkspaceAccessRecord::normal_for_workspace(&workspace)))
    }

    pub fn set_runtime_state(
        &self,
        workspace_id: &str,
        mode: WorkspaceAccessMode,
        handoff_op_id: Option<String>,
    ) -> Result<WorkspaceAccessRecord, WorkspaceAccessError> {
        let workspace = self
            .workspace_store
            .find_by_id(workspace_id)
            .map_err(|error| WorkspaceAccessError::WorkspaceNotFound(error.to_string()))?
            .ok_or_else(|| WorkspaceAccessError::WorkspaceNotFound(workspace_id.to_string()))?;
        let record = WorkspaceAccessRecord {
            workspace_id: workspace.id.clone(),
            mode,
            handoff_op_id,
            updated_at: chrono::Utc::now().to_rfc3339(),
        };
        self.access_store
            .upsert(&record)
            .map_err(|error| WorkspaceAccessError::WorkspaceNotFound(error.to_string()))?;
        Ok(record)
    }

    pub fn clear_runtime_state(&self, workspace_id: &str) -> Result<(), WorkspaceAccessError> {
        self.access_store
            .delete(workspace_id)
            .map_err(|error| WorkspaceAccessError::WorkspaceNotFound(error.to_string()))
    }

    pub fn assert_can_mutate_for_workspace(
        &self,
        workspace_id: &str,
    ) -> Result<(), WorkspaceAccessError> {
        let state = self.runtime_state(workspace_id)?;
        match state.mode {
            WorkspaceAccessMode::Normal => Ok(()),
            mode => Err(WorkspaceAccessError::MutationBlocked {
                workspace_id: workspace_id.to_string(),
                mode,
            }),
        }
    }

    pub fn assert_can_mutate_for_repo_root(
        &self,
        repo_root_id: &str,
    ) -> Result<(), WorkspaceAccessError> {
        let workspaces = self
            .workspace_store
            .list_by_repo_root_id(repo_root_id)
            .map_err(|error| WorkspaceAccessError::WorkspaceNotFound(error.to_string()))?;
        for workspace in workspaces {
            self.assert_can_mutate_for_workspace(&workspace.id)?;
        }
        Ok(())
    }

    pub fn assert_can_mutate_for_session(
        &self,
        session_id: &str,
    ) -> Result<(), WorkspaceAccessError> {
        let session = self
            .session_store
            .find_by_id(session_id)
            .map_err(|error| WorkspaceAccessError::SessionNotFound(error.to_string()))?
            .ok_or_else(|| WorkspaceAccessError::SessionNotFound(session_id.to_string()))?;
        self.assert_can_mutate_for_workspace(&session.workspace_id)
    }

    pub async fn assert_can_mutate_for_terminal(
        &self,
        terminal_id: &str,
    ) -> Result<(), WorkspaceAccessError> {
        let terminal = self
            .terminal_service
            .get_terminal(terminal_id)
            .await
            .ok_or_else(|| WorkspaceAccessError::TerminalNotFound(terminal_id.to_string()))?;
        self.assert_can_mutate_for_workspace(&terminal.workspace_id)
    }

    pub fn assert_can_start_live_session(
        &self,
        session_id: &str,
    ) -> Result<(), WorkspaceAccessError> {
        let session = self
            .session_store
            .find_by_id(session_id)
            .map_err(|error| WorkspaceAccessError::SessionNotFound(error.to_string()))?
            .ok_or_else(|| WorkspaceAccessError::SessionNotFound(session_id.to_string()))?;
        let state = self.runtime_state(&session.workspace_id)?;
        match state.mode {
            WorkspaceAccessMode::Normal => Ok(()),
            mode => Err(WorkspaceAccessError::LiveSessionStartBlocked {
                workspace_id: session.workspace_id,
                mode,
            }),
        }
    }
}
