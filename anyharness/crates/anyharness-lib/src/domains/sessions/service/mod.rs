use super::attachment_storage::PromptAttachmentStorage;
use super::deletion::SessionDeleteWorkflow;
use super::model::SessionRecord;
use super::store::SessionStore;
use crate::domains::agents::catalog::service::AgentCatalogService;
use crate::domains::workspaces::store::WorkspaceStore;

pub(crate) mod attachments;
mod config;
mod create;
#[cfg(test)]
mod create_tests;
mod history;
mod launch_options;
mod mobility;
mod title;

pub struct SessionService {
    session_store: SessionStore,
    delete_workflow: SessionDeleteWorkflow,
    attachment_storage: PromptAttachmentStorage,
    workspace_store: WorkspaceStore,
    catalog_service: AgentCatalogService,
    runtime_home: std::path::PathBuf,
}

#[derive(Debug)]
pub(crate) enum CreateSessionOutcome {
    Created(SessionRecord),
    Existing(SessionRecord),
}

impl CreateSessionOutcome {
    pub(crate) fn into_record(self) -> SessionRecord {
        match self {
            Self::Created(record) | Self::Existing(record) => record,
        }
    }
}

/// Complete provenance for a catalog-known model rejected by the active auth
/// context. The service constructs this before returning so the API boundary
/// can emit one authoritative incident without reconstructing lost context.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelGatedContext {
    pub workspace_id: String,
    pub attempted_session_id: Option<String>,
    pub agent_kind: String,
    pub requested_model_id: String,
    pub canonical_model_id: String,
    pub active_contexts: Vec<String>,
    pub required_contexts: Vec<String>,
    pub catalog_version: String,
}

#[derive(Debug)]
pub enum CreateSessionError {
    WorkspaceNotFound(String),
    WorkspaceSingleSession {
        workspace_id: String,
        session_id: String,
    },
    SessionIdConflict {
        session_id: String,
    },
    ModelUnsupported {
        agent_kind: String,
        model_id: String,
    },
    /// The model exists in the catalog but is gated behind auth contexts that
    /// are not active. Distinct from `ModelUnsupported` (unresolvable model):
    /// the client can unlock it by satisfying one of
    /// `required_contexts` (the model's `availability.anyOf`).
    ModelGated(ModelGatedContext),
    ModeUnsupported {
        agent_kind: String,
        mode_id: String,
    },
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
        catalog_service: AgentCatalogService,
        runtime_home: std::path::PathBuf,
    ) -> Self {
        Self {
            session_store,
            delete_workflow,
            attachment_storage: PromptAttachmentStorage::new(runtime_home.clone()),
            workspace_store,
            catalog_service,
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
