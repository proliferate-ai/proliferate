use std::sync::Arc;

use anyharness_contract::v1::{
    WorkspaceCleanupOperation, WorkspaceCleanupState, WorkspaceKind, WorkspaceLifecycleState,
    WorkspaceRetireBlocker, WorkspaceRetireBlockerCode, WorkspaceRetireBlockerSeverity,
};

use crate::sessions::runtime::SessionRuntime;
use crate::sessions::service::SessionService;
use crate::terminals::model::TerminalStatus;
use crate::terminals::TerminalService;
use crate::workspaces::access_gate::{WorkspaceAccessError, WorkspaceAccessGate};
use crate::workspaces::model::WorkspaceRecord;
use crate::workspaces::operation_gate::{WorkspaceOperationGate, WorkspaceOperationKind};
use crate::workspaces::runtime::WorkspaceRuntime;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetirePreflightMode {
    ActiveRetire,
    RetiredCleanupRetry,
    Purge,
}

#[derive(Debug, Clone)]
pub struct RetirePreflightResult {
    pub workspace: WorkspaceRecord,
    pub workspace_kind: WorkspaceKind,
    pub lifecycle_state: WorkspaceLifecycleState,
    pub cleanup_state: WorkspaceCleanupState,
    pub cleanup_operation: Option<WorkspaceCleanupOperation>,
    pub can_retire: bool,
    pub can_purge: bool,
    pub materialized: bool,
    pub merged_into_base: bool,
    pub base_ref: Option<String>,
    pub base_oid: Option<String>,
    pub head_oid: Option<String>,
    pub head_matches_base: bool,
    pub readiness_fingerprint: String,
    pub blockers: Vec<WorkspaceRetireBlocker>,
}

#[derive(Clone)]
pub struct RetirePreflightChecker {
    workspace_runtime: Arc<WorkspaceRuntime>,
    workspace_access_gate: Arc<WorkspaceAccessGate>,
    workspace_operation_gate: Arc<WorkspaceOperationGate>,
    session_runtime: Arc<SessionRuntime>,
    session_service: Arc<SessionService>,
    terminal_service: Arc<TerminalService>,
}

impl RetirePreflightChecker {
    pub fn new(
        workspace_runtime: Arc<WorkspaceRuntime>,
        workspace_access_gate: Arc<WorkspaceAccessGate>,
        workspace_operation_gate: Arc<WorkspaceOperationGate>,
        session_runtime: Arc<SessionRuntime>,
        session_service: Arc<SessionService>,
        terminal_service: Arc<TerminalService>,
    ) -> Self {
        Self {
            workspace_runtime,
            workspace_access_gate,
            workspace_operation_gate,
            session_runtime,
            session_service,
            terminal_service,
        }
    }

    pub async fn check_by_id(
        &self,
        workspace_id: &str,
        mode: RetirePreflightMode,
    ) -> anyhow::Result<RetirePreflightResult> {
        let workspace = self
            .workspace_runtime
            .get_workspace(workspace_id)?
            .ok_or_else(|| anyhow::anyhow!("Workspace not found"))?;
        self.check_workspace(workspace, mode).await
    }

