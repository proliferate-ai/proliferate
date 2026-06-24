use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::domains::agents::portability::delete_session_agent_artifacts;
use crate::domains::sessions::attachment_storage::PromptAttachmentStorage;
use crate::domains::sessions::runtime::SessionRuntime;
use crate::domains::sessions::store::SessionStore;
use crate::domains::workspaces::checkout_gate::{CheckoutDeletionGate, CheckoutPathLockKey};
use crate::domains::workspaces::deletion::WorkspaceDeleteWorkflow;
use crate::domains::workspaces::model::{
    WorkspaceCleanupOperation, WorkspaceCleanupState, WorkspaceLifecycleState, WorkspaceRecord,
};
use crate::domains::workspaces::operation_gate::WorkspaceOperationGate;
use crate::domains::workspaces::retire_preflight::{RetirePreflightChecker, RetirePreflightMode};
use crate::domains::workspaces::runtime::WorkspaceRuntime;

#[derive(Debug)]
pub enum WorkspacePurgeServiceOutcome {
    Deleted {
        already_deleted: bool,
        cleanup_attempted: bool,
    },
    Blocked {
        workspace: WorkspaceRecord,
        message: String,
    },
    CleanupFailed {
        workspace: WorkspaceRecord,
        message: String,
    },
}

#[derive(Clone)]
pub struct WorkspacePurgeService {
    workspace_runtime: Arc<WorkspaceRuntime>,
    session_runtime: Arc<SessionRuntime>,
    delete_workflow: WorkspaceDeleteWorkflow,
    session_store: SessionStore,
    attachment_storage: PromptAttachmentStorage,
    operation_gate: Arc<WorkspaceOperationGate>,
    checkout_gate: Arc<CheckoutDeletionGate>,
    preflight_checker: Arc<RetirePreflightChecker>,
    runtime_home: PathBuf,
}

impl WorkspacePurgeService {
    pub fn new(
        workspace_runtime: Arc<WorkspaceRuntime>,
        session_runtime: Arc<SessionRuntime>,
        delete_workflow: WorkspaceDeleteWorkflow,
        session_store: SessionStore,
        attachment_storage: PromptAttachmentStorage,
        operation_gate: Arc<WorkspaceOperationGate>,
        checkout_gate: Arc<CheckoutDeletionGate>,
        preflight_checker: Arc<RetirePreflightChecker>,
        runtime_home: PathBuf,
    ) -> Self {
        Self {
            workspace_runtime,
            session_runtime,
            delete_workflow,
            session_store,
            attachment_storage,
            operation_gate,
            checkout_gate,
            preflight_checker,
            runtime_home,
        }
    }

    pub async fn purge(
        &self,
        workspace_id: &str,
        retry_only: bool,
    ) -> anyhow::Result<WorkspacePurgeServiceOutcome> {
        let _workspace_lease = self.operation_gate.acquire_exclusive(workspace_id).await;
        let Some(workspace) = self.workspace_runtime.get_workspace(workspace_id)? else {
            return Ok(WorkspacePurgeServiceOutcome::Deleted {
                already_deleted: true,
                cleanup_attempted: false,
            });
        };
        if retry_only && !is_retryable_purge(&workspace) {
            return Ok(WorkspacePurgeServiceOutcome::Blocked {
                workspace,
                message: "purge retry is only available for pending or failed purge tombstones"
                    .to_string(),
            });
        }
        self.session_runtime
            .force_retire_workspace_live_sessions_for_purge(workspace_id)
            .await?;
        let preflight = self
            .preflight_checker
            .check_workspace(workspace.clone(), RetirePreflightMode::Purge)
            .await?;
        // HTTP preflight is advisory for response shape; this under-lease pass
        // is the authoritative race-sensitive safety check.
        if !preflight.can_purge {
            return Ok(WorkspacePurgeServiceOutcome::Blocked {
                workspace,
                message: display_preflight_message(&preflight.blockers),
            });
        }
        let Some(_path_lease) = self.acquire_checkout_lease(&workspace) else {
            return Ok(WorkspacePurgeServiceOutcome::Blocked {
                workspace,
                message: "checkout deletion is already in progress for this path".to_string(),
            });
        };

        let attempted_at = chrono::Utc::now().to_rfc3339();
        let pending = if workspace.lifecycle_state == WorkspaceLifecycleState::Active {
            self.workspace_runtime
                .set_lifecycle_cleanup_state(
                    workspace_id,
                    WorkspaceLifecycleState::Retired,
                    WorkspaceCleanupState::Pending,
                    Some(WorkspaceCleanupOperation::Purge),
                    None,
                    None,
                    Some(&attempted_at),
                )?
                .unwrap_or(workspace)
        } else {
            workspace
        };

        let materialization = {
            let runtime = self.workspace_runtime.clone();
            let workspace = pending.clone();
            tokio::task::spawn_blocking(move || runtime.retire_worktree_materialization(&workspace))
                .await
                .map_err(|error| anyhow::anyhow!("purge checkout cleanup task failed: {error}"))?
        };
        if let Err(error) = materialization {
            return self.cleanup_failed(workspace_id, &pending, &attempted_at, error);
        }

        let sessions = self.session_store.list_by_workspace(workspace_id)?;
        let session_ids = sessions
            .iter()
            .map(|session| session.id.clone())
            .collect::<Vec<_>>();
        let artifact_cleanup = {
            let workspace_path = pending.path.clone();
            let runtime_home = self.runtime_home.clone();
            tokio::task::spawn_blocking(move || {
                for session in sessions {
                    delete_session_agent_artifacts(
                        &session,
                        Path::new(&workspace_path),
                        Some(&runtime_home),
                    )?;
                }
                anyhow::Ok(())
            })
            .await
            .map_err(|error| anyhow::anyhow!("purge artifact cleanup task failed: {error}"))?
        };
        if let Err(error) = artifact_cleanup {
            return self.cleanup_failed(workspace_id, &pending, &attempted_at, error);
        }

        if let Err(error) = self
            .delete_workflow
            .purge_workspace_with_sessions(workspace_id)
        {
            return self.cleanup_failed(workspace_id, &pending, &attempted_at, error);
        }

        for session_id in session_ids {
            if let Err(error) = self.attachment_storage.delete_session_dir(&session_id) {
                tracing::warn!(
                    workspace_id,
                    session_id,
                    error = %error,
                    "workspace purge left prompt attachment files behind after durable cleanup"
                );
            }
        }

        Ok(WorkspacePurgeServiceOutcome::Deleted {
            already_deleted: false,
            cleanup_attempted: true,
        })
    }

