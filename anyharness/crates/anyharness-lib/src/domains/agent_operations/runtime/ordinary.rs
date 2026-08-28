use std::sync::Arc;

use crate::domains::agent_operations::model::{
    AgentCapability, AgentConfigApplyState, AgentCreationKind, AgentIdentity, AgentRole, AgentView,
    AuthenticatedAgentCaller, CapabilityDenial, ConfigureAgentInput, ConfigureAgentResult,
    CreateAgentInput,
};
use crate::domains::sessions::admission::{
    SessionMutationConflict, SessionMutationKind, SessionMutationSource,
};
use crate::domains::sessions::task_output::TaskOutputPage;
use crate::domains::workspaces::operation_gate::WorkspaceOperationKind;
use crate::domains::workspaces::options::WorkspaceOptionsError;

use super::{
    authorization_policy, status_from_record_only, AgentConfigMutationState, AgentOperations,
    AgentOperationsError, CallerFacts, ResolvedAgent,
};

// Matches the sessions-owned title cap while also bounding legacy rows that
// may predate title validation.
const MAX_PROVENANCE_LABEL_CHARS: usize = 160;

impl AgentOperations {
    #[tracing::instrument(skip_all, fields(operation = "create_agent"))]
    pub async fn create_agent(
        &self,
        caller: &AuthenticatedAgentCaller,
        input: CreateAgentInput,
    ) -> Result<AgentView, AgentOperationsError> {
        let initial_caller = self.resolve_caller_agent(caller)?;
        self.assert_create_authorized(&initial_caller, input.kind, &input.workspace.workspace_id)?;
        self.assert_workspace_same_runtime(&input.workspace)?;
        if input
            .task
            .as_deref()
            .is_some_and(|task| task.trim().is_empty())
            || (input.kind == AgentCreationKind::Subagent && input.task.is_none())
        {
            return Err(AgentOperationsError::InvalidTask);
        }

        let options = self
            .list_agent_launch_options(caller, &input.workspace)
            .await?;
        let agent_kind = input
            .agent_kind
            .as_deref()
            .unwrap_or(&initial_caller.record.agent_kind);
        let selection = options
            .validate_selection(agent_kind, input.model_id.as_deref(), &input.control_values)
            .map_err(AgentOperationsError::LaunchSelection)?;

        // A subagent is an atomic child+relationship mutation of its parent.
        // Hold the parent permit before the workspace lease so terminal parent
        // close and child creation have one serialized winner.
        let _parent_permit = if input.kind == AgentCreationKind::Subagent {
            Some(
                self.admit_target(
                    &initial_caller.record.id,
                    SessionMutationKind::SubagentCreate,
                )
                .await?,
            )
        } else {
            None
        };
        let _lease = self
            .operation_gate()?
            .acquire_shared(
                &input.workspace.workspace_id,
                WorkspaceOperationKind::SessionStart,
            )
            .await;
        let current_caller = self.resolve_caller_agent(caller)?;
        self.assert_create_authorized(&current_caller, input.kind, &input.workspace.workspace_id)?;
        self.assert_workspace_exists_under_lease(&input.workspace.workspace_id)
            .await?;
        let source_label = caller_provenance_label(&current_caller.record);
        let record = match input.kind {
            AgentCreationKind::Ordinary => self
                .session_mutations()?
                .create_ordinary_agent(
                    &input.workspace.workspace_id,
                    &selection.agent_kind,
                    selection.model_id.as_deref(),
                    &selection.control_values,
                    input.task,
                    &current_caller.record.id,
                    &source_label,
                )
                .await
                .map_err(AgentOperationsError::Create)?,
            AgentCreationKind::Subagent => self
                .subagent_lifecycle()?
                .create_subagent_agent(
                    &input.workspace.workspace_id,
                    &selection.agent_kind,
                    selection.model_id.as_deref(),
                    &selection.control_values,
                    input.task.expect("subagent task validated above"),
                    &current_caller.record.id,
                    &source_label,
                )
                .await
                .map_err(AgentOperationsError::CreateSubagent)?,
        };
        let created = self.resolve_record(record)?;
        let expected_role = match input.kind {
            AgentCreationKind::Ordinary => AgentRole::Ordinary,
            AgentCreationKind::Subagent => AgentRole::Subagent,
        };
        if created.role() != expected_role {
            return Err(AgentOperationsError::Internal(anyhow::anyhow!(
                "agent create produced an unexpected relationship role"
            )));
        }
        self.project_agent(&created, Some(&current_caller)).await
    }

