use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;

use anyharness_contract::v1::{
    ListWorkspaceFilesResponse, ReadWorkspaceFileResponse, SearchWorkspaceFilesResponse,
    StatWorkspaceFileResponse, WorkspaceFileEntry as ContractWorkspaceFileEntry,
    WorkspaceFileKind as ContractWorkspaceFileKind,
    WorkspaceFileSearchResult as ContractWorkspaceFileSearchResult, WriteWorkspaceFileRequest,
    WriteWorkspaceFileResponse,
};

use crate::app::AppState;
use crate::files::service::FileServiceError;
use crate::files::types::{
    ListWorkspaceFilesResult, ReadWorkspaceFileResult, StatWorkspaceFileResult,
    WorkspaceFileEntry as InternalWorkspaceFileEntry,
    WorkspaceFileKind as InternalWorkspaceFileKind, WriteWorkspaceFileResult,
};
use crate::git::file_search::WorkspaceFileSearchMatch;

use super::access::assert_workspace_mutable;
use super::error::ApiError;

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

pub async fn list_entries(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Query(query): Query<FilePathQuery>,
) -> Result<Json<ListWorkspaceFilesResponse>, ApiError> {
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

pub async fn read_file(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Query(query): Query<FilePathQuery>,
) -> Result<Json<ReadWorkspaceFileResponse>, ApiError> {
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

pub async fn search_files(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Query(query): Query<FileSearchQuery>,
) -> Result<Json<SearchWorkspaceFilesResponse>, ApiError> {
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

pub async fn write_file(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Json(body): Json<WriteWorkspaceFileRequest>,
) -> Result<Json<WriteWorkspaceFileResponse>, ApiError> {
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

pub async fn stat_file(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Query(query): Query<FilePathQuery>,
) -> Result<Json<StatWorkspaceFileResponse>, ApiError> {
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
