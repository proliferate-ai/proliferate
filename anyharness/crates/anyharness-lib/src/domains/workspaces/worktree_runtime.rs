use std::sync::Arc;

use crate::domains::workspaces::creator_context::WorkspaceCreatorContext;
use crate::domains::workspaces::retention::WorkspaceRetentionService;
use crate::domains::workspaces::runtime::WorkspaceRuntime;
use crate::domains::workspaces::setup_runtime::{WorkspaceSetupError, WorkspaceSetupRuntime};
use crate::domains::workspaces::types::CreateWorktreeResult;
use crate::domains::workspaces::worktree_checkout::WorktreeCheckoutMode;
use crate::domains::workspaces::worktree_names::WorktreeNameConflictPolicy;
use crate::origin::OriginContext;

#[derive(Clone)]
pub struct WorkspaceWorktreeRuntime {
    workspace_runtime: Arc<WorkspaceRuntime>,
    setup_runtime: Arc<WorkspaceSetupRuntime>,
    retention_service: Arc<WorkspaceRetentionService>,
}

#[derive(Debug, Clone)]
pub struct CreateWorktreeWorkflowInput {
    pub repo_root_id: String,
    pub target_path: String,
    pub new_branch_name: String,
    pub base_branch: Option<String>,
    pub checkout_mode: WorktreeCheckoutMode,
    pub setup_script: Option<String>,
    pub surface: String,
    pub name_conflict_policy: WorktreeNameConflictPolicy,
    pub origin: OriginContext,
    pub creator_context: Option<WorkspaceCreatorContext>,
}

#[derive(Debug, Clone)]
pub struct CreateWorktreeWorkflowResult {
    pub worktree: CreateWorktreeResult,
    pub setup_started: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum CreateWorktreeWorkflowError {
    #[error("worktree create task failed: {0}")]
    CreateTaskFailed(tokio::task::JoinError),
    #[error(transparent)]
    Create(anyhow::Error),
    #[error(transparent)]
    Setup(#[from] WorkspaceSetupError),
}

impl WorkspaceWorktreeRuntime {
    pub fn new(
        workspace_runtime: Arc<WorkspaceRuntime>,
        setup_runtime: Arc<WorkspaceSetupRuntime>,
        retention_service: Arc<WorkspaceRetentionService>,
    ) -> Self {
        Self {
            workspace_runtime,
            setup_runtime,
            retention_service,
        }
    }

    pub async fn create_worktree(
        &self,
        input: CreateWorktreeWorkflowInput,
    ) -> Result<CreateWorktreeWorkflowResult, CreateWorktreeWorkflowError> {
        let workspace_runtime = self.workspace_runtime.clone();
        let repo_root_id = input.repo_root_id.clone();
        let target_path = input.target_path.clone();
        let new_branch_name = input.new_branch_name.clone();
        let base_branch = input.base_branch.clone();
        let checkout_mode = input.checkout_mode;
        let surface = input.surface.clone();
        let name_conflict_policy = input.name_conflict_policy;
        let origin = input.origin;
        let creator_context = input.creator_context;
        let worktree = tokio::task::spawn_blocking(move || {
            workspace_runtime.create_worktree_with_surface_and_checkout_mode(
                &repo_root_id,
                &target_path,
                &new_branch_name,
                base_branch.as_deref(),
                None,
                &surface,
                checkout_mode,
                name_conflict_policy,
                origin,
                creator_context,
            )
        })
        .await
        .map_err(CreateWorktreeWorkflowError::CreateTaskFailed)?
        .map_err(CreateWorktreeWorkflowError::Create)?;

        let setup_started = if let Some(script) = normalized_setup_script(input.setup_script) {
            self.setup_runtime
                .start_setup_for_created_workspace(
                    worktree.workspace.clone(),
                    script,
                    input.base_branch.clone(),
                )
                .await?;
            true
        } else {
            false
        };

        self.retention_service
            .clone()
            .spawn_post_create_pass(worktree.workspace.id.clone());

        Ok(CreateWorktreeWorkflowResult {
            worktree,
            setup_started,
        })
    }
}

fn normalized_setup_script(script: Option<String>) -> Option<String> {
    script
        .map(|script| script.trim().to_string())
        .filter(|script| !script.is_empty())
}
