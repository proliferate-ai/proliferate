use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyharness_contract::v1::{
    WorkspaceCleanupOperation, WorkspaceCleanupState, WorkspaceKind, WorkspaceLifecycleState,
    WorktreeInventoryAction, WorktreeInventoryResponse, WorktreeInventoryRow,
    WorktreeInventoryState, WorktreeInventoryWorkspaceSummary,
};

use crate::sessions::store::SessionStore;
use crate::workspaces::checkout_gate::{CheckoutDeletionGate, CheckoutPathLockKey};
use crate::workspaces::managed_root::canonical_managed_worktrees_root;
use crate::workspaces::store::WorkspaceStore;

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

    pub fn inventory(&self) -> anyhow::Result<WorktreeInventoryResponse> {
        let workspaces = self.workspace_store.list_all()?;
        let mut by_path: BTreeMap<String, Vec<_>> = BTreeMap::new();
        for workspace in workspaces
            .into_iter()
            .filter(|workspace| workspace.kind == "worktree")
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
                        kind: workspace_kind_to_contract(&workspace.kind),
                        lifecycle_state: workspace_lifecycle_to_contract(
                            &workspace.lifecycle_state,
                        ),
                        cleanup_state: workspace_cleanup_to_contract(&workspace.cleanup_state),
                        cleanup_operation: workspace_cleanup_operation_to_contract(
                            workspace.cleanup_operation.as_deref(),
                        ),
                        display_name: workspace.display_name.clone(),
                        branch: workspace.current_branch.clone(),
                        session_count,
                    }
                })
                .collect::<Vec<_>>();
            let total_session_count = summaries.iter().map(|summary| summary.session_count).sum();
            let mut actions = Vec::new();
            if matches!(state, WorktreeInventoryState::Associated) && materialized {
                actions.push(WorktreeInventoryAction::PruneCheckout);
            }
            if !matches!(state, WorktreeInventoryState::Conflict) {
                actions.push(WorktreeInventoryAction::DeleteWorkspaceHistory);
            }
            if associated.iter().any(|workspace| {
                workspace.cleanup_operation.as_deref() == Some("purge")
                    && matches!(workspace.cleanup_state.as_str(), "pending" | "failed")
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
                    .and_then(|workspace| workspace.repo_root_id.clone()),
                repo_root_name: None,
                branch: associated
                    .first()
                    .and_then(|workspace| workspace.current_branch.clone()),
                cleanup_operation: associated.first().and_then(|workspace| {
                    workspace_cleanup_operation_to_contract(workspace.cleanup_operation.as_deref())
                }),
                cleanup_state: associated
                    .first()
                    .map(|workspace| workspace_cleanup_to_contract(&workspace.cleanup_state)),
                associated_workspaces: summaries,
                total_session_count,
                blockers: Vec::new(),
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
                    blockers: Vec::new(),
                    cleanup_operation: None,
                    cleanup_state: None,
                    available_actions: vec![WorktreeInventoryAction::DeleteOrphanCheckout],
                });
            }
        }

        Ok(WorktreeInventoryResponse { rows })
    }

    pub fn prune_orphan(&self, path: &str) -> anyhow::Result<WorktreeInventoryResponse> {
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
            .find_by_path_and_kind(requested_path, "worktree")?
            .is_some()
        {
            return Ok(true);
        }

        let canonical_string = canonical_path.to_string_lossy().to_string();
        if canonical_string != requested_path
            && self
                .workspace_store
                .find_by_path_and_kind(&canonical_string, "worktree")?
                .is_some()
        {
            return Ok(true);
        }

        for workspace in self
            .workspace_store
            .list_all()?
            .into_iter()
            .filter(|workspace| workspace.kind == "worktree")
        {
            if std::fs::canonicalize(&workspace.path).ok().as_deref() == Some(canonical_path) {
                return Ok(true);
            }
        }
        Ok(false)
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

fn workspace_kind_to_contract(kind: &str) -> WorkspaceKind {
    match kind {
        "worktree" => WorkspaceKind::Worktree,
        _ => WorkspaceKind::Local,
    }
}

fn workspace_lifecycle_to_contract(state: &str) -> WorkspaceLifecycleState {
    match state {
        "retired" => WorkspaceLifecycleState::Retired,
        _ => WorkspaceLifecycleState::Active,
    }
}

fn workspace_cleanup_to_contract(state: &str) -> WorkspaceCleanupState {
    match state {
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
    use std::ffi::OsString;
    use std::path::{Path, PathBuf};
    use std::sync::Arc;

    use super::*;
    use crate::persistence::Db;
    use crate::workspaces::managed_root::ANYHARNESS_WORKTREES_ROOT_ENV;
    use crate::workspaces::model::WorkspaceRecord;

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
            kind: "worktree".to_string(),
            repo_root_id: None,
            path: path.to_string(),
            surface: "standard".to_string(),
            source_repo_root_path: path.to_string(),
            source_workspace_id: None,
            git_provider: None,
            git_owner: None,
            git_repo_name: None,
            original_branch: Some("main".to_string()),
            current_branch: Some("main".to_string()),
            display_name: None,
            origin: None,
            creator_context: None,
            lifecycle_state: "active".to_string(),
            cleanup_state: "none".to_string(),
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
