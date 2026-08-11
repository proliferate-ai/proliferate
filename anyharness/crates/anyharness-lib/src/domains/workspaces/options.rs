//! Runtime-owned workspace creation vocabulary.
//!
//! This is the single query/validation path used by agent-initiated workspace
//! creation. It reports every durable repo root, including roots that are
//! currently missing or unreadable, and delegates effects to the existing
//! local/worktree workspace owners.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use async_trait::async_trait;
use serde::Serialize;

use super::access_gate::{WorkspaceAccessError, WorkspaceAccessGate};
use super::creator_context::WorkspaceCreatorContext;
use super::model::WorkspaceRecord;
use super::runtime::{normalize_workspace_display_name, WorkspaceResolution, WorkspaceRuntime};
use super::types::SetWorkspaceDisplayNameError;
use super::worktree_checkout::WorktreeCheckoutMode;
use super::worktree_names::{WorktreeNameConflictError, WorktreeNameConflictPolicy};
use super::worktree_runtime::{
    CreateWorktreeWorkflowError, CreateWorktreeWorkflowInput, CreateWorktreeWorkflowResult,
    WorkspaceWorktreeRuntime,
};
use crate::adapters::git::types::GitBranch;
use crate::adapters::git::GitService;
use crate::domains::repo_roots::model::RepoRootRecord;
use crate::domains::repo_roots::service::RepoRootService;
use crate::origin::OriginContext;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum WorkspaceRepositoryAvailability {
    Present,
    Missing,
    Unreadable {
        /// Retained for local diagnostics and error chains, but never exposed
        /// through the workspace-options wire projection.
        #[serde(skip_serializing)]
        diagnostic: String,
    },
}

impl WorkspaceRepositoryAvailability {
    pub fn is_present(&self) -> bool {
        matches!(self, Self::Present)
    }

