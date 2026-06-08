use std::collections::BTreeMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use anyharness_contract::v1::{WorkspaceRetireBlocker, WorktreeRetentionRowOutcome};

use crate::domains::sessions::store::SessionStore;
use crate::domains::terminals::store::TerminalStore;
use crate::domains::workspaces::checkout_gate::{CheckoutDeletionGate, CheckoutPathLockKey};
use crate::domains::workspaces::managed_root::canonical_managed_worktrees_root;
use crate::domains::workspaces::model::{
    WorkspaceCleanupOperation, WorkspaceCleanupState, WorkspaceLifecycleState, WorkspaceRecord,
};
use crate::domains::workspaces::operation_gate::WorkspaceOperationGate;
use crate::domains::workspaces::retention_policy::{
    WorktreeRetentionPolicyRecord, WorktreeRetentionPolicyStore,
};
use crate::domains::workspaces::retire_preflight::{RetirePreflightChecker, RetirePreflightMode};
use crate::domains::workspaces::runtime::WorkspaceRuntime;
use crate::domains::workspaces::store::WorkspaceStore;

const RETENTION_MAX_REMOVALS_PER_PASS: usize = 20;
const RETENTION_MAX_CONSIDERED_PER_PASS: usize = 200;
const RETENTION_MAX_ATTEMPTS_PER_PASS: usize = 50;
const RETENTION_OPERATION_GATE_TIMEOUT: Duration = Duration::from_millis(150);
pub const ANYHARNESS_DEFER_STARTUP_RETENTION_ENV: &str = "ANYHARNESS_DEFER_STARTUP_RETENTION";

#[derive(Clone)]
pub struct WorkspaceRetentionService {
    workspace_runtime: Arc<WorkspaceRuntime>,
    workspace_store: WorkspaceStore,
    session_store: SessionStore,
    terminal_store: TerminalStore,
    policy_store: WorktreeRetentionPolicyStore,
    preflight_checker: Arc<RetirePreflightChecker>,
    operation_gate: Arc<WorkspaceOperationGate>,
    checkout_gate: Arc<CheckoutDeletionGate>,
    runtime_home: std::path::PathBuf,
    running: Arc<AtomicBool>,
    enabled: bool,
    defer_startup_pass: bool,
}

#[derive(Debug, Clone)]
pub struct WorktreeRetentionRunRow {
    pub workspace_id: String,
    pub path: String,
    pub repo_root_id: String,
    pub outcome: WorktreeRetentionRowOutcome,
    pub message: String,
}

#[derive(Debug, Clone)]
pub struct WorktreeRetentionRunResult {
    pub policy: WorktreeRetentionPolicyRecord,
    pub already_running: bool,
    pub considered_count: usize,
    pub attempted_count: usize,
    pub retired_count: usize,
    pub blocked_count: usize,
    pub skipped_count: usize,
    pub failed_count: usize,
    pub more_eligible_remaining: bool,
    pub rows: Vec<WorktreeRetentionRunRow>,
}

impl WorkspaceRetentionService {
    pub fn new(
        workspace_runtime: Arc<WorkspaceRuntime>,
        workspace_store: WorkspaceStore,
        session_store: SessionStore,
        terminal_store: TerminalStore,
        policy_store: WorktreeRetentionPolicyStore,
        preflight_checker: Arc<RetirePreflightChecker>,
        operation_gate: Arc<WorkspaceOperationGate>,
        checkout_gate: Arc<CheckoutDeletionGate>,
        runtime_home: std::path::PathBuf,
    ) -> Self {
        let enabled = std::env::var_os("ANYHARNESS_DISABLE_WORKTREE_RETENTION").is_none();
        let defer_startup_pass = std::env::var_os(ANYHARNESS_DEFER_STARTUP_RETENTION_ENV).is_some();
        Self {
            workspace_runtime,
            workspace_store,
            session_store,
            terminal_store,
            policy_store,
            preflight_checker,
            operation_gate,
            checkout_gate,
            runtime_home,
            running: Arc::new(AtomicBool::new(false)),
            enabled,
            defer_startup_pass,
        }
    }

    pub fn spawn_startup_pass(self: Arc<Self>) {
        if !should_spawn_startup_pass(self.enabled, self.defer_startup_pass) {
            return;
        }
        tokio::spawn(async move {
            if let Err(error) = self.run_pass(None).await {
                tracing::warn!(error = %error, "workspace retention startup pass failed");
            }
        });
    }

