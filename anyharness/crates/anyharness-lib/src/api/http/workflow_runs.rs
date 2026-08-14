//! The gen-2 workflow-runs routes: the courier's PUT, the two reads, and the
//! six command POSTs, exactly the ADR runtime-plane API table. Every command
//! returns the fresh full projection so the client never needs a follow-up
//! read. Reads come from rows; commands go through the manager's one door and
//! its oneshot reply IS the response body (Illegal = the 409).

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use utoipa::ToSchema;

use super::blocking::run_blocking;
use super::error::ApiError;
use crate::app::AppState;
use crate::domains::repo_roots::model::RepoRootRecord;
use crate::domains::workflows::definition::{
    InvocationSnapshot, NodeModel, PlacementMode, WorkflowDefinition,
};
use crate::domains::workflows::materialize::{materialize_planned_context, plan_context_docs};
use crate::domains::workflows::model::WorkflowNodeType;
use crate::domains::workflows::projection::{run_view, RunProjection, RunView};
use crate::domains::workflows::store::NewRunParams;
use crate::domains::workflows::transition::WorkflowCommand;
use crate::domains::workspaces::workflow_placement::WorkflowPlacementRequest;
use crate::live::workflows::WorkflowCommandError;
use super::workspaces_contract::request_origin_or_api_default;

const RUN_NOT_FOUND: &str = "WORKFLOW_RUN_NOT_FOUND";
const NODE_NOT_FOUND: &str = "WORKFLOW_NODE_NOT_FOUND";
const TRANSITION_ILLEGAL: &str = "WORKFLOW_TRANSITION_ILLEGAL";
const SNAPSHOT_INVALID: &str = "WORKFLOW_SNAPSHOT_INVALID";
const MATERIALIZATION_FAILED: &str = "WORKFLOW_WORKSPACE_MATERIALIZATION_FAILED";

/// The PUT body: the frozen invocation snapshot the courier reconstitutes
/// from the control plane's flat invocation response. Extra fields a future
/// courier might forward verbatim (`title`, `definitionRevision`, ...) are
/// tolerated and ignored; `id`, when present, is the frozen invocation's own
/// id and becomes the run row's `invocation_id`.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunPutRequest {
    #[serde(default)]
    pub id: Option<String>,
    pub schema_version: u32,
    pub workflow_definition_id: String,
    pub definition: WorkflowDefinition,
    #[serde(default)]
    #[schema(value_type = Object)]
    pub arguments: serde_json::Map<String, serde_json::Value>,
    pub placement: crate::domains::workflows::definition::InvocationPlacement,
}

#[derive(Debug, serde::Serialize, ToSchema)]
pub struct WorkflowRunsListResponse {
    pub runs: Vec<RunView>,
}

