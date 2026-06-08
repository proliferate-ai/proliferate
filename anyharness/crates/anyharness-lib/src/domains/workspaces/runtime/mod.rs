use std::path::PathBuf;

use super::branch_refresh::WorkspaceBranchRefreshCoordinator;
use super::deletion::WorkspaceDeleteWorkflow;
use super::store::WorkspaceStore;
use crate::domains::repo_roots::model::RepoRootRecord;
use crate::domains::repo_roots::service::RepoRootService;
use crate::domains::workspaces::model::WorkspaceRecord;

mod access;
mod env;
mod identity;
mod lifecycle;
mod materialization;
mod mobility;
mod records;
mod repo_metadata;
mod worktrees;

#[cfg(test)]
mod tests;

pub struct WorkspaceRuntime {
    store: WorkspaceStore,
    delete_workflow: WorkspaceDeleteWorkflow,
    repo_root_service: RepoRootService,
    runtime_home: PathBuf,
    branch_refresh: WorkspaceBranchRefreshCoordinator,
}

#[derive(Debug, Clone)]
pub struct WorkspaceResolution {
    pub repo_root: RepoRootRecord,
    pub workspace: WorkspaceRecord,
}

impl WorkspaceRuntime {
    pub fn new(
        store: WorkspaceStore,
        delete_workflow: WorkspaceDeleteWorkflow,
        repo_root_service: RepoRootService,
        runtime_home: PathBuf,
    ) -> Self {
        Self {
            store,
            delete_workflow,
            repo_root_service,
            runtime_home,
            branch_refresh: WorkspaceBranchRefreshCoordinator::new(),
        }
    }
}
