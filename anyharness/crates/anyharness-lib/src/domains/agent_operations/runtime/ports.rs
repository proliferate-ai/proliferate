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
