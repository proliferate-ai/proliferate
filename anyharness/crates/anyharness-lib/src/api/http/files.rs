use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;

use anyharness_contract::v1::{
    CreateWorkspaceFileEntryKind as ContractCreateWorkspaceFileEntryKind,
    CreateWorkspaceFileEntryRequest, CreateWorkspaceFileEntryResponse,
    DeleteWorkspaceFileEntryResponse, ListWorkspaceFilesResponse, ReadWorkspaceFileResponse,
    RenameWorkspaceFileEntryRequest, RenameWorkspaceFileEntryResponse,
    SearchWorkspaceFilesResponse, StatWorkspaceFileResponse,
    WorkspaceFileEntry as ContractWorkspaceFileEntry,
    WorkspaceFileKind as ContractWorkspaceFileKind,
    WorkspaceFileSearchResult as ContractWorkspaceFileSearchResult, WriteWorkspaceFileRequest,
    WriteWorkspaceFileResponse,
};

use crate::app::AppState;
use crate::files::service::FileServiceError;
use crate::files::types::{
    CreateWorkspaceFileEntryKind as InternalCreateWorkspaceFileEntryKind,
    CreateWorkspaceFileEntryResult, DeleteWorkspaceFileEntryResult, ListWorkspaceFilesResult,
    ReadWorkspaceFileResult, RenameWorkspaceFileEntryResult, StatWorkspaceFileResult,
    WorkspaceFileEntry as InternalWorkspaceFileEntry,
    WorkspaceFileKind as InternalWorkspaceFileKind, WriteWorkspaceFileResult,
};
use crate::git::file_search::WorkspaceFileSearchMatch;

use super::access::{assert_workspace_mutable, assert_workspace_not_retired};
use super::error::ApiError;
use crate::workspaces::operation_gate::WorkspaceOperationKind;

#[derive(Deserialize)]
pub struct FilePathQuery {
    #[serde(default)]
    pub path: String,
}

#[derive(Deserialize)]
pub struct FileSearchQuery {
    #[serde(default)]
    pub q: String,
    #[serde(default = "default_search_limit")]
    pub limit: usize,
}

fn default_search_limit() -> usize {
    50
}

pub(super) async fn run_files_task<T, F>(task_label: &'static str, task: F) -> Result<T, ApiError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, ApiError> + Send + 'static,
{
    tokio::task::spawn_blocking(task)
        .await
        .map_err(|e| ApiError::internal(format!("{task_label} task failed: {e}")))?
}

pub(super) fn map_service_error(e: FileServiceError) -> ApiError {
    let code = e.problem_code();
    let detail = e.to_string();
    match e.status_code() {
        404 => ApiError::not_found(detail, code),
        409 => ApiError::conflict(detail, code),
        400 => ApiError::bad_request(detail, code),
        _ => ApiError::internal(detail),
    }
}

#[utoipa::path(
    get,
    path = "/v1/workspaces/{workspace_id}/files/entries",
    params(
        ("workspace_id" = String, Path, description = "Workspace ID"),
        ("path" = Option<String>, Query, description = "Directory path relative to workspace root"),
    ),
    responses((status = 200, description = "Workspace file entries", body = ListWorkspaceFilesResponse)),
    tag = "files"
)]
pub async fn list_entries(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Query(query): Query<FilePathQuery>,
) -> Result<Json<ListWorkspaceFilesResponse>, ApiError> {
    let _lease = state
        .workspace_operation_gate
        .acquire_shared(&workspace_id, WorkspaceOperationKind::MaterializationRead)
        .await;
    assert_workspace_not_retired(&state, &workspace_id)?;
    let path = query.path;
    let files_runtime = state.files_runtime.clone();
    let response = run_files_task("list files", move || {
        files_runtime
            .list_entries(&workspace_id, &path)
            .map(list_response_to_contract)
            .map_err(map_service_error)
    })
    .await?;
    Ok(Json(response))
}

