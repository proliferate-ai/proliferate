mod authorization_policy;
mod catalogs;
mod error;
mod messaging;
mod ordinary;
mod ports;
mod product_context;
mod subagent_lifecycle;
mod subagent_roster;
mod target_access;
mod workspaces;

#[cfg(test)]
mod messaging_tests;
#[cfg(test)]
mod ordinary_tests;
#[cfg(test)]
mod subagent_lifecycle_tests;
#[cfg(test)]
mod tests;

use std::sync::Arc;

use authorization_policy::{CallerFacts, TargetFacts};
pub use error::AgentOperationsError;
pub(crate) use ports::AgentMessageQueue;
pub use ports::{
    AgentCatalogReads, AgentConfigMutationState, AgentExecutionReads, AgentLaunchOptionReads,
    AgentSessionMutations, AgentSessionReads, AgentTaskOutputReads, AgentWorkspaceOperations,
    SubagentCompletionReads, SubagentLifecycleMutations, SubagentRelationshipReads,
};

use crate::domains::agent_operations::model::{
    AgentCapability, AgentConfiguration, AgentCreationKind, AgentExecutionStatus, AgentIdentity,
    AgentPage, AgentPresentationStatus, AgentRole, AgentView, AuthenticatedAgentCaller,
    CapabilityDecision, CapabilityDenial, EffectiveAgentStatus, ListAgentsInput, RuntimeIdentity,
    WhoAmIView, WorkspaceIdentity, MAX_AGENT_PAGE_SIZE,
};
use crate::domains::sessions::admission::SessionMutationAdmission;
use crate::domains::sessions::links::model::SessionLinkRecord;
use crate::domains::sessions::model::{
    SessionExecutionState, SessionExecutionStatePhase, SessionRecord,
};
use crate::domains::workspaces::operation_gate::WorkspaceOperationGate;

pub struct AgentOperations {
    runtime_id: RuntimeIdentity,
    sessions: Arc<dyn AgentSessionReads>,
    relationships: Arc<dyn SubagentRelationshipReads>,
    execution: Arc<dyn AgentExecutionReads>,
    workspaces: Option<Arc<dyn AgentWorkspaceOperations>>,
    launch_options: Option<Arc<dyn AgentLaunchOptionReads>>,
    catalog: Option<Arc<dyn AgentCatalogReads>>,
    mutations: Option<Arc<dyn AgentSessionMutations>>,
    subagent_lifecycle: Option<Arc<dyn SubagentLifecycleMutations>>,
    message_queue: Option<Arc<dyn AgentMessageQueue>>,
    task_output: Option<Arc<dyn AgentTaskOutputReads>>,
    session_admission: Option<Arc<SessionMutationAdmission>>,
    workspace_operation_gate: Option<Arc<WorkspaceOperationGate>>,
    subagent_completions: Option<Arc<dyn SubagentCompletionReads>>,
}

impl AgentOperations {
    pub fn new(
        runtime_id: RuntimeIdentity,
        sessions: Arc<dyn AgentSessionReads>,
        relationships: Arc<dyn SubagentRelationshipReads>,
        execution: Arc<dyn AgentExecutionReads>,
    ) -> Self {
        Self {
            runtime_id,
            sessions,
            relationships,
            execution,
            workspaces: None,
            launch_options: None,
            catalog: None,
            mutations: None,
            subagent_lifecycle: None,
            message_queue: None,
            task_output: None,
            session_admission: None,
            workspace_operation_gate: None,
            subagent_completions: None,
        }
    }

    pub fn with_workspace_catalogs(
        mut self,
        workspaces: Arc<dyn AgentWorkspaceOperations>,
        launch_options: Arc<dyn AgentLaunchOptionReads>,
        catalog: Arc<dyn AgentCatalogReads>,
    ) -> Self {
        self.workspaces = Some(workspaces);
        self.launch_options = Some(launch_options);
        self.catalog = Some(catalog);
        self
    }

    pub fn with_ordinary_operations(
        mut self,
        mutations: Arc<dyn AgentSessionMutations>,
        task_output: Arc<dyn AgentTaskOutputReads>,
        session_admission: Arc<SessionMutationAdmission>,
        workspace_operation_gate: Arc<WorkspaceOperationGate>,
    ) -> Self {
        self.mutations = Some(mutations);
        self.task_output = Some(task_output);
        self.session_admission = Some(session_admission);
        self.workspace_operation_gate = Some(workspace_operation_gate);
        self
    }