    #[tracing::instrument(skip_all, fields(operation = "configure_agent"))]
    pub async fn configure_agent(
        &self,
        caller: &AuthenticatedAgentCaller,
        input: ConfigureAgentInput,
    ) -> Result<ConfigureAgentResult, AgentOperationsError> {
        let (_, initial_target) =
            self.authorize_target(caller, &input.target, AgentCapability::ConfigureAgent)?;
        let workspace_id = initial_target.record.workspace_id.clone();
        let options = self
            .config_options_for_authorized_target(&initial_target)
            .await?;
        let choice = options
            .validate_choice(&input.config_id, &input.value)
            .map_err(AgentOperationsError::ConfigChoice)?;
        let _permit = self
            .admit_target(&input.target.session_id, SessionMutationKind::Config)
            .await?;
        let _lease = self
            .operation_gate()?
            .acquire_shared(&workspace_id, WorkspaceOperationKind::SessionResume)
            .await;
        let (current_caller, current_target) =
            self.authorize_target(caller, &input.target, AgentCapability::ConfigureAgent)?;
        self.assert_target_workspace_under_lease(&current_target, &workspace_id)
            .await?;
        let (record, apply_state) = self
            .session_mutations()?
            .configure_agent(&input.target.session_id, &choice.config_id, &choice.value)
            .await
            .map_err(AgentOperationsError::Configure)?;
        let updated = self.resolve_record(record)?;
        let agent = self.project_agent(&updated, Some(&current_caller)).await?;
        Ok(ConfigureAgentResult {
            agent,
            apply_state: match apply_state {
                AgentConfigMutationState::Applied => AgentConfigApplyState::Applied,
                AgentConfigMutationState::Queued => AgentConfigApplyState::Queued,
            },
        })
    }

    #[tracing::instrument(skip_all, fields(operation = "resume_agent"))]
    pub async fn resume_agent(
        &self,
        caller: &AuthenticatedAgentCaller,
        target: &AgentIdentity,
    ) -> Result<AgentView, AgentOperationsError> {
        let (_, initial_target) =
            self.authorize_target(caller, target, AgentCapability::ResumeAgent)?;
        let workspace_id = initial_target.record.workspace_id.clone();
        let _permit = self
            .admit_target(&target.session_id, SessionMutationKind::Resume)
            .await?;
        let _lease = self
            .operation_gate()?
            .acquire_shared(&workspace_id, WorkspaceOperationKind::SessionResume)
            .await;
        let (current_caller, current_target) =
            self.authorize_target(caller, target, AgentCapability::ResumeAgent)?;
        self.assert_target_workspace_under_lease(&current_target, &workspace_id)
            .await?;
        let record = self
            .session_mutations()?
            .resume_agent(&target.session_id)
            .await
            .map_err(AgentOperationsError::Resume)?;
        let updated = self.resolve_record(record)?;
        self.project_agent(&updated, Some(&current_caller)).await
    }

    #[tracing::instrument(skip_all, fields(operation = "interrupt_agent"))]
    pub async fn interrupt_agent(
        &self,
        caller: &AuthenticatedAgentCaller,
        target: &AgentIdentity,
    ) -> Result<AgentView, AgentOperationsError> {
        self.authorize_target(caller, target, AgentCapability::InterruptAgent)?;
        let _permit = self
            .admit_target(&target.session_id, SessionMutationKind::Cancel)
            .await?;
        let (current_caller, _) =
            self.authorize_target(caller, target, AgentCapability::InterruptAgent)?;
        let record = self
            .session_mutations()?
            .interrupt_agent(&target.session_id)
            .await
            .map_err(AgentOperationsError::Interrupt)?;
        let updated = self.resolve_record(record)?;
        self.project_agent(&updated, Some(&current_caller)).await
    }

    #[tracing::instrument(skip_all, fields(operation = "get_task_output"))]
    pub fn get_task_output(
        &self,
        caller: &AuthenticatedAgentCaller,
        target: &AgentIdentity,
        cursor: Option<&str>,
        limit: usize,
    ) -> Result<TaskOutputPage, AgentOperationsError> {
        let (_, target) = self.authorize_target(caller, target, AgentCapability::GetTaskOutput)?;
        self.task_output_reads()?
            .task_output(&target.record.id, cursor, limit)
            .map_err(Into::into)
    }