    pub async fn check_workspace(
        &self,
        workspace: WorkspaceRecord,
        mode: RetirePreflightMode,
    ) -> anyhow::Result<RetirePreflightResult> {
        let mut blockers = Vec::new();
        let materialized = std::path::Path::new(&workspace.path).exists();
        let mut head_oid = None;
        let mut base_ref = None;
        let mut base_oid = None;
        let mut head_matches_base = false;
        let mut merged_into_base = false;

        if workspace.kind != "worktree"
            || (mode == RetirePreflightMode::Purge && workspace.surface != "standard")
        {
            let message = if mode == RetirePreflightMode::Purge {
                "Purge is only available for standard worktree workspaces."
            } else {
                "Only worktree workspaces can be marked done."
            };
            blockers.push(retire_blocker(
                WorkspaceRetireBlockerCode::UnsupportedWorkspace,
                message,
            ));
        }

        match mode {
            RetirePreflightMode::ActiveRetire => {
                if workspace.lifecycle_state != "active" {
                    blockers.push(retire_blocker(
                        WorkspaceRetireBlockerCode::WorkspaceAccessBlocked,
                        "Workspace is not active.",
                    ));
                }
                if let Err(error) = self
                    .workspace_access_gate
                    .assert_can_mutate_for_workspace(&workspace.id)
                {
                    blockers.push(workspace_access_retire_blocker(error));
                }
            }
            RetirePreflightMode::RetiredCleanupRetry => {
                if workspace.lifecycle_state != "retired" {
                    blockers.push(retire_blocker(
                        WorkspaceRetireBlockerCode::WorkspaceAccessBlocked,
                        "Cleanup retry requires a retired workspace.",
                    ));
                }
                if !matches!(workspace.cleanup_state.as_str(), "pending" | "failed") {
                    blockers.push(retire_blocker(
                        WorkspaceRetireBlockerCode::WorkspaceAccessBlocked,
                        "Cleanup retry requires pending or failed cleanup state.",
                    ));
                }
                if workspace.cleanup_operation.as_deref() == Some("purge") {
                    blockers.push(retire_blocker(
                        WorkspaceRetireBlockerCode::WorkspaceAccessBlocked,
                        "Workspace is in purge cleanup state.",
                    ));
                }
            }
            RetirePreflightMode::Purge => {
                if workspace.lifecycle_state == "active" {
                    if let Err(error) = self
                        .workspace_access_gate
                        .assert_can_mutate_for_workspace(&workspace.id)
                    {
                        blockers.push(workspace_access_retire_blocker(error));
                    }
                } else if !purge_lifecycle_allows(&workspace) {
                    blockers.push(retire_blocker(
                        WorkspaceRetireBlockerCode::WorkspaceAccessBlocked,
                        "Purge requires an active workspace or retired purge-ready workspace.",
                    ));
                }
            }
        }

        if let Some(active) = self
            .workspace_runtime
            .find_active_workspace_by_path_excluding_id(&workspace.path, &workspace.id)?
        {
            blockers.push(active_path_owner_retire_blocker(&active));
        }

        if workspace.kind == "worktree" && materialized {
            let workspace_id_for_task = workspace.id.clone();
            let workspace_path = workspace.path.clone();
            let status = tokio::task::spawn_blocking(move || {
                crate::git::GitService::status(
                    &workspace_id_for_task,
                    std::path::Path::new(&workspace_path),
                )
            })
            .await
            .map_err(|error| anyhow::anyhow!("retire git status task failed: {error}"))??;
            head_oid = Some(status.head_oid.clone());
            if mode != RetirePreflightMode::Purge && !status.clean {
                blockers.push(retire_blocker(
                    WorkspaceRetireBlockerCode::DirtyWorkingTree,
                    "Working tree has uncommitted changes.",
                ));
            }
            if mode != RetirePreflightMode::Purge && status.conflicted {
                blockers.push(WorkspaceRetireBlocker {
                    code: WorkspaceRetireBlockerCode::ConflictedFiles,
                    message: "Working tree has conflicted files.".to_string(),
                    severity: WorkspaceRetireBlockerSeverity::Blocking,
                    retryable: true,
                    session_id: None,
                    terminal_id: None,
                    command_run_id: None,
                    path: None,
                    paths: None,
                    operation: None,
                });
            }
            if mode != RetirePreflightMode::Purge
                && status.operation != crate::git::types::GitOperation::None
            {
                blockers.push(WorkspaceRetireBlocker {
                    code: WorkspaceRetireBlockerCode::ActiveGitOperation,
                    message: "A git operation is still in progress.".to_string(),
                    severity: WorkspaceRetireBlockerSeverity::Blocking,
                    retryable: true,
                    session_id: None,
                    terminal_id: None,
                    command_run_id: None,
                    path: None,
                    paths: None,
                    operation: Some(git_operation_to_contract(status.operation.clone())),
                });
            }
            if mode == RetirePreflightMode::ActiveRetire {
                if let Some(default_branch) = status.suggested_base_branch.as_deref() {
                    let remote_ref = format!("origin/{default_branch}");
                    let workspace_path = workspace.path.clone();
                    let remote_merged = tokio::task::spawn_blocking({
                        let remote_ref = remote_ref.clone();
                        let workspace_path = workspace_path.clone();
                        move || {
                            crate::git::GitService::head_is_ancestor_of(
                                std::path::Path::new(&workspace_path),
                                &remote_ref,
                            )
                        }
                    })
                    .await
                    .map_err(|error| anyhow::anyhow!("retire merged check task failed: {error}"))?
                    .unwrap_or(false);
                    if remote_merged {
                        base_ref = Some(remote_ref);
                        merged_into_base = true;
                    } else {
                        let local_ref = default_branch.to_string();
                        let workspace_path = workspace.path.clone();
                        merged_into_base = tokio::task::spawn_blocking({
                            let local_ref = local_ref.clone();
                            move || {
                                crate::git::GitService::head_is_ancestor_of(
                                    std::path::Path::new(&workspace_path),
                                    &local_ref,
                                )
                            }
                        })
                        .await
                        .map_err(|error| {
                            anyhow::anyhow!("retire merged check task failed: {error}")
                        })?
                        .unwrap_or(false);
                        base_ref = Some(local_ref);
                    }
                }
                if let (Some(base), Some(head)) = (base_ref.as_deref(), head_oid.as_deref()) {
                    let workspace_path = workspace.path.clone();
                    base_oid = tokio::task::spawn_blocking({
                        let base = base.to_string();
                        move || {
                            crate::git::GitService::resolve_ref_oid(
                                std::path::Path::new(&workspace_path),
                                &base,
                            )
                        }
                    })
                    .await
                    .map_err(|error| anyhow::anyhow!("retire base oid task failed: {error}"))?
                    .ok();
                    head_matches_base = base_oid.as_deref() == Some(head);
                }
            }
        }

        if mode == RetirePreflightMode::ActiveRetire
            || (mode == RetirePreflightMode::Purge && workspace.lifecycle_state == "active")
        {
            self.add_live_execution_blockers(&workspace.id, &mut blockers)
                .await?;
        }
        self.add_operation_blockers(&workspace.id, &mut blockers)
            .await?;

        let can_retire = blockers.is_empty()
            && workspace.kind == "worktree"
            && match mode {
                RetirePreflightMode::ActiveRetire => workspace.lifecycle_state == "active",
                RetirePreflightMode::RetiredCleanupRetry => workspace.lifecycle_state == "retired",
                RetirePreflightMode::Purge => false,
            };
        let can_purge = blockers.is_empty() && workspace_can_purge(&workspace);
        let readiness_fingerprint = format!(
            "v1:{}:{}:{}:{}:{}:{}:{}:{}:{}:{}",
            workspace.id,
            workspace.lifecycle_state,
            workspace.cleanup_state,
            materialized,
            head_oid.as_deref().unwrap_or(""),
            base_ref.as_deref().unwrap_or(""),
            base_oid.as_deref().unwrap_or(""),
            merged_into_base,
            head_matches_base,
            blockers
                .iter()
                .map(|blocker| format!("{:?}", blocker.code))
                .collect::<Vec<_>>()
                .join(",")
        );

        Ok(RetirePreflightResult {
            workspace_kind: workspace_kind_to_contract(&workspace.kind),
            lifecycle_state: workspace_lifecycle_to_contract(&workspace.lifecycle_state),
            cleanup_state: workspace_cleanup_to_contract(&workspace.cleanup_state),
            cleanup_operation: workspace_cleanup_operation_to_contract(
                workspace.cleanup_operation.as_deref(),
            ),
            can_retire,
            can_purge,
            materialized,
            merged_into_base,
            base_ref,
            base_oid,
            head_oid,
            head_matches_base,
            readiness_fingerprint,
            blockers,
            workspace,
        })
    }

