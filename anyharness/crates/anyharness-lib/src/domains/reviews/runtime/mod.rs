use std::path::PathBuf;
use std::sync::Arc;

mod artifacts;
mod background;
mod events;
mod feedback;
mod launch;
mod launching;
mod reconcile;
mod workflow;

use super::service::ReviewService;
use crate::sessions::runtime::SessionRuntime;
use crate::workspaces::runtime::WorkspaceRuntime;

#[derive(Debug, Clone)]
pub struct StartPlanReviewRuntimeInput {
    pub parent_session_id: String,
    pub max_rounds: u32,
    pub auto_iterate: bool,
    pub reviewers: Vec<super::service::ReviewPersonaInput>,
}

#[derive(Debug, Clone)]
pub struct StartCodeReviewRuntimeInput {
    pub parent_session_id: String,
    pub max_rounds: u32,
    pub auto_iterate: bool,
    pub reviewers: Vec<super::service::ReviewPersonaInput>,
}

#[derive(Debug, Clone)]
pub struct MarkReviewRevisionReadyInput {
    pub revised_plan_id: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct RetryReviewAssignmentInput {
    pub model_id: Option<String>,
}

#[derive(Clone)]
pub struct ReviewRuntime {
    pub(crate) service: Arc<ReviewService>,
    pub(crate) session_runtime: Arc<SessionRuntime>,
    pub(crate) workspace_runtime: Arc<WorkspaceRuntime>,
    pub(crate) runtime_home: PathBuf,
}

impl ReviewRuntime {
    pub fn new(
        service: Arc<ReviewService>,
        session_runtime: Arc<SessionRuntime>,
        workspace_runtime: Arc<WorkspaceRuntime>,
        runtime_home: PathBuf,
    ) -> Self {
        Self {
            service,
            session_runtime,
            workspace_runtime,
            runtime_home,
        }
    }

    pub fn service(&self) -> &Arc<ReviewService> {
        &self.service
    }
}