#[derive(Debug, Deserialize)]
pub struct WorkflowRunsListParams {
    pub workspace_id: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct WorkflowRunFailRedoRequest {
    #[serde(default)]
    pub prompt: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunFlipTypeRequest {
    pub node_type: WorkflowNodeType,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunAddAdhocNodeRequest {
    pub anchor_node_row_id: String,
    pub prompt: String,
    #[serde(default)]
    pub model: Option<NodeModel>,
}

fn map_command_error(error: WorkflowCommandError) -> ApiError {
    match error {
        WorkflowCommandError::RunNotFound => {
            ApiError::not_found("workflow run not found", RUN_NOT_FOUND)
        }
        WorkflowCommandError::Illegal(illegal) => ApiError::conflict(
            format!(
                "illegal workflow transition: command {} refused in run state {}{}: {}",
                illegal.command,
                illegal.run_state,
                illegal
                    .node_state
                    .as_deref()
                    .map(|state| format!(" (node state {state})"))
                    .unwrap_or_default(),
                illegal.detail
            ),
            TRANSITION_ILLEGAL,
        ),
        WorkflowCommandError::Internal(error) => ApiError::internal(error.to_string()),
    }
}

/// 404 with the right code unless `node_row_id` names one of the run's node
/// rows. The transition table would refuse a ghost row anyway, but the ADR
/// pins unknown-node to 404, not 409.
fn require_node(projection: &RunProjection, node_row_id: &str) -> Result<(), ApiError> {
    if projection.nodes.iter().any(|node| node.id == node_row_id) {
        return Ok(());
    }
    Err(ApiError::not_found(
        format!("workflow node row {node_row_id} not found"),
        NODE_NOT_FOUND,
    ))
}

async fn load_projection(state: &AppState, run_id: &str) -> Result<RunProjection, ApiError> {
    let store = state.workflow_store.clone();
    let run_id = run_id.to_string();
    run_blocking("workflow_run_detail", move || store.run_detail(&run_id))
        .await?
        .map_err(|error| ApiError::internal(error.to_string()))?
        .ok_or_else(|| ApiError::not_found("workflow run not found", RUN_NOT_FOUND))
}

async fn dispatch_command(
    state: &AppState,
    run_id: &str,
    node_row_id: Option<&str>,
    command: WorkflowCommand,
) -> Result<Json<RunProjection>, ApiError> {
    if let Some(node_row_id) = node_row_id {
        let projection = load_projection(state, run_id).await?;
        require_node(&projection, node_row_id)?;
    }
    let projection = state
        .workflow_manager
        .command(run_id, command)
        .await
        .map_err(map_command_error)?;
    Ok(Json(projection))
}

#[utoipa::path(
    put,
    path = "/v1/workflow-runs/{run_id}",
    request_body = WorkflowRunPutRequest,
    params(("run_id" = String, Path, description = "Client-minted run id; the PUT is idempotent on it")),
    responses(
        (status = 201, description = "Run placed and started", body = RunProjection),
        (status = 200, description = "Idempotent replay: the existing run, untouched", body = RunProjection),
        (status = 400, description = "WORKFLOW_SNAPSHOT_INVALID"),
        (status = 503, description = "WORKFLOW_WORKSPACE_MATERIALIZATION_FAILED, zero rows inserted"),
    ),
    tag = "workflow-runs"
)]
pub async fn put_workflow_run(
    State(state): State<AppState>,
    Path(run_id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Result<(StatusCode, Json<RunProjection>), ApiError> {
    // The runtime revalidates the whole snapshot regardless of server checks;
    // a body that does not even parse is the same 400.
    let invocation_id = body
        .get("id")
        .and_then(|value| value.as_str())
        .map(str::to_string);
    let snapshot: InvocationSnapshot = serde_json::from_value(body)
        .map_err(|error| ApiError::bad_request(format!("invalid snapshot: {error}"), SNAPSHOT_INVALID))?;
    let chain = snapshot
        .validate()
        .map_err(|error| ApiError::bad_request(error.detail, SNAPSHOT_INVALID))?;

    // Idempotent replay: an existing run id returns its projection untouched
    // (and rematerializes the actor if the runtime restarted since).
    {
        let store = state.workflow_store.clone();
        let existing_run_id = run_id.clone();
        let existing = run_blocking("workflow_run_replay_check", move || {
            store.run_detail(&existing_run_id)
        })
        .await?
        .map_err(|error| ApiError::internal(error.to_string()))?;
        if existing.is_some() {
            let manager = state.workflow_manager.clone();
            let replay_run_id = run_id.clone();
            let projection =
                run_blocking("workflow_run_replay_start", move || {
                    manager.start_run(&replay_run_id)
                })
                .await?
                .map_err(map_command_error)?;
            return Ok((StatusCode::OK, Json(projection)));
        }
    }

    // Disk before rows: placement, workspace, exclude entry, and context docs
    // all succeed before one row exists — a failure here is the retry-safe
    // 503 with nothing inserted.
    let workspace_id = {
        let workspace_runtime = state.workspace_runtime.clone();
        let repo_root_service = state.repo_root_service.clone();
        let planned_docs = plan_context_docs(&snapshot, &chain);
        let templates = snapshot.definition.doc_templates.clone();
        let placement = snapshot.placement.clone();
        let run_id = run_id.clone();
        run_blocking("workflow_run_place", move || {
            let repo_root: RepoRootRecord = repo_root_service
                .get_repo_root(&placement.repo_config_id)
                .map_err(|error| anyhow::anyhow!("repo config lookup: {error}"))?
                .ok_or_else(|| {
                    anyhow::anyhow!("repo config {} not found", placement.repo_config_id)
                })?;
            let workspace = match placement.mode {
                PlacementMode::Worktree => {
                    let request = WorkflowPlacementRequest::RepositoryWorktree {
                        run_id: run_id.clone(),
                        repo_root_id: repo_root.id.clone(),
                        base_ref: repo_root
                            .default_branch
                            .clone()
                            .unwrap_or_else(|| "HEAD".to_string()),
                    };
                    let resolved = workspace_runtime
                        .resolve_workflow_placement(&request)
                        .map_err(|error| anyhow::anyhow!("resolve placement: {error}"))?;
                    workspace_runtime
                        .ensure_workflow_workspace(&resolved)
                        .map_err(|error| anyhow::anyhow!("ensure workspace: {error}"))?
                }
                PlacementMode::RepoRoot => {
                    let origin =
                        request_origin_or_api_default(None, "workflow_run_put");
                    workspace_runtime
                        .create_workspace_with_origin_and_creator_context(
                            &repo_root.path,
                            origin,
                            None,
                        )
                        .map_err(|error| anyhow::anyhow!("repo-root workspace: {error}"))?
                        .workspace
                }
            };
            materialize_planned_context(
                std::path::Path::new(&workspace.path),
                &planned_docs,
                &templates,
            )
            .map_err(|error| anyhow::anyhow!("materialize context: {error}"))?;
            Ok::<_, anyhow::Error>(workspace.id)
        })
        .await?
        .map_err(|error| {
            ApiError::new(
                StatusCode::SERVICE_UNAVAILABLE,
                "Workspace materialization failed",
                Some(error.to_string()),
                Some(MATERIALIZATION_FAILED),
            )
        })?
    };

    // One transaction: run + node + doc rows. A racing PUT loses gracefully —
    // the store's replay path returns the winner's rows untouched.
    {
        let store = state.workflow_store.clone();
        let params = NewRunParams {
            run_id: run_id.clone(),
            // The courier's reconstituted body carries no invocation id (a
            // journaled cross-lane gap): fall back to the run id.
            invocation_id: invocation_id.unwrap_or_else(|| run_id.clone()),
            workspace_id,
            snapshot,
        };
        run_blocking("workflow_run_insert", move || {
            store.create_run_with_first_node(params)
        })
        .await?
        .map_err(|error| ApiError::internal(error.to_string()))?;
    }

    let manager = state.workflow_manager.clone();
    let start_run_id = run_id.clone();
    let projection = run_blocking("workflow_run_start", move || {
        manager.start_run(&start_run_id)
    })
    .await?
    .map_err(map_command_error)?;
    Ok((StatusCode::CREATED, Json(projection)))
}

#[utoipa::path(
    get,
    path = "/v1/workflow-runs/{run_id}",
    responses(
        (status = 200, description = "The run projected from rows", body = RunProjection),
        (status = 404, description = "WORKFLOW_RUN_NOT_FOUND"),
    ),
    tag = "workflow-runs"
)]
pub async fn get_workflow_run(
    State(state): State<AppState>,
    Path(run_id): Path<String>,
) -> Result<Json<RunProjection>, ApiError> {
    Ok(Json(load_projection(&state, &run_id).await?))
}

#[utoipa::path(
    get,
    path = "/v1/workflow-runs",
    params(("workspace_id" = Option<String>, Query, description = "Restrict to one workspace")),
    responses(
        (status = 200, description = "Run rows, newest first", body = WorkflowRunsListResponse),
    ),
    tag = "workflow-runs"
)]
pub async fn list_workflow_runs(
    State(state): State<AppState>,
    Query(params): Query<WorkflowRunsListParams>,
) -> Result<Json<WorkflowRunsListResponse>, ApiError> {
    let store = state.workflow_store.clone();
    let runs = run_blocking("workflow_runs_list", move || match params.workspace_id {
        Some(workspace_id) => store.runs_for_workspace(&workspace_id),
        None => store.all_runs(),
    })
    .await?
    .map_err(|error| ApiError::internal(error.to_string()))?;
    Ok(Json(WorkflowRunsListResponse {
        runs: runs.iter().map(run_view).collect(),
    }))
}