    async fn add_live_execution_blockers(
        &self,
        workspace_id: &str,
        blockers: &mut Vec<WorkspaceRetireBlocker>,
    ) -> anyhow::Result<()> {
        let execution_summary = self
            .session_runtime
            .workspace_execution_summary(workspace_id)
            .await?;
        if execution_summary.running_count > 0 || execution_summary.live_session_count > 0 {
            blockers.push(retire_blocker(
                WorkspaceRetireBlockerCode::LiveSession,
                "A live session is still running.",
            ));
        }
        if execution_summary.awaiting_interaction_count > 0 {
            blockers.push(retire_blocker(
                WorkspaceRetireBlockerCode::PendingInteraction,
                "A session is waiting for interaction.",
            ));
        }

        let sessions = self
            .session_service
            .list_sessions(Some(workspace_id), true)?;
        for session in sessions {
            let prompts = self
                .session_service
                .store()
                .list_pending_prompts(&session.id)?;
            if !prompts.is_empty() {
                blockers.push(WorkspaceRetireBlocker {
                    code: WorkspaceRetireBlockerCode::PendingPrompt,
                    message: "A session has queued prompts.".to_string(),
                    severity: WorkspaceRetireBlockerSeverity::Blocking,
                    retryable: true,
                    session_id: Some(session.id),
                    terminal_id: None,
                    command_run_id: None,
                    path: None,
                    paths: None,
                    operation: None,
                });
                break;
            }
        }

        let terminals = self.terminal_service.list_terminals(workspace_id).await;
        if let Some(terminal) = terminals.iter().find(|terminal| {
            matches!(
                terminal.status,
                TerminalStatus::Starting | TerminalStatus::Running
            )
        }) {
            blockers.push(WorkspaceRetireBlocker {
                code: WorkspaceRetireBlockerCode::ActiveTerminal,
                message: "A terminal is still active.".to_string(),
                severity: WorkspaceRetireBlockerSeverity::Blocking,
                retryable: true,
                session_id: None,
                terminal_id: Some(terminal.id.clone()),
                command_run_id: None,
                path: None,
                paths: None,
                operation: None,
            });
        }
        Ok(())
    }

