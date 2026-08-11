use std::sync::Arc;

use super::{AgentOperations, AgentOperationsError, AgentWorkspaceOperations};
use crate::domains::agent_operations::model::{
    AgentCapability, CreateWorkspaceInput, CreateWorkspaceResult, ListWorkspacesInput,
    WorkspaceOptionsView, WorkspacePage, WorkspaceView, MAX_WORKSPACE_PAGE_SIZE,
};
use crate::domains::workspaces::creator_context::WorkspaceCreatorContext;
use crate::domains::workspaces::model::WorkspaceRecord;
use crate::domains::workspaces::options::CreateWorkspaceFromOptionsInput;
use crate::origin::OriginContext;

impl AgentOperations {
    #[tracing::instrument(skip_all, fields(operation = "list_workspaces"))]
    pub async fn list_workspaces(
        &self,
        caller: &crate::domains::agent_operations::model::AuthenticatedAgentCaller,
        input: ListWorkspacesInput,
    ) -> Result<WorkspacePage, AgentOperationsError> {
        if input.limit == 0 || input.limit > MAX_WORKSPACE_PAGE_SIZE {
            return Err(AgentOperationsError::InvalidWorkspacePageSize);
        }
        self.resolve_caller_agent(caller)?;
        let records = self.workspace_operations()?.list_workspaces().await?;
        let projected = records
            .into_iter()
            .map(|record| self.project_workspace(record))
            .collect::<Vec<_>>();
        let start = match input.cursor.as_deref() {
            None => 0,
            Some(cursor) => projected
                .iter()
                .position(|workspace| workspace.identity.workspace_id == cursor)
                .map(|index| index + 1)
                .ok_or(AgentOperationsError::InvalidWorkspaceCursor)?,
        };
        let end = (start + input.limit).min(projected.len());
        let next_cursor =
            (end < projected.len()).then(|| projected[end - 1].identity.workspace_id.clone());
        Ok(WorkspacePage {
            workspaces: projected
                .into_iter()
                .skip(start)
                .take(input.limit)
                .collect(),
            next_cursor,
        })
    }

    #[tracing::instrument(skip_all, fields(operation = "list_workspace_options"))]
    pub async fn list_workspace_options(
        &self,
        caller: &crate::domains::agent_operations::model::AuthenticatedAgentCaller,
    ) -> Result<WorkspaceOptionsView, AgentOperationsError> {
        self.resolve_caller_agent(caller)?;
        let options = self
            .workspace_operations()?
            .list_workspace_options()
            .await?;
        Ok(WorkspaceOptionsView {
            runtime_id: self.runtime_id.clone(),
            options,
        })
    }

    #[tracing::instrument(skip_all, fields(operation = "create_workspace"))]
    pub async fn create_workspace(
        &self,
        caller: &crate::domains::agent_operations::model::AuthenticatedAgentCaller,
        input: CreateWorkspaceInput,
    ) -> Result<CreateWorkspaceResult, AgentOperationsError> {
        let caller_agent = self.resolve_caller_agent(caller)?;
        self.assert_caller_capability(&caller_agent, AgentCapability::CreateWorkspace)?;
        let caller_workspace_id = caller_agent.record.workspace_id.clone();
        let created = self
            .workspace_operations()?
            .create_workspace(
                &caller_workspace_id,
                CreateWorkspaceFromOptionsInput {
                    repository_id: input.repository_id,
                    creation_mode: input.creation_mode,
                    branch: input.branch,
                    display_name: input.display_name.clone(),
                    origin: OriginContext::system_local_runtime(),
                    creator_context: WorkspaceCreatorContext::Agent {
                        source_session_id: caller_agent.record.id,
                        source_session_workspace_id: Some(caller_workspace_id.clone()),
                        session_link_id: caller_agent
                            .parent_link
                            .as_ref()
                            .map(|link| link.id.clone()),
                        source_workspace_id: Some(caller_workspace_id.clone()),
                        label: input.display_name,
                    },
                },
            )
            .await?;
        Ok(CreateWorkspaceResult {
            workspace: self.project_workspace(created.workspace),
            creation_mode: created.creation_mode,
        })
    }

    pub(super) fn workspace_operations(
        &self,
    ) -> Result<&Arc<dyn AgentWorkspaceOperations>, AgentOperationsError> {
        self.workspaces
            .as_ref()
            .ok_or(AgentOperationsError::WorkspaceCatalogsUnavailable)
    }

    fn project_workspace(&self, record: WorkspaceRecord) -> WorkspaceView {
        WorkspaceView {
            identity: crate::domains::agent_operations::model::WorkspaceIdentity {
                runtime_id: self.runtime_id.clone(),
                workspace_id: record.id,
            },
            repository_id: record.repo_root_id,
            kind: record.kind.as_str().to_string(),
            surface: record.surface.as_str().to_string(),
            path: record.path,
            display_name: record.display_name,
            original_branch: record.original_branch,
            current_branch: record.current_branch,
            lifecycle_state: record.lifecycle_state.as_str().to_string(),
            created_at: record.created_at,
            updated_at: record.updated_at,
        }
    }
}
