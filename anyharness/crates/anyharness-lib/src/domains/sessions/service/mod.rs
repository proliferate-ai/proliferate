use std::sync::Arc;

use super::attachment_storage::PromptAttachmentStorage;
use super::deletion::SessionDeleteWorkflow;
use super::model::SessionRecord;
use super::store::SessionStore;
use crate::domains::agents::catalog::service::{ActiveUniverse, AgentCatalogService};
use crate::domains::agents::model_snapshot::universe::ObservedUniverseSource;
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
    /// This machine's observed models per auth context, consulted by launch
    /// validation so a probe's discoveries are launchable and the shipped catalog
    /// fills in where nothing was observed.
    ///
    /// A seam rather than the probe engine itself: the engine takes a filesystem
    /// lock on the runtime home at construction, and requiring one to answer a pure
    /// validation question would put an flock in the middle of every session test.
    /// [`NoObservations`] is the pre-probe universe, i.e. exactly the old behavior.
    observed_universe: Arc<dyn ObservedUniverseSource>,
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
    ModelUnsupported {
        agent_kind: String,
        model_id: String,
        active_universe: ActiveUniverse,
    },
    ModeUnsupported {
        agent_kind: String,
        mode_id: String,
    },
    /// The harness's enrolled agent-auth selection cannot be satisfied
    /// (agent-auth.md: "present-but-empty fails closed"). Distinct from
    /// `Invalid`: the agent may be perfectly installed and the user's own login
    /// may even work — the point is that they SELECTED a route which is now dead,
    /// and honoring it silently with their personal credentials is the failure
    /// this refuses. Maps to a 409 carrying route-auth's own code.
    RouteAuth(crate::domains::agents::route_auth::RouteAuthError),
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
    /// A service that validates against the shipped catalog only — the pre-probe
    /// universe.
    ///
    /// **Test-only today.** Production wiring always has a runtime home and therefore a
    /// probe engine, so it goes through
    /// [`SessionService::with_observed_universe`]. This constructor is kept (rather
    /// than deleted) because it is the shape every catalog/session suite wants — a
    /// service whose validation answers are a pure function of the shipped catalog,
    /// with no filesystem lock taken on a temp home — and because it documents that
    /// the no-observation universe is a legitimate configuration rather than an
    /// error path.
    #[cfg(test)]
    pub fn new(
        session_store: SessionStore,
        delete_workflow: SessionDeleteWorkflow,
        workspace_store: WorkspaceStore,
        catalog_service: AgentCatalogService,
        runtime_home: std::path::PathBuf,
    ) -> Self {
        Self::with_observed_universe(
            session_store,
            delete_workflow,
            workspace_store,
            catalog_service,
            Arc::new(crate::domains::agents::model_snapshot::universe::NoObservations),
            runtime_home,
        )
    }

    pub fn with_observed_universe(
        session_store: SessionStore,
        delete_workflow: SessionDeleteWorkflow,
        workspace_store: WorkspaceStore,
        catalog_service: AgentCatalogService,
        observed_universe: Arc<dyn ObservedUniverseSource>,
        runtime_home: std::path::PathBuf,
    ) -> Self {
        Self {
            session_store,
            delete_workflow,
            attachment_storage: PromptAttachmentStorage::new(runtime_home.clone()),
            workspace_store,
            catalog_service,
            observed_universe,
            runtime_home,
        }
    }

    pub fn store(&self) -> &SessionStore {
        &self.session_store
    }

    pub fn attachment_storage(&self) -> &PromptAttachmentStorage {
        &self.attachment_storage
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