    pub fn with_subagent_lifecycle(
        mut self,
        lifecycle: Arc<dyn SubagentLifecycleMutations>,
        workspaces: Arc<dyn AgentWorkspaceOperations>,
        session_admission: Arc<SessionMutationAdmission>,
        workspace_operation_gate: Arc<WorkspaceOperationGate>,
    ) -> Self {
        self.subagent_lifecycle = Some(lifecycle);
        self.workspaces = Some(workspaces);
        self.session_admission = Some(session_admission);
        self.workspace_operation_gate = Some(workspace_operation_gate);
        self
    }

    pub fn with_subagent_roster(mut self, completions: Arc<dyn SubagentCompletionReads>) -> Self {
        self.subagent_completions = Some(completions);
        self
    }

    pub(crate) fn with_messaging(
        mut self,
        message_queue: Arc<dyn AgentMessageQueue>,
        workspaces: Arc<dyn AgentWorkspaceOperations>,
        session_admission: Arc<SessionMutationAdmission>,
        workspace_operation_gate: Arc<WorkspaceOperationGate>,
    ) -> Self {
        self.message_queue = Some(message_queue);
        self.workspaces = Some(workspaces);
        self.session_admission = Some(session_admission);
        self.workspace_operation_gate = Some(workspace_operation_gate);
        self
    }

    pub fn runtime_identity(&self) -> &RuntimeIdentity {
        &self.runtime_id
    }

    pub fn authenticated_caller(&self, session_id: impl Into<String>) -> AuthenticatedAgentCaller {
        AuthenticatedAgentCaller::new(self.runtime_id.clone(), session_id)
    }

    pub fn verify_caller_workspace(
        &self,
        caller: &AuthenticatedAgentCaller,
        workspace_id: &str,
    ) -> Result<(), AgentOperationsError> {
        let resolved = self.resolve_caller_record(caller)?;
        if resolved.workspace_id != workspace_id {
            return Err(AgentOperationsError::CallerNotFound);
        }
        Ok(())
    }

    #[tracing::instrument(skip_all, fields(operation = "whoami"))]
    pub async fn whoami(
        &self,
        caller: &AuthenticatedAgentCaller,
    ) -> Result<WhoAmIView, AgentOperationsError> {
        let resolved = self.resolve_caller_agent(caller)?;
        let agent = self.project_agent(&resolved, Some(&resolved)).await?;
        let effective_capabilities = authorization_policy::effective_capabilities(CallerFacts {
            role: agent.role,
            status: agent.status.presentation,
        });
        Ok(WhoAmIView {
            agent,
            effective_capabilities,
        })
    }

    #[tracing::instrument(skip_all, fields(operation = "list_agents"))]
    pub async fn list_agents(
        &self,
        caller: &AuthenticatedAgentCaller,
        input: ListAgentsInput,
    ) -> Result<AgentPage, AgentOperationsError> {
        if input.limit == 0 || input.limit > MAX_AGENT_PAGE_SIZE {
            return Err(AgentOperationsError::InvalidPageSize);
        }
        let caller_agent = self.resolve_caller_agent(caller)?;
        let caller_status = self.status_for(&caller_agent).await?;
        let caller_facts = CallerFacts {
            role: caller_agent.role(),
            status: caller_status.presentation,
        };

        let records = self
            .sessions
            .list_sessions()
            .map_err(AgentOperationsError::Internal)?;
        let mut agents = Vec::new();
        for record in records {
            if input
                .workspace_id
                .as_deref()
                .is_some_and(|workspace_id| record.workspace_id != workspace_id)
            {
                continue;
            }
            let resolved = self.resolve_record(record)?;
            if resolved.role() == AgentRole::Subagent {
                continue;
            }
            if resolved.is_terminal_session() {
                continue;
            }
            let status = self.status_for(&resolved).await?;
            if input
                .status
                .is_some_and(|filter| status.presentation != filter)
            {
                continue;
            }
            agents.push(self.project_agent_with_status(
                &resolved,
                Some((&caller_agent, caller_facts)),
                status,
            ));
        }

        let start = match input.cursor.as_deref() {
            None => 0,
            Some(cursor) => agents
                .iter()
                .position(|agent| agent.identity.session_id == cursor)
                .map(|index| index + 1)
                .ok_or(AgentOperationsError::InvalidCursor)?,
        };
        let end = (start + input.limit).min(agents.len());
        let next_cursor = (end < agents.len()).then(|| agents[end - 1].identity.session_id.clone());
        Ok(AgentPage {
            agents: agents.into_iter().skip(start).take(input.limit).collect(),
            next_cursor,
        })
    }