#[utoipa::path(
    get,
    path = "/v1/workspaces/{workspace_id}/files/file",
    params(
        ("workspace_id" = String, Path, description = "Workspace ID"),
        ("path" = String, Query, description = "File path relative to workspace root"),
    ),
    responses((status = 200, description = "Workspace file", body = ReadWorkspaceFileResponse)),
    tag = "files"
)]
pub async fn read_file(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Query(query): Query<FilePathQuery>,
) -> Result<Json<ReadWorkspaceFileResponse>, ApiError> {
    let _lease = state
        .workspace_operation_gate
        .acquire_shared(&workspace_id, WorkspaceOperationKind::MaterializationRead)
        .await;
    assert_workspace_not_retired(&state, &workspace_id)?;
    let path = query.path;
    let files_runtime = state.files_runtime.clone();
    let response = run_files_task("read file", move || {
        files_runtime
            .read_file(&workspace_id, &path)
            .map(read_response_to_contract)
            .map_err(map_service_error)
    })
    .await?;
    Ok(Json(response))
}

#[utoipa::path(
    get,
    path = "/v1/workspaces/{workspace_id}/files/search",
    params(
        ("workspace_id" = String, Path, description = "Workspace ID"),
        ("q" = Option<String>, Query, description = "Search query"),
        ("limit" = Option<usize>, Query, description = "Maximum results"),
    ),
    responses((status = 200, description = "Workspace file search results", body = SearchWorkspaceFilesResponse)),
    tag = "files"
)]
pub async fn search_files(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Query(query): Query<FileSearchQuery>,
) -> Result<Json<SearchWorkspaceFilesResponse>, ApiError> {
    let _lease = state
        .workspace_operation_gate
        .acquire_shared(&workspace_id, WorkspaceOperationKind::MaterializationRead)
        .await;
    assert_workspace_not_retired(&state, &workspace_id)?;
    let files_runtime = state.files_runtime.clone();
    let search_query = query.q;
    let limit = query.limit.clamp(1, 200);

    let response = run_files_task("search files", move || {
        files_runtime
            .search_files(&workspace_id, &search_query, limit)
            .map(search_response_to_contract)
            .map_err(map_service_error)
    })
    .await?;

    Ok(Json(response))
}

#[utoipa::path(
    put,
    path = "/v1/workspaces/{workspace_id}/files/file",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    request_body = WriteWorkspaceFileRequest,
    responses((status = 200, description = "Workspace file write result", body = WriteWorkspaceFileResponse)),
    tag = "files"
)]
pub async fn write_file(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Json(body): Json<WriteWorkspaceFileRequest>,
) -> Result<Json<WriteWorkspaceFileResponse>, ApiError> {
    let _lease = state
        .workspace_operation_gate
        .acquire_shared(&workspace_id, WorkspaceOperationKind::FileWrite)
        .await;
    assert_workspace_mutable(&state, &workspace_id)?;
    let path = body.path;
    let content = body.content;
    let expected_version_token = body.expected_version_token;
    let files_runtime = state.files_runtime.clone();
    let response = run_files_task("write file", move || {
        files_runtime
            .write_file(&workspace_id, &path, &content, &expected_version_token)
            .map(write_response_to_contract)
            .map_err(map_service_error)
    })
    .await?;
    Ok(Json(response))
}

#[utoipa::path(
    post,
    path = "/v1/workspaces/{workspace_id}/files/entries",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    request_body = CreateWorkspaceFileEntryRequest,
    responses((status = 200, description = "Workspace file entry create result", body = CreateWorkspaceFileEntryResponse)),
    tag = "files"
)]
pub async fn create_entry(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Json(body): Json<CreateWorkspaceFileEntryRequest>,
) -> Result<Json<CreateWorkspaceFileEntryResponse>, ApiError> {
    let _lease = state
        .workspace_operation_gate
        .acquire_shared(&workspace_id, WorkspaceOperationKind::FileWrite)
        .await;
    assert_workspace_mutable(&state, &workspace_id)?;
    let path = body.path;
    let content = body.content;
    let kind = create_kind_to_internal(body.kind);
    let files_runtime = state.files_runtime.clone();
    let response = run_files_task("create file entry", move || {
        files_runtime
            .create_entry(&workspace_id, &path, kind, content.as_deref())
            .map(create_entry_response_to_contract)
            .map_err(map_service_error)
    })
    .await?;
    Ok(Json(response))
}