    fn public_reason(&self) -> Option<String> {
        match self {
            Self::Present => None,
            Self::Missing => Some("The repository checkout is missing from this runtime.".into()),
            Self::Unreadable { .. } => Some("The repository checkout could not be read.".into()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceBranchMetadata {
    pub name: String,
    pub is_remote: bool,
    pub is_head: bool,
    pub is_default: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upstream: Option<String>,
    /// Existing refs are descriptive metadata. V1 worktree creation accepts a
    /// new branch name and keeps base-ref selection as owner policy.
    pub selectable_for_creation: bool,
}

impl From<GitBranch> for WorkspaceBranchMetadata {
    fn from(branch: GitBranch) -> Self {
        Self {
            name: branch.name,
            is_remote: branch.is_remote,
            is_head: branch.is_head,
            is_default: branch.is_default,
            upstream: branch.upstream,
            selectable_for_creation: false,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceCreationMode {
    Worktree,
    Local,
}

impl WorkspaceCreationMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Worktree => "worktree",
            Self::Local => "local",
        }
    }

    fn parse(value: &str) -> Result<Self, WorkspaceOptionsError> {
        match value {
            "worktree" => Ok(Self::Worktree),
            "local" => Ok(Self::Local),
            other => Err(WorkspaceOptionsError::InvalidCreationMode(
                other.to_string(),
            )),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCreationModeOption {
    pub mode: WorkspaceCreationMode,
    pub requires_branch: bool,
    pub branch_must_be_absent: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRepositoryOption {
    pub repository_id: String,
    pub name: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_branch: Option<String>,
    pub branches: Vec<WorkspaceBranchMetadata>,
    pub availability: WorkspaceRepositoryAvailability,
    pub executable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unavailable_reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCreationOptions {
    pub repositories: Vec<WorkspaceRepositoryOption>,
    pub creation_modes: Vec<WorkspaceCreationModeOption>,
}

impl WorkspaceCreationOptions {
    fn repository(&self, repository_id: &str) -> Option<&WorkspaceRepositoryOption> {
        self.repositories
            .iter()
            .find(|repository| repository.repository_id == repository_id)
    }
}

#[derive(Debug, Clone)]
pub struct CreateWorkspaceFromOptionsInput {
    pub repository_id: String,
    pub creation_mode: String,
    pub branch: Option<String>,
    pub display_name: Option<String>,
    pub origin: OriginContext,
    pub creator_context: WorkspaceCreatorContext,
}

#[derive(Debug, Clone)]
pub struct CreateWorkspaceFromOptionsResult {
    pub workspace: WorkspaceRecord,
    pub repository: RepoRootRecord,
    pub creation_mode: WorkspaceCreationMode,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ValidatedWorkspaceCreation {
    repository_id: String,
    creation_mode: WorkspaceCreationMode,
    branch: Option<String>,
    display_name: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum WorkspaceOptionsError {
    #[error("repository not found: {0}")]
    RepositoryNotFound(String),
    #[error("repository {repository_id} is unavailable: {availability:?}")]
    RepositoryUnavailable {
        repository_id: String,
        availability: WorkspaceRepositoryAvailability,
    },
    #[error("unknown workspace creation mode: {0}")]
    InvalidCreationMode(String),
    #[error("branch is required for worktree creation")]
    BranchRequired,
    #[error("branch must be omitted for local workspace creation")]
    BranchNotAllowed,
    #[error("invalid worktree branch: {0}")]
    InvalidBranch(String),
    #[error("workspace display name cannot exceed {0} characters")]
    DisplayNameTooLong(usize),
    #[error("workspace not found: {0}")]
    WorkspaceNotFound(String),
    #[error(transparent)]
    Access(#[from] WorkspaceAccessError),
    #[error("workspace option task failed: {0}")]
    TaskFailed(#[from] tokio::task::JoinError),
    #[error("requested worktree name conflicts with existing owner state")]
    WorktreeConflict(#[source] WorktreeNameConflictError),
    #[error("worktree owner rejected workspace creation")]
    WorktreeCreate(#[source] CreateWorktreeWorkflowError),
    #[error("workspace operation failed")]
    Create(#[source] anyhow::Error),
}

impl WorkspaceOptionsError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::RepositoryNotFound(_) => "WORKSPACE_REPOSITORY_NOT_FOUND",
            Self::RepositoryUnavailable { .. } => "WORKSPACE_REPOSITORY_UNAVAILABLE",
            Self::InvalidCreationMode(_) => "WORKSPACE_CREATION_MODE_INVALID",
            Self::BranchRequired => "WORKSPACE_BRANCH_REQUIRED",
            Self::BranchNotAllowed => "WORKSPACE_BRANCH_NOT_ALLOWED",
            Self::InvalidBranch(_) => "WORKSPACE_BRANCH_INVALID",
            Self::DisplayNameTooLong(_) => "WORKSPACE_DISPLAY_NAME_INVALID",
            Self::WorkspaceNotFound(_) => "WORKSPACE_NOT_FOUND",
            Self::Access(_) => "WORKSPACE_ACCESS_DENIED",
            Self::WorktreeConflict(_) => "WORKSPACE_WORKTREE_CONFLICT",
            Self::WorktreeCreate(_) => "WORKSPACE_WORKTREE_CREATE_FAILED",
            Self::TaskFailed(_) | Self::Create(_) => "WORKSPACE_OPERATION_FAILED",
        }
    }

    pub fn public_message(&self) -> String {
        match self {
            Self::RepositoryNotFound(_) => {
                "The requested repository is not registered in this runtime.".into()
            }
            Self::RepositoryUnavailable { availability, .. } => availability
                .public_reason()
                .unwrap_or_else(|| "The requested repository is unavailable.".into()),
            Self::InvalidCreationMode(_) => "Use creationMode 'worktree' or 'local'.".into(),
            Self::BranchRequired => {
                "A non-blank new branch is required for worktree creation.".into()
            }
            Self::BranchNotAllowed => "branch must be omitted when creationMode is 'local'.".into(),
            Self::InvalidBranch(reason) => format!("The requested branch is invalid: {reason}"),
            Self::DisplayNameTooLong(limit) => {
                format!("Workspace display name cannot exceed {limit} characters.")
            }
            Self::WorkspaceNotFound(_) => "The requested workspace was not found.".into(),
            Self::Access(_) => {
                "Workspace creation is not allowed while the workspace is read-only.".into()
            }
            Self::WorktreeConflict(_) => {
                "The requested worktree branch or path is already in use.".into()
            }
            Self::WorktreeCreate(_) => {
                "Worktree creation could not use the requested branch and path.".into()
            }
            Self::TaskFailed(_) | Self::Create(_) => "Workspace operation failed.".into(),
        }
    }
}

#[async_trait]
pub trait WorkspaceWorktreeCreates: Send + Sync {
    async fn create_worktree(
        &self,
        input: CreateWorktreeWorkflowInput,
    ) -> Result<CreateWorktreeWorkflowResult, CreateWorktreeWorkflowError>;
}

#[async_trait]
impl WorkspaceWorktreeCreates for WorkspaceWorktreeRuntime {
    async fn create_worktree(
        &self,
        input: CreateWorktreeWorkflowInput,
    ) -> Result<CreateWorktreeWorkflowResult, CreateWorktreeWorkflowError> {
        WorkspaceWorktreeRuntime::create_worktree(self, input).await
    }
}

#[derive(Clone)]
pub struct WorkspaceOptionRuntime {
    repo_roots: Arc<RepoRootService>,
    workspaces: Arc<WorkspaceRuntime>,
    worktrees: Arc<dyn WorkspaceWorktreeCreates>,
    access_gate: Arc<WorkspaceAccessGate>,
}

impl WorkspaceOptionRuntime {
    pub fn new(
        repo_roots: Arc<RepoRootService>,
        workspaces: Arc<WorkspaceRuntime>,
        worktrees: Arc<dyn WorkspaceWorktreeCreates>,
        access_gate: Arc<WorkspaceAccessGate>,
    ) -> Self {
        Self {
            repo_roots,
            workspaces,
            worktrees,
            access_gate,
        }
    }

    pub async fn list_workspaces(&self) -> Result<Vec<WorkspaceRecord>, WorkspaceOptionsError> {
        let workspaces = self.workspaces.clone();
        tokio::task::spawn_blocking(move || workspaces.list_workspaces())
            .await?
            .map_err(WorkspaceOptionsError::Create)
    }

    pub async fn get_workspace(
        &self,
        workspace_id: &str,
    ) -> Result<Option<WorkspaceRecord>, WorkspaceOptionsError> {
        let workspaces = self.workspaces.clone();
        let workspace_id = workspace_id.to_string();
        tokio::task::spawn_blocking(move || workspaces.get_workspace(&workspace_id))
            .await?
            .map_err(WorkspaceOptionsError::Create)
    }

    pub async fn list_options(&self) -> Result<WorkspaceCreationOptions, WorkspaceOptionsError> {
        let repo_roots = self.repo_roots.clone();
        tokio::task::spawn_blocking(move || build_workspace_options(&repo_roots)).await?
    }

    pub async fn create_workspace(
        &self,
        caller_workspace_id: &str,
        input: CreateWorkspaceFromOptionsInput,
    ) -> Result<CreateWorkspaceFromOptionsResult, WorkspaceOptionsError> {
        let options = self.list_options().await?;
        let validated = validate_workspace_creation(&options, &input)?;

        self.access_gate
            .assert_can_mutate_for_workspace(caller_workspace_id)?;
        self.access_gate
            .assert_can_mutate_for_repo_root(&validated.repository_id)?;

        let repo_roots = self.repo_roots.clone();
        let repository_id = validated.repository_id.clone();
        let repository =
            tokio::task::spawn_blocking(move || repo_roots.get_repo_root(&repository_id))
                .await?
                .map_err(WorkspaceOptionsError::Create)?
                .ok_or_else(|| {
                    WorkspaceOptionsError::RepositoryNotFound(validated.repository_id.clone())
                })?;

        let mut workspace = match validated.creation_mode {
            WorkspaceCreationMode::Local => {
                self.create_local_workspace(&repository, &input).await?
            }
            WorkspaceCreationMode::Worktree => {
                self.create_worktree_workspace(&repository, &validated, &input)
                    .await?
            }
        };

        if let Some(display_name) = validated.display_name.as_deref() {
            let workspaces = self.workspaces.clone();
            let workspace_id = workspace.id.clone();
            let display_name = display_name.to_string();
            workspace = tokio::task::spawn_blocking(move || {
                workspaces.set_display_name(&workspace_id, Some(&display_name))
            })
            .await?
            .map_err(map_display_name_error)?;
        }

        Ok(CreateWorkspaceFromOptionsResult {
            workspace,
            repository,
            creation_mode: validated.creation_mode,
        })
    }

    async fn create_local_workspace(
        &self,
        repository: &RepoRootRecord,
        input: &CreateWorkspaceFromOptionsInput,
    ) -> Result<WorkspaceRecord, WorkspaceOptionsError> {
        let workspaces = self.workspaces.clone();
        let path = repository.path.clone();
        let origin = input.origin.clone();
        let creator_context = input.creator_context.clone();
        let resolution: WorkspaceResolution = tokio::task::spawn_blocking(move || {
            workspaces.create_workspace_with_origin_and_creator_context(
                &path,
                origin,
                Some(creator_context),
            )
        })
        .await?
        .map_err(WorkspaceOptionsError::Create)?;
        Ok(resolution.workspace)
    }

    async fn create_worktree_workspace(
        &self,
        repository: &RepoRootRecord,
        validated: &ValidatedWorkspaceCreation,
        input: &CreateWorkspaceFromOptionsInput,
    ) -> Result<WorkspaceRecord, WorkspaceOptionsError> {
        let branch = validated
            .branch
            .as_deref()
            .expect("validated worktree branch");
        let workspaces = self.workspaces.clone();
        let repository_id = repository.id.clone();
        let branch_for_path = branch.to_string();
        let target_path = tokio::task::spawn_blocking(move || {
            workspaces.default_worktree_destination_path(&repository_id, &branch_for_path)
        })
        .await?
        .map_err(WorkspaceOptionsError::Create)?;

        let parent = target_path.parent().ok_or_else(|| {
            WorkspaceOptionsError::Create(anyhow::anyhow!(
                "managed worktree destination has no parent"
            ))
        })?;
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|error| WorkspaceOptionsError::Create(error.into()))?;

        let result = self
            .worktrees
            .create_worktree(CreateWorktreeWorkflowInput {
                repo_root_id: repository.id.clone(),
                target_path: target_path.to_string_lossy().to_string(),
                new_branch_name: branch.to_string(),
                base_branch: repository.default_branch.clone(),
                checkout_mode: WorktreeCheckoutMode::NewBranch,
                setup_script: None,
                surface: "standard".to_string(),
                // `branch` is an explicit caller token. The workspace owner
                // must either create that exact branch/path pair or return a
                // conflict; generated-name suffixing is not valid here.
                name_conflict_policy: WorktreeNameConflictPolicy::Fail,
                origin: input.origin.clone(),
                creator_context: Some(input.creator_context.clone()),
            })
            .await
            .map_err(|error| match error {
                CreateWorktreeWorkflowError::NameConflict(conflict) => {
                    WorkspaceOptionsError::WorktreeConflict(conflict)
                }
                error => WorkspaceOptionsError::WorktreeCreate(error),
            })?;
        Ok(result.worktree.workspace)
    }
}

fn build_workspace_options(
    repo_roots: &RepoRootService,
) -> Result<WorkspaceCreationOptions, WorkspaceOptionsError> {
    let roots = repo_roots
        .list_repo_roots()
        .map_err(WorkspaceOptionsError::Create)?;
    let repositories = roots.into_iter().map(repository_option).collect();
    Ok(WorkspaceCreationOptions {
        repositories,
        creation_modes: vec![
            WorkspaceCreationModeOption {
                mode: WorkspaceCreationMode::Worktree,
                requires_branch: true,
                branch_must_be_absent: false,
            },
            WorkspaceCreationModeOption {
                mode: WorkspaceCreationMode::Local,
                requires_branch: false,
                branch_must_be_absent: true,
            },
        ],
    })
}

fn repository_option(root: RepoRootRecord) -> WorkspaceRepositoryOption {
    let (availability, branches) = discover_repository(&root.path);
    let name = repository_name(&root);
    let current_branch = branches
        .iter()
        .find(|branch| branch.is_head && !branch.is_remote)
        .map(|branch| branch.name.clone());
    let executable = availability.is_present();
    let unavailable_reason = availability.public_reason();
    WorkspaceRepositoryOption {
        repository_id: root.id,
        name,
        path: root.path,
        default_branch: root.default_branch,
        current_branch,
        branches,
        availability,
        executable,
        unavailable_reason,
    }
}

fn discover_repository(
    path: &str,
) -> (
    WorkspaceRepositoryAvailability,
    Vec<WorkspaceBranchMetadata>,
) {
    match std::fs::metadata(path) {
        Ok(metadata) if metadata.is_dir() => match GitService::list_branches(Path::new(path)) {
            Ok(branches) => (
                WorkspaceRepositoryAvailability::Present,
                branches.into_iter().map(Into::into).collect(),
            ),
            Err(error) => (
                WorkspaceRepositoryAvailability::Unreadable {
                    diagnostic: error.to_string(),
                },
                Vec::new(),
            ),
        },
        Ok(_) => (WorkspaceRepositoryAvailability::Missing, Vec::new()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            (WorkspaceRepositoryAvailability::Missing, Vec::new())
        }
        Err(error) => (
            WorkspaceRepositoryAvailability::Unreadable {
                diagnostic: error.to_string(),
            },
            Vec::new(),
        ),
    }
}

fn repository_name(root: &RepoRootRecord) -> String {
    root.display_name
        .clone()
        .or_else(|| root.remote_repo_name.clone())
        .or_else(|| {
            PathBuf::from(&root.path)
                .file_name()
                .and_then(|name| name.to_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| "repository".to_string())
}

mod validation;
use validation::{map_display_name_error, validate_workspace_creation};

#[cfg(test)]
#[path = "options/tests.rs"]
mod tests;
