//! Destroy the source workspace after a committed move.
//!
//! Live because it force-closes live terminals and because destroying the
//! materialization goes through `WorkspaceRuntime`.

use std::path::PathBuf;

use super::MobilityRuntime;
use crate::domains::agents::portability::delete_session_agent_artifacts;
use crate::domains::mobility::model::DestroyedWorkspaceSourceSummary;
use crate::domains::mobility::service::MobilityError;
use crate::domains::workspaces::model::WorkspaceKind;

impl MobilityRuntime {
    pub fn destroy_source_workspace(
        &self,
        workspace_id: &str,
    ) -> Result<DestroyedWorkspaceSourceSummary, MobilityError> {
        let workspace = self.mobility_service.load_workspace(workspace_id)?;
        let workspace_path = PathBuf::from(&workspace.path);
        let default_branch = if workspace.kind == WorkspaceKind::Local {
            let repo_root_id = workspace.repo_root_id.clone();
            Some(
                self.workspace_runtime
                    .resolve_repo_root_default_branch(&repo_root_id)
                    .map_err(MobilityError::Internal)?,
            )
        } else {
            None
        };

        let active_terminals = self.active_terminals_blocking(workspace_id);
        let mut closed_terminal_ids = Vec::new();
        for terminal in active_terminals {
            self.terminal_service
                .close_terminal_blocking(&terminal.id)
                .map_err(MobilityError::Internal)?;
            closed_terminal_ids.push(terminal.id);
        }
        let sessions = self
            .session_service
            .store()
            .list_by_workspace(workspace_id)?;
        let mut deleted_session_ids = Vec::new();
        let runtime_home = Some(self.session_runtime.runtime_home());
        for session in sessions {
            delete_session_agent_artifacts(&session, &workspace_path, runtime_home)?;
            self.session_service.delete_session(&session.id)?;
            deleted_session_ids.push(session.id);
        }

        self.workspace_runtime
            .destroy_source_workspace_materialization(&workspace, default_branch.as_deref())
            .map_err(MobilityError::Internal)?;

        Ok(DestroyedWorkspaceSourceSummary {
            workspace_id: workspace.id,
            deleted_session_ids,
            closed_terminal_ids,
            source_destroyed: true,
        })
    }
}
