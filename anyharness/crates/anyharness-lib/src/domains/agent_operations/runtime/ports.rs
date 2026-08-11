use std::sync::Arc;

use async_trait::async_trait;

use crate::domains::agents::catalog::service::ActiveCatalog;
use crate::domains::agents::readiness::launch_options::ResolvedWorkspaceLaunchOptions;
use crate::domains::sessions::links::model::SessionLinkRecord;
use crate::domains::sessions::links::service::SessionLinkService;
use crate::domains::sessions::live_config::{
    effective_live_config_snapshot, EffectiveLiveConfigSnapshot,
};
use crate::domains::sessions::model::{SessionExecutionState, SessionRecord};
use crate::domains::sessions::prompt::provenance::AgentSessionPromptSource;
use crate::domains::sessions::runtime::{
    CreateOrdinaryAgentSessionError, CreateSubagentAgentSessionError, EnsureLiveSessionError,
    SessionLifecycleError, SessionRuntime, SetSessionConfigOptionError, SubagentLifecycleError,
};
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
        // Generic relationship closure is historical/terminal and must not
        // continue conferring the dynamic subagent role. Reversible
        // subagent-Closed rows remain in this current relationship query.
        self.find_subagent_parent(child_session_id)
    }

    fn list_children_including_closed(
        &self,
        parent_session_id: &str,
    ) -> anyhow::Result<Vec<SessionLinkRecord>> {
        self.list_subagent_children(parent_session_id)
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

#[async_trait]
pub trait AgentSessionMutations: Send + Sync {
    async fn create_ordinary_agent(
        &self,
        workspace_id: &str,
        agent_kind: &str,
        model_id: Option<&str>,
        mode_id: Option<&str>,
        task: Option<String>,
        source_session_id: &str,
        source_label: &str,
    ) -> Result<SessionRecord, CreateOrdinaryAgentSessionError>;

    async fn configure_agent(
        &self,
        session_id: &str,
        config_id: &str,
        value: &str,
    ) -> Result<(SessionRecord, AgentConfigMutationState), SetSessionConfigOptionError>;

    async fn resume_agent(&self, session_id: &str)
        -> Result<SessionRecord, EnsureLiveSessionError>;

    async fn interrupt_agent(
        &self,
        session_id: &str,
    ) -> Result<SessionRecord, SessionLifecycleError>;
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
        source_session_id: &str,
        source_label: &str,
    ) -> Result<SessionRecord, CreateOrdinaryAgentSessionError> {
        self.create_ordinary_agent_session(
            workspace_id,
            agent_kind,
            model_id,
            mode_id,
            task,
            source_session_id.to_string(),
            source_label.to_string(),
        )
        .await
    }

    async fn configure_agent(
        &self,
        session_id: &str,
        config_id: &str,
        value: &str,
    ) -> Result<(SessionRecord, AgentConfigMutationState), SetSessionConfigOptionError> {
        let (record, _, state) = self
            .set_live_session_config_option(session_id, config_id, value)
            .await?;
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
    ) -> Result<SessionRecord, EnsureLiveSessionError> {
        self.ensure_live_session(session_id, None).await
    }

    async fn interrupt_agent(
        &self,
        session_id: &str,
    ) -> Result<SessionRecord, SessionLifecycleError> {
        self.cancel_live_session(session_id).await
    }
}

#[async_trait]
pub trait SubagentLifecycleMutations: Send + Sync {
    async fn create_subagent_agent(
        &self,
        workspace_id: &str,
        agent_kind: &str,
        model_id: Option<&str>,
        mode_id: Option<&str>,
        task: String,
        parent_session_id: &str,
        source_label: &str,
    ) -> Result<SessionRecord, CreateSubagentAgentSessionError>;

    async fn close_subagent(
        &self,
        parent_session_id: &str,
        child_session_id: &str,
    ) -> Result<SessionRecord, SubagentLifecycleError>;

    async fn open_subagent(
        &self,
        parent_session_id: &str,
        child_session_id: &str,
    ) -> Result<SessionRecord, SubagentLifecycleError>;

    async fn promote_subagent(
        &self,
        parent_session_id: &str,
        child_session_id: &str,
    ) -> Result<SessionRecord, SubagentLifecycleError>;
}

#[async_trait]
impl SubagentLifecycleMutations for SessionRuntime {
    async fn create_subagent_agent(
        &self,
        workspace_id: &str,
        agent_kind: &str,
        model_id: Option<&str>,
        mode_id: Option<&str>,
        task: String,
        parent_session_id: &str,
        source_label: &str,
    ) -> Result<SessionRecord, CreateSubagentAgentSessionError> {
        self.create_subagent_agent_session(
            workspace_id,
            agent_kind,
            model_id,
            mode_id,
            task,
            parent_session_id,
            source_label,
        )
        .await
    }

    async fn close_subagent(
        &self,
        parent_session_id: &str,
        child_session_id: &str,
    ) -> Result<SessionRecord, SubagentLifecycleError> {
        SessionRuntime::close_subagent(self, parent_session_id, child_session_id).await
    }

    async fn open_subagent(
        &self,
        parent_session_id: &str,
        child_session_id: &str,
    ) -> Result<SessionRecord, SubagentLifecycleError> {
        SessionRuntime::open_subagent(self, parent_session_id, child_session_id).await
    }

    async fn promote_subagent(
        &self,
        parent_session_id: &str,
        child_session_id: &str,
    ) -> Result<SessionRecord, SubagentLifecycleError> {
        SessionRuntime::promote_subagent(self, parent_session_id, child_session_id).await
    }
}

#[async_trait]
pub(crate) trait AgentMessageQueue: Send + Sync {
    // `Arc<Self>` receiver: `enqueue_agent_message` durably commits the pending
    // row, then detaches consumer activation onto a spawned task, so it needs a
    // shared-owned handle that outlives the call.
    async fn enqueue_agent_message(
        self: Arc<Self>,
        target_session_id: &str,
        message: String,
        source: AgentSessionPromptSource,
    ) -> Result<i64, crate::domains::sessions::runtime::SendPromptError>;
}

#[async_trait]
impl AgentMessageQueue for SessionRuntime {
    async fn enqueue_agent_message(
        self: Arc<Self>,
        target_session_id: &str,
        message: String,
        source: AgentSessionPromptSource,
    ) -> Result<i64, crate::domains::sessions::runtime::SendPromptError> {
        SessionRuntime::enqueue_agent_message(self, target_session_id, message, source).await
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