#[utoipa::path(
    post,
    path = "/v1/workflow-runs/{run_id}/nodes/{node_row_id}/approve",
    responses(
        (status = 200, description = "Gate approved; the fresh projection", body = RunProjection),
        (status = 404, description = "WORKFLOW_RUN_NOT_FOUND or WORKFLOW_NODE_NOT_FOUND"),
        (status = 409, description = "WORKFLOW_TRANSITION_ILLEGAL"),
    ),
    tag = "workflow-runs"
)]
pub async fn approve_workflow_node(
    State(state): State<AppState>,
    Path((run_id, node_row_id)): Path<(String, String)>,
) -> Result<Json<RunProjection>, ApiError> {
    dispatch_command(
        &state,
        &run_id,
        Some(&node_row_id),
        WorkflowCommand::ApproveGate {
            node_row_id: node_row_id.clone(),
        },
    )
    .await
}

#[utoipa::path(
    post,
    path = "/v1/workflow-runs/{run_id}/nodes/{node_row_id}/fail-redo",
    request_body = WorkflowRunFailRedoRequest,
    responses(
        (status = 200, description = "Replacement row running; the fresh projection", body = RunProjection),
        (status = 404, description = "WORKFLOW_RUN_NOT_FOUND or WORKFLOW_NODE_NOT_FOUND"),
        (status = 409, description = "WORKFLOW_TRANSITION_ILLEGAL"),
    ),
    tag = "workflow-runs"
)]
pub async fn fail_redo_workflow_node(
    State(state): State<AppState>,
    Path((run_id, node_row_id)): Path<(String, String)>,
    Json(body): Json<WorkflowRunFailRedoRequest>,
) -> Result<Json<RunProjection>, ApiError> {
    dispatch_command(
        &state,
        &run_id,
        Some(&node_row_id),
        WorkflowCommand::FailAndRedo {
            node_row_id: node_row_id.clone(),
            prompt: body.prompt,
        },
    )
    .await
}