    #[tracing::instrument(skip_all, fields(operation = "get_agent"))]
    pub async fn get_agent(
        &self,
        caller: &AuthenticatedAgentCaller,
        target: &AgentIdentity,
    ) -> Result<AgentView, AgentOperationsError> {
        let (caller_agent, target_agent) =
            self.authorize_target(caller, target, AgentCapability::GetAgent)?;
        self.project_agent(&target_agent, Some(&caller_agent)).await
    }

    #[tracing::instrument(skip_all, fields(operation = "list_subagents"))]
    pub async fn list_subagents(
        &self,
        caller: &AuthenticatedAgentCaller,
    ) -> Result<Vec<AgentView>, AgentOperationsError> {
        Ok(self
            .session_subagent_roster(caller)
            .await?
            .children
            .into_iter()
            .map(|entry| entry.agent)
            .collect())
    }

    pub fn decide_agent_creation(
        &self,
        caller: &AuthenticatedAgentCaller,
        kind: AgentCreationKind,
        target_workspace_id: &str,
    ) -> Result<CapabilityDecision, AgentOperationsError> {
        let caller = self.resolve_caller_agent(caller)?;
        let status = status_from_record_only(&caller);
        Ok(authorization_policy::create_agent_decision(
            CallerFacts {
                role: caller.role(),
                status: status.presentation,
            },
            &caller.record.workspace_id,
            kind,
            target_workspace_id,
        ))
    }

    fn assert_caller_capability(
        &self,
        caller: &ResolvedAgent,
        capability: AgentCapability,
    ) -> Result<(), AgentOperationsError> {
        let decision = authorization_policy::caller_capability(
            CallerFacts {
                role: caller.role(),
                status: status_from_record_only(caller).presentation,
            },
            capability,
        );
        match decision.denial {
            None => Ok(()),
            Some(CapabilityDenial::CallerClosed) => Err(AgentOperationsError::CallerClosed),
            Some(denial) => Err(AgentOperationsError::CapabilityDenied { capability, denial }),
        }
    }

    fn resolve_caller_record(
        &self,
        caller: &AuthenticatedAgentCaller,
    ) -> Result<SessionRecord, AgentOperationsError> {
        self.assert_same_runtime(caller.identity())?;
        self.sessions
            .get_session(&caller.identity().session_id)
            .map_err(AgentOperationsError::Internal)?
            .ok_or(AgentOperationsError::CallerNotFound)
    }

    fn resolve_caller_agent(
        &self,
        caller: &AuthenticatedAgentCaller,
    ) -> Result<ResolvedAgent, AgentOperationsError> {
        let resolved = self.resolve_record(self.resolve_caller_record(caller)?)?;
        if resolved.is_terminal_session() && !resolved.is_relationship_closed() {
            return Err(AgentOperationsError::CallerClosed);
        }
        Ok(resolved)
    }

    fn resolve_agent(
        &self,
        identity: &AgentIdentity,
    ) -> Result<ResolvedAgent, AgentOperationsError> {
        self.assert_same_runtime(identity)?;
        let record = self
            .sessions
            .get_session(&identity.session_id)
            .map_err(AgentOperationsError::Internal)?
            .ok_or(AgentOperationsError::AgentNotFound)?;
        self.resolve_record(record)
    }

    fn resolve_record(&self, record: SessionRecord) -> Result<ResolvedAgent, AgentOperationsError> {
        let parent_link = self
            .relationships
            .find_parent_including_closed(&record.id)
            .map_err(AgentOperationsError::Internal)?;
        Ok(ResolvedAgent {
            record,
            parent_link,
        })
    }

    fn assert_same_runtime(&self, identity: &AgentIdentity) -> Result<(), AgentOperationsError> {
        if identity.runtime_id != self.runtime_id {
            return Err(AgentOperationsError::RuntimeBoundaryDenied);
        }
        Ok(())
    }

    async fn project_agent(
        &self,
        target: &ResolvedAgent,
        caller: Option<&ResolvedAgent>,
    ) -> Result<AgentView, AgentOperationsError> {
        let status = self.status_for(target).await?;
        let caller_with_facts = caller.map(|caller| {
            let caller_status = status_from_record_only(caller);
            (
                caller,
                CallerFacts {
                    role: caller.role(),
                    status: caller_status.presentation,
                },
            )
        });
        Ok(self.project_agent_with_status(target, caller_with_facts, status))
    }

