//! Prepare a mobility destination workspace under a repo root.
//!
//! Live because it materializes a destination through `WorkspaceRuntime` and
//! then proves the destination is empty against live terminals.

use super::MobilityRuntime;
use crate::domains::mobility::service::MobilityError;
use crate::domains::workspaces::model::WorkspaceRecord;
use crate::domains::workspaces::types::PreparedWorkspaceMobilityDestination;

impl MobilityRuntime {
    pub async fn prepare_repo_root_destination(
        &self,
        repo_root_id: &str,
        requested_branch: &str,
        requested_base_sha: &str,
        destination_id: Option<&str>,
        preferred_workspace_name: Option<&str>,
    ) -> Result<PreparedWorkspaceMobilityDestination, MobilityError> {
        let repo_root_id = repo_root_id.trim().to_string();
        let requested_branch = requested_branch.trim().to_string();
        let requested_base_sha = requested_base_sha.trim().to_string();
        let preferred_workspace_name = preferred_workspace_name
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        let destination_id = destination_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);

        if requested_branch.is_empty() {
            return Err(MobilityError::Invalid(
                "requested branch is required".to_string(),
            ));
        }
        if requested_base_sha.is_empty() {
            return Err(MobilityError::Invalid(
                "requested base sha is required".to_string(),
            ));
        }

        let workspace_runtime = self.workspace_runtime.clone();
        let prepared = tokio::task::spawn_blocking(move || {
            workspace_runtime.create_mobility_destination(
                &repo_root_id,
                &requested_branch,
                &requested_base_sha,
                destination_id.as_deref(),
                preferred_workspace_name.as_deref(),
            )
        })
        .await
        .map_err(|error| MobilityError::Internal(anyhow::anyhow!(error.to_string())))?
        .map_err(|error| {
            let message = error.to_string();
            if message.contains("mobility destination conflict") {
                MobilityError::DestinationConflict(message)
            } else {
                MobilityError::Internal(error)
            }
        })?;

        self.validate_prepared_destination_is_empty(&prepared.workspace)
            .await?;

        Ok(prepared)
    }

    async fn validate_prepared_destination_is_empty(
        &self,
        workspace: &WorkspaceRecord,
    ) -> Result<(), MobilityError> {
        let sessions = self
            .session_service
            .store()
            .list_by_workspace(&workspace.id)?;
        if let Some(session) = sessions.first() {
            return Err(MobilityError::DestinationConflict(format!(
                "mobility destination conflict: destination workspace already contains session {}",
                session.id
            )));
        }
        let active_terminals = self.active_terminals_async(&workspace.id).await;
        if let Some(terminal) = active_terminals.first() {
            return Err(MobilityError::DestinationConflict(format!(
                "mobility destination conflict: destination workspace still has active terminal {}",
                terminal.id
            )));
        }
        Ok(())
    }
}
