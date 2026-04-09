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
use crate::files::service::{FileServiceError, WorkspaceFilesService};
use crate::files::types::{
    ListWorkspaceFilesResult, ReadWorkspaceFileResult, StatWorkspaceFileResult,
    WorkspaceFileEntry as InternalWorkspaceFileEntry,
    WorkspaceFileKind as InternalWorkspaceFileKind, WriteWorkspaceFileResult,
};
use crate::git::file_search::WorkspaceFileSearchMatch;

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

fn resolve_workspace_root(
    workspace_service: &crate::workspaces::service::WorkspaceService,
    workspace_id: &str,
) -> Result<std::path::PathBuf, ApiError> {
    let ws = workspace_service
        .get_workspace(workspace_id)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| {
            ApiError::not_found(
                format!("workspace not found: {workspace_id}"),
                "WORKSPACE_NOT_FOUND",
            )
        })?;
    Ok(std::path::PathBuf::from(&ws.path))
}

async fn run_files_task<T, F>(
    state: &AppState,
    workspace_id: String,
    task_label: &'static str,
    task: F,
) -> Result<T, ApiError>
where
    T: Send + 'static,
    F: FnOnce(std::path::PathBuf) -> Result<T, ApiError> + Send + 'static,
{
    let workspace_service = state.workspace_service.clone();
    tokio::task::spawn_blocking(move || {
        let root = resolve_workspace_root(&workspace_service, &workspace_id)?;
        task(root)
    })
    .await
    .map_err(|e| ApiError::internal(format!("{task_label} task failed: {e}")))?
}

fn map_service_error(e: FileServiceError) -> ApiError {
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
    let response = run_files_task(&state, workspace_id, "list files", move |root| {
        WorkspaceFilesService::list_entries(&root, &path)
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
    let response = run_files_task(&state, workspace_id, "read file", move |root| {
        WorkspaceFilesService::read_file(&root, &path)
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
    let cache = state.workspace_file_search_cache.clone();
    let search_workspace_id = workspace_id.clone();
    let search_query = query.q;
    let limit = query.limit.clamp(1, 200);

    let response = run_files_task(&state, workspace_id, "search files", move |root| {
        cache
            .search(&search_workspace_id, &root, &search_query, limit)
            .map(search_response_to_contract)
            .map_err(|error| ApiError::internal(error.to_string()))
    })
    .await?;

    Ok(Json(response))
}

pub async fn write_file(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Json(body): Json<WriteWorkspaceFileRequest>,
) -> Result<Json<WriteWorkspaceFileResponse>, ApiError> {
    let path = body.path;
    let content = body.content;
    let expected_version_token = body.expected_version_token;
    let cache = state.workspace_file_search_cache.clone();
    let invalidate_workspace_id = workspace_id.clone();
    let response = run_files_task(&state, workspace_id, "write file", move |root| {
        WorkspaceFilesService::write_file(&root, &path, &content, &expected_version_token)
            .map(|result| {
                cache.invalidate(&invalidate_workspace_id);
                write_response_to_contract(result)
            })
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
    let response = run_files_task(&state, workspace_id, "stat file", move |root| {
        WorkspaceFilesService::stat_file(&root, &path)
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

fn read_response_to_contract(result: ReadWorkspaceFileResult) -> ReadWorkspaceFileResponse {
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