    fn acquire_checkout_lease(
        &self,
        workspace: &WorkspaceRecord,
    ) -> Option<crate::domains::workspaces::checkout_gate::CheckoutDeletionLease> {
        let path = Path::new(&workspace.path);
        let key = match std::fs::canonicalize(path) {
            Ok(canonical) => CheckoutPathLockKey::Canonical(canonical),
            Err(_) => CheckoutPathLockKey::StoredNormalized(workspace.path.clone()),
        };
        self.checkout_gate.try_acquire(key)
    }

    fn cleanup_failed(
        &self,
        workspace_id: &str,
        prior: &WorkspaceRecord,
        attempted_at: &str,
        error: anyhow::Error,
    ) -> anyhow::Result<WorkspacePurgeServiceOutcome> {
        let message = error.to_string();
        let failed_at = chrono::Utc::now().to_rfc3339();
        match self.workspace_runtime.set_lifecycle_cleanup_state(
            workspace_id,
            WorkspaceLifecycleState::Retired,
            WorkspaceCleanupState::Failed,
            Some(WorkspaceCleanupOperation::Purge),
            Some(&message),
            Some(&failed_at),
            Some(attempted_at),
        ) {
            Ok(Some(workspace)) => {
                Ok(WorkspacePurgeServiceOutcome::CleanupFailed { workspace, message })
            }
            Ok(None) => Ok(WorkspacePurgeServiceOutcome::CleanupFailed {
                workspace: prior.clone(),
                message,
            }),
            Err(update_error) => {
                tracing::error!(
                    workspace_id,
                    prior_lifecycle_state = %prior.lifecycle_state,
                    prior_cleanup_state = %prior.cleanup_state,
                    prior_cleanup_operation = ?prior.cleanup_operation,
                    purge_error = %message,
                    update_error = %update_error,
                    "failed to record purge cleanup failure state"
                );
                Ok(WorkspacePurgeServiceOutcome::CleanupFailed {
                    workspace: prior.clone(),
                    message,
                })
            }
        }
    }
}

fn is_retryable_purge(workspace: &WorkspaceRecord) -> bool {
    workspace.lifecycle_state == WorkspaceLifecycleState::Retired
        && matches!(
            workspace.cleanup_state,
            WorkspaceCleanupState::Pending | WorkspaceCleanupState::Failed
        )
        && workspace.cleanup_operation == Some(WorkspaceCleanupOperation::Purge)
}

fn display_preflight_message(
    blockers: &[anyharness_contract::v1::WorkspaceRetireBlocker],
) -> String {
    blockers
        .first()
        .map(|blocker| blocker.message.clone())
        .unwrap_or_else(|| "workspace is not ready to delete".to_string())
}