    fn project_agent_with_status(
        &self,
        target: &ResolvedAgent,
        caller: Option<(&ResolvedAgent, CallerFacts)>,
        status: EffectiveAgentStatus,
    ) -> AgentView {
        let role = target.role();
        let capabilities = caller
            .map(|(caller, caller_facts)| {
                authorization_policy::target_capabilities(
                    caller_facts,
                    TargetFacts {
                        role,
                        status: status.presentation,
                        owned_by_caller: target.parent_session_id()
                            == Some(caller.record.id.as_str()),
                    },
                )
            })
            .unwrap_or_default();
        AgentView {
            identity: AgentIdentity::new(self.runtime_id.clone(), target.record.id.clone()),
            workspace: WorkspaceIdentity {
                runtime_id: self.runtime_id.clone(),
                workspace_id: target.record.workspace_id.clone(),
            },
            role,
            parent: target.parent_session_id().map(|parent_id| {
                AgentIdentity::new(self.runtime_id.clone(), parent_id.to_string())
            }),
            title: target.record.title.clone(),
            configuration: AgentConfiguration {
                agent_kind: target.record.agent_kind.clone(),
                model_id: target
                    .record
                    .current_model_id
                    .clone()
                    .or_else(|| target.record.requested_model_id.clone()),
                mode_id: target
                    .record
                    .current_mode_id
                    .clone()
                    .or_else(|| target.record.requested_mode_id.clone()),
            },
            status,
            capabilities,
            created_at: target.record.created_at.clone(),
            updated_at: target.record.updated_at.clone(),
        }
    }

    async fn status_for(
        &self,
        agent: &ResolvedAgent,
    ) -> Result<EffectiveAgentStatus, AgentOperationsError> {
        if agent.is_relationship_closed() {
            return Ok(closed_status());
        }
        let state = self
            .execution
            .execution_state(&agent.record)
            .await
            .map_err(AgentOperationsError::Internal)?;
        Ok(project_status(state))
    }
}

struct ResolvedAgent {
    record: SessionRecord,
    parent_link: Option<SessionLinkRecord>,
}

impl ResolvedAgent {
    fn role(&self) -> AgentRole {
        if self.parent_link.is_some() {
            AgentRole::Subagent
        } else {
            AgentRole::Ordinary
        }
    }

    fn parent_session_id(&self) -> Option<&str> {
        self.parent_link
            .as_ref()
            .map(|link| link.parent_session_id.as_str())
    }

    fn is_relationship_closed(&self) -> bool {
        self.parent_link
            .as_ref()
            .is_some_and(|link| link.subagent_closed_at.is_some())
    }

    fn is_terminal_session(&self) -> bool {
        self.record.closed_at.is_some() || self.record.status == "closed"
    }
}

fn project_status(state: SessionExecutionState) -> EffectiveAgentStatus {
    let execution = match state.phase {
        SessionExecutionStatePhase::Starting => AgentExecutionStatus::Starting,
        SessionExecutionStatePhase::Running => AgentExecutionStatus::Running,
        SessionExecutionStatePhase::AwaitingInteraction => {
            AgentExecutionStatus::AwaitingInteraction
        }
        SessionExecutionStatePhase::Idle => AgentExecutionStatus::Idle,
        SessionExecutionStatePhase::Errored => AgentExecutionStatus::Errored,
        SessionExecutionStatePhase::Closed => AgentExecutionStatus::Closed,
    };
    let presentation = match execution {
        AgentExecutionStatus::Starting
        | AgentExecutionStatus::Running
        | AgentExecutionStatus::AwaitingInteraction => AgentPresentationStatus::Running,
        AgentExecutionStatus::Idle | AgentExecutionStatus::Errored => {
            AgentPresentationStatus::Available
        }
        AgentExecutionStatus::Closed => AgentPresentationStatus::Closed,
    };
    EffectiveAgentStatus {
        presentation,
        execution,
        has_live_actor: state.has_live_handle,
    }
}

fn status_from_record_only(agent: &ResolvedAgent) -> EffectiveAgentStatus {
    if agent.is_relationship_closed() {
        return closed_status();
    }
    project_status(SessionExecutionState {
        phase: match agent.record.status.as_str() {
            "starting" => SessionExecutionStatePhase::Starting,
            "running" => SessionExecutionStatePhase::Running,
            "errored" => SessionExecutionStatePhase::Errored,
            "closed" => SessionExecutionStatePhase::Closed,
            _ => SessionExecutionStatePhase::Idle,
        },
        has_live_handle: false,
    })
}

fn closed_status() -> EffectiveAgentStatus {
    EffectiveAgentStatus {
        presentation: AgentPresentationStatus::Closed,
        execution: AgentExecutionStatus::Closed,
        has_live_actor: false,
    }
}