    async fn add_operation_blockers(
        &self,
        workspace_id: &str,
        blockers: &mut Vec<WorkspaceRetireBlocker>,
    ) -> anyhow::Result<()> {
        let operation_snapshot = self.workspace_operation_gate.snapshot(workspace_id).await;
        let has_running_command_holder = operation_snapshot.has_any(&[
            WorkspaceOperationKind::MaterializationRead,
            WorkspaceOperationKind::FileWrite,
            WorkspaceOperationKind::GitWrite,
            WorkspaceOperationKind::ProcessRun,
            WorkspaceOperationKind::TerminalCommand,
            WorkspaceOperationKind::SessionStart,
            WorkspaceOperationKind::SessionPrompt,
            WorkspaceOperationKind::SessionResume,
            WorkspaceOperationKind::SetupCommand,
            WorkspaceOperationKind::HostingWrite,
            WorkspaceOperationKind::PlanWrite,
            WorkspaceOperationKind::ReviewWrite,
            WorkspaceOperationKind::CoworkWrite,
            WorkspaceOperationKind::SubagentWrite,
            WorkspaceOperationKind::MobilityWrite,
        ]);
        let active_runs = self
            .terminal_service
            .active_command_runs_for_workspace(workspace_id)?;
        if has_running_command_holder || !active_runs.is_empty() {
            let command_run = active_runs.first();
            blockers.push(WorkspaceRetireBlocker {
                code: WorkspaceRetireBlockerCode::RunningCommand,
                message: "Workspace work is still in progress.".to_string(),
                severity: WorkspaceRetireBlockerSeverity::Blocking,
                retryable: true,
                session_id: None,
                terminal_id: command_run.and_then(|run| run.terminal_id.clone()),
                command_run_id: command_run.map(|run| run.id.clone()),
                path: None,
                paths: None,
                operation: None,
            });
        }
        Ok(())
    }
}

pub fn workspace_can_purge(workspace: &WorkspaceRecord) -> bool {
    workspace.kind == "worktree"
        && workspace.surface == "standard"
        && purge_lifecycle_allows(workspace)
}

fn purge_lifecycle_allows(workspace: &WorkspaceRecord) -> bool {
    workspace.lifecycle_state == "active"
        || workspace.cleanup_operation.as_deref() == Some("purge")
        || workspace.cleanup_state == "complete"
}

pub fn retire_blocker(code: WorkspaceRetireBlockerCode, message: &str) -> WorkspaceRetireBlocker {
    WorkspaceRetireBlocker {
        code,
        message: message.to_string(),
        severity: WorkspaceRetireBlockerSeverity::Blocking,
        retryable: true,
        session_id: None,
        terminal_id: None,
        command_run_id: None,
        path: None,
        paths: None,
        operation: None,
    }
}

pub fn active_path_owner_retire_blocker(active: &WorkspaceRecord) -> WorkspaceRetireBlocker {
    WorkspaceRetireBlocker {
        code: WorkspaceRetireBlockerCode::WorkspaceAccessBlocked,
        message: format!(
            "Another active workspace ({}) owns checkout path {}.",
            active.id, active.path
        ),
        severity: WorkspaceRetireBlockerSeverity::Blocking,
        retryable: true,
        session_id: None,
        terminal_id: None,
        command_run_id: None,
        path: Some(active.path.clone()),
        paths: None,
        operation: None,
    }
}

pub fn workspace_access_retire_blocker(error: WorkspaceAccessError) -> WorkspaceRetireBlocker {
    let message = match error {
        WorkspaceAccessError::MutationBlocked { mode, .. } => {
            format!(
                "Workspace cannot be marked done while access mode is {}.",
                mode.as_str()
            )
        }
        WorkspaceAccessError::LiveSessionStartBlocked { mode, .. } => {
            format!(
                "Workspace cannot be marked done while access mode is {}.",
                mode.as_str()
            )
        }
        WorkspaceAccessError::WorkspaceRetired(_) => "Workspace is already retired.".to_string(),
        WorkspaceAccessError::WorkspaceNotFound(_)
        | WorkspaceAccessError::SessionNotFound(_)
        | WorkspaceAccessError::TerminalNotFound(_) => {
            "Workspace access state could not be verified.".to_string()
        }
    };
    WorkspaceRetireBlocker {
        message,
        ..retire_blocker(
            WorkspaceRetireBlockerCode::WorkspaceAccessBlocked,
            "Workspace access is blocked.",
        )
    }
}

