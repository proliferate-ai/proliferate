use std::sync::Arc;

use super::attachment_storage::PromptAttachmentStorage;
use super::deletion::SessionDeleteWorkflow;
use super::model::SessionRecord;
use super::store::SessionStore;
use crate::domains::agents::catalog::service::AgentCatalogService;
use crate::domains::agents::launch_options::HarnessLaunchOptionsService;
use crate::domains::workspaces::store::WorkspaceStore;

pub(crate) mod attachments;
mod capability;
mod config;
pub(crate) mod create;
mod create_lifecycle;
#[cfg(test)]
mod create_tests;
mod history;
mod launch_options;
mod mobility;
pub(crate) mod support_windows;
mod title;

pub struct SessionService {
    session_store: SessionStore,
    delete_workflow: SessionDeleteWorkflow,
    attachment_storage: PromptAttachmentStorage,
    workspace_store: WorkspaceStore,
    catalog_service: AgentCatalogService,
    launch_options_service: Arc<HarnessLaunchOptionsService>,
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
    /// The requested model cannot launch under the active universe — the one
    /// typed refusal for every unservable model intent
    /// (`SESSION_MODEL_UNSUPPORTED`). `active_universe` names which truth
    /// refused so the wire detail can say so.
    LaunchOptionsUnavailable {
        agent_kind: String,
        state: Option<crate::domains::agents::launch_options::HarnessLaunchOptionsState>,
    },
    LaunchValueUnsupported {
        agent_kind: String,
        key: String,
        value: String,
        state: crate::domains::agents::launch_options::HarnessLaunchOptionsState,
    },
    AgentEnvOverrideUnsupported {
        agent_kind: String,
        env_var_name: String,
    },
    /// The harness's enrolled agent-auth selection cannot be satisfied
    /// (agent-auth.md: "present-but-empty fails closed"). Distinct from
    /// `Invalid`: the agent may be perfectly installed and the user's own login
    /// may even work — the point is that they SELECTED a route which is now dead,
    /// and honoring it silently with their personal credentials is the failure
    /// this refuses. Maps to a 409 carrying route-auth's own code.
    RouteAuth(crate::domains::agent_auth::route_auth::RouteAuthError),
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
    #[cfg(test)]
    pub fn new(
        session_store: SessionStore,
        delete_workflow: SessionDeleteWorkflow,
        workspace_store: WorkspaceStore,
        catalog_service: AgentCatalogService,
        runtime_home: std::path::PathBuf,
    ) -> Self {
        let launch_options_service = Arc::new(HarnessLaunchOptionsService::new(
            session_store.db(),
            runtime_home.clone(),
        ));
        Self::with_launch_options(
            session_store,
            delete_workflow,
            workspace_store,
            catalog_service,
            launch_options_service,
            runtime_home,
        )
    }

    pub fn with_launch_options(
        session_store: SessionStore,
        delete_workflow: SessionDeleteWorkflow,
        workspace_store: WorkspaceStore,
        catalog_service: AgentCatalogService,
        launch_options_service: Arc<HarnessLaunchOptionsService>,
        runtime_home: std::path::PathBuf,
    ) -> Self {
        Self {
            session_store,
            delete_workflow,
            attachment_storage: PromptAttachmentStorage::new(runtime_home.clone()),
            workspace_store,
            catalog_service,
            launch_options_service,
            runtime_home,
        }
    }

    pub fn store(&self) -> &SessionStore {
        &self.session_store
    }

    /// Revalidate the immutable intent immediately before a real process
    /// start. Every create/replay/resume/prompt/fork/config path converges on
    /// `SessionRuntime::start_live_session`, which calls this seam.
    pub(crate) fn validate_persisted_launch_intent(
        &self,
        record: &SessionRecord,
    ) -> Result<
        crate::domains::agents::launch_options::HarnessLaunchOptionStateRow,
        crate::domains::agents::launch_options::LaunchSelectionUnsupported,
    > {
        use crate::domains::agents::launch_options::{LaunchSelection, LaunchSelectionUnsupported};

        let intent = self
            .session_store
            .find_launch_intent(&record.id)
            .map_err(LaunchSelectionUnsupported::Internal)?
            .ok_or_else(|| {
                LaunchSelectionUnsupported::Internal(anyhow::anyhow!(
                    "session is missing its immutable launch intent"
                ))
            })?;
        self.launch_options_service.validate_selection(
            &record.agent_kind,
            &LaunchSelection {
                model_id: intent.model_id,
                control_values: intent.control_values,
            },
        )
    }

    pub fn attachment_storage(&self) -> &PromptAttachmentStorage {
        &self.attachment_storage
    }

    pub fn find_last_dismissed_in_workspace(
        &self,
        workspace_id: &str,
    ) -> anyhow::Result<Option<SessionRecord>> {
        self.session_store
            .find_last_dismissed_in_workspace(workspace_id)
    }

    /// Look up a single prompt attachment's record (not its bytes — see
    /// [`SessionService::read_prompt_attachment_content`]) by session and
    /// attachment id, for the download-by-id handler.
    pub fn find_prompt_attachment(
        &self,
        session_id: &str,
        attachment_id: &str,
    ) -> anyhow::Result<Option<super::model::PromptAttachmentRecord>> {
        self.session_store
            .find_prompt_attachment(session_id, attachment_id)
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