    pub fn spawn_post_create_pass(self: Arc<Self>, excluded_workspace_id: String) {
        if !self.enabled {
            return;
        }
        tokio::spawn(async move {
            if let Err(error) = self.run_pass(Some(excluded_workspace_id)).await {
                tracing::warn!(error = %error, "workspace retention post-create pass failed");
            }
        });
    }

    pub fn get_policy(&self) -> anyhow::Result<WorktreeRetentionPolicyRecord> {
        self.policy_store.get_policy()
    }

    pub fn update_policy(
        &self,
        max_materialized_worktrees_per_repo: u32,
    ) -> anyhow::Result<WorktreeRetentionPolicyRecord> {
        self.policy_store
            .update_policy(max_materialized_worktrees_per_repo)
    }

    pub async fn run_pass(
        &self,
        excluded_workspace_id: Option<String>,
    ) -> anyhow::Result<WorktreeRetentionRunResult> {
        let policy = self.policy_store.get_policy()?;
        if self.running.swap(true, Ordering::SeqCst) {
            return Ok(WorktreeRetentionRunResult::already_running(policy));
        }
        let _guard = RunningGuard(&self.running);
        let managed_root = canonical_managed_worktrees_root(&self.runtime_home)?;
        if !managed_root.exists() {
            return Ok(WorktreeRetentionRunResult::empty(policy));
        }

        let mut rows = Vec::new();
        let mut skipped_count = 0usize;
        let mut by_repo: BTreeMap<String, Vec<WorkspaceRecord>> = BTreeMap::new();
        for workspace in self.list_retention_worktrees_by_activity()? {
            if excluded_workspace_id.as_deref() == Some(workspace.id.as_str()) {
                continue;
            }
            if !Path::new(&workspace.path).exists() {
                continue;
            }
            let Ok(canonical) = std::fs::canonicalize(&workspace.path) else {
                skipped_count += 1;
                rows.push(row(
                    &workspace,
                    WorktreeRetentionRowOutcome::Skipped,
                    "checkout path could not be resolved",
                ));
                continue;
            };
            if !canonical.starts_with(&managed_root) {
                skipped_count += 1;
                rows.push(row(
                    &workspace,
                    WorktreeRetentionRowOutcome::Skipped,
                    "checkout is outside managed worktrees root",
                ));
                continue;
            }
            by_repo
                .entry(workspace.repo_root_id.clone())
                .or_default()
                .push(workspace);
        }

        let keep_per_repo = policy.max_materialized_worktrees_per_repo as usize;
        let mut considered_count = 0usize;
        let mut attempted_count = 0usize;
        let mut retired_count = 0usize;
        let mut blocked_count = 0usize;
        let mut failed_count = 0usize;
        let mut more_eligible_remaining = false;
        for workspaces in by_repo.values() {
            for workspace in workspaces.iter().skip(keep_per_repo) {
                if considered_count >= RETENTION_MAX_CONSIDERED_PER_PASS
                    || retired_count >= RETENTION_MAX_REMOVALS_PER_PASS
                    || attempted_count >= RETENTION_MAX_ATTEMPTS_PER_PASS
                {
                    more_eligible_remaining = true;
                    return Ok(WorktreeRetentionRunResult {
                        policy,
                        already_running: false,
                        considered_count,
                        attempted_count,
                        retired_count,
                        blocked_count,
                        skipped_count,
                        failed_count,
                        more_eligible_remaining,
                        rows,
                    });
                }

                considered_count += 1;
                let preflight = match self
                    .preflight_checker
                    .check_workspace(workspace.clone(), RetirePreflightMode::ActiveRetire)
                    .await
                {
                    Ok(preflight) => preflight,
                    Err(error) => {
                        failed_count += 1;
                        rows.push(row(
                            workspace,
                            WorktreeRetentionRowOutcome::Failed,
                            display_safe_error("workspace eligibility check failed", &error),
                        ));
                        continue;
                    }
                };
                if !preflight.can_retire {
                    blocked_count += 1;
                    rows.push(row(
                        workspace,
                        WorktreeRetentionRowOutcome::Blocked,
                        display_preflight_message(&preflight.blockers),
                    ));
                    continue;
                }

                let exclusive = match tokio::time::timeout(
                    RETENTION_OPERATION_GATE_TIMEOUT,
                    self.operation_gate.acquire_exclusive(&workspace.id),
                )
                .await
                {
                    Ok(lease) => lease,
                    Err(_) => {
                        blocked_count += 1;
                        rows.push(row(
                            workspace,
                            WorktreeRetentionRowOutcome::Blocked,
                            "workspace operation is in progress",
                        ));
                        continue;
                    }
                };

                let Some(reloaded) = self.workspace_runtime.get_workspace(&workspace.id)? else {
                    skipped_count += 1;
                    rows.push(row(
                        workspace,
                        WorktreeRetentionRowOutcome::Skipped,
                        "workspace no longer exists",
                    ));
                    drop(exclusive);
                    continue;
                };
                let Ok(canonical) = std::fs::canonicalize(&reloaded.path) else {
                    skipped_count += 1;
                    rows.push(row(
                        &reloaded,
                        WorktreeRetentionRowOutcome::Skipped,
                        "checkout path could not be resolved",
                    ));
                    drop(exclusive);
                    continue;
                };
                if !canonical.starts_with(&managed_root) {
                    skipped_count += 1;
                    rows.push(row(
                        &reloaded,
                        WorktreeRetentionRowOutcome::Skipped,
                        "checkout is outside managed worktrees root",
                    ));
                    drop(exclusive);
                    continue;
                }
                let preflight = match self
                    .preflight_checker
                    .check_workspace(reloaded.clone(), RetirePreflightMode::ActiveRetire)
                    .await
                {
                    Ok(preflight) => preflight,
                    Err(error) => {
                        failed_count += 1;
                        rows.push(row(
                            &reloaded,
                            WorktreeRetentionRowOutcome::Failed,
                            display_safe_error("workspace eligibility check failed", &error),
                        ));
                        drop(exclusive);
                        continue;
                    }
                };
                if !preflight.can_retire {
                    blocked_count += 1;
                    rows.push(row(
                        &reloaded,
                        WorktreeRetentionRowOutcome::Blocked,
                        display_preflight_message(&preflight.blockers),
                    ));
                    drop(exclusive);
                    continue;
                }
                let Some(_path_lease) = self
                    .checkout_gate
                    .try_acquire(CheckoutPathLockKey::Canonical(canonical))
                else {
                    skipped_count += 1;
                    rows.push(row(
                        &reloaded,
                        WorktreeRetentionRowOutcome::Skipped,
                        "checkout deletion is already in progress",
                    ));
                    drop(exclusive);
                    continue;
                };

                let attempted_at = chrono::Utc::now().to_rfc3339();
                attempted_count += 1;
                let pending = self.workspace_runtime.set_lifecycle_cleanup_state(
                    &reloaded.id,
                    WorkspaceLifecycleState::Retired,
                    WorkspaceCleanupState::Pending,
                    Some(WorkspaceCleanupOperation::Retire),
                    None,
                    None,
                    Some(&attempted_at),
                )?;
                let Some(pending) = pending else {
                    skipped_count += 1;
                    rows.push(row(
                        &reloaded,
                        WorktreeRetentionRowOutcome::Skipped,
                        "workspace no longer exists",
                    ));
                    drop(exclusive);
                    continue;
                };
                let runtime = self.workspace_runtime.clone();
                let cleanup_workspace = pending.clone();
                let cleanup = tokio::task::spawn_blocking(move || {
                    runtime.retire_worktree_materialization(&cleanup_workspace)
                })
                .await
                .map_err(|error| anyhow::anyhow!("retention cleanup task failed: {error}"))?;
                let (state, message, failed_at) = match cleanup {
                    Ok(()) => (WorkspaceCleanupState::Complete, None, None),
                    Err(error) => (
                        WorkspaceCleanupState::Failed,
                        Some(error.to_string()),
                        Some(chrono::Utc::now().to_rfc3339()),
                    ),
                };
                self.workspace_runtime.set_lifecycle_cleanup_state(
                    &reloaded.id,
                    WorkspaceLifecycleState::Retired,
                    state,
                    Some(WorkspaceCleanupOperation::Retire),
                    message.as_deref(),
                    failed_at.as_deref(),
                    Some(&attempted_at),
                )?;
                if state == WorkspaceCleanupState::Complete {
                    retired_count += 1;
                    rows.push(row(
                        &reloaded,
                        WorktreeRetentionRowOutcome::Retired,
                        "checkout retired",
                    ));
                } else {
                    failed_count += 1;
                    rows.push(row(
                        &reloaded,
                        WorktreeRetentionRowOutcome::Failed,
                        "checkout cleanup failed",
                    ));
                }
                drop(exclusive);
            }
        }

        Ok(WorktreeRetentionRunResult {
            policy,
            already_running: false,
            considered_count,
            attempted_count,
            retired_count,
            blocked_count,
            skipped_count,
            failed_count,
            more_eligible_remaining,
            rows,
        })
    }

