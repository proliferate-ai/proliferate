use crate::domains::agent_operations::model::{
    AgentCapability, AgentIdentity, AgentView, AuthenticatedAgentCaller,
};
use crate::domains::agent_operations::subagents::SubagentLifecycleView;
use crate::domains::sessions::admission::SessionMutationKind;
use crate::domains::workspaces::operation_gate::WorkspaceOperationKind;

use super::{AgentOperations, AgentOperationsError};

impl AgentOperations {
    #[tracing::instrument(skip_all, fields(operation = "close_subagent"))]
    pub async fn close_subagent(
        &self,
        caller: &AuthenticatedAgentCaller,
        target: &AgentIdentity,
    ) -> Result<AgentView, AgentOperationsError> {
        Ok(self.close_subagent_lifecycle(caller, target).await?.agent)
    }

    pub async fn close_subagent_lifecycle(
        &self,
        caller: &AuthenticatedAgentCaller,
        target: &AgentIdentity,
    ) -> Result<SubagentLifecycleView, AgentOperationsError> {
        let (_, initial_target) =
            self.authorize_target(caller, target, AgentCapability::CloseSubagent)?;
        let workspace_id = initial_target.record.workspace_id.clone();
        let _permit = self
            .admit_target(&target.session_id, SessionMutationKind::SubagentClose)
            .await?;
        let _lease = self
            .operation_gate()?
            .acquire_shared(&workspace_id, WorkspaceOperationKind::SubagentWrite)
            .await;
        let (current_caller, current_target) =
            self.authorize_target(caller, target, AgentCapability::CloseSubagent)?;
        self.assert_target_workspace_under_lease(&current_target, &workspace_id)
            .await?;
        let record = self
            .subagent_lifecycle()?
            .close_subagent(&current_caller.record.id, &target.session_id)
            .await
            .map_err(AgentOperationsError::SubagentLifecycle)?;
        let updated = self.resolve_record(record)?;
        let relationship = updated
            .parent_link
            .clone()
            .map(super::subagent_roster::relationship_view);
        let agent = self.project_agent(&updated, Some(&current_caller)).await?;
        Ok(SubagentLifecycleView {
            agent,
            relationship,
        })
    }

    #[tracing::instrument(skip_all, fields(operation = "open_subagent"))]
    pub async fn open_subagent(
        &self,
        caller: &AuthenticatedAgentCaller,
        target: &AgentIdentity,
    ) -> Result<AgentView, AgentOperationsError> {
        Ok(self.open_subagent_lifecycle(caller, target).await?.agent)
    }

    pub async fn open_subagent_lifecycle(
        &self,
        caller: &AuthenticatedAgentCaller,
        target: &AgentIdentity,
    ) -> Result<SubagentLifecycleView, AgentOperationsError> {
        let (_, initial_target) =
            self.authorize_target(caller, target, AgentCapability::OpenSubagent)?;
        let workspace_id = initial_target.record.workspace_id.clone();
        let _permit = self
            .admit_target(&target.session_id, SessionMutationKind::SubagentOpen)
            .await?;
        let _lease = self
            .operation_gate()?
            .acquire_shared(&workspace_id, WorkspaceOperationKind::SubagentWrite)
            .await;
        let (current_caller, current_target) =
            self.authorize_target(caller, target, AgentCapability::OpenSubagent)?;
        self.assert_target_workspace_under_lease(&current_target, &workspace_id)
            .await?;
        let record = self
            .subagent_lifecycle()?
            .open_subagent(&current_caller.record.id, &target.session_id)
            .await
            .map_err(AgentOperationsError::SubagentLifecycle)?;
        let updated = self.resolve_record(record)?;
        let relationship = updated
            .parent_link
            .clone()
            .map(super::subagent_roster::relationship_view);
        let agent = self.project_agent(&updated, Some(&current_caller)).await?;
        Ok(SubagentLifecycleView {
            agent,
            relationship,
        })
    }

    #[tracing::instrument(skip_all, fields(operation = "promote_subagent"))]
    pub async fn promote_subagent(
        &self,
        caller: &AuthenticatedAgentCaller,
        target: &AgentIdentity,
    ) -> Result<AgentView, AgentOperationsError> {
        Ok(self.promote_subagent_lifecycle(caller, target).await?.agent)
    }

    pub async fn promote_subagent_lifecycle(
        &self,
        caller: &AuthenticatedAgentCaller,
        target: &AgentIdentity,
    ) -> Result<SubagentLifecycleView, AgentOperationsError> {
        let (_, initial_target) =
            self.authorize_target(caller, target, AgentCapability::PromoteSubagent)?;
        let workspace_id = initial_target.record.workspace_id.clone();
        let _permit = self
            .admit_target(&target.session_id, SessionMutationKind::SubagentPromote)
            .await?;
        let _lease = self
            .operation_gate()?
            .acquire_shared(&workspace_id, WorkspaceOperationKind::SubagentWrite)
            .await;
        let (current_caller, current_target) =
            self.authorize_target(caller, target, AgentCapability::PromoteSubagent)?;
        self.assert_target_workspace_under_lease(&current_target, &workspace_id)
            .await?;
        let record = self
            .subagent_lifecycle()?
            .promote_subagent(&current_caller.record.id, &target.session_id)
            .await
            .map_err(AgentOperationsError::SubagentLifecycle)?;
        let promoted = self.resolve_record(record)?;
        let agent = self.project_agent(&promoted, Some(&current_caller)).await?;
        Ok(SubagentLifecycleView {
            agent,
            relationship: None,
        })
    }
}
