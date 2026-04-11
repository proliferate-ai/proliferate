use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::Mutex;
use uuid::Uuid;

use super::bootstrap;
use crate::api::http::latency::LatencyRequestContext;
use crate::sessions::model::{SessionPermissionPolicy, SessionRecord};
use crate::sessions::runtime::{CreateAndStartSessionError, SessionRuntime};
use crate::sessions::service::SessionService;
use crate::workspaces::model::WorkspaceRecord;
use crate::workspaces::resolver;
use crate::workspaces::service::WorkspaceService;

#[derive(Clone)]
pub struct CoworkOrchestrator {
    runtime_home: PathBuf,
    workspace_service: Arc<WorkspaceService>,
    session_service: Arc<SessionService>,
    session_runtime: Arc<SessionRuntime>,
    bootstrap_lock: Arc<Mutex<()>>,
}

pub struct CoworkWorkspaceCreation {
    pub workspace: WorkspaceRecord,
    pub session: SessionRecord,
}

#[derive(Debug)]
pub enum CoworkCreateWorkspaceError {
    UnsupportedAgent(String),
    Workspace(anyhow::Error),
    Session(CreateAndStartSessionError),
}

#[derive(Debug)]
pub enum CoworkReplaceDefaultSessionError {
    UnsupportedAgent(String),
    Workspace(anyhow::Error),
    Session(CreateAndStartSessionError),
    SessionLifecycle(anyhow::Error),
}

impl CoworkOrchestrator {
    pub fn new(
        runtime_home: PathBuf,
        workspace_service: Arc<WorkspaceService>,
        session_service: Arc<SessionService>,
        session_runtime: Arc<SessionRuntime>,
    ) -> Self {
        Self {
            runtime_home,
            workspace_service,
            session_service,
            session_runtime,
            bootstrap_lock: Arc::new(Mutex::new(())),
        }
    }

    pub async fn create_workspace(
        &self,
        agent_kind: &str,
        model_id: Option<&str>,
        latency: Option<&LatencyRequestContext>,
    ) -> Result<CoworkWorkspaceCreation, CoworkCreateWorkspaceError> {
        let Some(mode_id) = cowork_mode_for_agent(agent_kind) else {
            return Err(CoworkCreateWorkspaceError::UnsupportedAgent(
                agent_kind.to_string(),
            ));
        };

        let backing_repo = self
            .ensure_backing_repo_workspace()
            .await
            .map_err(CoworkCreateWorkspaceError::Workspace)?;

        let workspace_id = Uuid::new_v4().to_string();
        let branch_name = format!("cowork/{workspace_id}");
        let target_path = bootstrap::worktrees_root(&self.runtime_home).join(&workspace_id);
        let target_path_string = target_path.to_string_lossy().into_owned();

        let workspace = match self
            .create_worktree_workspace(
                &backing_repo.id,
                &workspace_id,
                &target_path_string,
                &branch_name,
            )
            .await
        {
            Ok(workspace) => workspace,
            Err(error) => {
                self.cleanup_failed_workspace(
                    &workspace_id,
                    &backing_repo.path,
                    &target_path_string,
                    &branch_name,
                )
                .await;
                return Err(CoworkCreateWorkspaceError::Workspace(error));
            }
        };

        let session = match self
            .session_runtime
            .create_and_start_session(
                &workspace.id,
                agent_kind,
                model_id,
                Some(mode_id),
                true,
                SessionPermissionPolicy::FailOnRequest,
                None,
                Vec::new(),
                latency,
            )
            .await
        {
            Ok(session) => session,
            Err(error) => {
                self.cleanup_failed_workspace(
                    &workspace.id,
                    &backing_repo.path,
                    &workspace.path,
                    &branch_name,
                )
                .await;
                return Err(CoworkCreateWorkspaceError::Session(error));
            }
        };

        let updated_workspace = self
            .update_default_session_id(&workspace.id, &session.id)
            .await;
        let updated_workspace = match updated_workspace {
            Ok(updated_workspace) => updated_workspace,
            Err(error) => {
                self.retire_session_best_effort(
                    &session.id,
                    "failed to finalize cowork workspace creation",
                )
                .await;
                self.cleanup_failed_workspace(
                    &workspace.id,
                    &backing_repo.path,
                    &workspace.path,
                    &branch_name,
                )
                .await;
                return Err(CoworkCreateWorkspaceError::Workspace(error));
            }
        };

        Ok(CoworkWorkspaceCreation {
            workspace: updated_workspace,
            session,
        })
    }