    fn list_retention_worktrees_by_activity(&self) -> anyhow::Result<Vec<WorkspaceRecord>> {
        let mut workspaces = self.workspace_store.list_standard_active_worktrees()?;
        order_worktrees_by_activity(
            &mut workspaces,
            self.session_store.list_workspace_session_activity()?,
            self.terminal_store.list_workspace_command_run_activity()?,
        );
        Ok(workspaces)
    }
}

impl WorktreeRetentionRunResult {
    fn already_running(policy: WorktreeRetentionPolicyRecord) -> Self {
        Self {
            policy,
            already_running: true,
            considered_count: 0,
            attempted_count: 0,
            retired_count: 0,
            blocked_count: 0,
            skipped_count: 0,
            failed_count: 0,
            more_eligible_remaining: false,
            rows: Vec::new(),
        }
    }

    fn empty(policy: WorktreeRetentionPolicyRecord) -> Self {
        Self {
            policy,
            already_running: false,
            considered_count: 0,
            attempted_count: 0,
            retired_count: 0,
            blocked_count: 0,
            skipped_count: 0,
            failed_count: 0,
            more_eligible_remaining: false,
            rows: Vec::new(),
        }
    }
}

fn row(
    workspace: &WorkspaceRecord,
    outcome: WorktreeRetentionRowOutcome,
    message: impl Into<String>,
) -> WorktreeRetentionRunRow {
    WorktreeRetentionRunRow {
        workspace_id: workspace.id.clone(),
        path: workspace.path.clone(),
        repo_root_id: workspace.repo_root_id.clone(),
        outcome,
        message: message.into(),
    }
}