#[utoipa::path(
    patch,
    path = "/v1/workspaces/{workspace_id}/files/entries",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    request_body = RenameWorkspaceFileEntryRequest,
    responses((status = 200, description = "Workspace file entry rename result", body = RenameWorkspaceFileEntryResponse)),
    tag = "files"
)]
pub async fn rename_entry(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Json(body): Json<RenameWorkspaceFileEntryRequest>,
) -> Result<Json<RenameWorkspaceFileEntryResponse>, ApiError> {
    let _lease = state
        .workspace_operation_gate
        .acquire_shared(&workspace_id, WorkspaceOperationKind::FileWrite)
        .await;
    assert_workspace_mutable(&state, &workspace_id)?;
    let path = body.path;
    let new_path = body.new_path;
    let files_runtime = state.files_runtime.clone();
    let response = run_files_task("rename file entry", move || {
        files_runtime
            .rename_entry(&workspace_id, &path, &new_path)
            .map(rename_entry_response_to_contract)
            .map_err(map_service_error)
    })
    .await?;
    Ok(Json(response))
}

#[utoipa::path(
    delete,
    path = "/v1/workspaces/{workspace_id}/files/entries",
    params(
        ("workspace_id" = String, Path, description = "Workspace ID"),
        ("path" = String, Query, description = "Path relative to workspace root"),
    ),
    responses((status = 200, description = "Workspace file entry delete result", body = DeleteWorkspaceFileEntryResponse)),
    tag = "files"
)]
pub async fn delete_entry(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Query(query): Query<FilePathQuery>,
) -> Result<Json<DeleteWorkspaceFileEntryResponse>, ApiError> {
    let _lease = state
        .workspace_operation_gate
        .acquire_shared(&workspace_id, WorkspaceOperationKind::FileWrite)
        .await;
    assert_workspace_mutable(&state, &workspace_id)?;
    let path = query.path;
    let files_runtime = state.files_runtime.clone();
    let response = run_files_task("delete file entry", move || {
        files_runtime
            .delete_entry(&workspace_id, &path)
            .map(delete_entry_response_to_contract)
            .map_err(map_service_error)
    })
    .await?;
    Ok(Json(response))
}

#[utoipa::path(
    get,
    path = "/v1/workspaces/{workspace_id}/files/stat",
    params(
        ("workspace_id" = String, Path, description = "Workspace ID"),
        ("path" = String, Query, description = "Path relative to workspace root"),
    ),
    responses((status = 200, description = "Workspace file metadata", body = StatWorkspaceFileResponse)),
    tag = "files"
)]
pub async fn stat_file(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Query(query): Query<FilePathQuery>,
) -> Result<Json<StatWorkspaceFileResponse>, ApiError> {
    let _lease = state
        .workspace_operation_gate
        .acquire_shared(&workspace_id, WorkspaceOperationKind::MaterializationRead)
        .await;
    assert_workspace_not_retired(&state, &workspace_id)?;
    let path = query.path;
    let files_runtime = state.files_runtime.clone();
    let response = run_files_task("stat file", move || {
        files_runtime
            .stat_file(&workspace_id, &path)
            .map(stat_response_to_contract)
            .map_err(map_service_error)
    })
    .await?;
    Ok(Json(response))
}

fn list_response_to_contract(result: ListWorkspaceFilesResult) -> ListWorkspaceFilesResponse {
    ListWorkspaceFilesResponse {
        directory_path: result.directory_path,
        entries: result
            .entries
            .into_iter()
            .map(file_entry_to_contract)
            .collect(),
    }
}