    pub async fn replace_default_session(
        &self,
        workspace_id: &str,
        agent_kind: &str,
        model_id: Option<&str>,
        latency: Option<&LatencyRequestContext>,
    ) -> Result<CoworkWorkspaceCreation, CoworkReplaceDefaultSessionError> {
        let Some(mode_id) = cowork_mode_for_agent(agent_kind) else {
            return Err(CoworkReplaceDefaultSessionError::UnsupportedAgent(
                agent_kind.to_string(),
            ));
        };

        let workspace = self
            .workspace_service
            .get_workspace(workspace_id)
            .map_err(CoworkReplaceDefaultSessionError::Workspace)?
            .ok_or_else(|| {
                CoworkReplaceDefaultSessionError::Workspace(anyhow::anyhow!(
                    "workspace not found: {workspace_id}"
                ))
            })?;

        if workspace.surface_kind != "cowork" || workspace.is_internal {
            return Err(CoworkReplaceDefaultSessionError::Workspace(
                anyhow::anyhow!("workspace is not a visible cowork workspace: {workspace_id}"),
            ));
        }

        let previous_default_session_id = workspace.default_session_id.clone();
        let replacement = self
            .session_runtime
            .create_and_start_session(
                &workspace.id,
                agent_kind,
                model_id,
                Some(mode_id),
                true,
                SessionPermissionPolicy::FailOnRequest,
                None,
                Vec::new(),
                latency,
            )
            .await
            .map_err(CoworkReplaceDefaultSessionError::Session)?;

        let updated_workspace = match self
            .update_default_session_id(&workspace.id, &replacement.id)
            .await
        {
            Ok(updated_workspace) => updated_workspace,
            Err(error) => {
                self.retire_session_best_effort(
                    &replacement.id,
                    "failed to update cowork default session",
                )
                .await;
                return Err(CoworkReplaceDefaultSessionError::Workspace(error));
            }
        };

        if let Some(previous_session_id) = previous_default_session_id {
            if previous_session_id != replacement.id {
                self.retire_session_best_effort(
                    &previous_session_id,
                    "failed to retire previous cowork default session",
                )
                .await;
            }
        }

        Ok(CoworkWorkspaceCreation {
            workspace: updated_workspace,
            session: replacement,
        })
    }

    async fn ensure_backing_repo_workspace(&self) -> anyhow::Result<WorkspaceRecord> {
        if let Some(existing) = self
            .workspace_service
            .get_internal_repo_workspace("cowork")?
        {
            return Ok(existing);
        }

        let _guard = self.bootstrap_lock.lock().await;
        if let Some(existing) = self
            .workspace_service
            .get_internal_repo_workspace("cowork")?
        {
            return Ok(existing);
        }

        let runtime_home = self.runtime_home.clone();
        let repo_root =
            tokio::task::spawn_blocking(move || bootstrap::ensure_backing_repo(&runtime_home))
                .await
                .map_err(|error| anyhow::anyhow!("cowork bootstrap task failed: {error}"))??;
        let repo_root_string = repo_root.to_string_lossy().into_owned();
        let workspace_service = self.workspace_service.clone();

        tokio::task::spawn_blocking(move || {
            workspace_service.register_managed_repo(&repo_root_string, "cowork", true)
        })
        .await
        .map_err(|error| anyhow::anyhow!("cowork repo registration task failed: {error}"))?
    }

    async fn create_worktree_workspace(
        &self,
        source_workspace_id: &str,
        workspace_id: &str,
        target_path: &str,
        branch_name: &str,
    ) -> anyhow::Result<WorkspaceRecord> {
        let workspace_service = self.workspace_service.clone();
        let source_workspace_id = source_workspace_id.to_string();
        let workspace_id = workspace_id.to_string();
        let target_path = target_path.to_string();
        let branch_name = branch_name.to_string();

        tokio::task::spawn_blocking(move || {
            workspace_service
                .create_worktree_with_id(
                    &source_workspace_id,
                    &target_path,
                    &branch_name,
                    None,
                    None,
                    Some(&workspace_id),
                )
                .map(|result| result.workspace)
        })
        .await
        .map_err(|error| anyhow::anyhow!("cowork worktree task failed: {error}"))?
    }

    async fn update_default_session_id(
        &self,
        workspace_id: &str,
        session_id: &str,
    ) -> anyhow::Result<WorkspaceRecord> {
        let workspace_service = self.workspace_service.clone();
        let workspace_id = workspace_id.to_string();
        let session_id = session_id.to_string();

        tokio::task::spawn_blocking(move || {
            workspace_service.update_default_session_id(&workspace_id, Some(&session_id))
        })
        .await
        .map_err(|error| anyhow::anyhow!("default-session update task failed: {error}"))?
    }

    async fn cleanup_failed_workspace(
        &self,
        workspace_id: &str,
        repo_path: &str,
        worktree_path: &str,
        branch_name: &str,
    ) {
        if let Err(error) = self
            .session_service
            .delete_sessions_by_workspace(workspace_id)
        {
            tracing::warn!(workspace_id = %workspace_id, error = %error, "failed to clean up cowork sessions");
        }

        if let Err(error) = self.workspace_service.delete_workspace(workspace_id) {
            tracing::warn!(workspace_id = %workspace_id, error = %error, "failed to clean up cowork workspace row");
        }

        if let Err(error) = resolver::remove_git_worktree(repo_path, worktree_path) {
            tracing::warn!(workspace_id = %workspace_id, worktree_path = %worktree_path, error = %error, "failed to clean up cowork worktree");
        }

        if let Err(error) = resolver::delete_git_branch(repo_path, branch_name) {
            tracing::warn!(workspace_id = %workspace_id, branch_name = %branch_name, error = %error, "failed to clean up cowork branch");
        }
    }

    async fn retire_session_best_effort(&self, session_id: &str, context: &str) {
        if let Err(error) = self.session_runtime.close_live_session(session_id).await {
            tracing::warn!(
                session_id = %session_id,
                error = ?error,
                "{context}"
            );
        }
        if let Err(error) = self.session_runtime.dismiss_live_session(session_id).await {
            tracing::warn!(
                session_id = %session_id,
                error = ?error,
                "{context}"
            );
        }
    }
}

pub fn cowork_mode_for_agent(agent_kind: &str) -> Option<&'static str> {
    match agent_kind {
        "claude" => Some("bypassPermissions"),
        "codex" => Some("full-access"),
        "gemini" => Some("yolo"),
        _ => None,
    }
}
