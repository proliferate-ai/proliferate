use std::path::PathBuf;

use super::branch_refresh::WorkspaceBranchRefreshCoordinator;
use super::deletion::WorkspaceDeleteWorkflow;
use super::service::WorkspaceService;
use super::store::WorkspaceStore;
use crate::repo_roots::model::RepoRootRecord;
use crate::repo_roots::service::RepoRootService;
use crate::workspaces::model::WorkspaceRecord;

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
    service: WorkspaceService,
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
        service: WorkspaceService,
        store: WorkspaceStore,
        delete_workflow: WorkspaceDeleteWorkflow,
        repo_root_service: RepoRootService,
        runtime_home: PathBuf,
    ) -> Self {
        Self {
            service,
            store,
            delete_workflow,
            repo_root_service,
            runtime_home,
            branch_refresh: WorkspaceBranchRefreshCoordinator::new(),
        }
    }
}