#[utoipa::path(
    post,
    path = "/v1/workflow-runs/{run_id}/nodes/{node_row_id}/type",
    request_body = WorkflowRunFlipTypeRequest,
    responses(
        (status = 200, description = "Node type flipped; the fresh projection", body = RunProjection),
        (status = 404, description = "WORKFLOW_RUN_NOT_FOUND or WORKFLOW_NODE_NOT_FOUND"),
        (status = 409, description = "WORKFLOW_TRANSITION_ILLEGAL"),
    ),
    tag = "workflow-runs"
)]
pub async fn flip_workflow_node_type(
    State(state): State<AppState>,
    Path((run_id, node_row_id)): Path<(String, String)>,
    Json(body): Json<WorkflowRunFlipTypeRequest>,
) -> Result<Json<RunProjection>, ApiError> {
    dispatch_command(
        &state,
        &run_id,
        Some(&node_row_id),
        WorkflowCommand::FlipType {
            node_row_id: node_row_id.clone(),
            node_type: body.node_type,
        },
    )
    .await
}

#[utoipa::path(
    post,
    path = "/v1/workflow-runs/{run_id}/undo-advance",
    responses(
        (status = 200, description = "Advance undone; the fresh projection", body = RunProjection),
        (status = 404, description = "WORKFLOW_RUN_NOT_FOUND"),
        (status = 409, description = "WORKFLOW_TRANSITION_ILLEGAL"),
    ),
    tag = "workflow-runs"
)]
pub async fn undo_workflow_advance(
    State(state): State<AppState>,
    Path(run_id): Path<String>,
) -> Result<Json<RunProjection>, ApiError> {
    dispatch_command(&state, &run_id, None, WorkflowCommand::UndoAdvance).await
}

#[utoipa::path(
    post,
    path = "/v1/workflow-runs/{run_id}/resume",
    responses(
        (status = 200, description = "Run resumed; the fresh projection", body = RunProjection),
        (status = 404, description = "WORKFLOW_RUN_NOT_FOUND"),
        (status = 409, description = "WORKFLOW_TRANSITION_ILLEGAL"),
    ),
    tag = "workflow-runs"
)]
pub async fn resume_workflow_run(
    State(state): State<AppState>,
    Path(run_id): Path<String>,
) -> Result<Json<RunProjection>, ApiError> {
    dispatch_command(&state, &run_id, None, WorkflowCommand::Resume).await
}

#[utoipa::path(
    post,
    path = "/v1/workflow-runs/{run_id}/adhoc-nodes",
    request_body = WorkflowRunAddAdhocNodeRequest,
    responses(
        (status = 200, description = "Adhoc row running beside the chain; the fresh projection", body = RunProjection),
        (status = 404, description = "WORKFLOW_RUN_NOT_FOUND or WORKFLOW_NODE_NOT_FOUND (anchor)"),
        (status = 409, description = "WORKFLOW_TRANSITION_ILLEGAL"),
    ),
    tag = "workflow-runs"
)]
pub async fn add_workflow_adhoc_node(
    State(state): State<AppState>,
    Path(run_id): Path<String>,
    Json(body): Json<WorkflowRunAddAdhocNodeRequest>,
) -> Result<Json<RunProjection>, ApiError> {
    dispatch_command(
        &state,
        &run_id,
        Some(&body.anchor_node_row_id),
        WorkflowCommand::AddAdhocNode {
            anchor_node_row_id: body.anchor_node_row_id.clone(),
            prompt: body.prompt,
            model: body.model,
        },
    )
    .await
}