    fn assert_create_authorized(
        &self,
        caller: &ResolvedAgent,
        kind: AgentCreationKind,
        target_workspace_id: &str,
    ) -> Result<(), AgentOperationsError> {
        let decision = authorization_policy::create_agent_decision(
            CallerFacts {
                role: caller.role(),
                status: status_from_record_only(caller).presentation,
            },
            &caller.record.workspace_id,
            kind,
            target_workspace_id,
        );
        match decision.denial {
            None => Ok(()),
            Some(CapabilityDenial::CallerClosed) => Err(AgentOperationsError::CallerClosed),
            Some(denial) => Err(AgentOperationsError::CapabilityDenied {
                capability: AgentCapability::CreateAgent,
                denial,
            }),
        }
    }

    pub(super) async fn admit_target(
        &self,
        session_id: &str,
        kind: SessionMutationKind,
    ) -> Result<crate::domains::sessions::admission::SessionMutationPermit, AgentOperationsError>
    {
        self.session_admission()?
            .acquire(session_id, kind, &SessionMutationSource::external())
            .await
            .map_err(|error| match error {
                SessionMutationConflict::ControlledByWorkflow { .. } => {
                    AgentOperationsError::ControlledByWorkflow
                }
                SessionMutationConflict::SubagentOpenRequired => {
                    AgentOperationsError::SubagentOpenRequired
                }
                SessionMutationConflict::Internal(error) => AgentOperationsError::Internal(error),
            })
    }

    pub(super) async fn assert_target_workspace_under_lease(
        &self,
        target: &ResolvedAgent,
        expected_workspace_id: &str,
    ) -> Result<(), AgentOperationsError> {
        if target.record.workspace_id != expected_workspace_id {
            return Err(AgentOperationsError::AgentNotFound);
        }
        match self
            .workspace_operations()?
            .get_workspace(expected_workspace_id)
            .await
        {
            Ok(Some(_)) => Ok(()),
            Ok(None) | Err(_) => Err(AgentOperationsError::AgentNotFound),
        }
    }

    async fn assert_workspace_exists_under_lease(
        &self,
        workspace_id: &str,
    ) -> Result<(), AgentOperationsError> {
        if self
            .workspace_operations()?
            .get_workspace(workspace_id)
            .await?
            .is_none()
        {
            return Err(AgentOperationsError::Workspace(
                WorkspaceOptionsError::WorkspaceNotFound(workspace_id.to_string()),
            ));
        }
        Ok(())
    }

    fn session_mutations(
        &self,
    ) -> Result<&Arc<dyn super::AgentSessionMutations>, AgentOperationsError> {
        self.mutations
            .as_ref()
            .ok_or(AgentOperationsError::OrdinaryOperationsUnavailable)
    }

    pub(super) fn subagent_lifecycle(
        &self,
    ) -> Result<&Arc<dyn super::SubagentLifecycleMutations>, AgentOperationsError> {
        self.subagent_lifecycle
            .as_ref()
            .ok_or(AgentOperationsError::OrdinaryOperationsUnavailable)
    }

    fn task_output_reads(
        &self,
    ) -> Result<&Arc<dyn super::AgentTaskOutputReads>, AgentOperationsError> {
        self.task_output
            .as_ref()
            .ok_or(AgentOperationsError::OrdinaryOperationsUnavailable)
    }

    fn session_admission(
        &self,
    ) -> Result<
        &Arc<crate::domains::sessions::admission::SessionMutationAdmission>,
        AgentOperationsError,
    > {
        self.session_admission
            .as_ref()
            .ok_or(AgentOperationsError::OrdinaryOperationsUnavailable)
    }

    pub(super) fn operation_gate(
        &self,
    ) -> Result<
        &Arc<crate::domains::workspaces::operation_gate::WorkspaceOperationGate>,
        AgentOperationsError,
    > {
        self.workspace_operation_gate
            .as_ref()
            .ok_or(AgentOperationsError::OrdinaryOperationsUnavailable)
    }
}

pub(super) fn caller_provenance_label(
    record: &crate::domains::sessions::model::SessionRecord,
) -> String {
    record
        .title
        .as_deref()
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .unwrap_or(&record.agent_kind)
        .chars()
        .take(MAX_PROVENANCE_LABEL_CHARS)
        .collect()
}
