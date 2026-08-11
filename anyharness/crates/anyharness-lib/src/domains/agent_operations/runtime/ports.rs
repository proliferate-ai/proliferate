use async_trait::async_trait;

use crate::domains::agents::catalog::service::ActiveCatalog;
use crate::domains::agents::readiness::launch_options::ResolvedWorkspaceLaunchOptions;
use crate::domains::sessions::links::model::SessionLinkRecord;
use crate::domains::sessions::links::service::SessionLinkService;
use crate::domains::sessions::live_config::{
    effective_live_config_snapshot, EffectiveLiveConfigSnapshot,
};
use crate::domains::sessions::model::{SessionExecutionState, SessionRecord};
use crate::domains::sessions::runtime::SessionRuntime;
use crate::domains::sessions::service::SessionService;
use crate::domains::sessions::task_output::{TaskOutputError, TaskOutputPage};
use crate::domains::workspaces::model::WorkspaceRecord;
use crate::domains::workspaces::options::{
    CreateWorkspaceFromOptionsInput, CreateWorkspaceFromOptionsResult, WorkspaceCreationOptions,
    WorkspaceOptionRuntime, WorkspaceOptionsError,
};

pub trait AgentSessionReads: Send + Sync {
    fn get_session(&self, session_id: &str) -> anyhow::Result<Option<SessionRecord>>;
    fn list_sessions(&self) -> anyhow::Result<Vec<SessionRecord>>;
}

impl AgentSessionReads for SessionService {
    fn get_session(&self, session_id: &str) -> anyhow::Result<Option<SessionRecord>> {
        self.get_session(session_id)
    }

    fn list_sessions(&self) -> anyhow::Result<Vec<SessionRecord>> {
        self.list_sessions(None, false)
    }
}

pub trait SubagentRelationshipReads: Send + Sync {
    fn find_parent_including_closed(
        &self,
        child_session_id: &str,
    ) -> anyhow::Result<Option<SessionLinkRecord>>;

    fn list_children_including_closed(
        &self,
        parent_session_id: &str,
    ) -> anyhow::Result<Vec<SessionLinkRecord>>;
}

impl SubagentRelationshipReads for SessionLinkService {
    fn find_parent_including_closed(
        &self,
        child_session_id: &str,
    ) -> anyhow::Result<Option<SessionLinkRecord>> {
        self.find_subagent_parent_including_closed(child_session_id)
    }

    fn list_children_including_closed(
        &self,
        parent_session_id: &str,
    ) -> anyhow::Result<Vec<SessionLinkRecord>> {
        self.list_subagent_children_including_closed(parent_session_id)
    }
}

#[async_trait]
pub trait AgentExecutionReads: Send + Sync {
    async fn execution_state(
        &self,
        session: &SessionRecord,
    ) -> anyhow::Result<SessionExecutionState>;
}

