use std::path::PathBuf;
use std::sync::Arc;

use super::service::{FileServiceError, WorkspaceFilesService};
use super::types::{
    ListWorkspaceFilesResult, ReadWorkspaceFileResult, StatWorkspaceFileResult,
    WriteWorkspaceFileResult,
};
use crate::cowork::artifacts::CoworkArtifactRuntime;
use crate::git::file_search::WorkspaceFileSearchMatch;
use crate::git::WorkspaceFileSearchCache;
use crate::workspaces::model::WorkspaceRecord;
use crate::workspaces::runtime::WorkspaceRuntime;

#[derive(Clone)]
pub struct WorkspaceFilesRuntime {
    workspace_runtime: Arc<WorkspaceRuntime>,
    cowork_artifact_runtime: Arc<CoworkArtifactRuntime>,
    workspace_file_search_cache: Arc<WorkspaceFileSearchCache>,
}

impl WorkspaceFilesRuntime {
    pub fn new(
        workspace_runtime: Arc<WorkspaceRuntime>,
        cowork_artifact_runtime: Arc<CoworkArtifactRuntime>,
        workspace_file_search_cache: Arc<WorkspaceFileSearchCache>,
    ) -> Self {
        Self {
            workspace_runtime,
            cowork_artifact_runtime,
            workspace_file_search_cache,
        }
    }

    pub fn list_entries(
        &self,
        workspace_id: &str,
        relative_dir: &str,
    ) -> Result<ListWorkspaceFilesResult, FileServiceError> {
        let workspace = self.resolve_workspace(workspace_id)?;
        WorkspaceFilesService::list_entries(&PathBuf::from(&workspace.path), relative_dir)
    }

    pub fn read_file(
        &self,
        workspace_id: &str,
        relative_path: &str,
    ) -> Result<ReadWorkspaceFileResult, FileServiceError> {
        let workspace = self.resolve_workspace(workspace_id)?;
        WorkspaceFilesService::read_file(&PathBuf::from(&workspace.path), relative_path)
    }

    pub fn search_files(
        &self,
        workspace_id: &str,
        query: &str,
        limit: usize,
    ) -> Result<Vec<WorkspaceFileSearchMatch>, FileServiceError> {
        let workspace = self.resolve_workspace(workspace_id)?;
        self.workspace_file_search_cache
            .search(workspace_id, &PathBuf::from(&workspace.path), query, limit)
            .map_err(|error| FileServiceError::Io(error.to_string()))
    }

    pub fn write_file(
        &self,
        workspace_id: &str,
        relative_path: &str,
        content: &str,
        expected_version_token: &str,
    ) -> Result<WriteWorkspaceFileResult, FileServiceError> {
        let workspace = self.resolve_workspace(workspace_id)?;
        if workspace.surface == "cowork" {
            let is_protected = self
                .cowork_artifact_runtime
                .is_protected_relative_path(&workspace, relative_path)
                .map_err(|error| FileServiceError::ProtectedPath(error.to_string()))?;
            if is_protected {
                return Err(FileServiceError::ProtectedPath(relative_path.to_string()));
            }
        }

        let result = WorkspaceFilesService::write_file(
            &PathBuf::from(&workspace.path),
            relative_path,
            content,
            expected_version_token,
        )?;
        self.workspace_file_search_cache.invalidate(workspace_id);
        Ok(result)
    }

    pub fn stat_file(
        &self,
        workspace_id: &str,
        relative_path: &str,
    ) -> Result<StatWorkspaceFileResult, FileServiceError> {
        let workspace = self.resolve_workspace(workspace_id)?;
        WorkspaceFilesService::stat_file(&PathBuf::from(&workspace.path), relative_path)
    }

    fn resolve_workspace(&self, workspace_id: &str) -> Result<WorkspaceRecord, FileServiceError> {
        self.workspace_runtime
            .get_workspace(workspace_id)
            .map_err(|error| FileServiceError::Io(error.to_string()))?
            .ok_or_else(|| {
                FileServiceError::NotFound(format!("workspace not found: {workspace_id}"))
            })
    }
}
