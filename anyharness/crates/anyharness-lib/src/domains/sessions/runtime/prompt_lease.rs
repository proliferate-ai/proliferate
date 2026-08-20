use crate::domains::sessions::model::SessionRecord;
use crate::domains::workspaces::operation_gate::{WorkspaceOperationKind, WorkspaceOperationLease};

use super::prompt::map_lifecycle_error_to_prompt;
use super::{SendPromptError, SessionRuntime};

#[derive(Clone, Copy)]
pub(super) enum PromptWorkspaceLeaseMode<'a> {
    Acquire,
    AlreadyHeld(&'a str),
}

impl SessionRuntime {
    /// Acquire the one workspace shared lease for the full
    /// resolve→capture→dispatch→settlement interval. The initial read locates
    /// the gate key; the row is re-read under the lease so a destructive writer
    /// that won the race cannot leave prompt dispatch using stale metadata.
    async fn acquire_prompt_workspace_lease(
        &self,
        session_id: &str,
    ) -> Result<(SessionRecord, WorkspaceOperationLease), SendPromptError> {
        let initial = self
            .get_session_or_not_found(session_id)
            .map_err(map_lifecycle_error_to_prompt)?;
        let workspace_id = initial.workspace_id.clone();
        let lease = self
            .workspace_operation_gate
            .acquire_shared(&workspace_id, WorkspaceOperationKind::SessionPrompt)
            .await;
        let current = self
            .get_session_or_not_found(session_id)
            .map_err(map_lifecycle_error_to_prompt)?;
        if current.workspace_id != workspace_id {
            return Err(SendPromptError::Internal(anyhow::anyhow!(
                "session workspace changed while acquiring prompt lease"
            )));
        }
        Ok((current, lease))
    }

    pub(super) async fn resolve_prompt_record(
        &self,
        session_id: &str,
        lease_mode: PromptWorkspaceLeaseMode<'_>,
    ) -> Result<(SessionRecord, Option<WorkspaceOperationLease>), SendPromptError> {
        match lease_mode {
            PromptWorkspaceLeaseMode::Acquire => self
                .acquire_prompt_workspace_lease(session_id)
                .await
                .map(|(record, lease)| (record, Some(lease))),
            PromptWorkspaceLeaseMode::AlreadyHeld(leased_workspace_id) => {
                let record = self
                    .get_session_or_not_found(session_id)
                    .map_err(map_lifecycle_error_to_prompt)?;
                if record.workspace_id != leased_workspace_id {
                    return Err(SendPromptError::Internal(anyhow::anyhow!(
                        "prompt lease workspace does not match the session workspace"
                    )));
                }
                Ok((record, None))
            }
        }
    }
}