fn display_preflight_message(blockers: &[WorkspaceRetireBlocker]) -> String {
    blockers
        .first()
        .map(|blocker| blocker.message.clone())
        .unwrap_or_else(|| "workspace is not eligible for retention".to_string())
}

fn display_safe_error(message: &str, error: &anyhow::Error) -> String {
    tracing::warn!(error = %error, "worktree retention candidate failed");
    message.to_string()
}

fn order_worktrees_by_activity(
    workspaces: &mut [WorkspaceRecord],
    session_activity: Vec<(String, String)>,
    terminal_activity: Vec<(String, String)>,
) {
    let session_activity = session_activity
        .into_iter()
        .collect::<BTreeMap<String, String>>();
    let terminal_activity = terminal_activity
        .into_iter()
        .collect::<BTreeMap<String, String>>();
    let activity_by_workspace = workspaces
        .iter()
        .map(|workspace| {
            (
                workspace.id.clone(),
                max_activity_at(workspace, &session_activity, &terminal_activity),
            )
        })
        .collect::<BTreeMap<String, String>>();

    workspaces.sort_by(|a, b| {
        a.repo_root_id
            .cmp(&b.repo_root_id)
            .then_with(|| {
                activity_by_workspace
                    .get(&b.id)
                    .map(String::as_str)
                    .unwrap_or("")
                    .cmp(
                        activity_by_workspace
                            .get(&a.id)
                            .map(String::as_str)
                            .unwrap_or(""),
                    )
            })
            .then_with(|| b.created_at.cmp(&a.created_at))
            .then_with(|| a.id.cmp(&b.id))
    });
}

fn max_activity_at(
    workspace: &WorkspaceRecord,
    session_activity: &BTreeMap<String, String>,
    terminal_activity: &BTreeMap<String, String>,
) -> String {
    let mut value = "";
    for candidate in [
        session_activity.get(&workspace.id).map(String::as_str),
        terminal_activity.get(&workspace.id).map(String::as_str),
        Some(workspace.updated_at.as_str()),
        Some(workspace.created_at.as_str()),
    ]
    .into_iter()
    .flatten()
    {
        if candidate > value {
            value = candidate;
        }
    }
    value.to_string()
}

fn should_spawn_startup_pass(enabled: bool, defer_startup_pass: bool) -> bool {
    enabled && !defer_startup_pass
}

struct RunningGuard<'a>(&'a AtomicBool);

impl Drop for RunningGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

#[cfg(test)]
#[path = "retention_tests.rs"]
mod tests;