#[async_trait]
impl AgentExecutionReads for SessionRuntime {
    async fn execution_state(
        &self,
        session: &SessionRecord,
    ) -> anyhow::Result<SessionExecutionState> {
        Ok(self.session_execution_state(session).await)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentConfigMutationState {
    Applied,
    Queued,
}

#[derive(Debug, thiserror::Error)]
pub enum AgentSessionMutationError {
    #[error("session not found")]
    SessionNotFound,
    #[error("session mutation failed")]
    Failed(#[source] anyhow::Error),
}

#[async_trait]
pub trait AgentSessionMutations: Send + Sync {
    async fn create_ordinary_agent(
        &self,
        workspace_id: &str,
        agent_kind: &str,
        model_id: Option<&str>,
        mode_id: Option<&str>,
        task: Option<String>,
    ) -> Result<SessionRecord, AgentSessionMutationError>;

    async fn configure_agent(
        &self,
        session_id: &str,
        config_id: &str,
        value: &str,
    ) -> Result<(SessionRecord, AgentConfigMutationState), AgentSessionMutationError>;

    async fn resume_agent(
        &self,
        session_id: &str,
    ) -> Result<SessionRecord, AgentSessionMutationError>;

    async fn interrupt_agent(
        &self,
        session_id: &str,
    ) -> Result<SessionRecord, AgentSessionMutationError>;
}

#[async_trait]
impl AgentSessionMutations for SessionRuntime {
    async fn create_ordinary_agent(
        &self,
        workspace_id: &str,
        agent_kind: &str,
        model_id: Option<&str>,
        mode_id: Option<&str>,
        task: Option<String>,
    ) -> Result<SessionRecord, AgentSessionMutationError> {
        self.create_ordinary_agent_session(workspace_id, agent_kind, model_id, mode_id, task)
            .await
            .map_err(|error| AgentSessionMutationError::Failed(anyhow::anyhow!("{error:?}")))
    }

    async fn configure_agent(
        &self,
        session_id: &str,
        config_id: &str,
        value: &str,
    ) -> Result<(SessionRecord, AgentConfigMutationState), AgentSessionMutationError> {
        use crate::domains::sessions::runtime::SetSessionConfigOptionError;
        let (record, _, state) = self
            .set_live_session_config_option(session_id, config_id, value)
            .await
            .map_err(|error| match error {
                SetSessionConfigOptionError::SessionNotFound(_) => {
                    AgentSessionMutationError::SessionNotFound
                }
                other => AgentSessionMutationError::Failed(anyhow::anyhow!("{other:?}")),
            })?;
        let state = match crate::domains::sessions::live_config::effective_config_apply_state(state)
        {
            crate::domains::sessions::live_config::EffectiveConfigApplyState::Applied => {
                AgentConfigMutationState::Applied
            }
            crate::domains::sessions::live_config::EffectiveConfigApplyState::Queued => {
                AgentConfigMutationState::Queued
            }
        };
        Ok((record, state))
    }

    async fn resume_agent(
        &self,
        session_id: &str,
    ) -> Result<SessionRecord, AgentSessionMutationError> {
        use crate::domains::sessions::runtime::EnsureLiveSessionError;
        self.ensure_live_session(session_id, None)
            .await
            .map_err(|error| match error {
                EnsureLiveSessionError::SessionNotFound(_) => {
                    AgentSessionMutationError::SessionNotFound
                }
                other => AgentSessionMutationError::Failed(anyhow::anyhow!("{other:?}")),
            })
    }

    async fn interrupt_agent(
        &self,
        session_id: &str,
    ) -> Result<SessionRecord, AgentSessionMutationError> {
        use crate::domains::sessions::runtime::SessionLifecycleError;
        self.cancel_live_session(session_id)
            .await
            .map_err(|error| match error {
                SessionLifecycleError::SessionNotFound(_) => {
                    AgentSessionMutationError::SessionNotFound
                }
                SessionLifecycleError::Internal(error) => AgentSessionMutationError::Failed(error),
            })
    }
}

pub trait AgentTaskOutputReads: Send + Sync {
    fn task_output(
        &self,
        session_id: &str,
        cursor: Option<&str>,
        limit: usize,
    ) -> Result<TaskOutputPage, TaskOutputError>;
}

impl AgentTaskOutputReads for SessionService {
    fn task_output(
        &self,
        session_id: &str,
        cursor: Option<&str>,
        limit: usize,
    ) -> Result<TaskOutputPage, TaskOutputError> {
        self.get_task_output(session_id, cursor, limit)
    }
}

#[async_trait]
pub trait AgentWorkspaceOperations: Send + Sync {
    async fn list_workspaces(&self) -> Result<Vec<WorkspaceRecord>, WorkspaceOptionsError>;
    async fn get_workspace(
        &self,
        workspace_id: &str,
    ) -> Result<Option<WorkspaceRecord>, WorkspaceOptionsError>;
    async fn list_workspace_options(
        &self,
    ) -> Result<WorkspaceCreationOptions, WorkspaceOptionsError>;
    async fn create_workspace(
        &self,
        caller_workspace_id: &str,
        input: CreateWorkspaceFromOptionsInput,
    ) -> Result<CreateWorkspaceFromOptionsResult, WorkspaceOptionsError>;
}

#[async_trait]
impl AgentWorkspaceOperations for WorkspaceOptionRuntime {
    async fn list_workspaces(&self) -> Result<Vec<WorkspaceRecord>, WorkspaceOptionsError> {
        WorkspaceOptionRuntime::list_workspaces(self).await
    }

    async fn get_workspace(
        &self,
        workspace_id: &str,
    ) -> Result<Option<WorkspaceRecord>, WorkspaceOptionsError> {
        WorkspaceOptionRuntime::get_workspace(self, workspace_id).await
    }

    async fn list_workspace_options(
        &self,
    ) -> Result<WorkspaceCreationOptions, WorkspaceOptionsError> {
        WorkspaceOptionRuntime::list_options(self).await
    }

    async fn create_workspace(
        &self,
        caller_workspace_id: &str,
        input: CreateWorkspaceFromOptionsInput,
    ) -> Result<CreateWorkspaceFromOptionsResult, WorkspaceOptionsError> {
        WorkspaceOptionRuntime::create_workspace(self, caller_workspace_id, input).await
    }
}

pub trait AgentLaunchOptionReads: Send + Sync {
    fn resolved_workspace_launch_options(
        &self,
        workspace_id: &str,
    ) -> anyhow::Result<ResolvedWorkspaceLaunchOptions>;
}

impl AgentLaunchOptionReads for SessionRuntime {
    fn resolved_workspace_launch_options(
        &self,
        workspace_id: &str,
    ) -> anyhow::Result<ResolvedWorkspaceLaunchOptions> {
        SessionRuntime::resolved_workspace_launch_options(self, workspace_id)
    }
}

pub trait AgentCatalogReads: Send + Sync {
    fn active_catalog(&self) -> ActiveCatalog;
    fn checked_live_config_snapshot(
        &self,
        session_id: &str,
    ) -> anyhow::Result<Option<EffectiveLiveConfigSnapshot>>;
    fn live_model_switch_authorized(&self, session: &SessionRecord, value: &str) -> bool;
}

impl AgentCatalogReads for SessionService {
    fn active_catalog(&self) -> ActiveCatalog {
        self.active_agent_catalog()
    }

    fn checked_live_config_snapshot(
        &self,
        session_id: &str,
    ) -> anyhow::Result<Option<EffectiveLiveConfigSnapshot>> {
        self.get_live_config_snapshot_checked(session_id)
            .map_err(|error| match error {
                crate::domains::sessions::service::GetLiveConfigSnapshotError::SessionNotFound(
                    session_id,
                ) => anyhow::anyhow!("session not found: {session_id}"),
                crate::domains::sessions::service::GetLiveConfigSnapshotError::Internal(error) => {
                    error
                }
            })
            .map(|snapshot| snapshot.map(effective_live_config_snapshot))
    }

    fn live_model_switch_authorized(&self, session: &SessionRecord, value: &str) -> bool {
        SessionService::live_model_switch_authorized(self, session, value)
    }
}
