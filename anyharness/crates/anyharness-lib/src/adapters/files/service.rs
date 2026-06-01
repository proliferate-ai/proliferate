use std::path::Path;

use super::operations::{create, delete, list, read, rename, stat, write};
use super::types::{
    CreateWorkspaceFileEntryKind, CreateWorkspaceFileEntryResult, DeleteWorkspaceFileEntryResult,
    ListWorkspaceFilesResult, ReadWorkspaceFileResult, RenameWorkspaceFileEntryResult,
    StatWorkspaceFileResult, WriteWorkspaceFileResult,
};

pub use super::types::FileServiceError;

pub struct WorkspaceFilesService;

impl WorkspaceFilesService {
    pub fn list_entries(
        workspace_root: &Path,
        relative_dir: &str,
    ) -> Result<ListWorkspaceFilesResult, FileServiceError> {
        list::list_entries(workspace_root, relative_dir)
    }

    pub fn read_file(
        workspace_root: &Path,
        relative_path: &str,
    ) -> Result<ReadWorkspaceFileResult, FileServiceError> {
        read::read_file(workspace_root, relative_path)
    }

    pub fn create_entry(
        workspace_root: &Path,
        relative_path: &str,
        kind: CreateWorkspaceFileEntryKind,
        content: Option<&str>,
    ) -> Result<CreateWorkspaceFileEntryResult, FileServiceError> {
        create::create_entry(workspace_root, relative_path, kind, content)
    }

    pub fn rename_entry(
        workspace_root: &Path,
        relative_path: &str,
        new_relative_path: &str,
    ) -> Result<RenameWorkspaceFileEntryResult, FileServiceError> {
        rename::rename_entry(workspace_root, relative_path, new_relative_path)
    }

    pub fn delete_entry(
        workspace_root: &Path,
        relative_path: &str,
    ) -> Result<DeleteWorkspaceFileEntryResult, FileServiceError> {
        delete::delete_entry(workspace_root, relative_path)
    }

    pub fn write_file(
        workspace_root: &Path,
        relative_path: &str,
        content: &str,
        expected_version_token: &str,
    ) -> Result<WriteWorkspaceFileResult, FileServiceError> {
        write::write_file(
            workspace_root,
            relative_path,
            content,
            expected_version_token,
        )
    }

    pub fn stat_file(
        workspace_root: &Path,
        relative_path: &str,
    ) -> Result<StatWorkspaceFileResult, FileServiceError> {
        stat::stat_file(workspace_root, relative_path)
    }
}