pub(super) fn read_response_to_contract(
    result: ReadWorkspaceFileResult,
) -> ReadWorkspaceFileResponse {
    ReadWorkspaceFileResponse {
        path: result.path,
        kind: file_kind_to_contract(result.kind),
        content: result.content,
        version_token: result.version_token,
        encoding: result.encoding,
        size_bytes: result.size_bytes,
        modified_at: result.modified_at,
        is_text: result.is_text,
        too_large: result.too_large,
    }
}

fn search_response_to_contract(
    results: Vec<WorkspaceFileSearchMatch>,
) -> SearchWorkspaceFilesResponse {
    SearchWorkspaceFilesResponse {
        results: results.into_iter().map(search_result_to_contract).collect(),
    }
}

fn write_response_to_contract(result: WriteWorkspaceFileResult) -> WriteWorkspaceFileResponse {
    WriteWorkspaceFileResponse {
        path: result.path,
        version_token: result.version_token,
        size_bytes: result.size_bytes,
        modified_at: result.modified_at,
    }
}

fn create_entry_response_to_contract(
    result: CreateWorkspaceFileEntryResult,
) -> CreateWorkspaceFileEntryResponse {
    CreateWorkspaceFileEntryResponse {
        entry: file_entry_to_contract(result.entry),
        file: result.file.map(read_response_to_contract),
    }
}

fn rename_entry_response_to_contract(
    result: RenameWorkspaceFileEntryResult,
) -> RenameWorkspaceFileEntryResponse {
    RenameWorkspaceFileEntryResponse {
        old_path: result.old_path,
        entry: file_entry_to_contract(result.entry),
    }
}

fn delete_entry_response_to_contract(
    result: DeleteWorkspaceFileEntryResult,
) -> DeleteWorkspaceFileEntryResponse {
    DeleteWorkspaceFileEntryResponse {
        path: result.path,
        kind: file_kind_to_contract(result.kind),
    }
}

fn stat_response_to_contract(result: StatWorkspaceFileResult) -> StatWorkspaceFileResponse {
    StatWorkspaceFileResponse {
        path: result.path,
        kind: file_kind_to_contract(result.kind),
        size_bytes: result.size_bytes,
        modified_at: result.modified_at,
        is_text: result.is_text,
    }
}

fn file_entry_to_contract(entry: InternalWorkspaceFileEntry) -> ContractWorkspaceFileEntry {
    ContractWorkspaceFileEntry {
        path: entry.path,
        name: entry.name,
        kind: file_kind_to_contract(entry.kind),
        has_children: entry.has_children,
        size_bytes: entry.size_bytes,
        modified_at: entry.modified_at,
        is_text: entry.is_text,
    }
}

fn search_result_to_contract(entry: WorkspaceFileSearchMatch) -> ContractWorkspaceFileSearchResult {
    ContractWorkspaceFileSearchResult {
        path: entry.path,
        name: entry.name,
    }
}

fn file_kind_to_contract(kind: InternalWorkspaceFileKind) -> ContractWorkspaceFileKind {
    match kind {
        InternalWorkspaceFileKind::File => ContractWorkspaceFileKind::File,
        InternalWorkspaceFileKind::Directory => ContractWorkspaceFileKind::Directory,
        InternalWorkspaceFileKind::Symlink => ContractWorkspaceFileKind::Symlink,
    }
}

fn create_kind_to_internal(
    kind: ContractCreateWorkspaceFileEntryKind,
) -> InternalCreateWorkspaceFileEntryKind {
    match kind {
        ContractCreateWorkspaceFileEntryKind::File => InternalCreateWorkspaceFileEntryKind::File,
        ContractCreateWorkspaceFileEntryKind::Directory => {
            InternalCreateWorkspaceFileEntryKind::Directory
        }
    }
}
