use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::adapters::git::types::{
    GitStatusSummarySnapshot as AdapterGitStatusSummarySnapshot,
    GitStatusSummaryState as AdapterGitStatusSummaryState,
};
use crate::adapters::git::GitService;
use crate::domains::sessions::store::SessionStore;
use crate::domains::workspaces::checkout_gate::{CheckoutDeletionGate, CheckoutPathLockKey};
use crate::domains::workspaces::managed_root::canonical_managed_worktrees_root;
use crate::domains::workspaces::model::{
    WorkspaceCleanupOperation as DomainWorkspaceCleanupOperation,
    WorkspaceCleanupState as DomainWorkspaceCleanupState, WorkspaceKind as DomainWorkspaceKind,
    WorkspaceLifecycleState as DomainWorkspaceLifecycleState,
};
use crate::domains::workspaces::store::WorkspaceStore;

#[derive(Debug, Clone)]
pub struct WorktreeInventory {
    pub rows: Vec<WorktreeInventoryRow>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorktreeInventoryState {
    Associated,
    OrphanCheckout,
    MissingCheckout,
    Conflict,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorktreeInventoryAction {
    PruneCheckout,
    DeleteWorkspaceHistory,
    RetryPurge,
    DeleteOrphanCheckout,
}

#[derive(Debug, Clone)]
pub struct WorktreeInventoryWorkspaceSummary {
    pub id: String,
    pub kind: WorkspaceKind,
    pub lifecycle_state: WorkspaceLifecycleState,
    pub cleanup_state: WorkspaceCleanupState,
    pub cleanup_operation: Option<WorkspaceCleanupOperation>,
    pub display_name: Option<String>,
    pub branch: Option<String>,
    pub session_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorktreeGitStatusState {
    Clean,
    Dirty,
    Conflicted,
    Unknown,
}

#[derive(Debug, Clone)]
pub struct WorktreeGitStatusSummary {
    pub state: WorktreeGitStatusState,
    pub clean: bool,
    pub conflicted: bool,
    pub changed_file_count: u32,
    pub untracked_file_count: u32,
    pub ahead: u32,
    pub behind: u32,
    pub branch: Option<String>,
    pub upstream_branch: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone)]
pub struct WorktreeStorageEstimate {
    pub worktree_bytes: Option<u64>,
    pub sqlite_bytes: Option<u64>,
    pub total_bytes: Option<u64>,
}

#[derive(Debug, Clone)]
pub struct WorktreeInventoryRow {
    pub id: String,
    pub state: WorktreeInventoryState,
    pub path: String,
    pub canonical_path: Option<String>,
    pub managed: bool,
    pub materialized: bool,
    pub repo_root_id: Option<String>,
    pub repo_root_name: Option<String>,
    pub branch: Option<String>,
    pub associated_workspaces: Vec<WorktreeInventoryWorkspaceSummary>,
    pub total_session_count: usize,
    pub git_status: Option<WorktreeGitStatusSummary>,
    pub storage: WorktreeStorageEstimate,
    pub cleanup_operation: Option<WorkspaceCleanupOperation>,
    pub cleanup_state: Option<WorkspaceCleanupState>,
    pub available_actions: Vec<WorktreeInventoryAction>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkspaceKind {
    Worktree,
    Local,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkspaceLifecycleState {
    Active,
    Retired,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkspaceCleanupState {
    None,
    Pending,
    Complete,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkspaceCleanupOperation {
    Retire,
    Purge,
}

#[derive(Clone)]
pub struct WorktreeInventoryService {
    workspace_store: WorkspaceStore,
    session_store: SessionStore,
    checkout_gate: Arc<CheckoutDeletionGate>,
    runtime_home: PathBuf,
}

impl WorktreeInventoryService {
    pub fn new(
        workspace_store: WorkspaceStore,
        session_store: SessionStore,
        checkout_gate: Arc<CheckoutDeletionGate>,
        runtime_home: PathBuf,
    ) -> Self {
        Self {
            workspace_store,
            session_store,
            checkout_gate,
            runtime_home,
        }
    }

    pub fn inventory(&self) -> anyhow::Result<WorktreeInventory> {
        let workspaces = self.workspace_store.list_all()?;
        let mut by_path: BTreeMap<String, Vec<_>> = BTreeMap::new();
        for workspace in workspaces
            .into_iter()
            .filter(|workspace| workspace.kind == DomainWorkspaceKind::Worktree)
        {
            by_path
                .entry(workspace.path.clone())
                .or_default()
                .push(workspace);
        }

        let managed_root = canonical_managed_worktrees_root(&self.runtime_home)?;
        let mut known_paths: HashSet<String> = by_path.keys().cloned().collect();
        let mut rows = Vec::new();

        for (path, associated) in by_path {
            let materialized = Path::new(&path).exists();
            let canonical_path = std::fs::canonicalize(&path)
                .ok()
                .map(|path| path.to_string_lossy().to_string());
            let state = if associated.len() > 1 {
                WorktreeInventoryState::Conflict
            } else if materialized {
                WorktreeInventoryState::Associated
            } else {
                WorktreeInventoryState::MissingCheckout
            };
            let managed = canonical_path
                .as_deref()
                .map(|path| Path::new(path).starts_with(&managed_root))
                .unwrap_or(false);
            let summaries = associated
                .iter()
                .map(|workspace| {
                    let session_count = self
                        .session_store
                        .list_by_workspace(&workspace.id)
                        .map(|sessions| sessions.len())
                        .unwrap_or(0);
                    WorktreeInventoryWorkspaceSummary {
                        id: workspace.id.clone(),
                        kind: workspace_kind(workspace.kind),
                        lifecycle_state: workspace_lifecycle(workspace.lifecycle_state),
                        cleanup_state: workspace_cleanup(workspace.cleanup_state),
                        cleanup_operation: workspace
                            .cleanup_operation
                            .map(workspace_cleanup_operation),
                        display_name: workspace.display_name.clone(),
                        branch: workspace.current_branch.clone(),
                        session_count,
                    }
                })
                .collect::<Vec<_>>();
            let total_session_count = summaries.iter().map(|summary| summary.session_count).sum();
            let sqlite_bytes = estimate_sqlite_bytes(&self.session_store, &associated);
            let worktree_bytes = if materialized {
                directory_size_bytes(Path::new(&path)).ok()
            } else {
                None
            };
            let total_bytes = combine_optional_bytes(worktree_bytes, sqlite_bytes);
            let git_status = if materialized {
                Some(worktree_git_status(GitService::status_summary(Path::new(
                    &path,
                ))))
            } else {
                None
            };
            let mut actions = Vec::new();
            if matches!(state, WorktreeInventoryState::Associated) && materialized {
                actions.push(WorktreeInventoryAction::PruneCheckout);
            }
            if !matches!(state, WorktreeInventoryState::Conflict) {
                actions.push(WorktreeInventoryAction::DeleteWorkspaceHistory);
            }
            if associated.iter().any(|workspace| {
                workspace.cleanup_operation == Some(DomainWorkspaceCleanupOperation::Purge)
                    && matches!(
                        workspace.cleanup_state,
                        DomainWorkspaceCleanupState::Pending | DomainWorkspaceCleanupState::Failed
                    )
            }) {
                actions.push(WorktreeInventoryAction::RetryPurge);
            }
            rows.push(WorktreeInventoryRow {
                id: format!("workspace:{path}"),
                state,
                path: path.clone(),
                canonical_path,
                managed,
                materialized,
                repo_root_id: associated
                    .first()
                    .map(|workspace| workspace.repo_root_id.clone()),
                repo_root_name: None,
                branch: associated
                    .first()
                    .and_then(|workspace| workspace.current_branch.clone()),
                cleanup_operation: associated.first().and_then(|workspace| {
                    workspace.cleanup_operation.map(workspace_cleanup_operation)
                }),
                cleanup_state: associated
                    .first()
                    .map(|workspace| workspace_cleanup(workspace.cleanup_state)),
                associated_workspaces: summaries,
                total_session_count,
                git_status,
                storage: WorktreeStorageEstimate {
                    worktree_bytes,
                    sqlite_bytes,
                    total_bytes,
                },
                available_actions: actions,
            });
            known_paths.insert(path);
        }

        if managed_root.exists() {
            for entry in std::fs::read_dir(&managed_root)? {
                let entry = entry?;
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                let path_string = path.to_string_lossy().to_string();
                if known_paths.contains(&path_string) {
                    continue;
                }
                let worktree_bytes = directory_size_bytes(&path).ok();
                rows.push(WorktreeInventoryRow {
                    id: format!("orphan:{path_string}"),
                    state: WorktreeInventoryState::OrphanCheckout,
                    path: path_string,
                    canonical_path: std::fs::canonicalize(&path)
                        .ok()
                        .map(|path| path.to_string_lossy().to_string()),
                    managed: true,
                    materialized: true,
                    repo_root_id: None,
                    repo_root_name: None,
                    branch: None,
                    associated_workspaces: Vec::new(),
                    total_session_count: 0,
                    git_status: Some(worktree_git_status(GitService::status_summary(&path))),
                    storage: WorktreeStorageEstimate {
                        worktree_bytes,
                        sqlite_bytes: None,
                        total_bytes: worktree_bytes,
                    },
                    cleanup_operation: None,
                    cleanup_state: None,
                    available_actions: vec![WorktreeInventoryAction::DeleteOrphanCheckout],
                });
            }
        }

        Ok(WorktreeInventory { rows })
    }

    pub fn prune_orphan(&self, path: &str) -> anyhow::Result<WorktreeInventory> {
        let canonical_root = canonical_managed_worktrees_root(&self.runtime_home)?;
        let canonical_path = std::fs::canonicalize(path)
            .map_err(|error| anyhow::anyhow!("canonicalizing orphan worktree: {error}"))?;
        if !canonical_path.starts_with(&canonical_root) {
            anyhow::bail!("orphan prune target is outside the managed worktrees root");
        }
        if self.path_has_associated_workspace(path, &canonical_path)? {
            anyhow::bail!("orphan prune target is associated with an AnyHarness workspace");
        }
        let Some(_lease) = self
            .checkout_gate
            .try_acquire(CheckoutPathLockKey::Canonical(canonical_path.clone()))
        else {
            anyhow::bail!("checkout deletion is already in progress for this path");
        };
        let worktree_paths = git_worktree_paths(&canonical_path)?;
        if !worktree_paths.iter().any(|path| path == &canonical_path) {
            anyhow::bail!("orphan prune target is not a linked git worktree");
        }
        let Some(control_worktree) = worktree_paths.iter().find(|path| *path != &canonical_path)
        else {
            anyhow::bail!("orphan prune target has no controlling git worktree");
        };

        let status = std::process::Command::new("git")
            .arg("-C")
            .arg(&canonical_path)
            .args(["status", "--porcelain"])
            .output()
            .map_err(|error| anyhow::anyhow!("checking orphan worktree status: {error}"))?;
        if !status.status.success() {
            anyhow::bail!("orphan prune target is not a valid git checkout");
        }
        if !status.stdout.is_empty() {
            anyhow::bail!("orphan prune target has uncommitted changes");
        }

        let remove = std::process::Command::new("git")
            .arg("-C")
            .arg(control_worktree)
            .args(["worktree", "remove", "--force"])
            .arg(&canonical_path)
            .output()
            .map_err(|error| anyhow::anyhow!("removing orphan worktree: {error}"))?;
        if !remove.status.success() && canonical_path.exists() {
            let stderr = String::from_utf8_lossy(&remove.stderr).trim().to_string();
            anyhow::bail!("failed to remove orphan worktree: {stderr}");
        }
        self.inventory()
    }

    fn path_has_associated_workspace(
        &self,
        requested_path: &str,
        canonical_path: &Path,
    ) -> anyhow::Result<bool> {
        if self
            .workspace_store
            .find_by_path_and_kind(requested_path, DomainWorkspaceKind::Worktree)?
            .is_some()
        {
            return Ok(true);
        }

        let canonical_string = canonical_path.to_string_lossy().to_string();
        if canonical_string != requested_path
            && self
                .workspace_store
                .find_by_path_and_kind(&canonical_string, DomainWorkspaceKind::Worktree)?
                .is_some()
        {
            return Ok(true);
        }

        for workspace in self
            .workspace_store
            .list_all()?
            .into_iter()
            .filter(|workspace| workspace.kind == DomainWorkspaceKind::Worktree)
        {
            if std::fs::canonicalize(&workspace.path).ok().as_deref() == Some(canonical_path) {
                return Ok(true);
            }
        }
        Ok(false)
    }
}

fn estimate_sqlite_bytes(
    session_store: &SessionStore,
    workspaces: &[crate::domains::workspaces::model::WorkspaceRecord],
) -> Option<u64> {
    let mut total = 0_u64;
    let mut has_value = false;
    for workspace in workspaces {
        if let Ok(bytes) = session_store.estimate_workspace_storage_bytes(&workspace.id) {
            total = total.saturating_add(bytes);
            has_value = true;
        }
    }
    has_value.then_some(total)
}

fn combine_optional_bytes(left: Option<u64>, right: Option<u64>) -> Option<u64> {
    match (left, right) {
        (Some(left), Some(right)) => Some(left.saturating_add(right)),
        (Some(left), None) => Some(left),
        (None, Some(right)) => Some(right),
        (None, None) => None,
    }
}

fn directory_size_bytes(path: &Path) -> anyhow::Result<u64> {
    fn visit(path: &Path, total: &mut u64) -> anyhow::Result<()> {
        for entry in std::fs::read_dir(path)? {
            let entry = entry?;
            let file_type = entry.file_type()?;
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                visit(&entry.path(), total)?;
            } else if file_type.is_file() {
                let metadata = entry.metadata()?;
                *total = total.saturating_add(metadata.len());
            }
        }
        Ok(())
    }

    let mut total = 0_u64;
    visit(path, &mut total)?;
    Ok(total)
}

fn worktree_git_status(status: AdapterGitStatusSummarySnapshot) -> WorktreeGitStatusSummary {
    WorktreeGitStatusSummary {
        state: match status.state {
            AdapterGitStatusSummaryState::Clean => WorktreeGitStatusState::Clean,
            AdapterGitStatusSummaryState::Dirty => WorktreeGitStatusState::Dirty,
            AdapterGitStatusSummaryState::Conflicted => WorktreeGitStatusState::Conflicted,
            AdapterGitStatusSummaryState::Unknown => WorktreeGitStatusState::Unknown,
        },
        clean: status.clean,
        conflicted: status.conflicted,
        changed_file_count: status.changed_file_count,
        untracked_file_count: status.untracked_file_count,
        ahead: status.ahead,
        behind: status.behind,
        branch: status.branch,
        upstream_branch: status.upstream_branch,
        error_message: status.error_message,
    }
}

fn git_worktree_paths(worktree: &Path) -> anyhow::Result<Vec<PathBuf>> {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(worktree)
        .args(["worktree", "list", "--porcelain"])
        .output()
        .map_err(|error| anyhow::anyhow!("listing git worktrees: {error}"))?;
    if !output.status.success() {
        anyhow::bail!("orphan prune target is not a linked git worktree");
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let paths = stdout
        .lines()
        .filter_map(|line| line.strip_prefix("worktree "))
        .filter_map(|path| std::fs::canonicalize(path).ok())
        .collect::<Vec<_>>();
    Ok(paths)
}

fn workspace_kind(kind: DomainWorkspaceKind) -> WorkspaceKind {
    match kind {
        DomainWorkspaceKind::Worktree => WorkspaceKind::Worktree,
        DomainWorkspaceKind::Local => WorkspaceKind::Local,
    }
}

fn workspace_lifecycle(state: DomainWorkspaceLifecycleState) -> WorkspaceLifecycleState {
    match state {
        DomainWorkspaceLifecycleState::Retired => WorkspaceLifecycleState::Retired,
        DomainWorkspaceLifecycleState::Active => WorkspaceLifecycleState::Active,
    }
}

fn workspace_cleanup(state: DomainWorkspaceCleanupState) -> WorkspaceCleanupState {
    match state {
        DomainWorkspaceCleanupState::Pending => WorkspaceCleanupState::Pending,
        DomainWorkspaceCleanupState::Complete => WorkspaceCleanupState::Complete,
        DomainWorkspaceCleanupState::Failed => WorkspaceCleanupState::Failed,
        DomainWorkspaceCleanupState::None => WorkspaceCleanupState::None,
    }
}

fn workspace_cleanup_operation(
    operation: DomainWorkspaceCleanupOperation,
) -> WorkspaceCleanupOperation {
    match operation {
        DomainWorkspaceCleanupOperation::Retire => WorkspaceCleanupOperation::Retire,
        DomainWorkspaceCleanupOperation::Purge => WorkspaceCleanupOperation::Purge,
    }
}

#[cfg(test)]
mod tests {
    use std::ffi::OsString;
    use std::path::{Path, PathBuf};
    use std::sync::Arc;

    use super::*;
    use crate::domains::workspaces::managed_root::ANYHARNESS_WORKTREES_ROOT_ENV;
    use crate::domains::workspaces::model::{
        WorkspaceCleanupState, WorkspaceKind, WorkspaceLifecycleState, WorkspaceRecord,
        WorkspaceSurface,
    };
    use crate::persistence::Db;

    #[test]
    fn prune_orphan_rejects_anyharness_owned_checkout() {
        let _env_guard = EnvGuard::remove(ANYHARNESS_WORKTREES_ROOT_ENV);
        let root = TempDirGuard::new("inventory-owned-checkout");
        let runtime_home = root.path().join("runtime");
        let managed_root = root.path().join("worktrees");
        let checkout = managed_root.join("checkout");
        std::fs::create_dir_all(&runtime_home).expect("runtime home");
        std::fs::create_dir_all(&checkout).expect("checkout");

        let db = Db::open_in_memory().expect("open db");
        db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO repo_roots (
                    id, kind, path, display_name, default_branch, remote_provider, remote_owner,
                    remote_repo_name, remote_url, created_at, updated_at
                 ) VALUES (
                    'repo-root-1', 'external', '/tmp/repo-root-1', NULL, 'main', NULL, NULL,
                    NULL, NULL, '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z'
                 )",
                [],
            )?;
            Ok(())
        })
        .expect("seed repo root");
        let workspace_store = WorkspaceStore::new(db.clone());
        workspace_store
            .insert(&workspace_record(
                "workspace-owned-checkout",
                checkout.to_string_lossy().as_ref(),
            ))
            .expect("insert workspace");
        let service = WorktreeInventoryService::new(
            workspace_store,
            SessionStore::new(db),
            Arc::new(CheckoutDeletionGate::new()),
            runtime_home,
        );

        let error = service
            .prune_orphan(checkout.to_string_lossy().as_ref())
            .err()
            .expect("expected owned checkout rejection");

        assert_eq!(
            error.to_string(),
            "orphan prune target is associated with an AnyHarness workspace"
        );
    }

    fn workspace_record(id: &str, path: &str) -> WorkspaceRecord {
        WorkspaceRecord {
            id: id.to_string(),
            kind: WorkspaceKind::Worktree,
            repo_root_id: "repo-root-1".to_string(),
            path: path.to_string(),
            surface: WorkspaceSurface::Standard,
            original_branch: Some("main".to_string()),
            current_branch: Some("main".to_string()),
            display_name: None,
            origin: None,
            creator_context: None,
            lifecycle_state: WorkspaceLifecycleState::Active,
            cleanup_state: WorkspaceCleanupState::None,
            cleanup_operation: None,
            cleanup_error_message: None,
            cleanup_failed_at: None,
            cleanup_attempted_at: None,
            created_at: "2025-01-01T00:00:00Z".to_string(),
            updated_at: "2025-01-01T00:00:00Z".to_string(),
        }
    }

    struct TempDirGuard {
        path: PathBuf,
    }

    impl TempDirGuard {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "anyharness-{name}-{}-{}",
                std::process::id(),
                chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
            ));
            std::fs::create_dir_all(&path).expect("temp dir");
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TempDirGuard {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    struct EnvGuard {
        key: &'static str,
        previous: Option<OsString>,
    }

    impl EnvGuard {
        fn remove(key: &'static str) -> Self {
            let previous = std::env::var_os(key);
            std::env::remove_var(key);
            Self { key, previous }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            match self.previous.as_ref() {
                Some(value) => std::env::set_var(self.key, value),
                None => std::env::remove_var(self.key),
            }
        }
    }
}