fn git_operation_to_contract(
    operation: crate::git::types::GitOperation,
) -> anyharness_contract::v1::git::GitOperation {
    match operation {
        crate::git::types::GitOperation::Merge => anyharness_contract::v1::git::GitOperation::Merge,
        crate::git::types::GitOperation::Rebase => {
            anyharness_contract::v1::git::GitOperation::Rebase
        }
        crate::git::types::GitOperation::CherryPick => {
            anyharness_contract::v1::git::GitOperation::CherryPick
        }
        crate::git::types::GitOperation::Revert => {
            anyharness_contract::v1::git::GitOperation::Revert
        }
        crate::git::types::GitOperation::None => anyharness_contract::v1::git::GitOperation::None,
    }
}

fn workspace_kind_to_contract(kind: &str) -> WorkspaceKind {
    match kind {
        "worktree" => WorkspaceKind::Worktree,
        _ => WorkspaceKind::Local,
    }
}

fn workspace_lifecycle_to_contract(value: &str) -> WorkspaceLifecycleState {
    match value {
        "retired" => WorkspaceLifecycleState::Retired,
        _ => WorkspaceLifecycleState::Active,
    }
}

fn workspace_cleanup_to_contract(value: &str) -> WorkspaceCleanupState {
    match value {
        "pending" => WorkspaceCleanupState::Pending,
        "complete" => WorkspaceCleanupState::Complete,
        "failed" => WorkspaceCleanupState::Failed,
        _ => WorkspaceCleanupState::None,
    }
}

fn workspace_cleanup_operation_to_contract(
    operation: Option<&str>,
) -> Option<WorkspaceCleanupOperation> {
    match operation {
        Some("retire") => Some(WorkspaceCleanupOperation::Retire),
        Some("purge") => Some(WorkspaceCleanupOperation::Purge),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::workspace_can_purge;
    use crate::workspaces::model::WorkspaceRecord;

    #[test]
    fn workspace_can_purge_accepts_active_standard_worktree() {
        assert!(workspace_can_purge(&workspace_record(
            "worktree", "standard", "active", "none", None,
        )));
    }

    #[test]
    fn workspace_can_purge_accepts_retired_complete_or_purge_tombstone() {
        assert!(workspace_can_purge(&workspace_record(
            "worktree",
            "standard",
            "retired",
            "complete",
            Some("retire"),
        )));
        assert!(workspace_can_purge(&workspace_record(
            "worktree",
            "standard",
            "retired",
            "failed",
            Some("purge"),
        )));
    }

    #[test]
    fn workspace_can_purge_rejects_nonstandard_or_nonworktree_rows() {
        assert!(!workspace_can_purge(&workspace_record(
            "local", "standard", "active", "none", None,
        )));
        assert!(!workspace_can_purge(&workspace_record(
            "worktree", "mobility", "active", "none", None,
        )));
        assert!(!workspace_can_purge(&workspace_record(
            "worktree",
            "standard",
            "retired",
            "failed",
            Some("retire"),
        )));
    }

    fn workspace_record(
        kind: &str,
        surface: &str,
        lifecycle_state: &str,
        cleanup_state: &str,
        cleanup_operation: Option<&str>,
    ) -> WorkspaceRecord {
        WorkspaceRecord {
            id: "workspace-1".to_string(),
            kind: kind.to_string(),
            repo_root_id: None,
            path: "/tmp/workspace-1".to_string(),
            surface: surface.to_string(),
            source_repo_root_path: "/tmp/source".to_string(),
            source_workspace_id: None,
            git_provider: None,
            git_owner: None,
            git_repo_name: None,
            original_branch: Some("main".to_string()),
            current_branch: Some("main".to_string()),
            display_name: None,
            origin: None,
            creator_context: None,
            lifecycle_state: lifecycle_state.to_string(),
            cleanup_state: cleanup_state.to_string(),
            cleanup_operation: cleanup_operation.map(str::to_string),
            cleanup_error_message: None,
            cleanup_failed_at: None,
            cleanup_attempted_at: None,
            created_at: "2025-01-01T00:00:00Z".to_string(),
            updated_at: "2025-01-01T00:00:00Z".to_string(),
        }
    }
}
