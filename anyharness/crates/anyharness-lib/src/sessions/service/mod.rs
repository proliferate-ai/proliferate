use std::sync::Arc;

use super::attachment_storage::PromptAttachmentStorage;
use super::store::SessionStore;
use crate::domains::agents::catalog::{LaunchCatalogService, ModelCatalogService};
use crate::workspaces::store::WorkspaceStore;

mod attachments;
mod creation;
mod import_export;
mod launch_catalog;
mod model_resolution;
mod queries;

pub use attachments::read_prompt_attachment_content_with_legacy_fallback;
pub use launch_catalog::{
    WorkspaceSessionLaunchAgentData, WorkspaceSessionLaunchCatalogData,
    WorkspaceSessionLaunchModelData,
};

pub struct SessionService {
    session_store: SessionStore,
    attachment_storage: PromptAttachmentStorage,
    workspace_store: WorkspaceStore,
    runtime_home: std::path::PathBuf,
    model_catalog_service: Arc<ModelCatalogService>,
    launch_catalog_service: Arc<LaunchCatalogService>,
}

#[derive(Debug)]
pub enum CreateSessionError {
    WorkspaceNotFound(String),
    WorkspaceSingleSession {
        workspace_id: String,
        session_id: String,
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
        workspace_store: WorkspaceStore,
        runtime_home: std::path::PathBuf,
        model_catalog_service: Arc<ModelCatalogService>,
        launch_catalog_service: Arc<LaunchCatalogService>,
    ) -> Self {
        Self {
            session_store,
            attachment_storage: PromptAttachmentStorage::new(runtime_home.clone()),
            workspace_store,
            runtime_home,
            model_catalog_service,
            launch_catalog_service,
        }
    }
}
