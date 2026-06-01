use std::sync::Arc;

use super::attachment_storage::PromptAttachmentStorage;
use super::deletion::SessionDeleteWorkflow;
use super::store::SessionStore;
use crate::domains::agents::auth_config::{AgentAuthConfigService, AgentAuthSelectionRequired};
use crate::domains::agents::model_registry::store::DynamicModelRegistryStore;
use crate::domains::workspaces::store::WorkspaceStore;

pub(crate) mod attachments;
mod config;
mod create;
mod history;
mod launch_options;
mod mobility;
mod title;

pub struct SessionService {
    session_store: SessionStore,
    delete_workflow: SessionDeleteWorkflow,
    attachment_storage: PromptAttachmentStorage,
    workspace_store: WorkspaceStore,
    dynamic_model_registry_store: DynamicModelRegistryStore,
    agent_auth_config_service: Arc<AgentAuthConfigService>,
    runtime_home: std::path::PathBuf,
}

#[derive(Debug)]
pub enum CreateSessionError {
    WorkspaceNotFound(String),
    WorkspaceSingleSession {
        workspace_id: String,
        session_id: String,
    },
    ModelUnsupported {
        agent_kind: String,
        model_id: String,
    },
    ModeUnsupported {
        agent_kind: String,
        mode_id: String,
    },
    AgentAuthSelectionRequired(AgentAuthSelectionRequired),
    Invalid(String),
    Internal(anyhow::Error),
}

#[derive(Debug)]
pub enum GetLiveConfigSnapshotError {
    SessionNotFound(String),
    Internal(anyhow::Error),
}

#[derive(Debug)]
pub enum UpdateSessionTitleError {
    SessionNotFound(String),
    EmptyTitle,
    TitleTooLong(usize),
    Internal(anyhow::Error),
}

impl SessionService {
    pub fn new(
        session_store: SessionStore,
        delete_workflow: SessionDeleteWorkflow,
        workspace_store: WorkspaceStore,
        dynamic_model_registry_store: DynamicModelRegistryStore,
        agent_auth_config_service: Arc<AgentAuthConfigService>,
        runtime_home: std::path::PathBuf,
    ) -> Self {
        Self {
            session_store,
            delete_workflow,
            attachment_storage: PromptAttachmentStorage::new(runtime_home.clone()),
            workspace_store,
            dynamic_model_registry_store,
            agent_auth_config_service,
            runtime_home,
        }
    }

    pub fn store(&self) -> &SessionStore {
        &self.session_store
    }

    pub fn attachment_storage(&self) -> &PromptAttachmentStorage {
        &self.attachment_storage
    }

    pub fn read_prompt_attachment_content(
        &self,
        record: &super::model::PromptAttachmentRecord,
    ) -> anyhow::Result<Vec<u8>> {
        attachments::read_prompt_attachment_content_with_legacy_fallback(
            &self.session_store,
            &self.attachment_storage,
            record,
        )
    }

    pub fn delete_session(&self, session_id: &str) -> anyhow::Result<()> {
        self.delete_workflow.delete_session(session_id)?;
        if let Err(error) = self.attachment_storage.delete_session_dir(session_id) {
            tracing::warn!(
                session_id = %session_id,
                error = %error,
                "failed to delete session prompt attachment directory"
            );
        }
        Ok(())
    }
}
