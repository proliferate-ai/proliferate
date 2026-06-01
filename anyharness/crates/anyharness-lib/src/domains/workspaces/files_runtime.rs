use std::path::PathBuf;
use std::sync::Arc;

use crate::adapters::files::service::{FileServiceError, WorkspaceFilesService};
use crate::adapters::files::types::{
    CreateWorkspaceFileEntryKind, CreateWorkspaceFileEntryResult, DeleteWorkspaceFileEntryResult,
    ListWorkspaceFilesResult, ReadWorkspaceFileResult, RenameWorkspaceFileEntryResult,
    StatWorkspaceFileResult, WriteWorkspaceFileResult,
};
use crate::adapters::git::file_search::WorkspaceFileSearchMatch;
use crate::adapters::git::WorkspaceFileSearchCache;
use crate::domains::workspaces::model::WorkspaceRecord;
use crate::domains::workspaces::runtime::WorkspaceRuntime;

pub trait WorkspaceFileProtection: Send + Sync {
    fn is_protected_relative_path(
        &self,
        workspace: &WorkspaceRecord,
        relative_path: &str,
    ) -> anyhow::Result<bool>;

    fn is_protected_relative_path_or_ancestor(
        &self,
        workspace: &WorkspaceRecord,
        relative_path: &str,
    ) -> anyhow::Result<bool>;
}

#[derive(Clone, Default)]
pub struct WorkspaceFileProtectionRegistry {
    participants: Vec<Arc<dyn WorkspaceFileProtection>>,
}

impl WorkspaceFileProtectionRegistry {
    pub fn new(participants: Vec<Arc<dyn WorkspaceFileProtection>>) -> Self {
        Self { participants }
    }

    fn is_protected_relative_path(
        &self,
        workspace: &WorkspaceRecord,
        relative_path: &str,
    ) -> anyhow::Result<bool> {
        for participant in &self.participants {
            if participant.is_protected_relative_path(workspace, relative_path)? {
                return Ok(true);
            }
        }
        Ok(false)
    }

    fn is_protected_relative_path_or_ancestor(
        &self,
        workspace: &WorkspaceRecord,
        relative_path: &str,
    ) -> anyhow::Result<bool> {
        for participant in &self.participants {
            if participant.is_protected_relative_path_or_ancestor(workspace, relative_path)? {
                return Ok(true);
            }
        }
        Ok(false)
    }
}

#[derive(Clone)]
pub struct WorkspaceFilesRuntime {
    workspace_runtime: Arc<WorkspaceRuntime>,
    file_protection_registry: WorkspaceFileProtectionRegistry,
    workspace_file_search_cache: Arc<WorkspaceFileSearchCache>,
}

impl WorkspaceFilesRuntime {
    pub fn new(
        workspace_runtime: Arc<WorkspaceRuntime>,
        file_protection_registry: WorkspaceFileProtectionRegistry,
        workspace_file_search_cache: Arc<WorkspaceFileSearchCache>,
    ) -> Self {
        Self {
            workspace_runtime,
            file_protection_registry,
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
        self.ensure_relative_path_mutable(&workspace, relative_path)?;

        let result = WorkspaceFilesService::write_file(
            &PathBuf::from(&workspace.path),
            relative_path,
            content,
            expected_version_token,
        )?;
        self.workspace_file_search_cache.invalidate(workspace_id);
        Ok(result)
    }

    pub fn create_entry(
        &self,
        workspace_id: &str,
        relative_path: &str,
        kind: CreateWorkspaceFileEntryKind,
        content: Option<&str>,
    ) -> Result<CreateWorkspaceFileEntryResult, FileServiceError> {
        let workspace = self.resolve_workspace(workspace_id)?;
        self.ensure_relative_path_mutable(&workspace, relative_path)?;

        let result = WorkspaceFilesService::create_entry(
            &PathBuf::from(&workspace.path),
            relative_path,
            kind,
            content,
        )?;
        self.workspace_file_search_cache.invalidate(workspace_id);
        Ok(result)
    }

    pub fn rename_entry(
        &self,
        workspace_id: &str,
        relative_path: &str,
        new_relative_path: &str,
    ) -> Result<RenameWorkspaceFileEntryResult, FileServiceError> {
        let workspace = self.resolve_workspace(workspace_id)?;
        self.ensure_relative_path_or_ancestor_mutable(&workspace, relative_path)?;
        self.ensure_relative_path_mutable(&workspace, new_relative_path)?;

        let result = WorkspaceFilesService::rename_entry(
            &PathBuf::from(&workspace.path),
            relative_path,
            new_relative_path,
        )?;
        self.workspace_file_search_cache.invalidate(workspace_id);
        Ok(result)
    }

    pub fn delete_entry(
        &self,
        workspace_id: &str,
        relative_path: &str,
    ) -> Result<DeleteWorkspaceFileEntryResult, FileServiceError> {
        let workspace = self.resolve_workspace(workspace_id)?;
        self.ensure_relative_path_or_ancestor_mutable(&workspace, relative_path)?;

        let result =
            WorkspaceFilesService::delete_entry(&PathBuf::from(&workspace.path), relative_path)?;
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

    fn ensure_relative_path_mutable(
        &self,
        workspace: &WorkspaceRecord,
        relative_path: &str,
    ) -> Result<(), FileServiceError> {
        let is_protected = self
            .file_protection_registry
            .is_protected_relative_path(workspace, relative_path)
            .map_err(|error| FileServiceError::ProtectedPath(error.to_string()))?;
        if is_protected {
            return Err(FileServiceError::ProtectedPath(relative_path.to_string()));
        }
        Ok(())
    }

    fn ensure_relative_path_or_ancestor_mutable(
        &self,
        workspace: &WorkspaceRecord,
        relative_path: &str,
    ) -> Result<(), FileServiceError> {
        let is_protected = self
            .file_protection_registry
            .is_protected_relative_path_or_ancestor(workspace, relative_path)
            .map_err(|error| FileServiceError::ProtectedPath(error.to_string()))?;
        if is_protected {
            return Err(FileServiceError::ProtectedPath(relative_path.to_string()));
        }
        Ok(())
    }
}
